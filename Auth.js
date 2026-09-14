/**
 * 鈦傳速｜Auth.js — 伺服器端授權核心 (V1.0)
 *
 * 背景：Web App 部署為「任何人 (匿名)」可存取，代表任何不以底線結尾的全域函式都能被
 * 瀏覽器 Console 直接以 google.script.run 呼叫。因此每個會寫入資料 / 讀取敏感資料的
 * 函式都必須在伺服器端驗證 token，前端的密碼畫面只是 UI，不算防線。
 *
 * 機制：HMAC-SHA256 無狀態 token（不佔 CacheService / Properties 空間，也沒有 6 小時上限）
 *   token = base64url(JSON payload) + "." + base64url(HMAC(payload, SESSION_SECRET))
 *   payload = { role: 'admin' | 'driver', name, car, iat, exp }
 *
 * 角色：
 *   admin  — 戰情室 / 派車 / 系統設定 / 分析儀表板 (以 ADMIN_PASSWORD 換發，12 小時)
 *   driver — 司機端 (以白名單姓名換發，180 天；司機端登入本來就是選姓名，不另設密碼)
 *   system — 觸發器 / 編輯器 / 試算表選單 / 已驗證簽章的 Webhook (不發 token，執行期內設定)
 *
 * 需要的 Script Properties：
 *   ADMIN_PASSWORD   管理員密碼（必填，沒有設定就無法登入後台）
 *   SESSION_SECRET   簽章金鑰（第一次執行自動產生，換掉會讓所有人重新登入）
 */

var __AUTH_CTX__ = null; // 單次執行內的授權上下文；每個 google.script.run / 觸發器都是獨立執行，不會互相汙染

var AUTH_TTL = {
  ADMIN_SEC: 3650 * 24 * 60 * 60, // 10 年 (使用者要求：電腦記住登入愈久愈好；要強制全員重登就刪掉 SESSION_SECRET 屬性)
  DRIVER_SEC: 180 * 24 * 60 * 60, // 180 天 (司機手機長期登入)
  WAREHOUSE_SEC: 30 * 24 * 60 * 60 // 30 天 (驗貨頁每次載入由伺服器重發，只夠一個分頁長開)
};

function _getSessionSecret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('SESSION_SECRET');
  if (s) return s;
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    s = props.getProperty('SESSION_SECRET');
    if (!s) {
      s = Utilities.getUuid() + Utilities.getUuid();
      props.setProperty('SESSION_SECRET', s);
    }
  } finally {
    lock.releaseLock();
  }
  return s;
}

function _b64url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes);
}

function _hmac_(text) {
  return _b64url_(Utilities.computeHmacSha256Signature(text, _getSessionSecret_()));
}

/** 常數時間比對，避免 timing attack */
function _safeEqual_(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function _issueToken_(payload, ttlSec) {
  var now = Date.now();
  var body = {};
  for (var k in payload) body[k] = payload[k];
  body.iat = now;
  body.exp = now + ttlSec * 1000;
  var p = _b64url_(Utilities.newBlob(JSON.stringify(body)).getBytes());
  return p + "." + _hmac_(p);
}

/** 回傳 payload 或 null (簽章錯 / 過期 / 格式錯) */
function _parseToken_(token) {
  if (!token || typeof token !== 'string') return null;
  var parts = token.split('.');
  if (parts.length !== 2) return null;
  if (!_safeEqual_(_hmac_(parts[0]), parts[1])) return null;
  var body;
  try {
    body = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8'));
  } catch (e) { return null; }
  if (!body || !body.role || !body.exp || Date.now() > body.exp) return null;
  return body;
}

/**
 * 核心守門員。
 * - 若本次執行已有上下文 (system / 或角色符合) 直接放行 → 內部呼叫不用一路傳 token
 * - 否則驗 token；admin 可以做 driver 能做的所有事
 */
function _requireAuth_(token, roles) {
  if (__AUTH_CTX__) {
    if (__AUTH_CTX__.role === 'system' || __AUTH_CTX__.role === 'admin' || !roles || roles.indexOf(__AUTH_CTX__.role) !== -1) {
      return __AUTH_CTX__;
    }
  }
  var ctx = _parseToken_(token);
  if (!ctx) throw new Error('🔒 AUTH_REQUIRED：身分驗證失效，請重新登入');
  if (roles && roles.indexOf(ctx.role) === -1 && ctx.role !== 'admin') {
    throw new Error('🔒 AUTH_FORBIDDEN：權限不足');
  }
  // V41.22: 司機 token 長效 (180 天)，白名單「帳號啟用=否」必須能即時撤銷 → 查停用名單 (5 分鐘快取一次)
  if (ctx.role === 'driver' && _isDriverDeactivated_(ctx.name)) {
    throw new Error('🔒 AUTH_REQUIRED：此帳號已停用，請聯繫管理員');
  }
  __AUTH_CTX__ = ctx;
  return ctx;
}

/** 白名單「帳號啟用=否」的姓名集合，快取 5 分鐘；讀不到白名單時視為未停用 (不因此鎖死全員) */
function _isDriverDeactivated_(name) {
  if (!name) return false;
  var key = String(name).trim();
  try {
    var cache = CacheService.getScriptCache();
    var raw = cache.get('deactivated_drivers_v1');
    var list;
    if (raw !== null && raw !== undefined) {
      list = JSON.parse(raw);
    } else {
      list = [];
      var sheet = getSS_V11().getSheetByName(V11_PROD_CONFIG.SHEET_WHITELIST);
      if (sheet) {
        var data = sheet.getDataRange().getValues();
        var h = data[0].map(function (v) { return String(v).trim(); });
        var colName = findHIdx_Core(h, "NAME"), colActive = h.indexOf("帳號啟用");
        if (colName !== -1 && colActive !== -1) {
          for (var i = 1; i < data.length; i++) {
            if (String(data[i][colActive]).trim() === "否") list.push(String(data[i][colName]).trim());
          }
        }
      }
      cache.put('deactivated_drivers_v1', JSON.stringify(list), 300);
    }
    return list.indexOf(key) !== -1;
  } catch (e) { return false; }
}

function _requireAdmin_(token) { return _requireAuth_(token, ['admin']); }
/**
 * V41.37 倉庫驗貨頁 (?p=warehouse / bigt.cc QC.html iframe) 專用：
 * 使用者決定驗貨頁「略過後台密碼」。Chrome 在跨網域 iframe 內封鎖 window.prompt()，
 * 所以 QC.html 根本問不到密碼；改由 doGet 在渲染時直接發一枚 role=warehouse 的短效 token 塞進頁面。
 * 這枚 token 只能過 _requireWarehouse_ 守的 5 個驗貨函式，碰不到派車/設定/分析等 admin 功能。
 */
function _requireWarehouse_(token) { return _requireAuth_(token, ['warehouse', 'admin']); }
function _issueWarehouseToken_() { return _issueToken_({ role: 'warehouse', name: '倉庫驗貨' }, AUTH_TTL.WAREHOUSE_SEC); }
function _requireDriver_(token) { return _requireAuth_(token, ['driver', 'admin']); }

/** 只允許「已經通過驗證的執行」呼叫 — 給內部輔助函式用，擋掉從 Console 直接呼叫 */
function _requireCtx_() {
  if (!__AUTH_CTX__) throw new Error('🔒 AUTH_REQUIRED：此函式不可直接呼叫');
  return __AUTH_CTX__;
}

function _asSystem_(label) {
  __AUTH_CTX__ = { role: 'system', name: label || 'SYSTEM' };
  return __AUTH_CTX__;
}

/**
 * 觸發器 / 試算表選單 / Apps Script 編輯器 專用守門員。
 * 這些函式沒有 token 可驗，改用三種只有系統擁有者才具備的情境特徵：
 *   1. 時間觸發器：事件物件的 triggerUid 必須對得上專案內已安裝的觸發器 (外部呼叫者猜不到)
 *   2. 試算表選單：只有在 Sheets UI 內 SpreadsheetApp.getUi() 才不會拋錯
 *   3. 編輯器手動執行：Session.getActiveUser 等於 Session.getEffectiveUser (擁有者本人)
 * 已經是 admin / system 上下文的內部呼叫也直接放行。
 */
function _requireSystemContext_(e) {
  if (__AUTH_CTX__ && (__AUTH_CTX__.role === 'system' || __AUTH_CTX__.role === 'admin')) return __AUTH_CTX__;

  // 1. 觸發器
  if (e && e.triggerUid) {
    var uid = String(e.triggerUid);
    var ok = ScriptApp.getProjectTriggers().some(function (t) { return String(t.getUniqueId()) === uid; });
    if (ok) return _asSystem_('TRIGGER');
  }
  // 2. 試算表選單
  try { SpreadsheetApp.getUi(); return _asSystem_('SHEET_UI'); } catch (uiErr) { }
  // 3. 編輯器 (擁有者本人)
  var active = "", eff = "";
  try { active = String(Session.getActiveUser().getEmail() || "").toLowerCase(); } catch (e1) { }
  try { eff = String(Session.getEffectiveUser().getEmail() || "").toLowerCase(); } catch (e2) { }
  if (active && eff && active === eff) return _asSystem_('OWNER');

  throw new Error('🔒 此功能只能由系統擁有者在 Apps Script 編輯器、試算表選單或觸發器中執行');
}

// ==========================================
// 對外 (google.script.run) 登入 / 驗證入口
// ==========================================

/**
 * 管理員登入：以 ADMIN_PASSWORD 換發 admin token。
 * 沒有預設密碼；請在 Apps Script 編輯器執行 setAdminPassword('新密碼') 或於「專案設定 → 指令碼屬性」設定。
 */
function sysVerifyPwd(pwd) {
  var correctPwd = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!correctPwd) {
    throw new Error('⚠️ 尚未設定 ADMIN_PASSWORD，請管理員先在 Apps Script 專案設定中新增指令碼屬性');
  }
  Utilities.sleep(300); // 減緩暴力嘗試
  if (!_safeEqual_(String(pwd || "").trim(), String(correctPwd).trim())) {
    throw new Error('⚠️ 密碼錯誤，請確認身分');
  }
  var token = _issueToken_({ role: 'admin', name: '管理員' }, AUTH_TTL.ADMIN_SEC);
  return { success: true, token: token, expiresAt: Date.now() + AUTH_TTL.ADMIN_SEC * 1000, message: "身分驗證成功" };
}

/** [編輯器專用] 設定或重設管理員密碼 */
function setAdminPassword(newPwd) {
  _requireSystemContext_();
  if (!newPwd || String(newPwd).trim().length < 4) throw new Error("密碼至少 4 碼");
  PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD', String(newPwd).trim());
  return "✅ 管理員密碼已成功設定於系統屬性中";
}

/** 前端開頁時確認 admin token 是否仍有效 */
function checkAdminSession(token) {
  var ctx = _parseToken_(token);
  return { valid: !!(ctx && ctx.role === 'admin'), expiresAt: ctx ? ctx.exp : 0 };
}

/** 前端開頁時確認 driver token 是否仍有效 */
function checkDriverSession(token) {
  var ctx = _parseToken_(token);
  return { valid: !!(ctx && (ctx.role === 'driver' || ctx.role === 'admin')), name: ctx ? ctx.name : "", car: ctx ? ctx.car : "" };
}

/** 從白名單找姓名，回傳基本資料或 null */
function _lookupWhitelistByName_(name) {
  var ss = getSS_V11();
  var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_WHITELIST);
  if (!sheet) throw new Error('⚠️ 系統尚未初始化白名單');
  var data = sheet.getDataRange().getValues();
  var h = data[0].map(function (v) { return String(v).trim(); });
  var colName = findHIdx_Core(h, "NAME");
  var colEmail = findHIdx_Core(h, "EMAIL");
  var colRole = findHIdx_Core(h, "ROLE");
  var colCar = findHIdx_Core(h, "VEHICLE");
  var colBranch = findHIdx_Core(h, "BRANCH");
  var colActive = h.indexOf("帳號啟用");
  var target = String(name || "").trim();
  if (!target) return null;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colName]).trim() !== target) continue;
    if (colActive !== -1 && String(data[i][colActive]).trim() === "否") return null; // 停用帳號不可登入
    return {
      name: target,
      email: String(getSafeVal(data[i], colEmail)),
      role: String(getSafeVal(data[i], colRole)) || "司機",
      defaultCar: String(getSafeVal(data[i], colCar)),
      branch: String(getSafeVal(data[i], colBranch))
    };
  }
  return null;
}

function _buildDriverParamUrl_(found, token) {
  var scriptUrl = getScriptUrl();
  return scriptUrl
    + "?name=" + encodeURIComponent(found.name)
    + "&car=" + encodeURIComponent(found.defaultCar || "")
    + "&token=" + encodeURIComponent(token)
    + "&ts=" + Date.now();
}

/**
 * 司機端登入：以白名單姓名換發 driver token (180 天)。
 * V34.16 起司機端即為「選姓名登入」，此函式維持原介面，僅改為無狀態簽章 token。
 */
function verifyNameAndIssueToken(name) {
  try {
    var found = _lookupWhitelistByName_(name);
    if (!found) return { error: '⚠️ 找不到此姓名或帳號已停用，請聯繫管理員確認白名單' };
    var token = _issueToken_({ role: 'driver', name: found.name, car: found.defaultCar, branch: found.branch }, AUTH_TTL.DRIVER_SEC);
    return {
      token: token,
      name: found.name,
      defaultCar: found.defaultCar,
      role: found.role,
      paramUrl: _buildDriverParamUrl_(found, token),
      scriptUrl: getScriptUrl()
    };
  } catch (e) {
    return { error: "驗證發生錯誤: " + e.message };
  }
}

/** [封存] 舊介面轉發 */
function verifyEmailAndIssueToken(email) {
  return verifyNameAndIssueToken(email);
}

/** 管理員為特定司機產生專屬登入連結 (需 admin token) */
function generateParamUrlForDriver(name, adminToken) {
  try {
    _requireAdmin_(adminToken);
    var found = _lookupWhitelistByName_(name);
    if (!found) return { error: "找不到該司機" };
    var token = _issueToken_({ role: 'driver', name: found.name, car: found.defaultCar, branch: found.branch }, AUTH_TTL.DRIVER_SEC);
    return { paramUrl: _buildDriverParamUrl_(found, token) };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * 司機是否有權操作某台車：token 內的預設車牌相同、或該車在「車輛管理」對應到此司機、或白名單允許切換車輛。
 */
function _driverMayUseCar_(ctx, car) {
  if (!ctx) return false;
  if (ctx.role === 'admin' || ctx.role === 'system') return true;
  var want = cleanPlate_Core(car);
  if (!want) return true; // 沒有指定車牌的操作不擋
  if (cleanPlate_Core(ctx.car) === want) return true;
  try {
    var vMap = getManagementData().vehicleMap || {};
    for (var p in vMap) {
      if (cleanPlate_Core(p) === want && String(vMap[p]).trim() === String(ctx.name).trim()) return true;
    }
    var found = _lookupWhitelistByName_(ctx.name);
    if (found && cleanPlate_Core(found.defaultCar) === want) return true;
    // 白名單沒有指定預設車牌的司機 (例如支援/代班)，本來就必須在 App 內自選車輛 → 不擋
    if (found && !cleanPlate_Core(found.defaultCar) && !cleanPlate_Core(ctx.car)) return true;
    // 白名單「是否可切換車輛 = 是」的司機允許操作任何車
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_WHITELIST);
    if (sheet) {
      var data = sheet.getDataRange().getValues();
      var h = data[0].map(function (v) { return String(v).trim(); });
      var colName = findHIdx_Core(h, "NAME"), colSwitch = findHIdx_Core(h, "SWITCH_CAR");
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][colName]).trim() === String(ctx.name).trim()) {
          return String(getSafeVal(data[i], colSwitch)).trim() === "是";
        }
      }
    }
  } catch (e) { }
  return false;
}

// ==========================================
// LINE Webhook 驗證
// ==========================================

/**
 * 驗證 LINE Webhook 來源。
 * Apps Script 的 doPost 讀不到 HTTP header，因此無法直接驗 X-Line-Signature；
 * 改用「Webhook URL 附帶秘密參數」：在 LINE Developers Console 的 Webhook URL 尾端加上
 *   ...?bot=gaoyaci&key=<LINE_WEBHOOK_KEY>
 * 並在 Script Properties 設定 LINE_WEBHOOK_KEY（隨機長字串）。
 * 沒有設定或對不上一律拒絕 —— 否則任何人 POST 假事件就能改寫通知群組 ID。
 */
function _verifyLineWebhook_(e) {
  try {
    var webhookKey = PropertiesService.getScriptProperties().getProperty('LINE_WEBHOOK_KEY');
    if (!webhookKey) {
      // 依使用者決定：未設定 LINE_WEBHOOK_KEY 時維持舊行為 (不驗證來源)。
      // 風險：任何人 POST 假事件「測試通知」可改寫 LINE_TARGET_ID。要開啟驗證只需設定此屬性並在 Webhook URL 加 &key=。
      console.warn("doPost: 未設定 LINE_WEBHOOK_KEY，Webhook 來源未驗證");
      return true;
    }
    var gotKey = (e && e.parameter && e.parameter.key) ? String(e.parameter.key) : "";
    if (gotKey && _safeEqual_(webhookKey, gotKey)) return true;
    console.error("doPost: Webhook key 驗證失敗");
    return false;
  } catch (err) {
    console.error("doPost 驗證異常: " + err.message);
    return false;
  }
}
