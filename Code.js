/**
 * 鈦傳速｜AI 訂單識別與寫入規範 V0316.27 (混合指送模式)
 * V35.5: OCR 聯絡人解析優化 (排除業務姓名預查版)
 * V35.2 更新：
 * 1. 圖層 UI 扁平化：取消「今天」總開關，改為直覺的「上午」、「下午」、「明天」、「定位」四分立按鈕。
 * 2. 邏輯優化：勾選「上午」或「下午」即顯示當日對應訂單，未標註時間之單據（全天單）在任一勾選下皆會顯示。
 * 3. UI 樣式美化：橫向排版改為緊湊垂直排列，解決文字折行問題。
 */

const APP_VERSION = "V6.0"; // V6.0: 司機端導航同步優化 & 戰情室「前往中」閃爍提示
const V11_PROD_CONFIG = {
  SS_ID: "1M-Ewy58fQs-QmqzO5nERoXDCm7lm6S_mrrAIR1mUOtA",
  SHEET_TASKS: "派送清單",
  SHEET_LOG: "送貨日誌",
  SHEET_SCHEDULE: "每日行程表",
  SHEET_VEHICLE: "車輛管理",
  SHEET_MAINT: "車輛保養",
  SHEET_STATUS: "車輛即時狀態",
  SHEET_ROUTE: "車輛歷史軌跡",
  SHEET_KPI: "KPI 統計",
  SHEET_WHITELIST: "系統白名單",
  SHEET_AUDIT: "修改紀錄",
  SHEET_DIRECT_MAP: "指送對照表",
  SHEET_FREIGHT: "運費管理表",
  SHEET_COMPANY: "分公司代碼表",
  SHEET_HABIT: "排車習慣記錄",
  // V41: 外部試算表 ID 集中管理 (舊版散落在各函式內)
  GAOYACI_SS_ID: "1G5q-GixMWSdJJeF8ZiXWMOfrx4FMobER25jNc8m4Zds",
  PRODUCT_MASTER_SS_IDS: [
    "16QNID9hLs2K1iy_ePo7MxYxhW4kpDrDlfEIZ2p83ixo", // 安帝嘉
    "1uFKKWBfulg-GmCbJsSomimT5LW5r0N2w28rubrPveTA", // 喜悅納
    "1G5q-GixMWSdJJeF8ZiXWMOfrx4FMobER25jNc8m4Zds", // 高雅瓷
    "1OnLLqn3zUp-AzoD6ds95lZ01XxwOut8bt8SCHYLl0hc"  // 漢樺
  ],
  // V41.30: 「送回公司/倉庫」的地址關鍵字 — 樣品單只有送回這些地方才不計單、不收運費；送到貨運行/加工廠/客戶處照常計費
  HOME_ADDR_KEYWORDS: ["高職西街", "鶯歌倉", "載回", "回鶯歌", "回公司", "喜悅納", "安帝嘉", "高雅瓷", "漢樺公司"],
  // V41.28: 各分公司「銷售報表」(樣品 / 退貨 判定用；漢樺沒有報表，只靠關鍵字)
  SALES_REPORT: {
    "安帝嘉": { ssId: "16QNID9hLs2K1iy_ePo7MxYxhW4kpDrDlfEIZ2p83ixo", sheet: "經銷銷售報表" },
    "喜悅納": { ssId: "1uFKKWBfulg-GmCbJsSomimT5LW5r0N2w28rubrPveTA", sheet: "月報表" },
    "高雅瓷": { ssId: "1G5q-GixMWSdJJeF8ZiXWMOfrx4FMobER25jNc8m4Zds", sheet: "經銷銷售報表" }
  }
};

/** V2632.11: 核心選單初始化 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("🚛 鈦傳速工具")
    .addItem("🧼 執行 3 天數據封存清理", "cleanupOldLogsAndTasks_V11")
    .addItem("🆘 救回誤封存訂單 (從封存區移回)", "emergencyRestoreTasks")
    .addSeparator()
    .addItem("⏰ 建立/更新定時排程 (LINE + Email + 3天自動封存)", "setupHourlyDeliverySummaryTrigger_V11")
    .addSeparator()
    .addItem("🔑 設定管理員密碼", "menuSetAdminPassword")
    .addItem("🧾 建立每 2 小時「樣品/退貨判定」排程 (並立即更新)", "menuSetupSalesDocTrigger")
    .addItem("🧾 立即更新樣品/退貨判定", "menuRefreshSalesDoc")
    .addItem("🧹 清理屬性空間 (UUID 垃圾)", "menuCleanupProperties")
    .addToUi();
}

/** V41: 從試算表選單設定管理員密碼 (屬性超過 50 個時 Apps Script 設定頁無法編輯，改走這裡) */
function menuSetAdminPassword() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt("設定管理員密碼", "請輸入後台登入密碼（至少 4 碼）：", ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  try {
    ui.alert(setAdminPassword(res.getResponseText()));
  } catch (e) {
    ui.alert("❌ " + e.message);
  }
}

function menuSetupSalesDocTrigger() { SpreadsheetApp.getUi().alert(setupSalesDocTypeTrigger_V41()); }
function menuRefreshSalesDoc() { SpreadsheetApp.getUi().alert(refreshSalesDocTypes_V41()); }

/** V41: 從試算表選單清理屬性空間 */
function menuCleanupProperties() {
  var ui = SpreadsheetApp.getUi();
  var before = Object.keys(PropertiesService.getScriptProperties().getProperties()).length;
  cleanupSystemProperties();
  var after = Object.keys(PropertiesService.getScriptProperties().getProperties()).length;
  ui.alert("✅ 清理完成：" + before + " → " + after + " 個屬性");
}

const VISION_API_KEY = PropertiesService.getScriptProperties().getProperty('VISION_API_KEY');
const FOLDER_ID = '1hbNDk90bax55PFjdCSCzGTPTCGy8ztwn';

/** A 等級：初始化白名單分頁 (V2632.19 強制恢復標題) */
function setupWhitelist_V24(e) {
  _requireSystemContext_(e);
  var ss = SpreadsheetApp.openById(V11_PROD_CONFIG.SS_ID);
  var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_WHITELIST);
  var headers = ["帳號啟用", "Email帳號", "姓名", "身分類型", "所屬分公司", "預設車牌", "是否可切換車輛", "手機號碼", "建立日期", "備註", "line通知人"];

  if (!sheet) {
    sheet = ss.insertSheet(V11_PROD_CONFIG.SHEET_WHITELIST);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setBackground("#34495e").setFontColor("#ffffff").setFontWeight("bold");
    sheet.appendRow(["是", Session.getActiveUser().getEmail(), "管理員", "管理者", "安帝嘉", "", "是", "", new Date(), "系統自動初始化"]);
  } else {
    // V2632.11: 檢查標題是否存在，若第一格為空則補回標題列
    var topRow = sheet.getRange(1, 1, 1, 1).getValue();
    if (!topRow || topRow === "") {
      sheet.insertRowBefore(1);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers])
        .setBackground("#34495e").setFontColor("#ffffff").setFontWeight("bold");
    }
  }
  return "✅ 白名單分頁與標題已就緒";
}

function getSS_V11() { return SpreadsheetApp.openById(V11_PROD_CONFIG.SS_ID); }

/** V41: 戰情室快取 key（帶日期，換日自動失效）。所有讀 / 清除都必須走這兩個函式，不可再手寫字串 */
function _warRoomCacheKey_(dateStr) {
  var d = dateStr ? String(dateStr).replace(/\//g, '_') : Utilities.formatDate(new Date(), 'GMT+8', 'yyyy_MM_dd');
  return 'war_room_data_v3_' + d;
}
function _clearWarRoomCache_(dateStr) {
  try {
    var cache = CacheService.getScriptCache();
    cache.remove(_warRoomCacheKey_());
    // 派車常常是排明天的單，明天的 key 一起清
    var tmr = new Date(Date.now() + 86400000);
    cache.remove(_warRoomCacheKey_(Utilities.formatDate(tmr, 'GMT+8', 'yyyy/MM/dd')));
    if (dateStr) cache.remove(_warRoomCacheKey_(dateStr));
  } catch (e) { }
}

/**
 * V41.22: 只寫回「有改到的列 × 有改到的欄」，不再整表 setValues 覆蓋。
 * 整表覆蓋會把讀取快照之後、其他人 (例如司機結案) 寫進去的值蓋回舊值。
 * colIdxs 會自動合併成連續區段以減少 API 呼叫。
 */
function _writeRowCells_(sheet, rowNum, rowArr, colIdxs) {
  var cols = colIdxs.filter(function (c) { return c !== undefined && c !== null && c >= 0; }).sort(function (a, b) { return a - b; });
  var i = 0;
  while (i < cols.length) {
    var start = cols[i], end = start;
    while (i + 1 < cols.length && cols[i + 1] === end + 1) { i++; end = cols[i]; }
    sheet.getRange(rowNum, start + 1, 1, end - start + 1).setValues([rowArr.slice(start, end + 1)]);
    i++;
  }
}

function getSafeVal(row, idx) {
  if (idx === undefined || idx === -1 || idx === null || idx >= row.length) return "";
  var val = row[idx];
  return (val === undefined || val === null) ? "" : val;
}

/** A 等級：核心欄位識別工具 (V2633.4) */
function findHIdx_Core(headers, input) {
  if (!headers || !headers.length) return -1;
  var DEFAULT_MAP = {
    "ID": ["單號", "銷貨單號", "編號", "序號"],
    "CUSTOMER": ["客戶", "客戶名稱", "名稱"],
    "ADDRESS": ["送貨地址", "配送地址", "地址", "地點"],
    "PHONE": ["聯絡電話", "電話", "手機", "手機號碼"],
    "STATUS": ["狀態", "進度", "已完成"],
    "VEHICLE": ["車牌", "車號", "車輛", "預設車牌"],
    "SEQ": ["順序", "趟次"],
    "DATE": ["日期", "建立日期"],
    "BRANCH": ["分公司", "單位", "所屬分公司"],
    "LAT": ["緯度", "Lat"],
    "LNG": ["經度", "Lng"],
    "FINISH_TIME": ["配送完成時間", "結案時間"],
    "ARCHIVE": ["是否封存", "封存"],
    "SWITCH_CAR": ["是否可切換車輛", "可切換車輛"],
    "ROLE": ["身分類型", "等級"],
    "WEIGHT": ["重量", "重量(kg)", "kg", "重量(KG)", "重量kg"],
    "NAME": ["姓名", "人員", "名稱"],
    "EMAIL": ["Email帳號", "帳號", "電郵"],
    "NOTE": ["備註", "注意", "說明", "備注", "特殊需求", "說明事項"],
    "CONTACT": ["聯絡人", "聯繫人", "對象", "窗口"], // V36.2: 聯絡人對照
    "THUMBNAIL": ["貨單縮圖", "縮圖", "照片", "圖片"], // V36.6
    "SHIPPING_TYPE": ["配送方式", "任務類型"], // V8.5
    "RETURN_REASON": ["退回原因", "退回備註"] 
  };

  var keywords = [];
  if (Array.isArray(input)) {
    keywords = input;
  } else {
    keywords = DEFAULT_MAP[input] || [input];
  }

  var h = headers.map(function (v) { return String(v).trim().toLowerCase().replace(/\s/g, ""); });
  for (var k = 0; k < keywords.length; k++) {
    var key = String(keywords[k]).toLowerCase().replace(/\s/g, "");
    if (!key) continue;
    var idx = h.indexOf(key);
    if (idx !== -1) return idx;
    for (var i = 0; i < h.length; i++) {
      if (!h[i] || h[i].length < 2) continue; // 忽略空標頭與單字元標頭 (防止錯誤匹配)
      if (h[i].indexOf(key) !== -1 || key.indexOf(h[i]) !== -1) return i;
    }
  }
  return -1;
}

/** 輔助：日期正規化 (yyyy/MM/dd) */
function normalizeDate_Core(val) {
  if (!val) return "";
  if (val instanceof Date) return Utilities.formatDate(val, "GMT+8", "yyyy/MM/dd");
  var parts = String(val).split(/[-/]/);
  if (parts.length >= 3) {
    var y = parts[0], m = parts[1], d = parts[2];
    var yNum = parseInt(y, 10);
    if (!isNaN(yNum)) {
      if (yNum < 200) {
        y = String(yNum + 1911);
      } else if (y.length === 2) {
        y = "20" + y;
      }
    }
    if (m.length === 1) m = "0" + m;
    if (d.length === 1) d = "0" + d;
    return y + "/" + m + "/" + d;
  }
  return String(val).replace(/-/g, '/');
}

/** 輔助：封膠膜值正規化 (只允許空白或「封」) */
function normalizeWrapSeal_Core(val) {
  var text = String(val || "").trim();
  return text.indexOf("封") !== -1 ? "封" : "";
}

/** 輔助：車牌正規化 (移除符號與空白) */
function cleanPlate_Core(p) {
  if (!p) return "";
  return String(p).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}



/**
 * 取使用者 Email，相容外部 Gmail 帳號 (V2632.3)
 */
function getUserEmail_V11() {
  // 匿名部署下多數訪客拿不到 email，回傳空字串即可；
  // 舊版用 ScriptApp.getOAuthToken() 查 userinfo 的備援拿到的是「部署者」的 email，會把所有訪客都誤判成管理員，已移除。
  try {
    var email = Session.getActiveUser().getEmail();
    return email ? String(email) : "";
  } catch (e) {
    return "";
  }
}

function getScriptUrl() {
  return ScriptApp.getService().getUrl();
}

function doGet(e) {
  // V11.50: 經銷商查詢專用 API 路由入口 (安全後端過濾)
  if (e && e.parameter && e.parameter.action === 'getDealerProgress') {
    return handleDealerApiRequest_V11(e);
  }

  // 除錯用：回傳實際送出的頁面原始碼 (原始碼本來就在公開 repo，無敏感資料；userInfo 固定為訪客)
  if (e && e.parameter && e.parameter.p === 'srcline') {
    var f0 = ['Dashboard', 'Index', 'WebDashboard', 'tracking', 'Warehouse'].indexOf(e.parameter.f) !== -1 ? e.parameter.f : 'Dashboard';
    return ContentService.createTextOutput(_renderPageHtml_(f0, { active: false, role: "訪客" }, 'admin'));
  }
  var page = ((e && e.parameter && e.parameter.p) || 'index').toLowerCase();
  var title = '鈦傳速｜智能運控系統 V8.8';
  var fileName = 'Index';
  
  if (page === 'admin') {
    title = '鈦傳速｜運控核心 V8.8';
    fileName = 'Dashboard';
  } else if (page === 'dispatch') {
    title = '鈦傳速｜派遣戰情室 V8.8';
    fileName = 'Dashboard'; // 派遣系統目前嵌入在 Dashboard 中，但在入口會自動開啟
  } else if (page === 'analytics') {
    title = '鈦傳速｜數據分析儀表板 V8.8';
    fileName = 'WebDashboard';
  } else if (page === 'warehouse' || page === 'wh') {
    title = '鈦傳速｜倉庫驗貨系統 V1.0';
    fileName = 'Warehouse';
  } else if (page === 'tracking' || page === 'client') {
    title = '鈦傳速｜經銷商今日派送追蹤';
    fileName = 'tracking';
  }
  
  var email = getUserEmail_V11();
  var auth = checkAuth_V24(email);
  if (fileName === 'Warehouse') {
    // V41.37: 驗貨頁略過後台密碼 (見 Auth.js _requireWarehouse_)；token 隨頁面下發，只能用驗貨功能
    auth = { active: true, role: 'warehouse', token: _issueWarehouseToken_() };
  }
  // V39.32: GAS 網頁實際渲染在 googleusercontent.com 的內部 iframe，
  // client端 window.location.search 讀不到原始 exec 網址帶的 ?p=xxx，
  // 改用伺服器端變數直接把 page 值塞進頁面，讓「?p=dispatch 自動開啟派車」這類邏輯可靠運作
  var html = _renderPageHtml_(fileName, auth, page);

  return HtmlService.createHtmlOutput(html)
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * V41.9: 自行展開頁面，不走 HtmlService 樣板引擎。
 * 原因：createTemplateFromFile().evaluate() 編譯時會做去註解處理，實測會把 JS 字串裡的 "https://..."
 * 從 // 起截斷 (尤其緊接在 regex 字面值或樣板字串附近)，導致整個 <script> 語法錯誤。
 * 改用 createHtmlOutputFromFile 取原始內容 + 自己做三種替換：
 *   <?!= include('X'); ?>                       → X 檔案原始內容
 *   <?!= JSON.stringify(userInfo || {}) ?>       → JSON
 *   <?!= JSON.stringify(initialPage || '') ?>    → JSON 字串
 */
function _renderPageHtml_(fileName, userInfo, initialPage) {
  var html = HtmlService.createHtmlOutputFromFile(fileName).getContent();
  // createHtmlOutputFromFile 會把 HTML 文字節點裡的 <? 轉成 &lt;? (script 內則不會)，兩種形式都要接
  html = html.replace(/(?:<|&lt;)\?!=\s*include\('([A-Za-z0-9_\-]+)'\);?\s*\?>/g, function (m, inc) {
    try { return HtmlService.createHtmlOutputFromFile(inc).getContent(); } catch (err) { return "<!-- include " + inc + " failed: " + err.message + " -->"; }
  });
  var userJson = JSON.stringify(userInfo || {});
  var pageJson = JSON.stringify(String(initialPage || ''));
  html = html.replace(/<\?!=\s*JSON\.stringify\(userInfo(?:\s*\|\|\s*\{\})?\)\s*\?>/g, userJson);
  html = html.replace(/<\?!=\s*JSON\.stringify\(initialPage(?:\s*\|\|\s*'')?\)\s*\?>/g, pageJson);
  return html;
}

/** V11.20: LINE Webhook 捕捉 Group ID */
function doPost(e) {
  try {
    // V41: 先驗證來源 (Webhook URL 需帶 &key=<LINE_WEBHOOK_KEY>)，否則任何人都能 POST 假事件改寫 LINE_TARGET_ID
    if (!_verifyLineWebhook_(e)) {
      return ContentService.createTextOutput("forbidden");
    }
    _asSystem_('LINE_WEBHOOK');
    var data = JSON.parse(e.postData.contents);
    var botType = (e && e.parameter && e.parameter.bot) ? String(e.parameter.bot).toLowerCase().trim() : "";
    
    // V11.50: 經銷商 LINE Bot 查詢關鍵字攔截與安全回覆 (支援多機器人分流)
    if (typeof handleLineBotWebhook_V11 === 'function') {
      handleLineBotWebhook_V11(data, botType);
    }

    var event = data.events[0];
    var sourceId = "";
    if (event.source.type === 'group') sourceId = event.source.groupId;
    else if (event.source.type === 'room') sourceId = event.source.roomId;
    else sourceId = event.source.userId;

    if (event.type === 'message' && event.message.text === '測試通知') {
      PropertiesService.getScriptProperties().setProperty('LINE_TARGET_ID', sourceId);
      pushLineMessage_V11("✅ 系統已成功連結此群組！\nID: " + sourceId);
    }
  } catch (err) {}
}

/** 支援 HTML 元件化包含 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** A 等級：核心授權驗證 (V2631.16: 動態抓取欄寬，相容刪除帳號啟用欄) */
function checkAuth_V24(email) {
  try {
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_WHITELIST);
    if (!sheet) return { active: false, role: "無 (未初始化)" };

    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { active: false, role: "無資料" };

    var h = data[0].map(function (v) { return String(v).trim(); });
    // V2633.4: 使用核心工具識別欄位
    var colEmail = findHIdx_Core(h, "EMAIL");
    var colName = findHIdx_Core(h, "NAME");
    var colRole = findHIdx_Core(h, "ROLE");
    var colCar = findHIdx_Core(h, "VEHICLE");
    var colBranch = findHIdx_Core(h, "BRANCH");
    var colSwitch = findHIdx_Core(h, "SWITCH_CAR");

    if (colEmail === -1) return { active: false, error: "⚠️ 系統設定錯誤：白名單缺少「Email帳號」欄位" };
    if (colName === -1) return { active: false, error: "⚠️ 系統設定錯誤：白名單缺少「姓名」欄位" };

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][colEmail]).toLowerCase().trim() === String(email).toLowerCase().trim()) {
        return {
          active: true,
          loginEmail: email,
          name: String(getSafeVal(data[i], colName)),
          role: String(getSafeVal(data[i], colRole)),
          branch: String(getSafeVal(data[i], colBranch)),
          defaultCar: String(getSafeVal(data[i], colCar)),
          canSwitchCar: String(getSafeVal(data[i], colSwitch)) === "是",
          scriptUrl: getScriptUrl()
        };
      }
    }
    return { active: false, role: "訪客", detectedEmail: email };
  } catch (e) { return { active: false, error: e.message }; }
}

/** 戰情室資料抓取 V2633.2 (帶快取優化) */
function getWarRoomData_V11(force, targetDateStr, token) {
  _requireAdmin_(token);
  // V36.14: cache key 帶入今日日期，確保換日後自動失效，不再讀到昨日殘留快取
  const cacheKey = _warRoomCacheKey_(targetDateStr);
  const cache = CacheService.getScriptCache();
  if (force) cache.remove(cacheKey); // V36.3: 強制清除快取

  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    var ss = getSS_V11();
    var vInfo = getManagementData();
    var vMap = vInfo.vehicleMap || {};
    var tSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
    if (!tSheet) throw new Error("找不到任務工作表(" + V11_PROD_CONFIG.SHEET_TASKS + ")");
    ensureHeaders_V11(tSheet); // 自我切換 V11.11
    var vSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_VEHICLE);
    var tData = tSheet.getDataRange().getValues();

    // V36.12: 支援查詢歷史天數，若指定日期小於今天，加載「派送清單_封存區」以求完整歷史
    var todayStr = Utilities.formatDate(new Date(), "GMT+8", "yyyy/MM/dd");
    if (targetDateStr && targetDateStr < todayStr) {
      var archiveSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS + "_封存區");
      if (archiveSheet) {
        var archiveData = archiveSheet.getDataRange().getValues();
        if (archiveData.length > 1) {
          tData = tData.concat(archiveData.slice(1));
        }
      }
    }

    var h = tData[0].map(function (v) { return String(v).trim(); });
    // V2633.5: 全面改用標籤式模糊識別，定義存放於 SHEET_FIELD_MAP
    var idx = {
      date: findHIdx_Core(h, "DATE"),
      branch: findHIdx_Core(h, "BRANCH"),
      id: findHIdx_Core(h, "ID"),
      cust: findHIdx_Core(h, "CUSTOMER"),
      phone: findHIdx_Core(h, "PHONE"),
      addr: findHIdx_Core(h, "ADDRESS"),
      weight: findHIdx_Core(h, "WEIGHT"),
      vehicle: findHIdx_Core(h, "VEHICLE"),
      status: findHIdx_Core(h, "STATUS"),
      seq: findHIdx_Core(h, "SEQ"),
      lat: h.indexOf("緯度"),
      lng: h.indexOf("經度"),
      archived: findHIdx_Core(h, "ARCHIVE"),
      timeSlot: h.indexOf("到貨時間"),
      specifiedArrive: h.indexOf("指定到貨時間"), // V40: 強制指定到貨時間 (電梯管制)
      location: findHIdx_Core(h, "LOCATION"), // V4.1: 地點分頁
      thumbnail: findHIdx_Core(h, "THUMBNAIL") , // V36.6
      shippingType: findHIdx_Core(h, "SHIPPING_TYPE"),
      wrapSeal: findHIdx_Core(h, ["封膠膜", "膠膜", "封膜"]),
      docTypeManual: h.indexOf("單據類型(人工)"),
      finishTime: findHIdx_Core(h, "FINISH_TIME"),
      note: findHIdx_Core(h, "NOTE"),
      size: h.indexOf("尺寸"),
      boxes: h.indexOf("箱數")
    };

    // 💡 建立 銷貨單單號 -> 現場簽收單照片 的動態對照表 (從送貨日誌中讀取)
    var signPhotoMap = {};
    try {
      var logSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_LOG);
      if (logSheet) {
        var logData = logSheet.getDataRange().getValues();
        if (logData.length > 1) {
          var logH = logData[0].map(function(v) { return String(v).trim(); });
          var colLogOrderId = logH.indexOf("單號");
          var colLogSignPhoto = logH.indexOf("簽收單照片");
          if (colLogOrderId !== -1 && colLogSignPhoto !== -1) {
            for (var r = 1; r < logData.length; r++) {
              var oId = String(logData[r][colLogOrderId]).trim();
              var pUrl = String(logData[r][colLogSignPhoto]).trim();
              if (oId && pUrl) {
                var normOId = oId.toUpperCase().replace(/-[安高漢喜]$/, '').replace(/-[0-9]+$/, '');
                signPhotoMap[normOId] = pUrl;
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn("建立 signPhotoMap 失敗:", e.message);
    }

    var todayStr = Utilities.formatDate(new Date(), "GMT+8", "yyyy/MM/dd");

    var tasks = [];
    for (var i = 1; i < tData.length; i++) {
      var row = tData[i], orderId = String(getSafeVal(row, idx.id)).trim();
      if (!orderId) continue;

      // V11.17 封存邏輯: 隱藏已封存
      if (idx.archived !== -1 && ["是", "手動刪除"].indexOf(String(getSafeVal(row, idx.archived))) !== -1) continue;

      // 隱藏「昨天以上 且 已完成/退貨完成/結案」的資料 (即使忘記手動封存也不顯示)
      // V5.2.1: 強化日期正規化，確保 yyyy/MM/dd 格式一致性，解決字串比對失效問題
      var rowDate = ""; // V41: 每列重設，避免日期空白的列繼承上一列的日期
      if (idx.date !== -1) {
        var d = getSafeVal(row, idx.date);
        if (d instanceof Date) {
          rowDate = Utilities.formatDate(d, "GMT+8", "yyyy/MM/dd");
        } else if (d && String(d).trim() !== "") {
          var ds = String(d).trim().split(/[-/]/);
          if (ds.length >= 3) {
            var y = ds[0];
            var m = ds[1].padStart(2, '0');
            var dy = ds[2].substring(0, 2).padStart(2, '0');
            var yNum = parseInt(y, 10);
            if (!isNaN(yNum)) {
              if (yNum < 200) {
                y = String(yNum + 1911);
              } else if (y.length === 2) {
                y = "20" + y;
              }
            }
            rowDate = y + "/" + m + "/" + dy;
          }
        }
      }
      // V34.11: 過期任務過濾 - 若有指定歷史日期則精準匹配；若無指定則跳過今天以前的任務 (無論是否完成)
      if (targetDateStr) {
        if (rowDate !== targetDateStr) continue;
      } else {
        if (rowDate && rowDate < todayStr) continue;
      }

      var lat = parseFloat(getSafeVal(row, idx.lat)), lng = parseFloat(getSafeVal(row, idx.lng)), hasGPS = !isNaN(lat) && !isNaN(lng);
      var rawV = String(getSafeVal(row, idx.vehicle)).trim();
      var finalV = rawV;
      // V35.9: 強制標準化車牌/司機代碼 (去空格、去底線、轉換為大寫)，確保前後台對位一致
      if (rawV) {
        var normV = rawV.toUpperCase().replace(/[\s-]/g, "");
        for (var p in vMap) {
          if (p.toUpperCase().replace(/[\s-]/g, "") === normV || String(vMap[p]).toUpperCase().replace(/[\s-]/g, "") === normV) {
            finalV = p; // 統一轉換為車牌作為唯一 ID
            break;
          }
        }
      }

      var rawCust = String(getSafeVal(row, idx.cust));
      var fTime = "";
      var colFT = idx.finishTime;
      if (colFT !== -1) {
        var ftVal = getSafeVal(row, colFT);
        if (ftVal instanceof Date) {
          fTime = Utilities.formatDate(ftVal, "GMT+8", "HH:mm");
        } else if (typeof ftVal === 'string' && ftVal !== "") {
          // 嘗試提取 HH:mm 或 yyyy/MM/dd HH:mm
          var m = ftVal.match(/(\d{1,2}:\d{2})/);
          if (m) fTime = m[1];
        }
      }

      tasks.push({
        id: orderId, branch: String(getSafeVal(row, idx.branch)).trim(), customer: cleanCustName_V11(rawCust),
        address: String(getSafeVal(row, idx.addr)), vehicle: finalV,
        status: String(getSafeVal(row, idx.status)) || "待指派", seq: Number(getSafeVal(row, idx.seq)) || 0,
        lat: hasGPS ? lat : null, lng: hasGPS ? lng : null, weight: Number(getSafeVal(row, idx.weight)) || 0,
        timeSlot: String(getSafeVal(row, idx.timeSlot) || ""),  // V11.12.2
        specifiedArrive: _fmtArriveTime_(getSafeVal(row, idx.specifiedArrive)),  // V40: 強制指定到貨時間
        rowIndex: i + 1, hasGPS: hasGPS, date: rowDate,
        location: String(getSafeVal(row, idx.location) || ""),
        size: String(getSafeVal(row, idx.size) || ""),
        boxes: String(getSafeVal(row, idx.boxes) || ""),
        thumbnail: String(getSafeVal(row, idx.thumbnail) || ""), // V36.6
        signPhoto: signPhotoMap[orderId.toUpperCase().replace(/-[安高漢喜]$/, '').replace(/-[0-9]+$/, '')] || "", // V37.1
        shippingType: idx.shippingType !== -1 ? String(getSafeVal(row, idx.shippingType)) : "",
        wrapSeal: (function () {
          var ws = idx.wrapSeal !== -1 ? String(getSafeVal(row, idx.wrapSeal) || "").trim() : "";
          if (ws) return ws;
          var noteText = idx.note !== -1 ? String(getSafeVal(row, idx.note) || "").trim() : "";
          return noteText.indexOf("膠膜") !== -1 ? "封" : "";
        })(),
        finishTime: fTime
      });
    }

    // V41.28: 樣品 / 退貨 判定 (供戰情室標籤)
    try {
      _annotateDocTypes_(tasks.map(function (t) {
        var r0 = tData[t.rowIndex - 1] || [];
        t.note = idx.note !== -1 ? String(getSafeVal(r0, idx.note) || "") : "";
        t.rawCustomer = String(getSafeVal(r0, idx.cust) || "");
        t.docTypeManual = idx.docTypeManual !== -1 ? String(getSafeVal(r0, idx.docTypeManual) || "").trim() : "";
        return t;
      }));
      tasks.forEach(function (t) { delete t.rawCustomer; delete t.note; }); // 不回傳前端，減少 payload
    } catch (dtErr) { console.log("docType 判定失敗: " + dtErr.message); }

    // V34.9: 讀取里程紀錄 (加總本日總里程)
    var totalKM_Val = 0;
    var carStartTimes = {};
    var schSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_SCHEDULE);
    if (schSheet && schSheet.getLastRow() >= 2) {
      // V41 Fix: 舊版把「最後 51 列」的第一列當標題，行程表一超過 51 列標題就對不到，總里程/上班時間永遠是 0/空白；
      // 且 colCar 從未在本函式宣告 (ReferenceError)。改為：標題列單獨讀，資料只讀最後 50 列。
      var schLastRow = schSheet.getLastRow(), schLastCol = schSheet.getLastColumn();
      var schH = schSheet.getRange(1, 1, 1, schLastCol).getValues()[0].map(function (v) { return String(v).trim(); });
      var schStart = Math.max(2, schLastRow - 49);
      var schD = schSheet.getRange(schStart, 1, schLastRow - schStart + 1, schLastCol).getValues();
      var colST = schH.indexOf("日期"); if (colST === -1) colST = 0;
      var colSchCar = -1;
      ["車牌", "車牌號碼", "車輛"].forEach(function (n) { if (colSchCar === -1 && schH.indexOf(n) !== -1) colSchCar = schH.indexOf(n); });
      if (colSchCar === -1) colSchCar = 1;
      var colKM = -1;
      ["當日總里程", "總里程", "單日里程"].forEach(function (n) { if (colKM === -1 && schH.indexOf(n) !== -1) colKM = schH.indexOf(n); });
      var colTimeIn = schH.indexOf("上班時間");

      for (var s = 0; s < schD.length; s++) {
        var sDate = normalizeDate_Core(schD[s][colST]);
        if (sDate === todayStr) {
          if (colKM !== -1) totalKM_Val += (parseFloat(schD[s][colKM]) || 0);
          if (colTimeIn !== -1 && schD[s][colTimeIn]) {
            var cCar = cleanPlate_Core(schD[s][colSchCar]);
            carStartTimes[cCar] = String(schD[s][colTimeIn]);
          }
        }
      }
    }

    var vehicles = [];
    if (vSheet) {
      var vd = vSheet.getDataRange().getValues();
      var vH = vd[0].map(function (v) { return String(v).trim(); });
      var capIdx = vH.indexOf("載重");
      for (var j = 1; j < vd.length; j++) {
        if (vd[j][0]) {
          vehicles.push({ name: String(vd[j][0]), driver: String(vd[j][1] || "未設定"), capacity: Number(vd[j][capIdx]) || 2500 });
        }
      }
    }

    var vPos = [];
    var sSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_STATUS);
    if (sSheet) {
      var sd = sSheet.getDataRange().getValues();
      for (var k = 1; k < sd.length; k++) {
        if (sd[k][0]) {
          var car = String(sd[k][0]);
          var tAddr = String(sd[k][5] || "");
          var tLat = null, tLng = null;

          var preciseMinutes = null;
          // 若有明確「正前往」目標，嘗試從任務清單抓座標 (V36.10: 增加模糊比對提升命中率)
          if (tAddr) {
            var targetT = tasks.find(function (tk) {
              if (tk.vehicle !== car) return false;
              if (tk.address === tAddr) return true;
              var tkA = String(tk.address).replace(/.*?(市|縣|區)/g, "").replace(/\s/g, "");
              var tdA = String(tAddr).replace(/.*?(市|縣|區)/g, "").replace(/\s/g, "");
              return tkA && tdA && (tkA === tdA || tkA.indexOf(tdA) !== -1 || tdA.indexOf(tkA) !== -1);
            });
            if (targetT && targetT.lat) {
              tLat = targetT.lat; tLng = targetT.lng;
              // V5.1.10: 取得正前往點的流量路況版精確時間
              var resPrecise = calculatePreciseMinutes_V11(parseFloat(sd[k][1]), parseFloat(sd[k][2]), tLat, tLng);
              if (resPrecise !== null) preciseMinutes = resPrecise;
            }
          }

          vPos.push({
            vehicle: car,
            driver: vMap[car] || car, // V6.3.3: 補回司機姓名
            lat: parseFloat(sd[k][1]),
            lng: parseFloat(sd[k][2]),
            lastUpdate: sd[k][3] ? (function (v) {
              if (v instanceof Date) {
                // Google Sheets 純時間儲存會被讀成 1899 年，只取時間部分；新格式才取完整日期時間
                if (v.getFullYear() < 2000) return Utilities.formatDate(v, "GMT+8", "HH:mm:ss");
                return Utilities.formatDate(v, "GMT+8", "yyyy/MM/dd HH:mm:ss");
              }
              return String(v);
            })(sd[k][3]) : "",
            targetAddr: tAddr,
            targetLat: tLat,
            targetLng: tLng,
            targetPreciseMin: preciseMinutes, // V5.1.10
            departureTime: String(sd[k][6] || ""),
            startTime: carStartTimes[cleanPlate_Core(car)] || "" // V6.6: 打卡連動
          });
        }
      }
    }

    // V11.12: KPI 統計計算
    var stats = { totalOrders: tasks.length, delivered: tasks.filter(function (t) { return t.status === '已完成'; }).length, returned: tasks.filter(function (t) { return t.status && t.status.indexOf('退貨') !== -1; }).length, totalWeight: tasks.reduce(function (sum, t) { return sum + (parseFloat(t.weight) || 0); }, 0), totalKM: Math.round(totalKM_Val * 10) / 10 };
    stats.pending = tasks.length - stats.delivered - stats.returned; // Calculate pending based on delivered and returned
    // V13.0: 抓取業務白名單對照圖 (供新增行程介面指派業務使用)
    var salesMap = {};
    try {
      var sheetW = ss.getSheetByName("系統白名單");
      if (sheetW) {
        var wd = sheetW.getDataRange().getValues();
        var wh = wd[0].map(function(v){ return String(v).trim(); });
        var cN = wh.indexOf("姓名"), cB = wh.indexOf("所屬分公司"), cR = wh.indexOf("身分類型"), cA = wh.indexOf("帳號啟用");
        if (cN !== -1 && cB !== -1) {
          for (var w = 1; w < wd.length; w++) {
            if (cA !== -1 && String(wd[w][cA]).trim() === "否") continue;
            // V13.3: 移除硬性 Role 字串檢查，只要帳號啟用且有分公司即載入，避免漏填漏抓
            // var role = cR !== -1 ? String(wd[w][cR] || "").trim() : "";
            // if (role.indexOf("業務") === -1 && role.indexOf("司機") === -1) continue;
            
            var bKey = String(wd[w][cB]).trim();
            var nVal = String(wd[w][cN]).trim();
            if (!bKey || !nVal) continue;
            if (!salesMap[bKey]) salesMap[bKey] = [];
            salesMap[bKey].push(nVal);
          }
        }
      }
    } catch(e) { console.error("Load salesMap failed: " + e); }

    const result = { success: true, tasks: tasks, vehicles: vehicles, vehiclePositions: vPos, kpi: stats, branchSalesMap: salesMap, ver: "V2633.4.5" };
    // 存進快取，有效 5 分鐘 (300秒)，使用帶日期的 key 確保換日後自動失效
    // V41: CacheService 單值上限 100KB，超過會 throw；超過就不快取，不能讓整個戰情室因此失敗
    try {
      var warJson = JSON.stringify(result);
      if (warJson.length < 95000) cache.put(cacheKey, warJson, 300);
      else console.log("戰情室資料 " + warJson.length + " 字元，超過快取上限，略過快取");
    } catch (cacheErr) { console.log("戰情室快取寫入失敗: " + cacheErr.message); }
    return result;
  } catch (e) { return { success: false, error: e.message }; }
}

/** V5.1.12: 分析儀表板核心數據抓取 (近 60 天) */
/** V41.13: 清除分析中心分段快取 */
function _clearDashboardCache_() {
  try {
    var c = CacheService.getScriptCache();
    var meta = c.get('dashboard_stats_v3_meta');
    var cnt = meta ? (JSON.parse(meta).count || 0) : 0;
    for (var i = 0; i < cnt; i++) c.remove('dashboard_stats_v3_' + i);
    c.remove('dashboard_stats_v3_meta');
  } catch (e) { }
}

function getDashboardData(force, token) {
  _requireAdmin_(token);
  const cache = CacheService.getScriptCache();
  // V41.13: 改用分段快取 (原本 95KB 上限幾乎每次都超過 → 等於沒有快取，每次開頁都重讀 3 張表)
  const DASH_CACHE_KEY = 'dashboard_stats_v3';
  if (!force) {
    const cachedObj = readChunkedCacheJson_V11(cache, DASH_CACHE_KEY);
    if (cachedObj && cachedObj.success) return cachedObj;
  }

  try {
    const ss = getSS_V11();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 186); // V41.17: 涵蓋「近半年」
    const cutoffStr = Utilities.formatDate(cutoffDate, "GMT+8", "yyyy/MM/dd");

    // 1. orders: 派送清單
    // 1. orders: 派送清單 (合併載入主表與封存區，以取得完整對帳歷史)
    var sheetsToLoad = [V11_PROD_CONFIG.SHEET_TASKS, V11_PROD_CONFIG.SHEET_TASKS + "_封存區"];
    var allRows = [];
    var tH = null;

    for (var sIdxVal = 0; sIdxVal < sheetsToLoad.length; sIdxVal++) {
      var curSheet = ss.getSheetByName(sheetsToLoad[sIdxVal]);
      if (!curSheet) continue;
      var curData = curSheet.getDataRange().getValues();
      if (curData.length < 2) continue;
      
      if (!tH) {
        tH = curData[0].map(v => String(v).trim());
      }
      
      // 跳過首行標頭，將資料列加入 allRows
      for (var rIdx = 1; rIdx < curData.length; rIdx++) {
        allRows.push(curData[rIdx]);
      }
    }

    if (!tH || allRows.length === 0) {
      return { orders: [], schedule: [], error: "找不到派送清單及封存區分頁" };
    }

    const tIdx = {
      date: findHIdx_Core(tH, "DATE"),
      branch: findHIdx_Core(tH, "BRANCH"),
      cust: findHIdx_Core(tH, "CUSTOMER"),
      weight: findHIdx_Core(tH, "WEIGHT"),
      slot: tH.indexOf("到貨時間"),
      plate: findHIdx_Core(tH, "VEHICLE"),
      status: findHIdx_Core(tH, "STATUS"),
      finish: findHIdx_Core(tH, "FINISH_TIME"),
      archived: findHIdx_Core(tH, "ARCHIVE"),
      shippingType: findHIdx_Core(tH, "SHIPPING_TYPE"),
      wrapSeal: findHIdx_Core(tH, ["封膠膜", "膠膜", "封膜"]),
      address: findHIdx_Core(tH, "ADDRESS"),
      whStatus: tH.indexOf("驗貨狀態"),
      returnReason: findHIdx_Core(tH, "RETURN_REASON"),
      specifiedArrive: tH.indexOf("指定到貨時間"),
      
      // 運費新欄位索引
      freightEst: tH.indexOf("估算運費"),
      freightDetail: tH.indexOf("運費計算明細"),
      adjustedFee: tH.indexOf("調整後運費"),
      carrierFlag: tH.indexOf("貨運行標示"),
      carrierDiscount: tH.indexOf("貨運行折扣"),
      isRemote: tH.indexOf("是否偏遠"),
      isTimedDeliver: tH.indexOf("指定送貨"),
      isTimedReturn: tH.indexOf("指定退貨"),
      isOvertimeWait: tH.indexOf("等候超時"),
      isHeavyCarry: tH.indexOf("加倍搬運"),
      id: findHIdx_Core(tH, "單號"),
      thumbnail: findHIdx_Core(tH, "THUMBNAIL"),
      docTypeManual: tH.indexOf("單據類型(人工)")
    };

    // V8.6: 品項欄位動態定位 (品項1編號~品項10編號 + 數量)
    var itemCodeIdx = [], itemQtyIdx = [];
    for (var it = 1; it <= 10; it++) {
      itemCodeIdx.push(tH.indexOf("品項" + it + "編號"));
      itemQtyIdx.push(tH.indexOf("品項" + it + "數量"));
    }
    var freightRatesInfo = loadFreightRates_V11();
    var noteIdx = findHIdx_Core(tH, "NOTE"); // V41: 提到迴圈外

    const orders = [];
    // 從後往前掃，提升大數據下的效能
    for (let i = allRows.length - 1; i >= 0; i--) {
      const row = allRows[i];
      const dVal = row[tIdx.date];
      if (!dVal) continue;
      
      const d = (dVal instanceof Date) ? dVal : new Date(dVal);
      if (!d || isNaN(d.getTime())) continue;
      if (d < cutoffDate) {
         continue;
      }

      const arch = String(getSafeVal(row, tIdx.archived));
      if (arch === "是" || arch === "手動刪除") continue;

      var noteText = noteIdx !== -1 ? String(getSafeVal(row, noteIdx) || "").trim() : "";
      var slotText = String(getSafeVal(row, tIdx.slot) || "").trim();
      var shippingTypeVal = tIdx.shippingType !== -1 ? String(getSafeVal(row, tIdx.shippingType) || "").trim() : "";
      var statusVal = String(getSafeVal(row, tIdx.status) || "").trim();
      var addressVal = String(getSafeVal(row, tIdx.address) || "").trim();
      var weightVal = parseFloat(getSafeVal(row, tIdx.weight)) || 0;

      // 讀取/計算運費
      var fEst = tIdx.freightEst !== -1 ? parseFloat(getSafeVal(row, tIdx.freightEst)) || 0 : 0;
      var fDetail = tIdx.freightDetail !== -1 ? String(getSafeVal(row, tIdx.freightDetail) || "").trim() : "";
      
      var isRemoteVal = tIdx.isRemote !== -1 ? String(getSafeVal(row, tIdx.isRemote) || "").trim() : "";
      var isTimedDeliver = tIdx.isTimedDeliver !== -1 ? String(getSafeVal(row, tIdx.isTimedDeliver) || "").trim() : "";
      var isTimedReturn = tIdx.isTimedReturn !== -1 ? String(getSafeVal(row, tIdx.isTimedReturn) || "").trim() : "";
      var isOvertimeWait = tIdx.isOvertimeWait !== -1 ? String(getSafeVal(row, tIdx.isOvertimeWait) || "").trim() : "";
      var isHeavyCarry = tIdx.isHeavyCarry !== -1 ? String(getSafeVal(row, tIdx.isHeavyCarry) || "").trim() : "";

      // 預設規則 (若儲存格空白)
      if (!isTimedDeliver) {
        // 如果「指定送貨」儲存格為空：
        // 1. 若「指定到貨時間」欄位有值（表示OCR匯入時小姐有勾選指定時間並選擇或手動輸入了時間）
        // 2. 或「備註」中包含「限時」或「指定」時
        // 以上任一成立，則預設為「是」；否則預設為「否」（排除普通的AM/PM時段全量誤判）
        var specifiedArriveVal = tIdx.specifiedArrive !== -1 ? String(getSafeVal(row, tIdx.specifiedArrive) || "").trim() : "";
        isTimedDeliver = (specifiedArriveVal || noteText.indexOf("限時") !== -1 || noteText.indexOf("指定") !== -1) ? "是" : "否";
      }
      if (!isTimedReturn) {
        // 退貨單且備註中指定時間，才預設為是
        isTimedReturn = (statusVal.indexOf("退貨") !== -1 && noteText.indexOf("指定") !== -1) ? "是" : "否";
      }
      if (!isOvertimeWait) {
        isOvertimeWait = (noteText.indexOf("等候") !== -1 || noteText.indexOf("等待") !== -1) ? "是" : "否";
      }
      if (!isHeavyCarry) {
        isHeavyCarry = (noteText.indexOf("上樓") !== -1 || noteText.indexOf("搬運") !== -1) ? "是" : "否";
      }

      var carrierFlagVal = tIdx.carrierFlag !== -1 ? String(getSafeVal(row, tIdx.carrierFlag) || "").trim() : "";
      var carrierDiscountVal = tIdx.carrierDiscount !== -1 ? parseFloat(getSafeVal(row, tIdx.carrierDiscount)) : 1.0;
      if (isNaN(carrierDiscountVal) || carrierDiscountVal <= 0) {
        carrierDiscountVal = 1.0;
      } else if (carrierDiscountVal > 1.0) {
        carrierDiscountVal = carrierDiscountVal / 100.0;
      }

      var calcResult = FreightEngine.calculateFreight(addressVal, weightVal, {
        isTimedDeliver: isTimedDeliver,
        isTimedReturn: isTimedReturn,
        isOvertimeWait: isOvertimeWait,
        isHeavyCarry: isHeavyCarry,
        carrierFlag: carrierFlagVal,
        carrierDiscount: carrierDiscountVal
      });

      // 如果試算表已經存有系統估計運費且不是 0，以試算表儲存的為優先；否則以計算引擎動態算的為準
      var finalEst = fEst > 0 ? fEst : calcResult.estFee;
      var finalDetail = fDetail ? fDetail : calcResult.detail;
      var finalRemote = isRemoteVal ? isRemoteVal : calcResult.isRemote;

      var adjFee = tIdx.adjustedFee !== -1 ? parseFloat(getSafeVal(row, tIdx.adjustedFee)) || 0 : 0;

      orders.push({
        id: tIdx.id !== -1 ? String(getSafeVal(row, tIdx.id)) : "",
        date: normalizeDate_Core(dVal),
        branch: String(getSafeVal(row, tIdx.branch)),
        customer: cleanCustName_V11(getSafeVal(row, tIdx.cust)),
        weight: weightVal,
        slot: slotText,
        plate: String(getSafeVal(row, tIdx.plate)),
        status: statusVal,
        finishTime: String(getSafeVal(row, tIdx.finish)),
        shippingType: shippingTypeVal,
        address: addressVal,
        // V41.39: 指定到貨時間 (HH:MM 或 HH:MM~HH:MM)，分析中心司機卡片「指定準點率」用
        specifiedArrive: tIdx.specifiedArrive !== -1 ? _fmtArriveTime_(getSafeVal(row, tIdx.specifiedArrive)) : "",
        whStatus: tIdx.whStatus !== -1 ? String(getSafeVal(row, tIdx.whStatus) || "").trim() : "",
        returnReason: tIdx.returnReason !== -1 ? String(getSafeVal(row, tIdx.returnReason) || "").trim() : "",
        note: noteText,
        rawCustomer: String(getSafeVal(row, tIdx.cust) || ""),
        thumbnail: tIdx.thumbnail !== -1 ? String(getSafeVal(row, tIdx.thumbnail) || "") : "",
        docTypeManual: tIdx.docTypeManual !== -1 ? String(getSafeVal(row, tIdx.docTypeManual) || "").trim() : "",
        // V8.6: 品項陣列
        items: (function () {
          var list = [];
          for (var ii = 0; ii < 10; ii++) {
            var ci = itemCodeIdx[ii], qi = itemQtyIdx[ii];
            var code = (ci !== -1 && ci < row.length) ? String(row[ci] || "").trim() : "";
            var qty = (qi !== -1 && qi < row.length) ? String(row[qi] || "").trim() : "";
            if (code) list.push({ code: code, qty: qty });
          }
          return list;
        })(),
        // 運費對帳屬性
        isRemote: finalRemote,
        estFee: finalEst,
        detail: finalDetail,
        adjustedFee: adjFee,
        carrierFlag: carrierFlagVal,
        carrierDiscount: carrierDiscountVal,
        wrapSeal: (function () {
          var ws = tIdx.wrapSeal !== -1 ? String(getSafeVal(row, tIdx.wrapSeal) || "").trim() : "";
          if (ws) return ws;
          return noteText.indexOf("膠膜") !== -1 ? "封" : "";
        })()
      });
    }

    _annotateDocTypes_(orders); // V41.28: 樣品 / 退貨 / 銷貨

    // 2. schedule: 每日行程表
    const sSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_SCHEDULE);
    const schedule = [];
    if (sSheet) {
      const sData = sSheet.getDataRange().getValues();
      // V41.13: 照片欄位可能是「📸 相片」富文本超連結 (forceUpdateAllScheduleTraces 轉的)，要用 RichText 取回網址
      let sRich = null;
      try { sRich = sSheet.getDataRange().getRichTextValues(); } catch (rtErr) { sRich = null; }
      const linkOf = (r, c) => {
        if (c < 0) return "";
        try { const rt = sRich && sRich[r] && sRich[r][c]; const u = rt && rt.getLinkUrl ? rt.getLinkUrl() : ""; if (u) return u; } catch (e2) { }
        const s = String(sData[r][c] || "").trim();
        return s.indexOf("http") === 0 ? s : "";
      };
      const sH = sData[0].map(v => String(v).trim());
      const findS = (names) => { for (let n of names) { let p = sH.indexOf(n); if (p !== -1) return p; } return -1; };
      
      const sIdx = {
        date: sH.indexOf("日期"),
        plate: findS(["車牌", "車牌號碼", "車輛"]),
        totalKm: findS(["當日總里程", "總里程", "單日里程", "行駛里程"]),
        startKm: findS(["起始里程", "起點里程"]),
        endKm: findS(["結束里程", "終點里程"]),
        fuelAmt: findS(["加油金額", "油費金額", "油費"]),
        fuelLit: findS(["加油公升數", "加油公升", "加油量", "公升數"]),
        // V41.13: 司機行程記錄頁需要
        driver: findS(["司機", "姓名", "人員", "駕駛"]),
        timeIn: findS(["上班時間"]),
        timeOut: findS(["下班時間"]),
        photoExt: findS(["外觀照片"]),
        photoInt: findS(["內裝照片"]),
        photoFuel: findS(["加油發票照片", "發票照片", "加油發票"]),
        trace: findS(["當日行程足跡", "行程足跡", "足跡"])
      };
      const fmtT = (v) => { if (!v) return ""; if (v instanceof Date) return Utilities.formatDate(v, "GMT+8", "HH:mm"); const s = String(v).trim(); return s.length >= 5 && s.indexOf(':') !== -1 ? s.substring(0, 5) : s; };
      const richLink = (v) => { const s = String(v || "").trim(); return s.indexOf("http") === 0 ? s : ""; };

      for (let i = sData.length - 1; i >= 1; i--) {
        const row = sData[i];
        const dVal = row[sIdx.date];
        if (!dVal) continue;
        const d = (dVal instanceof Date) ? dVal : new Date(dVal);
        if (!d || isNaN(d.getTime())) continue;
        if (d < cutoffDate) continue;

        // V8.7: 里程異常值修正
        // 單日里程 > 1000km 視為異常 (實務上貨車單日不超過 ~600km)
        // 優先採用「結束里程 - 起始里程」重算；仍異常則整筆跳過，避免污染統計
        var totalKmRaw = parseFloat(getSafeVal(row, sIdx.totalKm)) || 0;
        if (totalKmRaw > 1000) {
          var sKm = parseFloat(getSafeVal(row, sIdx.startKm)) || 0;
          var eKm = parseFloat(getSafeVal(row, sIdx.endKm)) || 0;
          var diffKm = (eKm > sKm && sKm > 0) ? (eKm - sKm) : 0;
          if (diffKm > 0 && diffKm <= 1000) {
            totalKmRaw = diffKm;
          } else {
            console.log("里程異常已跳過: " + normalizeDate_Core(dVal) + " " + String(getSafeVal(row, sIdx.plate)) + " 總里程=" + totalKmRaw);
            continue;
          }
        }

        schedule.push({
          date: normalizeDate_Core(dVal),
          plate: String(getSafeVal(row, sIdx.plate)),
          driver: String(getSafeVal(row, sIdx.driver) || ""),
          totalKm: totalKmRaw,
          startKm: parseFloat(getSafeVal(row, sIdx.startKm)) || 0,
          endKm: parseFloat(getSafeVal(row, sIdx.endKm)) || 0,
          fuelAmt: parseFloat(getSafeVal(row, sIdx.fuelAmt)) || 0,
          fuelLit: parseFloat(getSafeVal(row, sIdx.fuelLit)) || 0,
          timeIn: fmtT(getSafeVal(row, sIdx.timeIn)),
          timeOut: fmtT(getSafeVal(row, sIdx.timeOut)),
          photoExt: linkOf(i, sIdx.photoExt),
          photoInt: linkOf(i, sIdx.photoInt),
          photoFuel: linkOf(i, sIdx.photoFuel),
          trace: String(getSafeVal(row, sIdx.trace) || "")
        });
      }
    }

    var vehicleMap = {};
    try { vehicleMap = getManagementData().vehicleMap || {}; } catch (vmErr) { }
    const result = { success: true, orders: orders, schedule: schedule, freightRates: freightRatesInfo.rates, vehicleMap: vehicleMap, generatedAt: Date.now() };
    writeChunkedCacheJson_V11(cache, DASH_CACHE_KEY, result, 600); // 10 分鐘；運費調整 / 申訴會清除
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * V8.6: 建立/初始化「運費管理表」分頁（含基礎費率與附加費用）
 * 由使用者於選單或測試執行一次，自動建分頁並填入費率。
 */
function setupFreightRateSheet_V11(e) {
  _requireSystemContext_(e);
  var ss = getSS_V11();
  var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_FREIGHT);
  if (!sheet) {
    sheet = ss.insertSheet(V11_PROD_CONFIG.SHEET_FREIGHT);
  }
  sheet.clear();

  // 1. 重量級距費率表
  var baseWeightRows = [
    ["重量上限(KG)", "基礎運費"],
    [100, 200],
    [300, 500],
    [600, 800],
    [1000, 1200],
    [99999, 1800]
  ];

  // 2. 偏遠地區倍率
  var remoteRows = [
    ["偏遠地區關鍵字", "加乘倍率"],
    ["宜蘭, 花蓮, 台東, 臺東, 屏東", 1.5],
    ["基隆, 瑞芳, 新竹, 苗栗, 烏來, 坪林", 1.2]
  ];

  // 3. 其他附加服務費
  var addonRows = [
    ["附加項目", "費率/單價"],
    ["指定時間送貨", 300],
    ["指定時間退貨", 500],
    ["等候超時費", 300],
    ["加倍搬運費(每百公斤)", 100]
  ];

  sheet.getRange(1, 1, baseWeightRows.length, baseWeightRows[0].length).setValues(baseWeightRows);
  sheet.getRange(1, 4, remoteRows.length, remoteRows[0].length).setValues(remoteRows);
  sheet.getRange(1, 7, addonRows.length, addonRows[0].length).setValues(addonRows);

  sheet.getRange("A1:B1").setBackground("#34495e").setFontColor("#ffffff").setFontWeight("bold");
  sheet.getRange("D1:E1").setBackground("#27ae60").setFontColor("#ffffff").setFontWeight("bold");
  sheet.getRange("G1:H1").setBackground("#d35400").setFontColor("#ffffff").setFontWeight("bold");
  
  sheet.autoResizeColumns(1, 8);
  return "運費管理表已重新初始化";
}

/**
 * V8.6: 讀取「運費管理表」的基礎費率與附加費用
 * 回傳 { rates: [{minKg, maxKg, fee}], addons: {remoteMultiplier, timedDeliver, timedReturn, waitFee, heavyCarryPer100kg} }
 */
// ==========================================
// V41.28: 單據類型判定 (樣品 / 退貨 / 銷貨)
// 規則同「睡美人戰情室」isSampleRow，另加：退貨單不視為樣品
//   同一單號的所有明細：任一列 類別含「退」 → 退貨
//   否則 每一列都符合 (客戶編號結尾 -S/-S1 或 客戶名/品名/備註含關鍵字) 或 金額合計 = 0 → 樣品
// ==========================================
var SAMPLE_KEYWORD_RE = /樣品|陳列|贈|SAMPLE|送樣|扣帶/i;

function _stripOrderSuffix_(id) {
  return String(id || "").trim().toUpperCase().replace(/-[安高漢喜]$/, '').replace(/-[0-9]+$/, '');
}

var SALES_DOC_CACHE_SHEET = "單據類型快取";

/**
 * 單號 → {t: 類型, a: 金額} 對照。讀取順序：
 *   1. CacheService (6 小時)
 *   2. 「單據類型快取」分頁 (由 refreshSalesDocTypes_V41 每 2 小時排程寫入，持久)
 *   3. 都沒有才現場讀該分公司銷售報表 (慢，約 2 秒)
 */
function _loadSalesDocTypeMap_(branch) {
  var cfg = V11_PROD_CONFIG.SALES_REPORT[branch];
  if (!cfg) return null;
  var cache = CacheService.getScriptCache();
  var key = 'salesdoc_' + branch + '_v1';
  var hit = readChunkedCacheJson_V11(cache, key);
  if (hit) return hit;
  var fromSheet = _readSalesDocCacheSheet_(branch);
  if (fromSheet) { writeChunkedCacheJson_V11(cache, key, fromSheet, 21600); return fromSheet; }
  return _buildSalesDocTypeMapLive_(branch, cache, key);
}

function _readSalesDocCacheSheet_(branch) {
  try {
    var sheet = getSS_V11().getSheetByName(SALES_DOC_CACHE_SHEET);
    if (!sheet || sheet.getLastRow() < 2) return null;
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
    var map = {}, n = 0;
    rows.forEach(function (r) { if (String(r[0]) === branch && r[1] !== "") { map[String(r[1])] = { t: String(r[2]), a: Number(r[3]) || 0 }; n++; } });
    return n ? map : null;
  } catch (e) { return null; }
}

/** [排程 / 選單] 重算三家報表的單據類型並寫入「單據類型快取」分頁，同時暖 CacheService */
function refreshSalesDocTypes_V41(e) {
  _requireSystemContext_(e);
  var ss = getSS_V11();
  var sheet = ss.getSheetByName(SALES_DOC_CACHE_SHEET) || ss.insertSheet(SALES_DOC_CACHE_SHEET);
  var out = [["分公司", "單號", "類型", "金額", "更新時間"]];
  var now = Utilities.formatDate(new Date(), "GMT+8", "yyyy/MM/dd HH:mm");
  var cache = CacheService.getScriptCache();
  var summary = [];
  Object.keys(V11_PROD_CONFIG.SALES_REPORT).forEach(function (branch) {
    var map = _buildSalesDocTypeMapLive_(branch, cache, 'salesdoc_' + branch + '_v1');
    if (!map) { summary.push(branch + ": 讀取失敗"); return; }
    var c = { 樣品: 0, 退貨: 0, 銷貨: 0 };
    Object.keys(map).forEach(function (no) { out.push([branch, no, map[no].t, map[no].a, now]); c[map[no].t] = (c[map[no].t] || 0) + 1; });
    summary.push(branch + ": 樣品 " + c["樣品"] + " / 退貨 " + c["退貨"] + " / 銷貨 " + c["銷貨"]);
  });
  sheet.clearContents();
  sheet.getRange(1, 1, out.length, 5).setValues(out);
  sheet.getRange(1, 1, 1, 5).setFontWeight("bold").setBackground("#34495e").setFontColor("#ffffff");
  _clearDashboardCache_();
  var msg = "✅ 單據類型快取已更新 (" + (out.length - 1) + " 筆)\n" + summary.join("\n");
  console.log(msg);
  return msg;
}

/** [編輯器 / 選單] 建立每 2 小時的排程 */
function setupSalesDocTypeTrigger_V41(e) {
  _requireSystemContext_(e);
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'refreshSalesDocTypes_V41') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshSalesDocTypes_V41').timeBased().everyHours(2).create();
  var first = refreshSalesDocTypes_V41();
  return "✅ 已建立每 2 小時更新單據類型的排程，並先跑了一次：\n" + first;
}

function _buildSalesDocTypeMapLive_(branch, cache, key) {
  var cfg = V11_PROD_CONFIG.SALES_REPORT[branch];
  if (!cfg) return null;
  var map = {};
  try {
    var ss = SpreadsheetApp.openById(cfg.ssId);
    var sheet = ss.getSheetByName(cfg.sheet) || ss.getSheets().filter(function (sh) { return /報表/.test(sh.getName()); })[0];
    if (!sheet) return null;
    var lastRow = sheet.getLastRow(), lastCol = Math.min(sheet.getLastColumn(), 18);
    var h = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v).trim(); });
    var idx = {
      type: h.indexOf("類別"), code: h.indexOf("客戶編號"), cust: h.indexOf("客戶名稱"), no: h.indexOf("單號編號"),
      prod: h.indexOf("產品名稱"), amt: h.indexOf("金額"), note: h.indexOf("產品備註")
    };
    if (idx.no === -1 || idx.amt === -1) return null;
    var start = Math.max(2, lastRow - 6000);
    var rows = sheet.getRange(start, 1, lastRow - start + 1, lastCol).getValues();
    var agg = {};
    rows.forEach(function (r) {
      var no = String(r[idx.no] || "").trim();
      if (!no) return;
      var a = agg[no] || (agg[no] = { ret: false, allSample: true, amount: 0, n: 0 });
      a.n++;
      if (idx.type !== -1 && String(r[idx.type] || "").indexOf("退") !== -1) a.ret = true;
      var code = idx.code !== -1 ? String(r[idx.code] || "").trim().toUpperCase() : "";
      var text = [idx.cust !== -1 ? r[idx.cust] : "", idx.prod !== -1 ? r[idx.prod] : "", idx.note !== -1 ? r[idx.note] : ""].join(" ");
      var lineSample = /-S1?$/.test(code) || SAMPLE_KEYWORD_RE.test(text);
      if (!lineSample) a.allSample = false;
      var amt = parseFloat(String(r[idx.amt] === undefined || r[idx.amt] === null ? "" : r[idx.amt]).replace(/,/g, ""));
      if (!isNaN(amt)) a.amount += amt;
    });
    Object.keys(agg).forEach(function (no) {
      var a = agg[no];
      var type = a.ret ? "退貨" : ((a.allSample || Math.round(a.amount) === 0) ? "樣品" : "銷貨");
      map[no] = { t: type, a: Math.round(a.amount) };
    });
    writeChunkedCacheJson_V11(cache, key, map, 21600);
  } catch (e) {
    console.log("讀取 " + branch + " 銷售報表失敗: " + e.message);
    return null;
  }
  return map;
}

/** 單筆判定：優先查該分公司銷售報表；查不到 (或漢樺) 就看派送清單上的客戶名 / 備註關鍵字 */
function _classifyDocType_(branch, orderId, customer, note, shippingType, mapCache) {
  var b = String(branch || "").trim();
  var st = String(shippingType || "");
  if (st.indexOf("退") !== -1) return "退貨";
  var key = Object.keys(V11_PROD_CONFIG.SALES_REPORT).filter(function (k) { return b.indexOf(k) !== -1; })[0];
  if (key) {
    if (!(key in mapCache)) mapCache[key] = _loadSalesDocTypeMap_(key);
    var m = mapCache[key];
    var hit = m && m[_stripOrderSuffix_(orderId)];
    if (hit) return hit.t;
  }
  if (SAMPLE_KEYWORD_RE.test(String(customer || "") + " " + String(note || ""))) return "樣品";
  return "銷貨";
}

/** 地址是否為「送回公司 / 倉庫」 */
function _isHomeAddress_(addr) {
  var a = String(addr || "").replace(/\s/g, "");
  if (!a) return false;
  return V11_PROD_CONFIG.HOME_ADDR_KEYWORDS.some(function (k) { return a.indexOf(k) !== -1; });
}

/**
 * 對一批 {branch, id, customer, note, shippingType, address} 物件填入：
 *   docType   樣品 / 退貨 / 銷貨
 *   sampleTo  'home' (送回公司，不計單不計費) | 'out' (送去貨運行/加工廠/客戶，照常計費) | ''
 *   isSample  只有「樣品且送回公司」才為 true → 統計預設排除的就是這種
 */
function _annotateDocTypes_(list) {
  var mapCache = {};
  (list || []).forEach(function (o) {
    try {
      var manual = String(o.docTypeManual || "").trim();
      o.__manualSampleTo = '';
      if (manual === "樣品收費") { o.docType = "樣品"; o.__manualSampleTo = 'out'; }
      else if (manual === "樣品免費") { o.docType = "樣品"; o.__manualSampleTo = 'home'; }
      else if (manual === "樣品" || manual === "銷貨" || manual === "退貨") {
        o.docType = manual; // 人工判定永遠優先於規則
      } else {
        // 客戶名用原始值 (cleanCustName_V11 會把「-樣品」之類的後綴切掉)
        o.docType = _classifyDocType_(o.branch, o.id, o.rawCustomer || o.customer, o.note, o.shippingType, mapCache);
      }
    } catch (e) { o.docType = "銷貨"; }
    if (o.docType === "樣品") {
      o.sampleTo = o.__manualSampleTo || (_isHomeAddress_(o.address) ? 'home' : 'out');
      o.isSample = (o.sampleTo === 'home');
    } else {
      o.sampleTo = '';
      o.isSample = false;
    }
  });
  return list;
}

function loadFreightRates_V11() {
  // V41: 舊版用正則找「100-300」區間，但 setupFreightRateSheet_V11 寫入的是單一「重量上限」，兩者永遠對不上 → rates 恆為 []。
  // 改為直接沿用 FreightEngine 解析好的級距，轉成 {minKg, maxKg, fee} 供前端顯示。
  var result = { rates: [], addons: {} };
  try {
    var r = (typeof FreightEngine !== 'undefined' && FreightEngine.loadRates) ? FreightEngine.loadRates() : null;
    if (!r) return result;
    var prev = 0;
    (r.weightSlabs || []).forEach(function (s) {
      result.rates.push({ minKg: prev, maxKg: s.maxKg, fee: s.fee });
      prev = s.maxKg + 1;
    });
    result.addons = r.addonFees || {};
  } catch (e) {
    console.log("運費表讀取失敗: " + e.message);
  }
  return result;
}

/**
 * V8.6: 依重量計算基礎運費
 */
function calcFreightBaseFee_V11(rates, weightKg) {
  if (!rates || !rates.length) return 0;
  var w = parseFloat(weightKg) || 0;
  for (var i = 0; i < rates.length; i++) {
    var r = rates[i];
    if (w >= r.minKg && w <= r.maxKg) return r.fee;
  }
  // 超過最大級距：以最後一級的費率當作起價
  return rates[rates.length - 1].fee;
}

/** V11.12: 客戶名稱智慧清洗邏輯 */
function cleanCustName_V11(name) {
  if (!name) return "";
  var n = String(name).trim();
  
  // 1. 特定客戶品牌與分公司合併 (根據 客戶合併原則.md)
  if (n.indexOf("太爾") !== -1) return "信義星";
  if (n.indexOf("琮達") !== -1) return "琮威";
  if (n.indexOf("喬翌") !== -1) return "伊特";
  if (n.indexOf("鼎康") !== -1) return "鼎晨";
  if (n.indexOf("高頓") !== -1) return "馬來高";
  if (n.indexOf("波爾泰") !== -1) return "漢樺";
  if (n.indexOf("新大永") !== -1) return "大永";
  if (n.indexOf("睿敏") !== -1) return "錦義";
  if (n.indexOf("東春") !== -1) return "滿財";
  if (n.indexOf("盛邦") !== -1) return "傅邦";
  if (n.indexOf("專岩") === 0) return "專岩";
  if (n.indexOf("禾昇") === 0) return "禾昇";

  // 2. 移除破折號與括弧後半段的附加字樣 (例如: 漢樺企業股份有限公司-設計部 -> 漢樺企業股份有限公司)
  n = n.split("-")[0].split("(")[0].split("（")[0].trim();

  // 2. 贅字後綴清洗 (V11.12.1 擴充：建材、設計、室內設計、建築、實業、國際)
  var suffixes = ['股份有限公司', '有限公司', '實業有限公司', '設計公司', '建材有限公司', '精品', '室內設計', '設計', '建材', '工程', '工作室', '公司', '商行', '企業', '磁磚', '五金', '實業', '國際', '總合', '綜合'];
  for (var s of suffixes) {
    var pos = n.indexOf(s);
    if (pos > 0) {
      n = n.substring(0, pos);
    } else if (pos === 0) {
      // 避免把名稱開頭就洗掉，若開頭就是這些字則跳過
      continue;
    }
  }
  return n.trim();
}

/** V38.x: 高雅瓷業務 LINE ID 對照（讀取「系統設定」分頁的 姓名/稱職 + LINEID 欄） */
function _buildGaoYaCiSalesLineIdMap_V11() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('gyc_sales_lineid_map');
  if (cached) return JSON.parse(cached);
  var map = {};
  try {
    var ss = SpreadsheetApp.openById(V11_PROD_CONFIG.GAOYACI_SS_ID);
    var sheet = ss.getSheetByName("系統設定");
    if (!sheet) return map;
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return map;
    var headers = data[0].map(function(v) { return String(v).trim(); });
    var idxName = headers.indexOf("姓名/稱職");
    var idxLine = headers.indexOf("LINEID");
    if (idxName === -1 || idxLine === -1) return map;
    for (var i = 1; i < data.length; i++) {
      var name = String(data[i][idxName] || "").trim();
      var lineId = String(data[i][idxLine] || "").trim();
      if (!name || !lineId) continue;
      if (["高弘治", "謝博皓", "陳勁多", "潘右森"].indexOf(name) === -1) continue;
      map[name] = lineId;
    }
    cache.put('gyc_sales_lineid_map', JSON.stringify(map), 300);
  } catch (e) {
    console.error("讀取系統設定業務 LINEID 失敗: " + e.message);
  }
  return map;
}

/** V38.x: 高雅瓷 客戶短名 → 負責業務 對照（讀取「業務分區」分頁） */
function _buildGaoYaCiCustomerSalesMap_V11() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('gyc_cust_sales_map');
  if (cached) return JSON.parse(cached);
  var map = {};
  try {
    var ss = SpreadsheetApp.openById(V11_PROD_CONFIG.GAOYACI_SS_ID);
    var sheet = ss.getSheetByName("業務分區");
    if (!sheet) return map;
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return map;
    var headers = data[0].map(function(v) { return String(v).trim(); });
    var idxCust = headers.indexOf("客戶");
    var idxSales = headers.indexOf("負責業務");
    if (idxCust === -1 || idxSales === -1) return map;
    for (var i = 1; i < data.length; i++) {
      var cust = String(data[i][idxCust] || "").trim();
      var sales = String(data[i][idxSales] || "").trim();
      if (!cust || !sales) continue;
      var key = cleanCustName_V11(cust);
      if (key) map[key] = sales;
    }
    cache.put('gyc_cust_sales_map', JSON.stringify(map), 300);
  } catch (e) {
    console.error("讀取業務分區失敗: " + e.message);
  }
  return map;
}

/** V38.x: 高雅瓷 配送完成 → LINE 個別通知負責業務（無聲推播，含司機簽收卡片 JPG） */
function notifySalesForDelivery_V11(report, driverName, timeStr, photoId) {
  try {
    _requireCtx_();
    // 收退貨單（客戶名含「收退」或 type 為收貨/退貨）不通知業務
    var custRaw = String(report.customer || "");
    var typeRaw = String(report.type || "");
    if (custRaw.indexOf("收退") !== -1 || custRaw.indexOf("退貨") !== -1 || typeRaw === "收貨" || typeRaw === "退貨") return;

    var custKey = cleanCustName_V11(custRaw);
    if (!custKey) return;
    var custMap = _buildGaoYaCiCustomerSalesMap_V11();
    var salesName = custMap[custKey] || "";
    if (!salesName) return;
    var lineMap = _buildGaoYaCiSalesLineIdMap_V11();
    var lineId = lineMap[salesName] || "";
    if (!lineId) return;

    // 只推司機生成的簽收卡片 JPG 一張（省 LINE push 額度，不附加文字訊息）
    // 用 Google Drive lh3 直連網址（無 302 跳轉，LINE 才收得到）
    if (!photoId) return;
    pushLineMessageToId_V11(lineId, {
      type: "image",
      originalContentUrl: "https://lh3.googleusercontent.com/d/" + photoId,
      previewImageUrl: "https://lh3.googleusercontent.com/d/" + photoId
    }, "高雅瓷");
  } catch (e) {
    console.error("notifySalesForDelivery_V11: " + e.message);
  }
}

/** A 等級：新增/更新臨時任務 (唯一鍵：單號+分公司) */
/**
 * V39.24: 手動建單表單即時預估運費用 (前端每次改地址/重量/指定時間就呼叫一次)
 */
function estimateFreight_V11(address, weight, isTimedDeliver) {
  try {
    if (typeof FreightEngine === 'undefined' || !FreightEngine.calculateFreight) {
      return { estFee: 0, detail: "運費引擎未載入" };
    }
    return FreightEngine.calculateFreight(address || "", weight || 0, { isTimedDeliver: isTimedDeliver ? "是" : "否" });
  } catch (e) {
    return { estFee: 0, detail: "計算失敗: " + e.message };
  }
}

function adminAddTempTask(data, token) {
  var lock = LockService.getScriptLock();
  try {
    _requireAdmin_(token);
    if (!lock.tryLock(10000)) return "❌ 系統忙碌中 (單據寫入鎖定)，請稍後再試。";
    var ss = getSS_V11();
    
    // V13.0 智慧路由：若指定了業務，改為寫入業務配送清單
    var isSalesRoute = data.assignedSales && String(data.assignedSales).trim() !== "";
    var targetSheetName = isSalesRoute ? "業務配送清單" : V11_PROD_CONFIG.SHEET_TASKS;
    var sheet = isSalesRoute ? ensureSalesDeliverySheet_Core(ss) : ss.getSheetByName(targetSheetName);
    
    var allData = sheet.getDataRange().getValues();
    var h = allData[0].map(function (v) { return String(v).trim(); });

    var idx = {
      id: h.indexOf("單號"), branch: h.indexOf("分公司"),
      status: h.indexOf("狀態"), date: h.indexOf("日期")
    };
    if (idx.id === -1 || idx.branch === -1) throw new Error("缺少 試算表 關鍵欄位 (單號/分公司)");

    // A 等級覆蓋原則：檢查 唯一鍵 (單號+分公司)
    var targetRow = -1;
    var orderIdStr = String(data.orderId || "").trim();
    var branchStr = String(data.branch || "桃園分公司").trim();

    // V36.5: 確保單號帶有分公司簡碼後綴 (-安, -高, -漢, -喜)
    if (orderIdStr) {
      var shortMap = { '安帝嘉': '安', '高雅瓷': '高', '喜悅納': '喜', '漢樺': '漢' };
      var shortCode = shortMap[branchStr] || branchStr.charAt(0);
      if (shortCode && orderIdStr.indexOf("-" + shortCode) === -1 && !/-[安高漢喜]$/.test(orderIdStr)) {
        orderIdStr = orderIdStr + "-" + shortCode;
      }
    }

    if (orderIdStr) {
      for (var i = 1; i < allData.length; i++) {
        if (String(allData[i][idx.id]) === orderIdStr &&
          String(allData[i][idx.branch]) === branchStr) {

          var currentStatus = String(allData[i][idx.status]);
          if (currentStatus !== "待指派" && currentStatus !== "" && currentStatus !== "null") {
            throw new Error("單號 " + orderIdStr + " (" + branchStr + ") 已處於「" + currentStatus + "」狀態，禁止覆蓋！");
          }
          targetRow = i + 1;
          break;
        }
      }
    } else {
      orderIdStr = "T" + Utilities.formatDate(new Date(), "GMT+8", "HHmmss");
    }

    var lat = "", lng = "";
    try {
      if (data.address) {
        var res = Maps.newGeocoder().geocode(data.address).results[0];
        if (res) { lat = res.geometry.location.lat; lng = res.geometry.location.lng; }
      }
    } catch (err) { }

    var indices = {
      id: findHIdx_Core(h, "ID"),
      cust: findHIdx_Core(h, "CUSTOMER"),
      addr: findHIdx_Core(h, "ADDRESS"),
      weight: findHIdx_Core(h, "WEIGHT"),
      // ⚠️ type 目前對位到 [順序] 欄位，僅供排序參考，禁止寫入任務類型資料
      type: h.indexOf("箱數/數量") !== -1 ? h.indexOf("箱數/數量") : findHIdx_Core(h, "SEQ"), 
      branch: findHIdx_Core(h, "BRANCH"),
      contact: findHIdx_Core(h, "CONTACT"),
      phone: findHIdx_Core(h, "PHONE"),
      note: findHIdx_Core(h, "NOTE"),
      wrapSeal: findHIdx_Core(h, ["封膠膜", "膠膜", "封膜"]),
      time: findHIdx_Core(h, "DATE"), 
      status: findHIdx_Core(h, "STATUS"),
      createDate: findHIdx_Core(h, "DATE"),
      lat: findHIdx_Core(h, "LAT"),
      lng: findHIdx_Core(h, "LNG"),
      plate: findHIdx_Core(h, "VEHICLE"),
      // 🎯 精準鎖定 [配送方式] 欄位 (預期在 M 欄)
      shippingType: findHIdx_Core(h, "SHIPPING_TYPE"),
      size: h.indexOf("尺寸"),
      boxes: h.indexOf("箱數"),
      specifiedArrive: h.indexOf("指定到貨時間"), // V40: 強制指定到貨時間
      driverCol: h.indexOf("派遣司機") !== -1 ? h.indexOf("派遣司機") : h.indexOf("司機"), // V13: 業務表欄位識別
      // V39.24: 運費對帳欄位 - 手動建單時也要跟 OCR 建單一樣計算並寫入，不然這裡新增的單完全沒有運費估算
      isRemote: h.indexOf("是否偏遠"),
      freightEst: h.indexOf("估算運費"),
      freightDetail: h.indexOf("運費計算明細"),
      isTimedDeliver: h.indexOf("指定送貨")
    };

    var rowValues = new Array(h.length).fill("");
    var setByCol = function (idx, val) { if (idx >= 0) rowValues[idx] = val; };

    setByCol(indices.id, orderIdStr);
    setByCol(indices.cust, data.customer || "");
    setByCol(indices.addr, data.address || "");
    setByCol(indices.weight, data.weight || 0);
    // V8.5 Fix: 將任務類型(退貨/送貨)寫入「配送方式」欄位
    setByCol(indices.shippingType, data.type || "送貨"); 
    setByCol(indices.branch, branchStr);
    setByCol(indices.contact, data.contact || "");
    setByCol(indices.phone, data.phone || "");
    setByCol(indices.size, data.size || "");
    setByCol(indices.boxes, data.boxes || "");
    setByCol(indices.note, data.notes || data.note || "");
    setByCol(indices.wrapSeal, normalizeWrapSeal_Core(data.wrapSeal || data.sealWrap || data.wrap || data.noteWrap));
    // V40: 強制指定到貨時間
    setByCol(indices.specifiedArrive, data.specifiedArrive || "");
    // V39.24: 手動建單也計算運費，跟 OCR 建單同一套邏輯 (FreightEngine)
    var isTimedDeliverFlag = data.specifiedArrive ? "是" : "否";
    setByCol(indices.isTimedDeliver, isTimedDeliverFlag);
    if (typeof FreightEngine !== 'undefined' && FreightEngine.calculateFreight) {
      try {
        var freightCalc = FreightEngine.calculateFreight(data.address || "", data.weight || 0, { isTimedDeliver: isTimedDeliverFlag });
        setByCol(indices.isRemote, freightCalc.isRemote);
        setByCol(indices.freightEst, freightCalc.estFee);
        setByCol(indices.freightDetail, freightCalc.detail);
      } catch (fe) { /* 運費計算失敗不影響任務建立 */ }
    }
    // 時段
    var slotIdx = h.indexOf("時段");
    if (slotIdx !== -1) rowValues[slotIdx] = data.timeSlot || "";

    setByCol(indices.status, "待指派");
    setByCol(indices.createDate, new Date());
    setByCol(indices.lat, lat);
    setByCol(indices.lng, lng);

    // V13.1: 業務配送處理
    if (isSalesRoute) {
      setByCol(indices.driverCol, data.assignedSales);
      setByCol(indices.status, "配送中"); // 直接指派業務，狀態為配送中
    } else if (data.vehicle) {
      setByCol(indices.plate, data.vehicle);
      setByCol(indices.status, "已指派");
    }

    // 寫入品項1~10
    if (data.items && data.items.length > 0) {
      var items = JSON.parse(data.items);
      for (var ni = 0; ni < items.length && ni < 10; ni++) {
        var colCode = h.indexOf("品項" + (ni + 1) + "編號");
        var colQty = h.indexOf("品項" + (ni + 1) + "數量");
        if (colCode !== -1) rowValues[colCode] = items[ni].code || "";
        if (colQty !== -1) rowValues[colQty] = items[ni].qty || "";
      }
    }

    _clearWarRoomCache_(); // V2633.2: 清除戰情室快取
    if (targetRow !== -1) {
      sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
      return "✅ 單號 " + orderIdStr + " 已成功覆蓋更新";
    } else {
      sheet.appendRow(rowValues);
      // V13.2: 若是業務單，自動觸發排序機制
      if (isSalesRoute && typeof sortSalesSheetByCompany_Core === 'function') {
        sortSalesSheetByCompany_Core(sheet);
      }
      return "✅ 單號 " + orderIdStr + " 已成功發布至" + (isSalesRoute ? "業務配送清單" : "派送清單");
    }
  } catch (e) {
    return "❌ 操作失敗: " + e.message;
  } finally {
    lock.releaseLock();
  }
}

function ensureHeaders_V11(sheet) {
  if (!sheet) {
    try {
      var ss = getSS_V11();
      sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
    } catch(e) {
      console.error("ensureHeaders 找不到預設工作表: " + e.message);
    }
  }
  if (!sheet) return;
  var lastCol = sheet.getLastColumn();
  if (sheet.getLastRow() === 0) return;
  if (lastCol < 1) lastCol = 1;

  var h = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v).trim(); });
  var required = ["車牌", "狀態", "順序", "緯度", "經度", "貨單縮圖"];
  var sheetName = sheet.getName();
  if (sheetName === V11_PROD_CONFIG.SHEET_LOG) {
    required = ["單號", "clientUUID", "抵達 GPS 定位", "是否有退貨", "退貨照片", "簽收類型"];
  } else if (sheetName === V11_PROD_CONFIG.SHEET_SCHEDULE) {
    required = ["上班時間", "下班時間"];
  }
  
  // V11.20: 強制包含退回原因欄位與運費對帳欄位 (全新簡化後台，獨立指定時間判斷)
  if (sheetName === V11_PROD_CONFIG.SHEET_TASKS) {
    if (required.indexOf("退回原因") === -1) required.push("退回原因");
    if (required.indexOf("封膠膜") === -1) required.push("封膠膜");
    if (required.indexOf("單據類型(人工)") === -1) required.push("單據類型(人工)");
    var freightCols = ["是否偏遠", "估算運費", "運費計算明細", "調整後運費", "貨運行標示", "貨運行折扣", "指定送貨", "指定退貨", "等候超時", "加倍搬運"];
    freightCols.forEach(function(col) {
      if (required.indexOf(col) === -1) required.push(col);
    });
  }

  var changed = false;

  var headerMap = {
    "車牌": "VEHICLE",
    "狀態": "STATUS",
    "順序": "SEQ",
    "緯度": "LAT",
    "經度": "LNG",
    "貨單縮圖": "THUMBNAIL"
  };

  required.forEach(function (name) {
    var exists = false;
    var coreKey = headerMap[name];
    
    if (coreKey) {
      exists = (findHIdx_Core(h, coreKey) !== -1);
    } else {
      exists = (h.indexOf(name) !== -1);
    }

    if (!exists) {
      lastCol++;
      sheet.getRange(1, lastCol).setValue(name);
      changed = true;
    }
  });
  return changed;
}

/**
 * V34.10: 一次性修正函式，將「車輛即時狀態」中舊有的純時間格式(HH:mm:ss)
 * 補上今天的日期，變成完整格式 (yyyy/MM/dd HH:mm:ss)。
 * 請在 Apps Script 編輯器中手動執行一次即可。
 */
function fixVehicleStatusDates(e) {
  _requireSystemContext_(e);
  var ss = getSS_V11();
  var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_STATUS);
  if (!sheet) { Logger.log("找不到車輛即時狀態表"); return; }
  var today = Utilities.formatDate(new Date(), "GMT+8", "yyyy/MM/dd");
  var data = sheet.getDataRange().getValues();
  var count = 0;
  for (var i = 1; i < data.length; i++) {
    var val = data[i][3];
    var newVal = null;
    if (val instanceof Date) {
      // Google Sheets 把純時間存成 1899 年的 Date，需要特別處理
      if (val.getFullYear() < 2000) {
        var timeStr = Utilities.formatDate(val, "GMT+8", "HH:mm:ss");
        newVal = today + " " + timeStr;
      }
    } else if (typeof val === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(val.trim())) {
      newVal = today + " " + val.trim();
    }
    if (newVal) {
      sheet.getRange(i + 1, 4).setValue(newVal);
      Logger.log("修正第" + (i + 1) + "列: " + val + " → " + newVal);
      count++;
    }
  }
  Logger.log("✅ 完成，共修正 " + count + " 筆");
}

function adminDispatchTasks(tasksData, car, token) {
  var lock = LockService.getScriptLock();
  try {
    _requireAdmin_(token);
    if (!lock.tryLock(15000)) throw new Error("系統忙碌中，請稍後再試。");

    var ss = getSS_V11(), sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
    ensureHeaders_V11(sheet);
    var data = sheet.getDataRange().getValues();
    var h = data[0].map(function (v) { return String(v).trim(); });
    var findCol = function (names) { for (var n of names) { var p = h.indexOf(n); if (p !== -1) return p; } return -1; };

    var idx = {
      id: findCol(["單號"]),
      branch: findCol(["分公司"]),
      v: findCol(["車牌", "車號"]),
      s: findCol(["狀態"]),
      sq: findCol(["順序", "趟次"]),
      ds: findCol(["派遣司機"]),
      dx: findCol(["派遣車次"]),
      cust: findCol(["客戶"]),
      addr: findCol(["地址"]),
      w: findCol(["重量"]),
      bx: findCol(["箱數"]),
      sz: findCol(["尺寸"]),
      bk: findCol(["回鶯歌"])
    };

    if (idx.id === -1 || idx.branch === -1 || idx.v === -1 || idx.s === -1 || idx.sq === -1) {
      throw new Error("試算表缺少必要欄位，請檢查標頭名稱。");
    }

    // 計算目標車輛目前的最大順序
    var curMax = 0;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idx.v] || "").trim() === car) {
        curMax = Math.max(curMax, Number(data[i][idx.sq]) || 0);
      }
    }

    var affectedCars = new Set([car]);
    var habitTasks = [];
    var habitDriverName = car;
    var touchedRows = []; // V41.22: 只寫回這些列

    // V41: 司機名稱查表只做一次 (舊版在每筆任務迴圈內整表讀取)
    var drvNameOfCar = car;
    if (typeof getDrivers_V3 === 'function') {
      var drvRes = getDrivers_V3();
      if (drvRes.success) {
        var mDrv = drvRes.drivers.find(function (d) { return d.plate === car; });
        if (mDrv) drvNameOfCar = mDrv.name;
      }
    }

    // 處理每一筆指派請求
    for (var j = 0; j < tasksData.length; j++) {
      var req = tasksData[j];
      var targetRow = -1;

      // 優先使用傳入的 rowIndex，若失效則依據單號回溯
      if (req.r && req.r > 1 && req.r <= data.length && String(data[req.r - 1][idx.id]).trim() === String(req.id).trim()) {
        targetRow = req.r;
      } else {
        var reqBranch = String(req.branch || "").trim();
        for (var k = 1; k < data.length; k++) {
          if (String(data[k][idx.id]).trim() === String(req.id).trim() && String(data[k][idx.branch] || "").trim() === reqBranch) {
            targetRow = k + 1;
            break;
          }
        }
      }

      if (targetRow !== -1) {
        var oldCar = String(data[targetRow - 1][idx.v] || "").trim();
        if (oldCar) affectedCars.add(oldCar);

        curMax++;
        data[targetRow - 1][idx.v] = car;
        data[targetRow - 1][idx.s] = "配送中";
        data[targetRow - 1][idx.sq] = curMax;
        
        // ⚡️ 統一寫入派遣司機與車次
        var drvName = drvNameOfCar;
        habitDriverName = drvName;
        if (idx.ds !== -1) data[targetRow - 1][idx.ds] = drvName;
        if (idx.dx !== -1) data[targetRow - 1][idx.dx] = "1";
        touchedRows.push(targetRow);

        habitTasks.push({
          id: String(data[targetRow - 1][idx.id]),
          customer: String(data[targetRow - 1][idx.cust] || '').trim(),
          address: String(data[targetRow - 1][idx.addr] || ''),
          weight: Number(data[targetRow - 1][idx.w]) || 0,
          boxes: String(data[targetRow - 1][idx.bx] || '0'),
          size: String(data[targetRow - 1][idx.sz] || ''),
          isBackYingge: String(data[targetRow - 1][idx.bk] || '').includes('T'),
          branch: String(data[targetRow - 1][idx.branch] || '')
        });
      }
    }

    // V41.22: 只寫回改到的列與欄 (舊版整表覆蓋會蓋掉司機同時間的結案)
    touchedRows.forEach(function (r) { _writeRowCells_(sheet, r, data[r - 1], [idx.v, idx.s, idx.sq, idx.ds, idx.dx]); });

    if (habitTasks.length > 0 && typeof logDispatchHabit_V8 === 'function') {
      var totalHabitWeight = habitTasks.reduce(function (sum, t) { return sum + (Number(t.weight) || 0); }, 0);
      logDispatchHabit_V8(ss, {
        tasks: habitTasks,
        config: { plate: car, name: habitDriverName, shift: "1" },
        tripTotalWeight: totalHabitWeight,
        utilization: "戰情室指派",
        source: "戰情室指派",
        operator: "System_AI"
      });
    }

    // 清除快取並強制同步受影響車輛的行程足跡
    _clearWarRoomCache_();
    affectedCars.forEach(function (c) { if (c) updateScheduleTrace_V12(c); });

    return "✅ 成功完成 " + tasksData.length + " 筆任務指派 (" + car + ")";
  } catch (e) {
    return "❌ 指派失敗: " + e.message;
  } finally {
    lock.releaseLock();
  }
}

/** V11.15: 單筆或批次取消指派 */
function adminUnassignTask(tasksData, token) {
  var lock = LockService.getScriptLock();
  try {
    _requireAdmin_(token);
    if (!lock.tryLock(15000)) throw new Error("系統忙碌中，請稍後再試。");

    var ss = getSS_V11(), sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
    if (!sheet) throw new Error("找不到任務工作表");
    var data = sheet.getDataRange().getValues();
    var h = data[0].map(function (v) { return String(v).trim(); });
    var findCol = function (names) { for (var n of names) { var p = h.indexOf(n); if (p !== -1) return p; } return -1; };
    var idx = { id: findCol(["單號"]), branch: findCol(["分公司"]), v: findCol(["車牌"]), s: findCol(["狀態"]), sq: findCol(["順序"]) };

    if (idx.id === -1 || idx.branch === -1 || idx.v === -1 || idx.s === -1 || idx.sq === -1) {
      throw new Error("試算表缺少必要欄位");
    }

    var affectedCars = new Set();

    for (var j = 0; j < tasksData.length; j++) {
      var req = tasksData[j];
      var targetRow = -1;

      if (req.r && req.r > 1 && req.r <= data.length && String(data[req.r - 1][idx.id]).trim() === String(req.id).trim()) {
        targetRow = req.r;
      } else {
        var reqBranch = String(req.branch || "").trim();
        for (var i = 1; i < data.length; i++) {
          if (String(data[i][idx.id]).trim() === String(req.id).trim() && String(data[i][idx.branch] || "").trim() === reqBranch) {
            targetRow = i + 1; break;
          }
        }
      }

      if (targetRow !== -1) {
        var oldCar = String(data[targetRow - 1][idx.v] || "").trim();
        if (oldCar) affectedCars.add(oldCar);

        data[targetRow - 1][idx.v] = "";
        data[targetRow - 1][idx.s] = "待指派";
        data[targetRow - 1][idx.sq] = "";
        _writeRowCells_(sheet, targetRow, data[targetRow - 1], [idx.v, idx.s, idx.sq]); // V41.22
      }
    }

    _clearWarRoomCache_();
    affectedCars.forEach(function (c) { if (c) updateScheduleTrace_V12(c); });

    return "✅ 單據已成功收回至待指派庫";
  } catch (e) { return "❌ 取消失敗: " + e.message; }
  finally { lock.releaseLock(); }
}

/** V11.12.2: 清除所有訂單的司機指派，用於重新分配 */
function adminResetAllAssignments(token) {
  try {
    _requireAdmin_(token);
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
    if (!sheet) throw new Error("找不到任務工作表");
    var data = sheet.getDataRange().getValues();
    var h = data[0].map(function (v) { return String(v).trim(); });
    var findAny = function (names) { for (var n of names) { var p = h.indexOf(n); if (p >= 0) return p; } return -1; };
    var colCar = findAny(["車牌", "配送車輛", "指派車輛"]);
    var colSeq = findAny(["順序", "配送順序", "配送序號"]);
    var colStatus = findAny(["狀態", "配送狀態"]);
    if (colCar < 0) throw new Error("找不到車牌欄 (已嘗試: 車牌/配送車輛/指派車輛)");
    var count = 0;
    var carCol = [], seqCol = [];
    for (var i = 1; i < data.length; i++) {
      var status = colStatus >= 0 ? String(data[i][colStatus] || "") : "";
      var keep = (status === "已完成");
      carCol.push([keep ? data[i][colCar] : ""]);
      if (colSeq >= 0) seqCol.push([keep ? data[i][colSeq] : ""]);
      if (!keep) count++;
    }
    // V41: 一次寫回整欄 (舊版逐格 setValue，每筆兩次來回)
    if (carCol.length) {
      sheet.getRange(2, colCar + 1, carCol.length, 1).setValues(carCol);
      if (colSeq >= 0) sheet.getRange(2, colSeq + 1, seqCol.length, 1).setValues(seqCol);
    }
    _clearWarRoomCache_();
    return "✅ 已清除 " + count + " 筆指派，可重新分配";
  } catch (e) { return "❌ 操作失敗: " + e.message; }
}

/** V11.12.2: 確保 KPI 統計分頁存在 */
function ensureKPISheet_V12() {
  var ss = getSS_V11();
  var sheet = ss.getSheetByName("KPI 統計");
  if (!sheet) {
    sheet = ss.insertSheet("KPI 統計");
    sheet.getRange(1, 1, 1, 7).setValues([["日期", "訂單數", "送達", "退貨", "待完成", "總重量(KG)", "更新時間"]]);
    sheet.getRange(1, 1, 1, 7).setFontWeight("bold").setBackground("#1e293b").setFontColor("#ffffff");
  }
  return sheet;
}

function updateTaskOrder(tasks, token) {
  var lock = LockService.getScriptLock();
  try {
    var ctx = _requireDriver_(token);
    if (!lock.tryLock(15000)) throw new Error("系統忙碌中，更新失敗。");

    var ss = getSS_V11(), sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS), data = sheet.getDataRange().getValues();
    var h = data[0].map(function (v) { return String(v).trim(); });
    var idxId = h.indexOf("單號"), idxSq = h.indexOf("順序"), idxBr = h.indexOf("分公司"), idxV = h.indexOf("車牌");

    var affectedCars = new Set();
    var carAllowMemo = {}; // V41.22: 同一車牌只查一次權限
    var mayUse = function (car) {
      var k = cleanPlate_Core(car);
      if (!(k in carAllowMemo)) carAllowMemo[k] = _driverMayUseCar_(ctx, car);
      return carAllowMemo[k];
    };

    for (var j = 0; j < tasks.length; j++) {
      var target = tasks[j];
      var targetId = typeof target === 'object' ? String(target.id) : String(target);
      var targetBr = typeof target === 'object' ? String(target.branch || "") : "";

      for (var i = 1; i < data.length; i++) {
        var rowId = String(data[i][idxId]).trim();
        var rowBr = idxBr !== -1 ? String(data[i][idxBr]).trim() : "";

        if (rowId === targetId && (targetBr === "" || rowBr === targetBr)) {
          if (ctx.role === 'driver' && idxV !== -1 && !mayUse(data[i][idxV])) break; // V41: 不可動他車的單
          data[i][idxSq] = j + 1;
          _writeRowCells_(sheet, i + 1, data[i], [idxSq]); // V41.22: 只寫順序欄
          if (idxV !== -1) affectedCars.add(String(data[i][idxV]).trim());
          break;
        }
      }
    }

    _clearWarRoomCache_();
    affectedCars.forEach(function (c) { if (c) updateScheduleTrace_V12(c); });

    return "✅ 順序已更新並同步足跡";
  } catch (e) { return "❌ 更新失敗: " + e.message; }
  finally { lock.releaseLock(); }
}

/**
 * V11.18: 刪除訂單 (邏輯為封存，不上演物理刪除)
 */
function adminDeleteTask_V11(taskId, branch, token) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return "❌ 系統忙碌中，刪除失敗";

  try {
    _requireAdmin_(token);
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
    var data = sheet.getDataRange().getValues();
    var h = data[0].map(function (v) { return String(v).trim(); });

    var idIdx = h.indexOf("單號");
    var branchIdx = h.indexOf("分公司");
    var archiveIdx = h.indexOf("是否封存");
    if (idIdx === -1) throw new Error("找不到單號欄位");
    if (archiveIdx === -1) {
      archiveIdx = h.length;
      sheet.getRange(1, archiveIdx + 1).setValue("是否封存");
    }

    for (var i = 1; i < data.length; i++) {
      var rowId = String(data[i][idIdx]).trim();
      var rowBranch = branchIdx !== -1 ? String(data[i][branchIdx]).trim() : "";

      // 如果有提供 branch，則兩者皆需符合；否則僅比對單號 (相容舊版)
      var isMatch = false;
      if (branch) {
        isMatch = (rowId === String(taskId).trim() && rowBranch === String(branch).trim());
      } else {
        isMatch = (rowId === String(taskId).trim());
      }

      if (isMatch) {
        sheet.getRange(i + 1, archiveIdx + 1).setValue("手動刪除"); // 以手動刪除作為封存標記，隱藏於畫面上
        _clearWarRoomCache_(); // V36.3: 清除快取
        return "✅ 任務 " + taskId + (branch ? " (" + branch + ")" : "") + " 已刪除";
      }
    }
    _clearWarRoomCache_(); // V36.3: 清除快取
    return "❌ 找不到指定單號" + (branch ? " (" + branch + ")" : "");
  } catch (e) {
    return "❌ 刪除失敗: " + e.message;
  } finally {
    lock.releaseLock();
  }
}

/**
 * V11.10 快速回報 - 重構版
 * 上班/下班打卡 → 每日行程表 (動態標頭)
 * 加油登記 → 每日行程表 (加油金額/公升/照片)
 * 車輛保養 → 車輛保養工作表 (精確欄位對位)
 */
// WORKLOG_SERVICE_SECRET：與「鈦傳速倉庫工作日誌」對接的共用密鑰，請直接在「專案設定 → 指令碼屬性」設定，
// 不要寫進原始碼（舊版曾把密鑰寫在這裡並推上公開 repo，該組密鑰已視為外洩，兩邊都必須換新）。

// 請假按鈕用：拿司機姓名跟倉庫工作日誌系統換一條該司機的專屬連結（伺服器對伺服器呼叫，
// 密鑰不會出現在前端程式碼或網路請求裡讓司機看到）
function getLeaveLinkForDriver(driverName, token) {
  try {
    var ctx = _requireDriver_(token); if (ctx.role === 'driver') driverName = ctx.name; // 司機只能拿自己的連結
    var secret = PropertiesService.getScriptProperties().getProperty('WORKLOG_SERVICE_SECRET');
    if (!secret) return { success: false, error: '尚未設定密鑰，請聯絡主管' };
    var url = 'https://script.google.com/macros/s/AKfycbyFugaIiv_I5yTfj-AYwo6yEadPQLhKtmmb5MeIlQmeyB4iTYNdjZWpBH7ZIy1gDwSy/exec'
      + '?p=service&action=leaveLink'
      + '&driver=' + encodeURIComponent(driverName || '')
      + '&secret=' + encodeURIComponent(secret);
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    return JSON.parse(resp.getContentText());
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

function submitQuickReport(report) {
  try {
    var ctx = _requireDriver_(report && report.token); if (!_driverMayUseCar_(ctx, report && report.car)) throw new Error('🔒 AUTH_FORBIDDEN：無權操作車輛 ' + (report && report.car));
    // V2633.1: 身分安全性核封 (V34.27: 已廢棄 token 驗證，改為全信任前端姓名配置)
    // const decoded = _verifyToken(report.token);
    if ((report.type === '上班打卡' || report.type === '下班打卡') && (!report.mileage || isNaN(Number(report.mileage)))) {
      throw new Error("🚨 里程數必填且須為有效數字！");
    }
    var ss = getSS_V11(), now = new Date();
    if (checkUUIDDuplicate(ss, report.clientUUID)) return "✅ 提交成功 (離線去重)";
    var dateStr = Utilities.formatDate(now, "GMT+8", "yyyy/MM/dd");
    var timeStr = Utilities.formatDate(now, "GMT+8", "yyyy/MM/dd HH:mm:ss");

    // V2632.15 修正：優先使用前端傳過來的 driverName，若無則從車牌映射
    var driverName = report.driverName || "";
    if (!driverName) {
      var vInfo = getManagementData();
      driverName = vInfo.vehicleMap[report.car] || "";
    }

    // V11.23 里程必填防呆
    if ((report.type === '上班打卡' || report.type === '下班打卡') && !report.mileage) {
      throw new Error("🚨 此報告類型必須填寫里程數！");
    }

    var photoUrl = (report.photo) ? uploadFile(report.photo, "QUICK_" + report.type + "_" + report.car) : "";
    var photoInt = (report.photo_int) ? uploadFile(report.photo_int, "INT_" + report.car) : "";
    var photoExt = (report.photo_ext) ? uploadFile(report.photo_ext, "EXT_" + report.car) : "";

    if (report.type === '上班打卡' || report.type === '下班打卡') {
      var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_SCHEDULE);
      var data = sheet.getDataRange().getValues();
      var h = data[0].map(function (v) { return String(v).trim(); });
      var findSCol = function (names) { for (var n of names) { var p = h.indexOf(n); if (p !== -1) return p; } return -1; };

      var colDate = findSCol(["日期"]);
      var colCar = findSCol(["車牌", "車牌號碼", "車輛"]);
      var colDriver = findSCol(["司機", "姓名", "人員", "駕駛"]);
      if (colDate === -1) colDate = 0; if (colCar === -1) colCar = 1; if (colDriver === -1) colDriver = 2; // Fallback

      var colMile = findSCol(["起始里程", "開始里程", "上班里程"]);
      var colEndMile = findSCol(["結束里程", "下班里程"]);
      var colPhotoExt = findSCol(["外觀照片"]);
      var colPhotoInt = findSCol(["內裝照片"]);

      var targetRow = -1;
      for (var i = 1; i < data.length; i++) {
        var rowDate = normalizeDate_Core(data[i][colDate]);
        if (rowDate === dateStr && String(data[i][colCar]).trim().toUpperCase() === String(report.car).trim().toUpperCase()) { targetRow = i + 1; break; }
      }

      if (targetRow > -1) {
        if (report.type === '上班打卡') {
          if (colMile >= 0) sheet.getRange(targetRow, colMile + 1).setValue(report.mileage);
          if (photoExt && colPhotoExt >= 0) sheet.getRange(targetRow, colPhotoExt + 1).setValue(photoExt);
          if (photoInt && colPhotoInt >= 0) sheet.getRange(targetRow, colPhotoInt + 1).setValue(photoInt);
        } else {
          // V11.11 下班里程防呆
          if (colMile >= 0) {
            var startMile = Number(sheet.getRange(targetRow, colMile + 1).getValue()) || 0;
            if (startMile > 0 && Number(report.mileage) <= startMile) {
              throw new Error("🚨 下班里程 (" + report.mileage + ") 不可低於或等於上班里程 (" + startMile + ")！");
            }
          }
          if (colEndMile >= 0) sheet.getRange(targetRow, colEndMile + 1).setValue(report.mileage);
          // V2631.18c: 計算當日總里程 = 結束里程 - 起始里程
          var colTotal = findSCol(["當日總里程", "總里程", "單日里程", "行駛里程"]);
          if (colTotal >= 0 && colMile >= 0) {
            var startKm = Number(sheet.getRange(targetRow, colMile + 1).getValue()) || 0;
            var endKm = Number(report.mileage) || 0;
            if (endKm > startKm) sheet.getRange(targetRow, colTotal + 1).setValue(endKm - startKm);
          }
        }
      } else {
        var newRow = new Array(h.length).fill("");
        newRow[colDate] = dateStr; newRow[colCar] = report.car; newRow[colDriver] = driverName;
        if (colMile >= 0 && report.type === '上班打卡') newRow[colMile] = report.mileage;
        if (colEndMile >= 0 && report.type === '下班打卡') newRow[colEndMile] = report.mileage;
        if (colPhotoExt >= 0 && photoExt) newRow[colPhotoExt] = photoExt;
        if (colPhotoInt >= 0 && photoInt) newRow[colPhotoInt] = photoInt;
        sheet.appendRow(newRow);
        targetRow = sheet.getLastRow(); // V5.2 Fix
      }
      
      // V6.2: 如果是下班打卡，清除該車的「目前導航目標」
      if (report.type === '下班打卡') {
        try { logDeparture_V24(report.car, ""); } catch (e) { }
        _clearWarRoomCache_();
      }

      // V35.5: 上下班打卡不再寫入送貨日誌，僅更新行程表時間
      var schSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_SCHEDULE);
      ensureHeaders_V11(schSheet);
      var schH2 = schSheet.getRange(1, 1, 1, schSheet.getLastColumn()).getValues()[0].map(v => String(v).trim());
      var colTimeIn = schH2.indexOf("上班時間");
      var colTimeOut = schH2.indexOf("下班時間");
      var shortTime = Utilities.formatDate(now, "GMT+8", "HH:mm");
      if (report.type === '上班打卡' && colTimeIn >= 0) schSheet.getRange(targetRow, colTimeIn + 1).setValue(shortTime);
      if (report.type === '下班打卡' && colTimeOut >= 0) schSheet.getRange(targetRow, colTimeOut + 1).setValue(shortTime);

      // V34.10: 上下班打卡也立即寫入行程足跡
      updateScheduleTrace_V12(report.car, report.lat, report.lng, report.type, (report.type === '上班打卡' ? '公司出發' : '返抵公司'));

      // 串接「鈦傳速倉庫工作日誌」系統：發車=打上班卡、收工=打下班卡。純附加、失敗不拋錯，
      // 絕對不能因為對方系統掛掉或密鑰沒設定就影響到這裡的發車/收工/里程主流程。
      try {
        var wlSecret = PropertiesService.getScriptProperties().getProperty('WORKLOG_SERVICE_SECRET');
        if (wlSecret) {
          UrlFetchApp.fetch(
            'https://script.google.com/macros/s/AKfycbyFugaIiv_I5yTfj-AYwo6yEadPQLhKtmmb5MeIlQmeyB4iTYNdjZWpBH7ZIy1gDwSy/exec'
            + '?p=service'
            + '&driver=' + encodeURIComponent(driverName)
            + '&type=' + encodeURIComponent(report.type)
            + '&lat=' + encodeURIComponent(report.lat || '')
            + '&lng=' + encodeURIComponent(report.lng || '')
            + '&secret=' + encodeURIComponent(wlSecret),
            { muteHttpExceptions: true }
          );
        }
      } catch (e) { /* 忽略：出勤打卡串接失敗不影響發車/收工本身 */ }

    } else if (report.type === '收貨' || report.type === '退貨') {
      // 1. 先寫入送貨日誌 (SHEET_LOG) — V2631.18c Bug2 Fix: 改用動態標頭對位
      var logSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_LOG);
      ensureHeaders_V11(logSheet);
      var logH = logSheet.getRange(1, 1, 1, Math.max(1, logSheet.getLastColumn())).getValues()[0].map(function (v) { return String(v).trim(); });
      var logRow = new Array(logH.length).fill("");
      var setLog = function (name, val) { var p = logH.indexOf(name); if (p >= 0) logRow[p] = val; };
      setLog("司機", driverName);
      setLog("車牌號碼", report.car);
      setLog("單號", report.orderId || "");
      setLog("客戶名稱", cleanCustName_V11(report.customer));
      setLog("送貨地址", "臨時派遣");
      setLog("指定到貨時間", report.specifiedArrive || ""); // V40
      setLog("配送完成時間", timeStr);
      setLog("備註", report.note);
      setLog("貨物破損", "否");
      setLog("是否有退貨", report.type === '退貨' ? '是' : '否');
      setLog("退貨照片", photoUrl);
      setLog("抵達 GPS 定位", report.lat + "," + report.lng);
      setLog("clientUUID", report.clientUUID || "");
      logSheet.appendRow(logRow);

      // 2. 寫入行程足跡 (SHEET_SCHEDULE)
      updateScheduleTrace_V12(report.car, report.lat, report.lng);

      // V34.3: 同步更新「車輛即時狀態」，確保管理員地圖同步換位
      updateVehicleLocation(report.car, report.lat, report.lng);

      // 3. (V11.12.7) 收貨/退貨 註記寫入當日行程表的 colNote
      var sSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_SCHEDULE);
      var sData = sSheet.getDataRange().getValues();
      var sH = sData[0].map(function (v) { return String(v).trim(); });
      var findSCol = function (names) { for (var n of names) { var p = sH.indexOf(n); if (p !== -1) return p; } return -1; };
      var targetRow = -1;
      for (var i = 1; i < sData.length; i++) {
        var rowDate = (sData[i][0] instanceof Date) ? Utilities.formatDate(sData[i][0], "GMT+8", "yyyy/MM/dd") : String(sData[i][0]);
        if (rowDate === dateStr && String(sData[i][1]) === String(report.car)) { targetRow = i + 1; break; }
      }
      var colNote = findSCol(["備註", "事由"]);
      if (targetRow > -1 && colNote >= 0) {
        var oldVal = sSheet.getRange(targetRow, colNote + 1).getValue();
        var detail = "[" + report.type + "] " + cleanCustName_V11(report.customer) + (report.address_short ? " @" + report.address_short : "");
        sSheet.getRange(targetRow, colNote + 1).setValue(oldVal ? oldVal + " | " + detail : detail);
      } else if (targetRow === -1) {
        var newRow = new Array(sH.length).fill("");
        newRow[0] = dateStr; newRow[1] = report.car; newRow[2] = driverName;
        if (colNote >= 0) newRow[colNote] = "[" + report.type + "] " + cleanCustName_V11(report.customer) + (report.address_short ? " @" + report.address_short : "");
        sSheet.appendRow(newRow);
      }

    } else if (report.type === '加油登記') {
      var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_SCHEDULE);
      var sData = sheet.getDataRange().getValues();
      var sH = sData[0].map(function (v) { return String(v).trim(); });
      var findSCol = function (names) { for (var n of names) { var p = sH.indexOf(n); if (p !== -1) return p; } return -1; };
      var targetRow = -1;
      for (var i = 1; i < sData.length; i++) {
        var rowDate = (sData[i][0] instanceof Date) ? Utilities.formatDate(sData[i][0], "GMT+8", "yyyy/MM/dd") : String(sData[i][0]);
        if (rowDate === dateStr && String(sData[i][1]) === String(report.car)) { targetRow = i + 1; break; }
      }
      var colAmt = findSCol(["加油金額", "油費金額", "油費"]);
      var colLit = findSCol(["加油公升數", "加油公升", "加油量", "公升數"]); // V2631.18c Bug5 Fix
      var colFuelPhoto = findSCol(["加油發票照片", "發票照片", "加油發票"]); // V2631.18c Bug5 Fix
      var colMile = findSCol(["起始里程", "開始里程", "里程"]);

      if (targetRow > -1) {
        if (colAmt >= 0 && report.amount) sheet.getRange(targetRow, colAmt + 1).setValue(report.amount);
        if (colLit >= 0 && report.litres) sheet.getRange(targetRow, colLit + 1).setValue(report.litres);
        if (colFuelPhoto >= 0 && photoUrl) sheet.getRange(targetRow, colFuelPhoto + 1).setValue(photoUrl);
        if (colMile >= 0 && report.mileage) sheet.getRange(targetRow, colMile + 1).setValue(report.mileage);
      } else {
        var newRow = new Array(sH.length).fill("");
        newRow[0] = dateStr; newRow[1] = report.car; newRow[2] = driverName;
        if (colAmt >= 0) newRow[colAmt] = report.amount;
        if (colLit >= 0) newRow[colLit] = report.litres;
        if (colFuelPhoto >= 0) newRow[colFuelPhoto] = photoUrl;
        if (colMile >= 0) newRow[colMile] = report.mileage;
        sheet.appendRow(newRow);
        targetRow = sheet.getLastRow(); // V5.2 Fix
      }

    } else if (report.type === '車輛保養') {
      var mSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_MAINT);
      if (!mSheet) return "❌ 找不到「車輛保養」工作表，請確認分頁名稱";
      var mData = mSheet.getDataRange().getValues();
      var mH = mData[0].map(function (v) { return String(v).trim(); });

      var p1 = report.photo ? uploadFile(report.photo, "MAINT1_" + report.car) : "";
      var p2 = report.photo2 ? uploadFile(report.photo2, "MAINT2_" + report.car) : "";
      var p3 = report.photo3 ? uploadFile(report.photo3, "MAINT3_" + report.car) : "";
      var photoMerged = [p1, p2, p3].filter(function (u) { return u; }).join(" / ");

      var newMaintRow = new Array(mH.length).fill("");
      var setM = function (name, val) { var i = mH.indexOf(name); if (i >= 0) newMaintRow[i] = val; };

      setM("保養日期", dateStr);
      if (mH.indexOf("車牌") >= 0) setM("車牌", report.car);
      else setM("車牌號碼", report.car);
      if (mH.indexOf("本次里程") >= 0) setM("本次里程", report.mileage || "");
      else setM("本次保養里程", report.mileage || "");

      // V2631.18d: 寫入下次保養里程
      if (mH.indexOf("下次保養里程") >= 0) setM("下次保養里程", report.nextMileage || "");
      else if (mH.indexOf("下一次保養里程") >= 0) setM("下一次保養里程", report.nextMileage || "");

      setM("保養人員", driverName || "司機端");
      setM("登記人", driverName || "司機端");

      // V2631.18d: 自動計算距上次間隔天數
      var colDiff = mH.indexOf("距上次間隔(天)");
      if (colDiff >= 0 && report.lastDate) {
        var d1 = new Date(report.lastDate);
        var d2 = new Date();
        var diffTime = Math.abs(d2 - d1);
        var diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        newMaintRow[colDiff] = diffDays;
      }

      // 把勾選項目打勾
      if (report.items) {
        var itemsArr = report.items.split('、');
        itemsArr.forEach(function (item) {
          setM(item, "✓");
        });
      }

      mSheet.appendRow(newMaintRow);
    }

    _markUUIDDone_(report.clientUUID);
    return "✅ 「" + report.type + "」回報已送達！(當日資料已同步更新)";
  } catch (e) { return "❌ 提交失敗: " + e.message; }
}

/**
 * V11.10 新增：檢查今日是否已上班打卡
 */
function checkTodayAttendance(car, token) {
  try {
    _requireDriver_(token);
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_SCHEDULE);
    var data = sheet.getDataRange().getValues();
    var dateStr = Utilities.formatDate(new Date(), "GMT+8", "yyyy/MM/dd");
    var h = data[0].map(function (v) { return String(v).trim(); });

    var colDate = findHIdx_Core(h, "DATE");
    var colCar = findHIdx_Core(h, "VEHICLE");
    var colStartMile = findHIdx_Core(h, ["上班里程", "起始里程"]);
    var colEndMile = findHIdx_Core(h, ["下班里程", "結束里程", "SEQ"]);
    var colTrace = findHIdx_Core(h, ["當日行程足跡", "行程足跡", "ADDRESS"]);

    if (colDate === -1) colDate = 0; if (colCar === -1) colCar = 1;

    function norm(s) {
      return String(s || "").trim().toUpperCase().replace(/[-\s]/g, "").replace(/[Ａ-Ｚ０-９]/g, function (s) {
        return String.fromCharCode(s.charCodeAt(0) - 0xfee0);
      });
    }
    var targetCar = norm(car);

    // V35.9.4: 全方位日期識別器
    function getMatchDate(val) {
      if (!val) return "";
      if (val instanceof Date) return Utilities.formatDate(val, "GMT+8", "yyyy/MM/dd");
      var s = String(val).trim();
      var m = s.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
      if (m) return m[1] + "/" + ("0" + m[2]).slice(-2) + "/" + ("0" + m[3]).slice(-2);
      var parts = s.split(/[\/\-]/);
      if (parts.length >= 3) {
        var y = parts[0].length === 4 ? parts[0] : "20" + parts[0];
        var m_ = ("0" + parts[1].replace(/\D/g, "")).slice(-2);
        var d_ = ("0" + parts[2].replace(/\D/g, "")).slice(-2);
        return y + "/" + m_ + "/" + d_;
      }
      return s.substring(0, 10);
    }
    var targetDate = getMatchDate(new Date());

    for (var i = 1; i < data.length; i++) {
      var rowDate = getMatchDate(data[i][colDate]);
      var rowCar = norm(data[i][colCar]);

      if (rowDate === targetDate && rowCar === targetCar) {
        var startTime = "--:--";
        if (colTrace >= 0) {
          var trace = String(data[i][colTrace] || "").trim();
          var timeMatch = trace.match(/(\d{1,2})[:：](\d{2})/);
          if (timeMatch) {
            startTime = ("0" + timeMatch[1]).slice(-2) + ":" + timeMatch[2];
          } else if (trace.match(/^\d{4}$/)) {
            startTime = trace.substring(0, 2) + ":" + trace.substring(2, 4);
          }
        }
        var hasClockOut = (colEndMile >= 0 && String(data[i][colEndMile]).trim() !== "");
        var startMile = (colStartMile >= 0) ? String(data[i][colStartMile]) : "";
        return { hasClockIn: true, hasClockOut: hasClockOut, startTime: startTime, startMileage: startMile };
      }
    }
    return { hasClockIn: false, hasClockOut: false, startTime: "--:--", startMileage: "" };
  } catch (e) {
    return { hasClockIn: false, hasClockOut: false, startTime: "--:--", startMileage: "", error: e.toString() };
  }
}

/** V35.9: 司機重新回報 (撤回結案) */
function driverRedoTask(orderId, branch, token) {
  try {
    _requireDriver_(token);
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
    var data = sheet.getDataRange().getValues();
    var h = data[0].map(v => String(v).trim());
    var idxId = findHIdx_Core(h, "ID"), idxB = findHIdx_Core(h, "BRANCH"), idxS = findHIdx_Core(h, "STATUS"), idxN = findHIdx_Core(h, "NOTE");

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idxId]) === String(orderId) && String(data[i][idxB]) === String(branch)) {
        sheet.getRange(i + 1, idxS + 1).setValue("配送中");
        var oldNote = String(data[i][idxN] || "");
        sheet.getRange(i + 1, idxN + 1).setValue(oldNote + " (撤回重報 " + Utilities.formatDate(new Date(), "GMT+8", "HH:mm") + ")");
        _clearWarRoomCache_();
        return { success: true, message: "✅ 已重設狀態，請點擊「拍照結案」重新回報。" };
      }
    }
    return { success: false, error: "找不到該筆單據" };
  } catch (e) { return { success: false, error: e.message }; }
}

/**
 * 抓取上一次保養紀錄 (供司機端保養介面顯示)
 */
function getMaintenanceHistory(car) {
  try {
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_MAINT);
    if (!sheet) return null;
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { lastDates: {} };
    var h = data[0].map(function (v) { return String(v).trim(); });

    var plateIdx = h.indexOf("車牌號碼");
    if (plateIdx < 0) plateIdx = h.indexOf("車牌");
    var dateIdx = h.indexOf("保養日期");

    var partsControls = [
      '變速箱油', '方向機油', '前輪碟盤', '後輪碟盤', '前輪來令片', '後輪來令片',
      '空氣濾芯', '冷氣濾網', '右前輪胎', '右後輪胎', '左前輪胎', '左後輪胎',
      '火星塞', '皮帶'
    ];

    var lastDates = {};
    if (dateIdx >= 0 && plateIdx >= 0) {
      partsControls.forEach(function (part) {
        var pIdx = h.indexOf(part);
        if (pIdx >= 0) {
          for (var i = data.length - 1; i >= 1; i--) {
            if (String(data[i][plateIdx]).trim() === String(car)) {
              var val = String(data[i][pIdx]).trim();
              if (val && val !== '' && val !== '否') {
                var dt = String(data[i][dateIdx]).trim().split(' ')[0] || '';
                if (dt.indexOf('T') !== -1) dt = dt.split('T')[0];
                else if (dt.indexOf('/') !== -1) dt = dt.split(' ')[0];
                lastDates[part] = dt;
                break;
              }
            }
          }
        }
      });
    }
    return { lastDates: lastDates };
  } catch (e) { return { lastDates: {} }; }
}

/**
 * 取得指定車牌上一次的保養里程、下回保養里程、保養項目、保養日期與備註 (供司機端保養介面預先載入)
 */
function getLastMaintRecord_V11(car) {
  try {
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_MAINT);
    if (!sheet) return { success: false, msg: "找不到保養分頁" };
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: false, msg: "無保養歷史紀錄" };
    var h = data[0].map(function (v) { return String(v).trim(); });
    
    var plateIdx = h.indexOf("車牌");
    if (plateIdx < 0) plateIdx = h.indexOf("車牌號碼");
    var dateIdx = h.indexOf("保養日期");
    var mileIdx = h.indexOf("本次里程");
    if (mileIdx < 0) mileIdx = h.indexOf("本次保養里程");
    var nextMileIdx = h.indexOf("下次保養里程");
    if (nextMileIdx < 0) nextMileIdx = h.indexOf("下一次保養里程");
    var noteIdx = h.indexOf("備註");
    var itemsIdx = h.indexOf("保養項目");
    
    if (plateIdx < 0) return { success: false, msg: "欄位設定錯誤" };
    
    // 逆向掃描最後一筆此車牌的紀錄
    for (var i = data.length - 1; i >= 1; i--) {
      if (String(data[i][plateIdx]).trim() === String(car).trim()) {
        var recordDate = dateIdx >= 0 ? String(data[i][dateIdx]).trim() : "";
        if (recordDate) {
          try {
            var d = new Date(recordDate);
            if (!isNaN(d.getTime())) {
              recordDate = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');
            }
          } catch(e) {}
        }
        return {
          success: true,
          date: recordDate,
          mileage: mileIdx >= 0 ? String(data[i][mileIdx]).trim() : "",
          nextMileage: nextMileIdx >= 0 ? String(data[i][nextMileIdx]).trim() : "",
          note: noteIdx >= 0 ? String(data[i][noteIdx]).trim() : "",
          items: itemsIdx >= 0 ? String(data[i][itemsIdx]).trim() : ""
        };
      }
    }
    return { success: false, msg: "找不到該車輛之保養紀錄" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 整合包：一次獲取上期里程資料與各零件上次保養日期
 */
function getVehicleMaintContext_V11(car, token) {
  _requireDriver_(token);
  var history = getMaintenanceHistory(car);
  var lastRecord = getLastMaintRecord_V11(car);
  return {
    lastDates: history ? history.lastDates : {},
    lastRecord: lastRecord
  };
}

/**
 * V11.9 營運補強：抓取昨日最後里程
 */
function getYesterdayMileage_V11p9(car, token) {
  try {
    _requireDriver_(token);
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_SCHEDULE);
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return "";
    var h = data[0].map(function (v) { return String(v).trim(); });
    
    // 動態搜尋欄位索引
    var colCar = -1;
    ["車牌", "車牌號碼", "車輛"].forEach(function (n) { if (h.indexOf(n) !== -1) colCar = h.indexOf(n); });
    if (colCar === -1) colCar = 1; // 預設為第 2 欄 (索引 1)
    
    var colEndMile = -1;
    ["結束里程", "下班里程"].forEach(function (n) { if (h.indexOf(n) !== -1) colEndMile = h.indexOf(n); });
    
    var colStartMile = -1;
    ["起始里程", "開始里程", "上班里程"].forEach(function (n) { if (h.indexOf(n) !== -1) colStartMile = h.indexOf(n); });
    
    // 由下往上掃描最近一筆該車牌的打卡紀錄 (跨假日自動支援)
    for (var i = data.length - 1; i > 0; i--) {
      if (String(data[i][colCar]).trim().toUpperCase() === String(car).trim().toUpperCase()) {
        // 優先使用該車牌最後一次下班的「結束里程」
        if (colEndMile >= 0 && data[i][colEndMile]) {
          var val = Number(data[i][colEndMile]);
          if (!isNaN(val) && val > 0) return val;
        }
        // 如果該天沒有填寫結束里程 (例如忘記收工)，安全回退至該天的「起始里程」
        if (colStartMile >= 0 && data[i][colStartMile]) {
          var val = Number(data[i][colStartMile]);
          if (!isNaN(val) && val > 0) return val;
        }
      }
    }
    return "";
  } catch (e) { return ""; }
}


/**
 * V11.9 歷史查詢功能
 */
function getLatestQuickReports_V11p9(car) {
  try {
    var ss = getSS_V11(), now = new Date();
    var dateStr = Utilities.formatDate(now, "GMT+8", "yyyy/MM/dd");
    var res = { mileage: "無", fuel: "無", maint: "無" };
    var sSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_SCHEDULE);
    var sData = sSheet.getDataRange().getValues();
    for (var i = sData.length - 1; i > 0; i--) {
      var d = (sData[i][0] instanceof Date) ? Utilities.formatDate(sData[i][0], "GMT+8", "yyyy/MM/dd") : String(sData[i][0]);
      if (d === dateStr && String(sData[i][1]) === String(car)) { res.mileage = sData[i][3]; break; }
    }
    var mSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_MAINT);
    if (mSheet) {
      var mData = mSheet.getDataRange().getValues();
      var mH = mData[0].map(function (v) { return String(v).trim(); });
      var plateIdx = mH.indexOf("車牌號碼"); if (plateIdx === -1) plateIdx = 1;
      var dateIdx2 = mH.indexOf("保養日期"); if (dateIdx2 === -1) dateIdx2 = 0;
      for (var i = mData.length - 1; i > 0; i--) {
        var d = (mData[i][dateIdx2] instanceof Date) ? Utilities.formatDate(mData[i][dateIdx2], "GMT+8", "yyyy/MM/dd") : String(mData[i][dateIdx2]);
        if (d === dateStr && String(mData[i][plateIdx]) === String(car)) {
          res.maint = String(mData[i][mH.indexOf("保養項目")] || "") + " (里程: " + String(mData[i][mH.indexOf("本次保養里程")] || "") + ")";
        }
      }
    }
    return res;
  } catch (e) { return null; }
}

function getManagementData() {
  try {
    var ss = getSS_V11();
    var sheetV = ss.getSheetByName(V11_PROD_CONFIG.SHEET_VEHICLE);
    var vData = sheetV ? sheetV.getDataRange().getValues() : [];
    var vMap = {};
    if (vData.length > 0) {
      var vh = vData[0].map(function (v) { return String(v).trim(); });
      var cPlate = vh.indexOf("車牌號碼"); if (cPlate === -1) cPlate = vh.indexOf("車牌"); if (cPlate === -1) cPlate = 0;
      var cDriver = vh.indexOf("司機"); if (cDriver === -1) cDriver = 1;
      for (var i = 1; i < vData.length; i++) {
        var car = String(vData[i][cPlate] || "").trim();
        var drv = String(vData[i][cDriver] || "").trim();
        if (car) vMap[car] = drv;
      }
    }

    var sheetW = ss.getSheetByName(V11_PROD_CONFIG.SHEET_WHITELIST);
    var wData = sheetW ? sheetW.getDataRange().getValues() : [];
    var whiteList = [];
    if (wData.length > 1) {
      var wh = wData[0].map(function (v) { return String(v).trim(); });
      var findIdx = function (keys) {
        for (var i = 0; i < wh.length; i++) {
          var c = wh[i].toLowerCase().replace(/\s/g, "");
          for (var kIdx = 0; kIdx < keys.length; kIdx++) {
            var k = keys[kIdx];
            if (c.indexOf(k.toLowerCase().replace(/\s/g, "")) !== -1) return i;
          }
        }
        return -1;
      };
      var cName = findIdx(["姓名", "名稱"]),
        cCar = findIdx(["預設車牌", "車號"]),
        cEmail = findIdx(["Email帳號", "email", "郵件"]),
        cRole = findIdx(["權限", "角色", "階級", "身分", "身分類型", "Role", "Status"]);

      if (cEmail === -1 || cName === -1) {
        return { error: "⚠️ 系統設定錯誤：白名單缺少「Email帳號」或「姓名」欄位", vehicleMap: vMap, whiteList: [] };
      }

      var exposeEmail = !!__AUTH_CTX__; // V41: 登入前 (司機選名畫面) 不回傳 email
      for (var j = 1; j < wData.length; j++) {
        var name = String(wData[j][cName] || "").trim();
        var email = exposeEmail ? String(wData[j][cEmail] || "").trim().toLowerCase() : "";
        if (name) {
          whiteList.push({
            name: name,
            email: email,
            role: (cRole !== -1) ? String(wData[j][cRole] || "").trim() : "司機",
            defaultCar: (cCar !== -1) ? String(wData[j][cCar] || "").trim() : ""
          });
        }
      }
    }

    return {
      vehicleMap: vMap,
      whiteList: whiteList,
      version: "V2633.4",
      serverTime: new Date().getTime()
    };
  } catch (e) {
    return { error: e.message, vehicleMap: {}, whiteList: [], stack: e.stack };
  }
}

function submitFinalDelivery(report) {
  try {
    var ctx = _requireDriver_(report && report.token); if (!_driverMayUseCar_(ctx, report && report.car)) throw new Error('🔒 AUTH_FORBIDDEN：無權操作車輛 ' + (report && report.car));
    var ss = getSS_V11(), now = new Date(), timeStr = Utilities.formatDate(now, "GMT+8", "yyyy/MM/dd HH:mm:ss");
    if (checkUUIDDuplicate(ss, report.clientUUID)) return { success: true, duplicated: true };

    var driverName = report.driverName || "";
    if (!driverName) {
      var vInfo = getManagementData();
      driverName = vInfo.vehicleMap[report.car] || "";
    }

    var photoId = "", photoUrl = "", tgBlob = null;
    if (report.photo_sign && report.photo_sign.contents) {
      var blob = Utilities.newBlob(Utilities.base64Decode(report.photo_sign.contents.split(',')[1]), report.photo_sign.mimeType, "SIGN_" + report.orderId + "_" + Date.now());
      tgBlob = blob;
      var folder = getSafeFolder_V11();
      var file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      photoId = file.getId();
      photoUrl = "https://drive.google.com/uc?export=view&id=" + photoId;
    }
    var dmgUrl = (report.photo_damage) ? uploadFile(report.photo_damage, "DMG_" + report.orderId) : "";

    var finalStatus = "已完成";
    if (report.type === '配送失敗') finalStatus = "沒有送達";
    var finalSignTypeDesc = (finalStatus === "沒有送達") ? "配送失敗" : "已送達";

    var taskSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
    var tData = taskSheet.getDataRange().getValues();
    var h = tData[0].map(function (v) { return String(v).trim(); });
    var idxId = findHIdx_Core(h, "ID"),
      idxBranch = findHIdx_Core(h, "BRANCH"),
      idxStatus = findHIdx_Core(h, "STATUS"),
      idxFinish = findHIdx_Core(h, "FINISH_TIME"),
      idxSpecified = h.indexOf("指定到貨時間");

    var specifiedArrive = "";

    if (idxId !== -1) {
      var foundRow = -1;
      var reportOrderId = String(report.orderId || "").trim();
      var reportBranch = String(report.branch || "").trim();

      for (var i = 1; i < tData.length; i++) {
        var rowId = String(tData[i][idxId] || "").trim();
        if (!rowId || !reportOrderId) continue;

        // 容錯：同時嘗試完全比對 與 去除後綴比對（例如 001-安 vs 001）
        var idExact = rowId === reportOrderId;
        var idLoose = rowId.replace(/-[安高漢喜]$/, '') === reportOrderId.replace(/-[安高漢喜]$/, '');

        if (!idExact && !idLoose) continue;

        // 有分公司時必須比對，沒有時寬鬆通過
        if (reportBranch && idxBranch !== -1) {
          if (String(tData[i][idxBranch] || "").trim() !== reportBranch) continue;
        }

        foundRow = i + 1;
        if (idxSpecified !== -1) specifiedArrive = _fmtArriveTime_(getSafeVal(tData[i], idxSpecified)); // V40
        break;
      }

      if (foundRow !== -1) {
        console.log("Matching successful. Found Row: " + foundRow + " for Order: " + reportOrderId);
        if (idxStatus !== -1) taskSheet.getRange(foundRow, idxStatus + 1).setValue(finalStatus);
        if (idxFinish !== -1) taskSheet.getRange(foundRow, idxFinish + 1).setValue(timeStr);
        // V37.15: 強制設定白底，確保清除原本的指派顏色
        taskSheet.getRange(foundRow, 1, 1, taskSheet.getLastColumn()).setBackground('#ffffff');
      } else {
        // 找不到對應列時記錄 Log，方便事後追查
        console.error("submitFinalDelivery: 找不到單號 " + reportOrderId + " (" + reportBranch + ") 的對應列，比對失敗");
      }
    }

    var logSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_LOG);
    ensureHeaders_V11(logSheet);
    var logH = logSheet.getRange(1, 1, 1, Math.max(1, logSheet.getLastColumn())).getValues()[0].map(function (v) { return String(v).trim(); });
    var logRow = new Array(logH.length).fill("");
    var setLog = function (name, val) { var p = logH.indexOf(name); if (p >= 0) logRow[p] = val; };

    setLog("司機", driverName);
    setLog("車牌號碼", report.car);
    setLog("單號", report.orderId || "");
    setLog("客戶名稱", report.customer);
    setLog("送貨地址", report.address);
    setLog("指定到貨時間", specifiedArrive); // V40: 強制指定到貨時間 (電梯管制)
    setLog("配送完成時間", timeStr);
    var currentSignType = report.signType || "本人親簽";
    var isUnattendedSign = (currentSignType.indexOf("無人") !== -1 || currentSignType.indexOf("放置指定位置") !== -1);
    var signPrefixTag = isUnattendedSign ? "[" + currentSignType + "] " : "";
    setLog("備註", (finalStatus === "沒有送達" ? "[配送失敗] " : signPrefixTag) + (report.note || ""));
    setLog("司機說明", report.driverIssue || ""); // V40: 司機狀況回報 (統計用)
    setLog("貨物破損", report.isDamaged === '是' ? '是' : '否');
    setLog("破損照片", dmgUrl);
    setLog("簽收單照片", photoUrl);
    setLog("是否有退貨", report.hasBack || "否");
    setLog("退貨照片", (report.photo_back) ? uploadFile(report.photo_back, "BACK_" + report.orderId) : "");
    setLog("抵達 GPS 定位", report.lat + "," + report.lng);
    setLog("clientUUID", report.clientUUID || "");
    setLog("簽收類型", currentSignType);
    logSheet.appendRow(logRow);

    // V37.23: 同地址批次結案 — 為每個合併訂單更新狀態 + 寫入 Log
    if (report.batchTasks && Array.isArray(report.batchTasks) && report.batchTasks.length > 0) {
      report.batchTasks.forEach(function(bt) {
        try {
          var btId = String(bt.id || "").trim();
          var btBranch = String(bt.branch || "").trim();
          if (!btId) return;
          // 更新 SHEET_TASKS 狀態
          if (idxId !== -1) {
            var btRow = -1;
            for (var bi = 1; bi < tData.length; bi++) {
              var btRowId = String(tData[bi][idxId] || "").trim();
              if (!btRowId) continue;
              if (btRowId !== btId && btRowId.replace(/-[安高漢喜]$/, '') !== btId.replace(/-[安高漢喜]$/, '')) continue;
              if (btBranch && idxBranch !== -1 && String(tData[bi][idxBranch] || "").trim() !== btBranch) continue;
              btRow = bi + 1;
              break;
            }
            if (btRow !== -1) {
              if (idxStatus !== -1) taskSheet.getRange(btRow, idxStatus + 1).setValue('已完成');
              if (idxFinish !== -1) taskSheet.getRange(btRow, idxFinish + 1).setValue(timeStr);
              taskSheet.getRange(btRow, 1, 1, taskSheet.getLastColumn()).setBackground('#ffffff');
            }
          }
          // 寫入 SHEET_LOG（共用同一張簽收照片）
          var btLogRow = new Array(logH.length).fill("");
          var setBt = function(name, val) { var p = logH.indexOf(name); if (p >= 0) btLogRow[p] = val; };
          setBt("司機", driverName);
          setBt("車牌號碼", report.car);
          setBt("單號", btId);
          setBt("客戶名稱", bt.customer || "");
          setBt("送貨地址", bt.address || "");
          setBt("指定到貨時間", specifiedArrive); // V40
          setBt("配送完成時間", timeStr);
          setBt("備註", "[批次結案] 同地址合併");
          setBt("司機說明", report.driverIssue || ""); // V40
          setBt("貨物破損", "否");
          setBt("簽收單照片", photoUrl);
          setBt("是否有退貨", "否");
          setBt("抵達 GPS 定位", (report.lat || 0) + "," + (report.lng || 0));
          setBt("clientUUID", bt.clientUUID || "");
          setBt("簽收類型", report.signType || "本人親簽");
          logSheet.appendRow(btLogRow);
        } catch(bte) {
          console.error("批次結案錯誤 " + (bt.id || "") + ": " + bte.message);
        }
      });
    }

    // V34.3: 同步更新「車輛即時狀態」，確保地圖圓點同步移動
    updateVehicleLocation(report.car, report.lat, report.lng);

    // V38.x: 配送完成 → 自動推送簽收卡片到 Telegram 到貨群組（依分公司分流，狀態已寫入後統計才正確）
    if (tgBlob) {
      try {
        var tgBranch = String(report.branch || "").trim();
        var tgStatusEmoji = (finalStatus === "沒有送達") ? '❌' : (report.isDamaged === '是' ? '🚨' : '✅');
        var tgStats = _getBranchTodayStats_V11(tgBranch);
        var tgCaption = "<b>" + tgStatusEmoji + " " + (driverName || "司機") + "</b>\n"
          + "今日合計 " + tgStats.total + " 筆　已送達 " + tgStats.delivered + " 筆";
        pushTelegramDeliveryPhoto_V11(tgBlob, tgCaption, tgBranch);
      } catch (tgErr) {
        console.error("TG 推送錯誤: " + tgErr.message);
      }
    }

    // V38.x: 高雅瓷配送完成 → LINE 個別通知負責業務
    try {
      var lineBranch = String(report.branch || "").trim();
      if (lineBranch === "高雅瓷" && finalStatus === "已完成") {
        notifySalesForDelivery_V11(report, driverName, timeStr, photoId);
      }
    } catch (salesErr) {
      console.error("LINE 業務通知錯誤: " + salesErr.message);
    }

    // V6.6.5: 結案時清除導航目標 → 由下方 logDeparture_V24(report.car, "") 處理 (舊版呼叫的 updateVehicleNavigation_V24 從未存在)

    // V5.2.2: 結案後自動更新下一站，供戰情室計算 ETA

    // V5.2.2: 結案後自動更新下一站，供戰情室計算 ETA
    if (report.nextDest && report.nextDest !== '本日行程已結束') {
      try { logDeparture_V24(report.car, report.nextDest); } catch (e) { }
    } else {
      // 若行程結束，清除該車的「目前導航目標」
      try { logDeparture_V24(report.car, ""); } catch (e) { }
    }

    // V6.2: 不論有無下一站，只要結案就強制清除當前目標並重新整理快取
    // (確保上一動的 targetAddr 不會殘留在 SHEET_STATUS)
    _clearWarRoomCache_();

    // V6.6: 取得該車牌剩餘的所有任務 (用於前端判斷同地址與下一站選擇)
    var remainingTasks = [];
    var colAddr = findHIdx_Core(h, "ADDRESS");
    var colStatus = findHIdx_Core(h, "STATUS");
    var colV = findHIdx_Core(h, "VEHICLE");
    var colSeq = findHIdx_Core(h, "SEQ");
    var colCustR = findHIdx_Core(h, "CUSTOMER");
    
    for (var k = 1; k < tData.length; k++) {
      var kId = String(tData[k][idxId] || "").trim();
      // V6.6.6: 排除目前正在處理的這一筆 ID，避免同地址判斷錯誤
      if (report.orderId && kId === String(report.orderId).trim()) continue;
      
      if (cleanPlate_Core(tData[k][colV]) === cleanPlate_Core(report.car)) {
        var stat = String(tData[k][colStatus] || "");
        if (!['已完成', '結案', '退貨完成', '沒有送達'].includes(stat)) {
          remainingTasks.push({
            id: kId,
            customer: String(tData[k][colCustR] || ""),
            address: String(tData[k][colAddr] || ""),
            seq: parseInt(tData[k][colSeq]) || 99
          });
        }
      }
    }

    // 判斷同地址是否還有單
    var currentAddr = String(report.address || "").trim();
    var sameAddrRemaining = remainingTasks.filter(function(t) {
      return String(t.address).trim() === currentAddr;
    });

    // V37.16: 從匹配到的資料列提取正確元數據
    var finalBranch = "", finalWeight = "0", finalArrival = "--";
    if (foundRow !== -1) {
      var row = tData[foundRow - 1];
      finalBranch = String(row[idxBranch] || "").trim();
      // 根據截圖索引：重量在 F (5), 到貨時間在 J (9)
      finalWeight = String(row[findHIdx_Core(h, "重量(kg)")] || row[5] || "0").trim();
      finalArrival = String(row[findHIdx_Core(h, "到貨時間")] || row[9] || "--").trim();
    }

    var __finalResult = { 
      success: true, 
      status: finalStatus,
      signTypeDesc: finalSignTypeDesc,
      customer: report.customer, 
      address: report.address, 
      time: timeStr.split(' ')[1], 
      car: report.car, 
      contact: report.contact, 
      phone: report.phone,
      branch: finalBranch,   // 關鍵顏色資訊回傳
      weight: finalWeight,   // 重量回傳
      arrivalTime: finalArrival, // 到貨時間回傳
      signPhotoUrl: photoUrl,
      damagePhotoUrl: dmgUrl,
      sameAddrCount: sameAddrRemaining.length,
      remainingCount: remainingTasks.length,
      remainingTasks: remainingTasks,
      batchTasks: (report.batchTasks && Array.isArray(report.batchTasks)) ? report.batchTasks : []
    };
    _markUUIDDone_(report.clientUUID);
    return __finalResult;
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * V6.6: 計算司機目前位置到目標站點的 ETA 並記入戰情室狀態
 */
function calculateAndLogETA_V6(car, taskId, fromLat, fromLng, toLat, toLng, token) {
  try {
    _requireDriver_(token);
    // 1. 直線距離計算 (Haversine)
    function deg2rad(deg) { return deg * (Math.PI/180); }
    var R = 6371; // Earth radius in km
    var dLat = deg2rad(toLat - fromLat);
    var dLon = deg2rad(toLng - fromLng);
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(deg2rad(fromLat)) * Math.cos(deg2rad(toLat)) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    var dist = R * c; // Distance in km
    
    // 2. 估算時間: 市區速度約 15km/h (較符合物流現場頻繁停靠現況)
    var speed = 15; // km/h
    var hours = dist / speed;
    var mins = Math.ceil(hours * 60 + 3); // 加 3 分鐘固定緩衝 (含紅綠燈與找車位)
    
    // 3. 寫入 SHEET_STATUS (戰情室即時狀態)
    var ss = getSS_V11();
    var sSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_STATUS);
    var sData = sSheet.getDataRange().getValues();
    var h = sData[0].map(v => String(v).trim());
    var colCar = 0; // 車牌在第 1 欄
    var colEta = 7; // 預算抵達時間 (第 8 欄為預留)
    
    var carClean = cleanPlate_Core(car);
    for (var i = 1; i < sData.length; i++) {
      if (cleanPlate_Core(sData[i][colCar]) === carClean) {
        sSheet.getRange(i + 1, colEta + 1).setValue("約 " + mins + " 分鐘 (" + dist.toFixed(1) + " km)");
        break;
      }
    }
    
    _clearWarRoomCache_();
    return { success: true, mins: mins, km: dist.toFixed(1) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * V6.6: 動態調整任務順序
 * 司機選定下一站後，該站與同地址站點設為 SEQ=1，其餘往後排
 */
function adjustTaskSequence_V6(carPlate, selectedTaskId, token) {
  try {
    var ctx = _requireDriver_(token); if (!_driverMayUseCar_(ctx, carPlate)) throw new Error('🔒 AUTH_FORBIDDEN：無權操作車輛 ' + carPlate);
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
    var data = sheet.getDataRange().getValues();
    var h = data[0].map(v => String(v).trim());
    
    var idxId = findHIdx_Core(h, "ID");
    var idxAddr = findHIdx_Core(h, "ADDRESS");
    var idxV = findHIdx_Core(h, "VEHICLE");
    var idxStatus = findHIdx_Core(h, "STATUS");
    var idxSeq = findHIdx_Core(h, "SEQ");
    
    var carClean = cleanPlate_Core(carPlate);
    var targetAddr = "";
    
    // 1. 找到目標地址
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idxId]) === String(selectedTaskId)) {
        targetAddr = String(data[i][idxAddr] || "").trim();
        break;
      }
    }
    if (!targetAddr) return { error: "找不到目標任務" };
    
    // 2. 獲取該車所有未完成任務
    var myTasks = [];
    for (var i = 1; i < data.length; i++) {
      if (cleanPlate_Core(data[i][idxV]) === carClean) {
        var stat = String(data[i][idxStatus] || "");
        if (!['已完成', '結案', '退貨完成', '沒有送達'].includes(stat)) {
          myTasks.push({
            row: i + 1,
            id: String(data[i][idxId]),
            addr: String(data[i][idxAddr] || "").trim(),
            oldSeq: parseInt(data[i][idxSeq]) || 99
          });
        }
      }
    }
    
    // 3. 排序與重新賦值
    // 優先度：目標地址 -> 原本順序
    myTasks.sort(function(a, b) {
      var aMatch = (a.addr === targetAddr);
      var bMatch = (b.addr === targetAddr);
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return a.oldSeq - b.oldSeq;
    });
    
    // 4. 批次寫回順序 (V41: 修改記憶體中的欄位後一次 setValues，不再逐格寫)
    var currentSeq = 1;
    var lastAddr = "";
    var seqColVals = data.slice(1).map(function (r) { return [r[idxSeq]]; });
    for (var j = 0; j < myTasks.length; j++) {
      if (j > 0 && myTasks[j].addr !== lastAddr) {
        currentSeq++;
      }
      seqColVals[myTasks[j].row - 2][0] = currentSeq;
      lastAddr = myTasks[j].addr;
    }
    if (seqColVals.length) sheet.getRange(2, idxSeq + 1, seqColVals.length, 1).setValues(seqColVals);
    
    // V6.6.8 同步邏輯：不只是改順序，也要「靜默告訴」戰情室目前新的目標
    // 這樣司機手機就不會亂跳 Google Maps，但戰情室會立即有預估時間
    if (targetAddr) {
      try { logDeparture_V24(carPlate, targetAddr); } catch(e) {}
    }
    
    _clearWarRoomCache_();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * V37.22: 將 Drive 上的簽收照片轉成 base64 回傳，供 Dashboard Canvas 繪製美化框
 * (繞過瀏覽器 CORS 限制，讓 drawImage 可以讀取 lh3 圖片)
 */
function getSignPhotoBase64(fileId, token) {
  try {
    _requireAdmin_(token);
    if (!fileId) return { success: false, error: "缺少 fileId" };
    var file = DriveApp.getFileById(fileId);
    var blob = file.getBlob();
    var base64 = Utilities.base64Encode(blob.getBytes());
    return { success: true, data: 'data:' + blob.getContentType() + ';base64,' + base64 };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

/**
 * V37.20: 將前端產生的美化簽收單圖片上傳至 Drive，並更新送貨日誌的「簽收單照片」欄位
 * 前端在 showSuccess() canvas 生成完畢後呼叫此函式
 */
function updateBeautifiedSignPhoto(orderId, branch, photoDataUrl, token) {
  try {
    _requireDriver_(token);
    if (!orderId || !photoDataUrl) return { success: false, error: "缺少必要參數" };

    // 解析 base64
    var base64Data = photoDataUrl.indexOf(',') !== -1 ? photoDataUrl.split(',')[1] : photoDataUrl;
    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), 'image/jpeg', 'BEAUTIFUL_SIGN_' + orderId + '_' + Date.now() + '.jpg');
    var folder = getSafeFolder_V11();
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var newUrl = "https://lh3.googleusercontent.com/d/" + file.getId();

    // 找到送貨日誌中對應的列，更新「簽收單照片」
    var ss = getSS_V11();
    var logSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_LOG);
    if (!logSheet) return { success: false, error: "找不到送貨日誌" };

    var logData = logSheet.getDataRange().getValues();
    var logH = logData[0].map(function(v) { return String(v).trim(); });
    var colOrderId = logH.indexOf("單號");
    var colSignPhoto = logH.indexOf("簽收單照片");
    if (colOrderId === -1 || colSignPhoto === -1) return { success: false, error: "找不到欄位" };

    var normTarget = String(orderId).trim().toUpperCase().replace(/-[安高漢喜]$/, '').replace(/-[0-9]+$/, '');
    for (var r = logData.length - 1; r >= 1; r--) {
      var rowId = String(logData[r][colOrderId]).trim().toUpperCase().replace(/-[安高漢喜]$/, '').replace(/-[0-9]+$/, '');
      if (rowId === normTarget) {
        logSheet.getRange(r + 1, colSignPhoto + 1).setValue(newUrl);
        // 清除 War Room 快取，確保前台立即看到新圖
        _clearWarRoomCache_();
        return { success: true, url: newUrl };
      }
    }
    return { success: false, error: "找不到對應日誌列: " + orderId };
  } catch(e) {
    console.error("updateBeautifiedSignPhoto Error:", e.message);
    return { success: false, error: e.message };
  }
}

/**
 * V37.21: 打包下載 - 以資料夾複製取代 zip，避免大量照片時記憶體溢出
 * 在主資料夾下建立「簽收單_YYMMDD」子資料夾，複製所有今日簽收照片進去後回傳資料夾連結
 * 檔名格式：客戶名_地址_日期
 */
function createTodaySignPhotoZip(dateStr, branchFilter, token) {
  try {
    _requireAdmin_(token);
    var ss = getSS_V11();
    var logSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_LOG);
    if (!logSheet) return { success: false, error: "找不到送貨日誌" };

    var targetDate = dateStr || Utilities.formatDate(new Date(), "GMT+8", "yyyy/MM/dd");
    var logData = logSheet.getDataRange().getValues();
    var logH = logData[0].map(function(v) { return String(v).trim(); });

    var colTime    = logH.indexOf("配送完成時間");
    var colCust    = logH.indexOf("客戶名稱");
    var colAddr    = logH.indexOf("送貨地址");
    var colPhoto   = logH.indexOf("簽收單照片");
    var colOrderId = logH.indexOf("單號");
    if (colPhoto === -1) return { success: false, error: "找不到簽收單照片欄位" };

    // 分公司後綴對照（單號尾碼）
    var branchSuffixMap = { '安帝嘉': '-安', '高雅瓷': '-高', '漢樺': '-漢', '喜悅納': '-喜' };
    var filterSuffix = (branchFilter && branchFilter !== '全部') ? (branchSuffixMap[branchFilter] || '') : '';

    var dateShort  = targetDate.replace(/\//g, '').substring(2); // e.g. 260526
    var branchTag  = (branchFilter && branchFilter !== '全部') ? ('_' + branchFilter) : '';
    var folderName = '簽收單_' + targetDate.replace(/\//g, '-') + branchTag;

    // 建立共用資料夾（makeCopy 不需讀取檔案內容，速度快且不佔記憶體）
    var rootFolder = getSafeFolder_V11();
    var dlFolder = rootFolder.createFolder(folderName);
    dlFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    var count = 0;
    for (var r = 1; r < logData.length; r++) {
      var photoUrl = String(logData[r][colPhoto] || "").trim();
      if (!photoUrl) continue;

      // 日期比對（兼容 Date 物件與字串格式）
      if (colTime !== -1) {
        var timeVal = logData[r][colTime];
        var rowDate;
        if (timeVal instanceof Date) {
          rowDate = Utilities.formatDate(timeVal, "GMT+8", "yyyy/MM/dd");
        } else {
          var ts = String(timeVal || "").trim();
          rowDate = ts.substring(0, 10).replace(/-/g, '/');
        }
        if (rowDate !== targetDate) continue;
      }

      // 分公司過濾（依單號尾碼）
      if (filterSuffix && colOrderId !== -1) {
        var orderId = String(logData[r][colOrderId] || "").trim();
        if (orderId.indexOf(filterSuffix) === -1) continue;
      }

      var cust = String(logData[r][colCust] || "客戶").replace(/[\\/:*?"<>|]/g, '').trim().substring(0, 10);
      var addr = String(logData[r][colAddr] || "地址").replace(/[\\/:*?"<>|]/g, '').trim().substring(0, 20);
      var fileName = (count + 1) + '_' + cust + '_' + addr + '_' + dateShort + '.jpg';

      try {
        var fileId = null;
        var lh3Match = photoUrl.match(/lh3\.googleusercontent\.com\/d\/([^?&/\s]+)/);
        var ucMatch  = photoUrl.match(/[?&]id=([^&\s]+)/);
        if (lh3Match) fileId = lh3Match[1];
        else if (ucMatch) fileId = ucMatch[1];

        if (fileId) {
          DriveApp.getFileById(fileId).makeCopy(fileName, dlFolder);
          count++;
        }
      } catch(e2) {
        console.warn("跳過無法複製的照片:", photoUrl, e2.message);
      }
    }

    if (count === 0) {
      try { dlFolder.setTrashed(true); } catch(ex) {}
      return { success: false, error: "今日尚無簽收單照片（確認司機已拍照結案）" };
    }

    return {
      success: true,
      count: count,
      folderUrl: 'https://drive.google.com/drive/folders/' + dlFolder.getId() + '?usp=sharing',
      folderName: folderName
    };
  } catch(e) {
    console.error("createTodaySignPhotoZip Error:", e.message);
    return { success: false, error: e.message };
  }
}

function uploadFile(f, name, token) {
  _requireDriver_(token);
  if (!f || !f.contents) return "";
  try {
    var base64Data = f.contents;
    // V36.7: 增加相容性，判斷是否含有 data:image/...;base64, 前綴
    if (base64Data.indexOf(',') !== -1) {
      base64Data = base64Data.split(',')[1];
    }
    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), f.mimeType, (name || "upload") + "_" + Date.now());
    var folder = getSafeFolder_V11();

    // V36.7: 支援動態子資料夾
    if (f.folderName) {
      var subFolders = folder.getFoldersByName(f.folderName);
      if (subFolders.hasNext()) {
        folder = subFolders.next();
      } else {
        folder = folder.createFolder(f.folderName);
      }
    }

    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // V36.8: 改用更穩定的 lh3 格式以利 <img> 標籤載入
    return "https://lh3.googleusercontent.com/d/" + file.getId();
  } catch (e) {
    console.error("uploadFile Error: " + e.message);
    return "Error: " + e.message;
  }
}

/** 輔助：安全取得資料夾 (防止 ID 找不到噴錯) */
function getSafeFolder_V11() {
  try {
    return DriveApp.getFolderById(FOLDER_ID);
  } catch (e) {
    var backupName = "物流單據備用_" + (new Date().getYear() + 1900);
    var it = DriveApp.getFoldersByName(backupName);
    if (it.hasNext()) return it.next();
    return DriveApp.createFolder(backupName);
  }
}

function updateVehicleLocation(v, lat, lng, token) {
  var ctx = _requireDriver_(token); if (!_driverMayUseCar_(ctx, v)) throw new Error('🔒 AUTH_FORBIDDEN：無權操作車輛 ' + v);
  var ss = getSS_V11();
  var now = new Date();
  var timeStr = Utilities.formatDate(now, "GMT+8", "HH:mm:ss");
  var fullTimeStr = Utilities.formatDate(now, "GMT+8", "yyyy/MM/dd HH:mm:ss");
  var sSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_STATUS);
  var data = sSheet.getDataRange().getValues(), found = false;
  for (var i = 1; i < data.length; i++) if (String(data[i][0]) === String(v)) { sSheet.getRange(i + 1, 2, 1, 3).setValues([[lat, lng, fullTimeStr]]); found = true; break; }
  if (!found) sSheet.appendRow([v, lat, lng, fullTimeStr]);

  // V2632.10: 5分鐘節流錄入 (防止軌跡表過於肥大)
  var rSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_ROUTE);
  if (!rSheet) {
    ss.insertSheet(V11_PROD_CONFIG.SHEET_ROUTE);
    rSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_ROUTE);
    rSheet.appendRow(["車牌", "緯度", "經度", "時間戳記"]);
  } else {
    var lastRow = rSheet.getLastRow();
    if (lastRow > 1) {
      var lastData = rSheet.getRange(lastRow, 1, 1, 4).getValues()[0];
      if (String(lastData[0]) === String(v)) {
        var lastTs = new Date(lastData[3]).getTime();
        if (now.getTime() - lastTs < 300000) return; // 未滿 5 分鐘則不紀錄歷史點位
      }
    }
  }
  rSheet.appendRow([v, lat, lng, fullTimeStr]);
}

/** V6.0 A 等級：記錄司機出發意圖 (支援動態標題與車牌模糊比對) */
function logDeparture_V24(car, targetAddr, token) {
  try {
    var ctx = _requireDriver_(token); if (!_driverMayUseCar_(ctx, car)) throw new Error('🔒 AUTH_FORBIDDEN：無權操作車輛 ' + car);
    var ss = getSS_V11();
    var sSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_STATUS);
    var data = sSheet.getDataRange().getValues();
    if (data.length === 0) return false;
    
    var h = data[0].map(function(v) { return String(v).trim(); });
    // 動態尋找欄位 (目的地/正前往, 出發時間)
    var colDest = findHIdx_Core(h, ["正前往", "目的地", "目前目標"]);
    var colTime = findHIdx_Core(h, ["出發時間", "開始時間"]);
    
    // 如果找不到標題，回退到預設的索引 5, 6 (F, G 欄)
    if (colDest === -1) colDest = 5;
    if (colTime === -1) colTime = 6;

    var carClean = String(car).split('(')[0].trim().toUpperCase();
    var now = Utilities.formatDate(new Date(), "GMT+8", "HH:mm:ss");
    var found = false;

    // 尋找該車輛並更新其「正前往」地址與出發時間
    for (var i = 1; i < data.length; i++) {
        var rowCar = String(data[i][0]).split('(')[0].trim().toUpperCase();
        if (rowCar === carClean) {
            sSheet.getRange(i + 1, colDest + 1).setValue(targetAddr);
            sSheet.getRange(i + 1, colTime + 1).setValue(now);
            found = true;
            break;
        }
    }
    
    if (!found) {
      // 若找不到車輛，則新增一列 (並保留結構：車牌, 緯度, 經度, 最後更新, 目前進度, 正前往, 出發時間)
      var newRow = new Array(h.length).fill("");
      newRow[0] = car; // 保留原始格式存入第一欄
      newRow[3] = now;
      newRow[4] = "出發中";
      newRow[colDest] = targetAddr;
      newRow[colTime] = now;
      sSheet.appendRow(newRow);
    }
    return true;
  } catch (e) { 
    console.error("logDeparture_V24 Error: " + e.message);
    return false; 
  }
}

/**
 * V2633.2: 設定每日定時執行美化樣式的觸發器
 * 建議在凌晨 3:00 執行，避免干擾白天作業
 */
function setupDailyStyleTrigger(e) {
  _requireSystemContext_(e);
  const funcName = 'applyProfessionalStyles_V11';
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => { if (t.getHandlerFunction() === funcName) ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger(funcName)
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();

  return "✅ 已設定每日凌晨 03:00 自動執行樣式優化排程";
}


// ==========================================
// 安全性模組已移至 Auth.js
// (sysVerifyPwd / setAdminPassword / checkAdminSession / verifyNameAndIssueToken /
//  generateParamUrlForDriver / _requireAdmin_ / _requireDriver_ / _requireSystemContext_)
// ==========================================


/** V34.13: 更新行程足跡路名 (富文本支援)
 * 將已完成的任務標註刪除線，並與戰情室面板視覺同步
 */
function updateScheduleTrace_V12(car, lat, lng, eventName, taskAddr) {
  try {
    var ss = getSS_V11();
    var now = new Date();
    var todayStr = Utilities.formatDate(now, "GMT+8", "yyyy/MM/dd");

    // 1. 找到今日行程表對應列
    var schSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_SCHEDULE);
    var schData = schSheet.getDataRange().getValues();
    var schH = schData[0].map(v => String(v).trim());
    var colTrace = findHIdx_Core(schH, ["當日行程足跡", "行程足跡", "足跡"]);
    var colDate = findHIdx_Core(schH, ["日期"]);
    var colCar = findHIdx_Core(schH, ["車牌號碼", "車牌", "車號", "車輛", "車號碼"]);
    var colTimeIn = findHIdx_Core(schH, ["上班時間"]);
    var colTimeOut = findHIdx_Core(schH, ["下班時間"]);

    if (colTrace === -1 || colCar === -1) return;

    var carTarget = cleanPlate_Core(car);
    var targetRow = -1;
    for (var i = 1; i < schData.length; i++) {
      var d = normalizeDate_Core(schData[i][colDate]);
      if (d === todayStr && cleanPlate_Core(schData[i][colCar]) === carTarget) { targetRow = i + 1; break; }
    }
    if (targetRow === -1) {
      Logger.log("找不到車牌 " + carTarget + " 今日 (" + todayStr + ") 的行程列");
      return;
    }

    // 偵錯輔助：顯示索引資訊
    if (eventName === 'FORCE_SYNC') {
      try { SpreadsheetApp.getActive().toast("正在處理 " + car + " (列:" + targetRow + ", 欄:" + (colTrace + 1) + ")", "資料比對中", 1); } catch (e2) { }
    }

    // 2. 獲取上班/下班時間 (對應戰情室的起點與終點)
    var startTime = colTimeIn >= 0 ? schData[targetRow - 1][colTimeIn] : "";
    var endTime = colTimeOut >= 0 ? schData[targetRow - 1][colTimeOut] : "";
    var fmtT = function (v) {
      if (!v) return "";
      if (v instanceof Date) return Utilities.formatDate(v, "GMT+8", "HH:mm");
      var s = String(v).trim();
      return (s.length >= 5 && s.indexOf(':') !== -1) ? s.substring(0, 5) : s;
    };

    // 🎯 地址簡碼轉換邏輯 (同步 Settings.js 的 _extractRoad 邏輯)
    var formatRoad_Core = function (addr) {
      if (!addr) return '';
      var s = String(addr)
        .replace(/(台灣|臺灣)/, '')
        .replace(/(台北市|新北市|桃園市|台中市|臺中市|高雄市|台南市|基隆市|新竹市|嘉義市|新竹縣|苗栗縣|彰化縣|南投縣|雲林縣|嘉義縣|屏東縣|宜蘭縣|花蓮縣|台東縣|澎湖縣|金門縣|連江縣)/, '')
        .replace(/[\u4e00-\u9fff]+(市|縣)/, '')
        .replace(/[\u4e00-\u9fff]+區/, '');
      // 抓「X路/X街/X大道」＋ 可能的「N段」
      var match = s.match(/([\u4e00-\u9fff]+(路|街|大道)([\u4e00-\u9fff]{0,3}段)?)/);
      if (match) return match[1];
      // fallback: 取前 6 個中文字
      var cjk = s.match(/[\u4e00-\u9fff]{2,6}/);
      return cjk ? cjk[0] : '';
    };

    // 3. 獲取該車今日與明日任務，依照順序排列
    var taskSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
    var tData = taskSheet.getDataRange().getValues();
    var tH = tData[0].map(v => String(v).trim());
    var idxV = findHIdx_Core(tH, ["車牌號碼", "車牌", "車號", "車輛"]),
      idxA = findHIdx_Core(tH, "ADDRESS"),
      idxS = findHIdx_Core(tH, "STATUS"),
      idxD = findHIdx_Core(tH, "DATE"),
      idxFT = findHIdx_Core(tH, "FINISH_TIME"),
      idxSeq = findHIdx_Core(tH, "SEQ");

    var dTomorrow = normalizeDate_Core(new Date(now.getTime() + 86400000));

    var curCarTasks = [];
    for (var j = 1; j < tData.length; j++) {
      var rDate = normalizeDate_Core(tData[j][idxD]);
      // V36.4: 只抓今天的任務，移除明日預告
      if (rDate === todayStr && cleanPlate_Core(tData[j][idxV]) === carTarget) {
        var addrRaw = String(tData[j][idxA]);
        var addrShort = formatRoad_Core(addrRaw);
        var time = "";
        if (idxFT >= 0 && tData[j][idxFT]) {
          var ft = tData[j][idxFT];
          time = (ft instanceof Date) ? Utilities.formatDate(ft, "GMT+8", "HH:mm") : String(ft).toString().substring(0, 5);
        }
        curCarTasks.push({
          road: addrShort,
          done: false, // V36.4: 一律不顯示刪除線
          time: time,
          seq: parseInt(tData[j][idxSeq]) || 99,
          date: rDate
        });
      }
    }
    curCarTasks.sort((a, b) => {
      if (a.date !== b.date) return a.date > b.date ? 1 : -1;
      return a.seq - b.seq;
    });

    // 4. 合併足跡：[上班] → [今日行程] → [下班]
    var allPoints = [];
    if (startTime) allPoints.push({ label: fmtT(startTime) + " 公司出發", done: false, isTag: false, road: "START" });

    var lastD = todayStr;
    curCarTasks.forEach(t => {
      if (t.date !== lastD) {
        allPoints.push({ label: "📅 " + (t.date === dTomorrow ? "明天" : t.date.substring(5)), done: false, isTag: true, road: "DATE_TAG" });
        lastD = t.date;
      }

      // V36.2: 去重邏輯 - 如果與上一個點的路名相同，且不是標籤，則跳過
      var lastPoint = allPoints.length > 0 ? allPoints[allPoints.length - 1] : null;
      if (lastPoint && lastPoint.road === t.road && !lastPoint.isTag) {
        // 若重複，但當前是「已完成」，則更新上一個點的狀態 (確保刪除線正確)
        if (t.done) lastPoint.done = true;
        return;
      }

      allPoints.push({ label: (t.time ? t.time + " " : "") + t.road, done: t.done, isTag: false, road: t.road });
    });

    if (endTime) {
      // 下班點去重 (防止最後一個點就是公司)
      var lastP = allPoints[allPoints.length - 1];
      if (!(lastP && lastP.road === "START")) {
        allPoints.push({ label: fmtT(endTime) + " 返抵公司", done: false, isTag: false, road: "END" });
      }
    }

    // 5. 建立 RichTextValue (時間:黑色, 路名:紅色+加粗)
    var fullText = "";
    var segments = [];
    allPoints.forEach((p, idx) => {
      // 處理每個點的細部區段：[時間] [空格] [路名]
      var parts = p.label.split(" ");
      var timeText = "";
      var roadText = "";

      if (parts.length >= 2 && /^\d{2}:\d{2}$/.test(parts[0])) {
        timeText = parts[0];
        roadText = parts.slice(1).join(" ");
      } else {
        roadText = p.label;
      }

      var pointStart = fullText.length;

      if (timeText) {
        var tStart = fullText.length;
        fullText += timeText + " ";
        segments.push({ start: tStart, end: tStart + timeText.length, style: "TIME" });
      }

      if (roadText) {
        var rStart = fullText.length;
        fullText += roadText;
        segments.push({ start: rStart, end: rStart + roadText.length, style: "ROAD" });
      }

      if (idx < allPoints.length - 1) fullText += " → ";
    });

    if (!fullText) return;
    var richValue = SpreadsheetApp.newRichTextValue().setText(fullText);
    var timeStyle = SpreadsheetApp.newTextStyle().setForegroundColor("#000000").setBold(false).build();
    var roadStyle = SpreadsheetApp.newTextStyle().setForegroundColor("#ef4444").setBold(true).build();

    segments.forEach(seg => {
      if (seg.style === "TIME") richValue = richValue.setTextStyle(seg.start, seg.end, timeStyle);
      else if (seg.style === "ROAD") richValue = richValue.setTextStyle(seg.start, seg.end, roadStyle);
    });

    // 寫回試算表並設定靠左對齊
    var range = schSheet.getRange(targetRow, colTrace + 1);
    range.setRichTextValue(richValue.build()).setHorizontalAlignment("left").setVerticalAlignment("middle");

    if (eventName === 'FORCE_SYNC') {
      try { SpreadsheetApp.getActive().toast("✅ " + car + " 足跡更新成功", "進度", 1); } catch (e2) { }
    }
  } catch (err) {
    Logger.log("updateScheduleTrace_V12 Error: " + err.message);
    // V41: toast 在 Web App 情境會再拋錯並蓋掉原本的錯誤，只在 FORCE_SYNC (Sheets 選單) 時顯示
    if (eventName === 'FORCE_SYNC') { try { SpreadsheetApp.getActive().toast("❌ " + car + " 發生錯誤: " + err.message, "錯誤", 5); } catch (e2) { } }
  }
}

function getRouteHistory_V11p9(carName, token) {
  try {
    _requireAdmin_(token);
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_ROUTE);
    if (!sheet) return [];
    var data = sheet.getDataRange().getValues();
    var todayStr = Utilities.formatDate(new Date(), "GMT+8", "yyyy/MM/dd");
    var historyAll = [];
    for (var i = data.length - 1; i > 0; i--) {
      var dStr = (data[i][3] instanceof Date) ? Utilities.formatDate(data[i][3], "GMT+8", "yyyy/MM/dd") : String(data[i][3]);
      if (dStr === todayStr && String(data[i][0]) === String(carName)) {
        historyAll.push({
          lat: parseFloat(data[i][1]),
          lng: parseFloat(data[i][2]),
          time: (data[i][3] instanceof Date) ? Utilities.formatDate(data[i][3], "GMT+8", "HH:mm:ss") : String(data[i][3])
        });
      }
    }

    // V11.17 抽樣優化：計算對應間隔並均勻抽樣，避免分佈不均
    var history = [];
    var maxPoints = 100;
    if (historyAll.length > maxPoints) {
      var step = historyAll.length / maxPoints;
      for (var k = 0; k < maxPoints; k++) {
        history.push(historyAll[Math.floor(k * step)]);
      }
    } else {
      history = historyAll;
    }
    return history.reverse();
  } catch (e) { return []; }
}

/** V11.11 使用 Google Maps Distance Matrix 計算真實路網時間 */
function calculatePreciseMinutes_V11(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return null;
  // V41.13: 車輛位置與目標都沒變 (取到小數 3 位 ≈ 100 公尺) 就沿用上次結果，省下約 80% 的 Distance Matrix 額度
  var r3 = function (v) { return (Math.round(parseFloat(v) * 1000) / 1000).toFixed(3); };
  var etaKey = 'eta_' + r3(lat1) + '_' + r3(lon1) + '_' + r3(lat2) + '_' + r3(lon2);
  var etaCache = CacheService.getScriptCache();
  try {
    var hit = etaCache.get(etaKey);
    if (hit !== null && hit !== undefined) return hit === 'null' ? null : parseInt(hit, 10);
  } catch (ce) { }
  var val = _calculatePreciseMinutesLive_(lat1, lon1, lat2, lon2);
  try { etaCache.put(etaKey, val === null ? 'null' : String(val), 900); } catch (ce2) { }
  return val;
}

function _calculatePreciseMinutesLive_(lat1, lon1, lat2, lon2) {
  try {
    var matrix = Maps.newDistanceMatrix()
      .addOrigin(lat1, lon1)
      .addDestination(lat2, lon2)
      .setMode(Maps.DistanceMatrixEnums.Mode.DRIVING)
      .getDistanceMatrix();

    if (matrix.rows[0].elements[0].status === "OK") {
      var duration = matrix.rows[0].elements[0].duration.value; // 秒
      return Math.round(duration / 60);
    }
    return null;
  } catch (e) { return null; }
}

function calculateSimpleETA(lat1, lon1, lat2, lon2, token) {
  _requireAdmin_(token);
  if (!lat1 || !lon1 || !lat2 || !lon2) return "N/A";
  try {
    var matrix = Maps.newDistanceMatrix()
      .addOrigin(lat1, lon1)
      .addDestination(lat2, lon2)
      .setMode(Maps.DistanceMatrixEnums.Mode.DRIVING)
      .getDistanceMatrix();

    if (matrix.rows[0].elements[0].status === "OK") {
      var duration = matrix.rows[0].elements[0].duration.value; // 秒
      var minutes = Math.round(duration / 60);
      var distance = matrix.rows[0].elements[0].distance.text;
      if (minutes < 1) return "即將抵達 (" + distance + ")";
      return minutes + " 分鐘 (" + distance + ")";
    }
  } catch (e) {
    // 備援方案：若 API 失敗則用直線距離
    var R = 6371;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round((R * c / 30) * 60) + " 分鐘 (預估)";
  }
  return "計算中";
}

/** V40: 把「指定到貨時間」正規化成純 HH:MM 或 HH:MM~HH:MM。
 *  試算表若把時間存成 Date（例如 1899-12-30 14:00:00 GMT+0800），直接取時分。
 *  已帶欄位名或純文字則原樣去除多餘空白。 */
function _fmtArriveTime_(v) {
  if (!v) return "";
  if (v instanceof Date) {
    var hh = ("0" + v.getHours()).slice(-2);
    var mm = ("0" + v.getMinutes()).slice(-2);
    return hh + ":" + mm;
  }
  var str = String(v).trim();
  if (!str) return "";
  // 可能是「1899-12-30 14:00:00」這種字串化日期
  var m = str.match(/(\d{1,2}):(\d{2})/);
  if (m) {
    // 只擷取第一個時間，若是時段「10:30~11:00」保留完整
    var range = str.match(/(\d{1,2}):(\d{2})\s*[~至\-到]\s*(\d{1,2}):(\d{2})/);
    if (range) {
      return ("0" + parseInt(range[1], 10) % 24).slice(-2) + ":" + range[2] + "~" + ("0" + parseInt(range[3], 10) % 24).slice(-2) + ":" + range[4];
    }
    return ("0" + parseInt(m[1], 10) % 24).slice(-2) + ":" + m[2];
  }
  return str;
}

function getTodayTasks(carPlate, queryDate, token) {
  _requireDriver_(token); // 放在 try 外：驗證失敗要讓前端 failureHandler 收到，而不是被 catch 吞成空陣列
  try {
    var ss = getSS_V11(), sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS), data = sheet.getDataRange().getValues();
    var h = data[0].map(function (v) { return String(v).trim(); });
    var findCol = function (names) { for (var n of names) { var p = h.indexOf(n); if (p !== -1) return p; } return -1; };
    var idx = {
      v: findHIdx_Core(h, "VEHICLE"),
      s: findHIdx_Core(h, "STATUS"),
      sq: findHIdx_Core(h, "SEQ"),
      c: findHIdx_Core(h, "CUSTOMER"),
      a: findHIdx_Core(h, "ADDRESS"),
      p: findHIdx_Core(h, "PHONE"),
      id: findHIdx_Core(h, "ID"),
      b: findHIdx_Core(h, "BRANCH"),
      w: findHIdx_Core(h, "WEIGHT"),
      n: findHIdx_Core(h, "NOTE"),
      contact: findHIdx_Core(h, "CONTACT"), // V36.2: 使用標準對照
      archived: findHIdx_Core(h, "ARCHIVE"),
      d: findHIdx_Core(h, "DATE"),
      location: findHIdx_Core(h, "LOCATION"), // V4.1
      thumbnail: findHIdx_Core(h, "THUMBNAIL") , // V36.6
      shippingType: findHIdx_Core(h, "SHIPPING_TYPE"),
      wrapSeal: findHIdx_Core(h, ["封膠膜", "膠膜", "封膜"]),
      size: findCol(['尺寸', '尺寸(cm)', '規格', '規格尺寸']),
      items: findCol(['ITEMS', '明細', '品項明細', '產品明細']),
      specifiedArrive: findCol(['指定到貨時間', '指定時間']) // V40: 強制指定到貨時間 (電梯管制)
    };

    // 伺服器端診斷日誌
    if (carPlate) Logger.log("getTodayTasks Diagnostic - Car: " + carPlate + ", Headers: " + h.length + ", Idx: " + JSON.stringify(idx));
    var dToday = new Date();
    var todayStr = Utilities.formatDate(dToday, "GMT+8", "yyyy/MM/dd");
    var tmrDate = new Date();
    tmrDate.setDate(tmrDate.getDate() + 1);
    var tmrStr = Utilities.formatDate(tmrDate, "GMT+8", "yyyy/MM/dd");
    var sevenDaysLater = new Date();
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
    var sevenDaysStr = Utilities.formatDate(sevenDaysLater, "GMT+8", "yyyy/MM/dd");

    var vInfo = getManagementData(), driverName = vInfo.vehicleMap[carPlate] || "", res = [];
    var target = String(carPlate || "").trim();
    // V41: 品項欄位索引只算一次 (舊版每列都重新掃 10 次表頭)
    var itemCols = [];
    for (var n0 = 1; n0 <= 5; n0++) {
      itemCols.push({ code: findCol(['品項' + n0 + '編號', 'ITEM' + n0, 'ITEM' + n0 + '_CODE']), qty: findCol(['品項' + n0 + '數量', 'ITEM' + n0 + '_QTY']) });
    }
    var noteColFallback = idx.n;
    if (noteColFallback === -1) {
      ['備註', '注意', '說明', '備注', '特殊需求', '說明事項'].forEach(function (nc) { if (noteColFallback === -1 && h.indexOf(nc) !== -1) noteColFallback = h.indexOf(nc); });
    }
    for (var i = 1; i < data.length; i++) {
      if (idx.archived !== -1 && ["是", "手動刪除"].indexOf(String(getSafeVal(data[i], idx.archived))) !== -1) continue;

      var rowDate = "";
      if (idx.d !== -1) {
        var dVal = getSafeVal(data[i], idx.d);
        if (dVal instanceof Date) {
          rowDate = Utilities.formatDate(dVal, "GMT+8", "yyyy/MM/dd");
        } else {
          // 強制正規化: 2026/3/3 -> 2026/03/03
          var parts = String(dVal).split(/[-/]/);
          if (parts.length >= 3) {
            var y = parts[0].length === 2 ? "20" + parts[0] : parts[0];
            var m = ("0" + parts[1].replace(/\D/g, "")).slice(-2);
            // d 只取前兩位數字，避免帶到時間（例如 "05 12:00" 的情況）
            var d = ("0" + parts[2].replace(/\D/g, "").substring(0, 2)).slice(-2);
            rowDate = y + "/" + m + "/" + d;
          } else {
            rowDate = String(dVal).substring(0, 10).replace(/-/g, '/');
          }
        }
      }
      var rowV = String(getSafeVal(data[i], idx.v)).trim(), rowS = String(getSafeVal(data[i], idx.s));

      if (queryDate === 'tmr') {
        if (rowDate <= todayStr || rowDate > sevenDaysStr) continue;
      } else {
        if (rowDate !== todayStr) continue;
      }

      if ((rowV === target || (driverName && rowV === driverName)) && rowS !== '結案') {
        var itemsArr = [];
        var rowSize = idx.size !== -1 ? String(getSafeVal(data[i], idx.size) || '').trim() : '';
        var sizeArr = rowSize ? rowSize.split(/[,，、；;\/]+/).map(function (s) { return String(s).trim(); }).filter(Boolean) : [];
        for (var n = 1; n <= 5; n++) {
          var codeIdx = itemCols[n - 1].code;
          var qtyIdx = itemCols[n - 1].qty;
          if (codeIdx !== -1 && qtyIdx !== -1) {
            var codeVal = String(getSafeVal(data[i], codeIdx) || '').trim();
            var qtyVal = String(getSafeVal(data[i], qtyIdx) || '').trim();
            if (codeVal && qtyVal) {
              var itemSize = sizeArr[n - 1] || sizeArr[0] || '';
              itemsArr.push({ code: codeVal, qty: qtyVal, size: itemSize, pcsPerBox: "", boxQty: "" });
            }
          }
        }
        if (!itemsArr.length && idx.items !== -1) {
          var rawItems = String(getSafeVal(data[i], idx.items) || '').trim();
          if (rawItems) {
            rawItems.split(/\n|、|，|,|；|;|\/+/).map(function (s) { return String(s).trim(); }).filter(Boolean).forEach(function (s) {
              itemsArr.push({ code: s, qty: '', size: sizeArr[itemsArr.length] || sizeArr[0] || '', pcsPerBox: "", boxQty: "" });
            });
          }
        }
        res.push({
          id: String(getSafeVal(data[i], idx.id)), branch: String(getSafeVal(data[i], idx.b)),
          status: rowS,
          customer: cleanCustName_V11(String(getSafeVal(data[i], idx.c))), address: String(getSafeVal(data[i], idx.a)),
          phone: String(getSafeVal(data[i], idx.p)), seq: Number(getSafeVal(data[i], idx.sq)) || 99,
          weight: Number(getSafeVal(data[i], idx.w)) || 0, rowIndex: i + 1,
          shippingType: idx.shippingType !== -1 ? String(getSafeVal(data[i], idx.shippingType)) : "送貨",
          note: noteColFallback !== -1 ? String(getSafeVal(data[i], noteColFallback)).trim() : '', // V35.7.1: 備註欄多重容錯 (V41: 索引提到迴圈外)
          contact: String(getSafeVal(data[i], idx.contact)), // V36.2
          date: rowDate, // V2632.16
          location: String(getSafeVal(data[i], idx.location) || ""),
          size: rowSize,
          thumbnail: String(getSafeVal(data[i], idx.thumbnail) || ""), // V36.6
          wrapSeal: idx.wrapSeal !== -1 ? String(getSafeVal(data[i], idx.wrapSeal) || "").trim() : "",
          specifiedArrive: idx.specifiedArrive !== -1 ? _fmtArriveTime_(getSafeVal(data[i], idx.specifiedArrive)) : "", // V40
          items: itemsArr
        });
      }
    }


    return res.sort(function (a, b) {
      if (a.status === '已完成' && b.status !== '已完成') return 1;
      if (a.status !== '已完成' && b.status === '已完成') return -1;
      return a.seq - b.seq;
    });
  } catch (e) { return []; }
}

function getDriverTaskItemDetails_V11(orderIds, token) {
  try {
    _requireDriver_(token);
    var ids = {};
    (orderIds || []).forEach(function (id) {
      var key = String(id || '').trim();
      if (key) ids[key] = true;
    });
    if (Object.keys(ids).length === 0) return {};

    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
    var data = sheet.getDataRange().getValues();
    var h = data[0].map(function (v) { return String(v).trim(); });
    var findCol = function (names) { for (var n = 0; n < names.length; n++) { var p = h.indexOf(names[n]); if (p !== -1) return p; } return -1; };
    var idxId = findHIdx_Core(h, "ID");
    var idxSize = findCol(['尺寸', '尺寸(cm)', '規格', '規格尺寸']);
    var productMap = lookupProductMasterData_V11();
    var result = {};
    var itemCols = [];
    for (var n0 = 1; n0 <= 5; n0++) {
      itemCols.push({ code: findCol(['品項' + n0 + '編號', 'ITEM' + n0, 'ITEM' + n0 + '_CODE']), qty: findCol(['品項' + n0 + '數量', 'ITEM' + n0 + '_QTY']) });
    }

    for (var i = 1; i < data.length; i++) {
      var orderId = String(getSafeVal(data[i], idxId) || '').trim();
      if (!ids[orderId]) continue;
      var rowSize = idxSize !== -1 ? String(getSafeVal(data[i], idxSize) || '').trim() : '';
      var sizeArr = rowSize ? rowSize.split(/[,，、；;\/]+/).map(function (s) { return String(s).trim(); }).filter(Boolean) : [];
      var itemsArr = [];

      for (var n = 1; n <= 5; n++) {
        var codeIdx = itemCols[n - 1].code;
        var qtyIdx = itemCols[n - 1].qty;
        if (codeIdx === -1 || qtyIdx === -1) continue;
        var codeVal = String(getSafeVal(data[i], codeIdx) || '').trim();
        var qtyVal = String(getSafeVal(data[i], qtyIdx) || '').trim();
        if (!codeVal || !qtyVal) continue;
        var pInfo = findProductInfo_V11(productMap, codeVal);
        var itemWeight = calcItemWeightKg_V11(qtyVal, pInfo.pcsPerBox, pInfo.kgPerBox);
        var itemSize = String(pInfo.size || '').trim() || sizeArr[n - 1] || sizeArr[0] || '';
        itemsArr.push({
          code: codeVal,
          qty: qtyVal,
          size: itemSize,
          pcsPerBox: pInfo.pcsPerBox || '',
          boxQty: calcBoxQtyFromPieces_V11(qtyVal, pInfo.pcsPerBox),
          kgPerBox: pInfo.kgPerBox || '',
          itemWeight: itemWeight,
          image: pInfo.img || '',
          series: pInfo.name || '',
          originalName: pInfo.originalName || ''
        });
      }

      result[orderId] = { items: itemsArr, size: rowSize };
    }
    return result;
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * V11.10: 派送清單 onEdit 觸發器 - 自動 Geocoding
 * 在 Google Sheet 的「觸發器」中設定為「onEdit」事件觸發此函式
 */
function onEdit_V11(e) {
  try {
    if (!e || !e.range) return;

    // V36.2: 優先執行足跡同步邏輯 (不論在哪個分頁)
    onEdit_V11_Sync_Core(e);

    var sheet = e.range.getSheet();
    if (sheet.getName() !== V11_PROD_CONFIG.SHEET_TASKS) return;
    var h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (v) { return String(v).trim(); });
    
    // 欄位索引識別
    var addrIdx = findHIdx_Core(h, "ADDRESS");
    var latIdx = findHIdx_Core(h, "LAT");
    var lngIdx = findHIdx_Core(h, "LNG");
    var vehicleIdx = findHIdx_Core(h, "VEHICLE");
    var driverIdx = findHIdx_Core(h, ["派遣司機", "司機"]);

    var col = e.range.getColumn();
    var row = e.range.getRow();
    var val = e.range.getValue();

    // 1. 自動帶出司機姓名 (V11.25)
    if (col === vehicleIdx + 1 && val) {
      var vInfo = getManagementData();
      var driverName = vInfo.vehicleMap[String(val).trim()];
      if (driverName && driverIdx !== -1) {
        sheet.getRange(row, driverIdx + 1).setValue(driverName);
      }
    }

    // 2. 自動 Geocoding (原本邏輯)
    if (col === addrIdx + 1 && val) {
      if (latIdx !== -1 && lngIdx !== -1) {
        var existing = sheet.getRange(row, latIdx + 1).getValue();
        if (!existing) {
          try {
            var res = Maps.newGeocoder().geocode(val).results[0];
            if (res) {
              sheet.getRange(row, latIdx + 1).setValue(res.geometry.location.lat);
              sheet.getRange(row, lngIdx + 1).setValue(res.geometry.location.lng);
            }
          } catch (err) { }
        }
      }
    }
  } catch (e) { }
}

/** V36.2: 強化級 onEdit 觸發器 - 同步更新行程足跡 */
function onEdit_V11_Sync_Core(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    var sheetName = sheet.getName();
    if (sheetName === "業務配送清單") {
      syncAllDriverValidationsByBranch();
      // 🤖 V13: 自動狀態流轉 - 當小姐選定派遣司機後，自動將狀態變為「配送中」
      var row = e.range.getRow();
      var col = e.range.getColumn();
      if (row > 1) {
        var h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(v){ return String(v).trim(); });
        var idxDriver = h.indexOf("派遣司機");
        var idxStatus = h.indexOf("狀態");
        if (idxDriver !== -1 && idxStatus !== -1 && col === (idxDriver + 1)) {
          var val = e.value;
          // 如果有填入值，就把狀態改成「配送中」
          if (val && String(val).trim().length > 0) {
            sheet.getRange(row, idxStatus + 1).setValue("配送中");
          }
        }
      }
    }
    var ss = e.source;
    var col = e.range.getColumn();
    var row = e.range.getRow();
    if (row < 2) return; // 忽略標頭

    if (sheetName === V11_PROD_CONFIG.SHEET_TASKS) {
      // 派送清單：當「車牌」、「狀態」、「順序」、「日期」變動時更新足跡
      var h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(v => String(v).trim());
      var syncCols = [
        findHIdx_Core(h, "VEHICLE") + 1,
        findHIdx_Core(h, "STATUS") + 1,
        findHIdx_Core(h, "SEQ") + 1,
        findHIdx_Core(h, "DATE") + 1
      ];
      if (syncCols.indexOf(col) !== -1) {
        var carIdx = findHIdx_Core(h, "VEHICLE");
        var car = String(sheet.getRange(row, carIdx + 1).getValue()).trim();
        if (car) updateScheduleTrace_V12(car);
        // 如果是改車牌，也要更新舊車牌的足跡
        if (e.oldValue && col === carIdx + 1) updateScheduleTrace_V12(String(e.oldValue).trim());
      }
    } else if (sheetName === V11_PROD_CONFIG.SHEET_SCHEDULE) {
      // 每日行程表：當「上班時間」、「下班時間」變動時更新足跡
      var schH = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(v => String(v).trim());
      var colIn = findHIdx_Core(schH, "上班時間") + 1;
      var colOut = findHIdx_Core(schH, "下班時間") + 1;
      if (col === colIn || col === colOut) {
        var colCar = findHIdx_Core(schH, "VEHICLE");
        var car = String(sheet.getRange(row, colCar + 1).getValue()).trim();
        if (car) updateScheduleTrace_V12(car);
      }
    }
  } catch (err) { }
}

/** V36.4: 手動強制同步所有司機的足跡樣式 (過去 5 天) */
function forceUpdateAllScheduleTraces(e) {
  try {
    _requireSystemContext_(e);
    var ss = getSS_V11();
    var schSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_SCHEDULE);
    var data = schSheet.getDataRange().getValues();
    var schH = data[0].map(v => String(v).trim());

    // 計算過去 5 天的日期清單
    var targetDates = [];
    var now = new Date();
    for (var i = 0; i < 5; i++) {
      var d = new Date(now.getTime() - i * 86400000);
      targetDates.push(normalizeDate_Core(d));
    }

    var colDate = findHIdx_Core(schH, "日期");
    var colCar = findHIdx_Core(schH, ["車牌號碼", "車牌", "車號", "車輛", "車號碼"]);
    var colTrace = findHIdx_Core(schH, ["當日行程足跡", "行程足跡", "足跡"]);

    if (colDate === -1 || colCar === -1) {
      SpreadsheetApp.getUi().alert("❌ 找不到行程表日期或車牌欄位");
      return;
    }

    // 1. 全域對齊調整 (除了足跡外全位置中)
    var fullRange = schSheet.getRange(2, 1, schSheet.getLastRow() - 1, schSheet.getLastColumn());
    fullRange.setHorizontalAlignment("center").setVerticalAlignment("middle");
    if (colTrace !== -1) {
      schSheet.getRange(2, colTrace + 1, schSheet.getLastRow() - 1, 1).setHorizontalAlignment("left");
    }

    // 2. 逐行同步足跡與優化照片網址
    var count = 0;
    var photoCols = [];
    schH.forEach((h, idx) => { if (h.indexOf("照片") !== -1) photoCols.push(idx); });

    for (var i = 1; i < data.length; i++) {
      var rowDate = normalizeDate_Core(data[i][colDate]);
      if (targetDates.indexOf(rowDate) !== -1) {
        // (A) 更新行程足跡
        var car = String(data[i][colCar]).trim();
        if (car) {
          updateScheduleTrace_V12(car, null, null, 'FORCE_SYNC');
          count++;
        }

        // (B) 優化照片網址 (轉為 📸 相片 連結)
        photoCols.forEach(pCol => {
          var cellVal = String(data[i][pCol]);
          if (cellVal.startsWith("http")) {
            var rt = SpreadsheetApp.newRichTextValue()
              .setText("📸 相片")
              .setLinkUrl(cellVal)
              .build();
            schSheet.getRange(i + 1, pCol + 1).setRichTextValue(rt).setHorizontalAlignment("center");
          }
        });
      }
    }
    SpreadsheetApp.getUi().alert("✅ 歷史同步完成！共更新 " + count + " 列行程足跡，並優化了相片顯示。");
  } catch (e) {
    SpreadsheetApp.getUi().alert("❌ 同步失敗：" + e.message);
  }
}

/**
 * V11.10: 批量補足經緯度 (可在工具選單手動執行)
 */
function batchGeocodeAllTasks(e) {
  _requireSystemContext_(e);
  var ss = getSS_V11();
  var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
  var data = sheet.getDataRange().getValues();
  var h = data[0].map(function (v) { return String(v).trim(); });
  var addrIdx = findHIdx_Core(h, ["送貨地址", "地址"]),
    latIdx = findHIdx_Core(h, "LAT"),
    lngIdx = findHIdx_Core(h, "LNG");
  if (addrIdx === -1 || latIdx === -1 || lngIdx === -1) { SpreadsheetApp.getUi().alert("找不到欄位：送貨地址/LAT/LNG"); return; }
  var count = 0;
  for (var i = 1; i < data.length; i++) {
    var addr = String(data[i][addrIdx] || "").trim();
    var lat = data[i][latIdx], lng = data[i][lngIdx];
    if (!addr || (lat && lng)) continue;
    try {
      var res = Maps.newGeocoder().geocode(addr).results[0];
      if (res) {
        sheet.getRange(i + 1, latIdx + 1).setValue(res.geometry.location.lat);
        sheet.getRange(i + 1, lngIdx + 1).setValue(res.geometry.location.lng);
        count++;
        Utilities.sleep(300);
      }
    } catch (err) { }
  }
  SpreadsheetApp.getUi().alert("✅ 完成！共補足 " + count + " 筆座標。");
}

/**
 * V11.11: 建立系統工具選單
 */


/**
 * V11.17: 前一天任務封存 (取代實體刪除)
 * 將日期小於今日且已完成/結案的訂單標記為「是否封存 = 是」
 */
function archiveYesterdayTasks(e) {
  try {
    _requireSystemContext_(e);
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return;

    var h = data[0].map(function (v) { return String(v).trim(); });
    var dateIdx = h.indexOf("日期");
    if (dateIdx === -1) dateIdx = h.indexOf("建立日期");
    var statusIdx = h.indexOf("狀態");
    var archiveIdx = h.indexOf("是否封存");

    // 如果找不到封存欄，就在最後一欄自動加上
    if (archiveIdx === -1) {
      archiveIdx = h.length;
      sheet.getRange(1, archiveIdx + 1).setValue("是否封存");
    }

    var todayStr = Utilities.formatDate(new Date(), "GMT+8", "yyyy/MM/dd");
    var finishStatus = ["已完成", "退貨完成", "結案"];
    var count = 0;

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var d = row[dateIdx];
      if (!d) continue;

      var rowDate = (d instanceof Date) ? Utilities.formatDate(d, "GMT+8", "yyyy/MM/dd") : String(d).substring(0, 10).replace(/-/g, '/');
      var status = String(row[statusIdx]).trim();
      var isArchived = String(row[archiveIdx]).trim();

      if (rowDate < todayStr && finishStatus.indexOf(status) !== -1 && isArchived !== "是") {
        sheet.getRange(i + 1, archiveIdx + 1).setValue("是");
        count++;
      }
    }
    SpreadsheetApp.getUi().alert("✅ 封存完成！\n共封存了 " + count + " 筆前日已完成任務。");
  } catch (e) {
    SpreadsheetApp.getUi().alert("❌ 封存失敗：" + e.message);
  }
}

/**
 * V11.17: 高階 UUID 雙重防護驗證機制
 * 藉由 Properties 以及 LOG 分頁的 clientUUID 實施嚴格防呆，確保多次送出僅會寫入一次。
 */
function checkUUIDDuplicate(ss, uuid) {
  if (!uuid) return false;
  try {
    // V41: 改用 CacheService (6 小時) 做快速去重；舊版把每個 UUID 永久寫進 ScriptProperties，
    // 是 Cleanup.js 要清的「UUID=1 垃圾屬性」的根因 (屬性空間 500KB 上限)。
    // 長期去重靠送貨日誌的 clientUUID 欄位掃描 (最近 300 筆)。
    // V41.22: 這裡只「檢查」，成功寫入後由 _markUUIDDone_ 標記；否則寫入失敗的重送會被誤判成重複而遺失
    var cache = CacheService.getScriptCache();
    var ck = 'uuid_' + String(uuid).substring(0, 200);
    if (cache.get(ck)) return true;
    var logSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_LOG);
    if (!logSheet) return false;
    var data = logSheet.getDataRange().getValues();
    if (data.length < 2) return false;
    var idx = data[0].map(function (v) { return String(v).trim(); }).indexOf("clientUUID");
    if (idx !== -1) {
      var startIdx = Math.max(1, data.length - 300);
      for (var i = data.length - 1; i >= startIdx; i--) {
        if (String(data[i][idx]) === String(uuid)) {
          cache.put(ck, "1", 21600);
          return true;
        }
      }
    }
    return false;
  } catch (e) { return false; }
}

/** V41.22: 寫入成功後才把 clientUUID 標記為已處理 (6 小時) */
function _markUUIDDone_(uuid) {
  if (!uuid) return;
  try { CacheService.getScriptCache().put('uuid_' + String(uuid).substring(0, 200), "1", 21600); } catch (e) { }
}

/** A 等級：Vision OCR 串接解析 */
function getVisionOCRData_V24(base64Image, token) {
  _requireAdmin_(token);
  if (!VISION_API_KEY) return { error: "尚未設定 VISION_API_KEY" };
  try {
    var payload = {
      requests: [{
        image: { content: base64Image.split(',')[1] || base64Image },
        features: [{ type: "TEXT_DETECTION" }]
      }]
    };
    var options = {
      method: "POST", contentType: "application/json",
      payload: JSON.stringify(payload), muteHttpExceptions: true
    };
    var response = UrlFetchApp.fetch("https://vision.googleapis.com/v1/images:annotate?key=" + VISION_API_KEY, options);
    var result = JSON.parse(response.getContentText());

    if (result.responses && result.responses[0].fullTextAnnotation) {
      var rawText = result.responses[0].fullTextAnnotation.text;
      return { success: true, rawText: rawText, parsed: parseOCR_V24(rawText) };
    }
    return { error: "無法解析圖片文字" };
  } catch (e) { return { error: e.message }; }
}

function parseOCR_V24(text) {
  var data = { orderId: "", weight: "", branch: "", customer: "" };
  if (!text) return data;
  var idMatch = text.match(/[A-Z0-9-]{8,15}/i);
  if (idMatch) data.orderId = idMatch[0];
  var weightMatch = text.match(/(\d+(\.\d+)?)\s*(KG|公斤)/i);
  if (weightMatch) data.weight = weightMatch[1];
  var branches = ["桃園", "新竹", "台中", "台南", "高雄", "屏東", "宜蘭"];
  for (var b of branches) { if (text.indexOf(b) !== -1) { data.branch = b + "分公司"; break; } }
  return data;
}

/** V11.11: 手動/自動安裝 onEdit 觸發器 */
function installTrigger_V11(e) {
  _requireSystemContext_(e);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (t) { if (t.getHandlerFunction() === "onEdit_V11") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("onEdit_V11").forSpreadsheet(ss).onEdit().create();
  SpreadsheetApp.getUi().alert("✅ 成功！自動經緯度觸發器已重新安裝。");
}
/** V2632.11: 專業樣式與條件格式同步 */
function applyProfessionalStyles_V11(e) {
  _requireSystemContext_(e);
  var ss = getSS_V11();
  var logSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_LOG);
  var taskSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);

  [logSheet, taskSheet].forEach(function (sheet) {
    if (!sheet) return;
    var lastCol = sheet.getLastColumn(), lastRow = sheet.getLastRow();
    if (lastRow < 1) return;

    var h = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v).trim(); });
    var addrIdx = findHIdx_Core(h, "ADDRESS");
    var custIdx = findHIdx_Core(h, "CUSTOMER");

    // 1. 全域基礎樣式: 先全部置中
    var range = sheet.getRange(1, 1, lastRow, lastCol);
    range.setHorizontalAlignment("center").setVerticalAlignment("middle").setFontFamily("Noto Sans TC");

    // 2. 特定欄位靠左 (V2632.16)
    if (addrIdx !== -1) sheet.getRange(1, addrIdx + 1, lastRow, 1).setHorizontalAlignment("left");
    if (custIdx !== -1) sheet.getRange(1, custIdx + 1, lastRow, 1).setHorizontalAlignment("left");

    sheet.setFrozenRows(1);
    if (!sheet.getFilter()) sheet.getDataRange().createFilter();
  });

  // --- 送貨日誌：全列著色邏輯 ---
  if (logSheet) {
    logSheet.clearConditionalFormatRules();
    var h = logSheet.getRange(1, 1, 1, logSheet.getLastColumn()).getValues()[0].map(function (v) { return String(v).trim(); });
    var colDmg = getColumnLetter(h.indexOf("貨物破損") + 1);
    var colDate = getColumnLetter(h.indexOf("配送完成時間") + 1);
    var rules = [];

    if (colDmg !== "@") {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$' + colDmg + '2="是"')
        .setBackground("#ef4444").setFontColor("#ffffff").setBold(true)
        .setRanges([logSheet.getRange(2, 1, logSheet.getMaxRows(), logSheet.getLastColumn())])
        .build());
    }
    if (colDate !== "@") {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND(ISDATE($' + colDate + '2),INT($' + colDate + '2)=TODAY()-1)')
        .setBackground("#fef08a")
        .setRanges([logSheet.getRange(2, 1, logSheet.getMaxRows(), logSheet.getLastColumn())])
        .build());
    }
    logSheet.setConditionalFormatRules(rules);
  }

  // --- 派送清單：全列著色邏輯 ---
  if (taskSheet) {
    taskSheet.clearConditionalFormatRules();
    var th = taskSheet.getRange(1, 1, 1, taskSheet.getLastColumn()).getValues()[0].map(function (v) { return String(v).trim(); });
    var colS = getColumnLetter(findHIdx_Core(th, "STATUS") + 1);
    var tRules = [];

    if (colS !== "@") {
      // V11.21: 退回分公司 (紫底白字)
      tRules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$' + colS + '2="退回分公司"')
        .setBackground("#a855f7").setFontColor("#ffffff").setBold(true)
        .setRanges([taskSheet.getRange(2, 1, taskSheet.getMaxRows(), taskSheet.getLastColumn())])
        .build());

      tRules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$' + colS + '2="待指派"')
        .setBackground("#facc15")
        .setRanges([taskSheet.getRange(2, 1, taskSheet.getMaxRows(), taskSheet.getLastColumn())])
        .build());
      tRules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$' + colS + '2="配送中"')
        .setBackground("#fbcfe8")
        .setRanges([taskSheet.getRange(2, 1, taskSheet.getMaxRows(), taskSheet.getLastColumn())])
        .build());
      tRules.push(SpreadsheetApp.newConditionalFormatRule() // 新增已取消樣式
        .whenFormulaSatisfied('=$' + colS + '2="已取消"')
        .setBackground("#e5e7eb").setFontColor("#9ca3af").setBold(true)
        .setRanges([taskSheet.getRange(2, 1, taskSheet.getMaxRows(), taskSheet.getLastColumn())])
        .build());
      tRules.push(SpreadsheetApp.newConditionalFormatRule() // V11.20: 退回分公司 (紫底白字)
        .whenFormulaSatisfied('=$' + colS + '2="退回分公司"')
        .setBackground("#a855f7").setFontColor("#ffffff").setBold(true)
        .setRanges([taskSheet.getRange(2, 1, taskSheet.getMaxRows(), taskSheet.getLastColumn())])
        .build());
    }
    taskSheet.setConditionalFormatRules(tRules);

    // --- 派送清單：下拉選單自動套用 ---
    var colStatusIdx = findHIdx_Core(th, "STATUS");
    if (colStatusIdx !== -1) {
      var statusRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(["待指派", "已指派", "配送中", "已完成", "退貨完成", "結案", "已取消", "退回分公司"], true)
        .setAllowInvalid(true)
        .build();
      taskSheet.getRange(2, colStatusIdx + 1, taskSheet.getMaxRows() - 1, 1).setDataValidation(statusRule);
    }

    var colBranchIdx = th.indexOf("分公司");
    if (colBranchIdx !== -1) {
      var branchRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(["漢樺", "高雅瓷", "安帝嘉", "喜悅納"], true)
        .setAllowInvalid(true)
        .build();
      taskSheet.getRange(2, colBranchIdx + 1, taskSheet.getMaxRows() - 1, 1).setDataValidation(branchRule);
    }
  }

  // --- 業務配送清單：底色邏輯 (同步與主表一致) ---
  var salesSheet = ss.getSheetByName("業務配送清單");
  if (salesSheet) {
    salesSheet.clearConditionalFormatRules();
    var sh = salesSheet.getRange(1, 1, 1, salesSheet.getLastColumn()).getValues()[0].map(function(v){ return String(v).trim(); });
    var colStatusIdx = typeof findHIdx_Core === 'function' ? findHIdx_Core(sh, "STATUS") : sh.indexOf("狀態");
    var colCustIdx = typeof findHIdx_Core === 'function' ? findHIdx_Core(sh, "CUSTOMER") : sh.indexOf("客戶");
    var sRules = [];
    
    if (colStatusIdx !== -1) {
      var colStatusLetter = getColumnLetter(colStatusIdx + 1);
      var rRange = [salesSheet.getRange(2, 1, salesSheet.getMaxRows(), salesSheet.getLastColumn())];
      
      // 1. 待指派 (黃色)
      sRules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$' + colStatusLetter + '2="待指派"')
        .setBackground("#facc15")
        .setRanges(rRange)
        .build());
        
      // 2. 配送中 (粉色)
      sRules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$' + colStatusLetter + '2="配送中"')
        .setBackground("#fbcfe8")
        .setRanges(rRange)
        .build());
        
      // 3. 已取消 (灰色)
      sRules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$' + colStatusLetter + '2="已取消"')
        .setBackground("#e5e7eb").setFontColor("#9ca3af").setBold(true)
        .setRanges(rRange)
        .build());
        
      // 4. 退回分公司 (紫色)
      sRules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$' + colStatusLetter + '2="退回分公司"')
        .setBackground("#a855f7").setFontColor("#ffffff").setBold(true)
        .setRanges(rRange)
        .build());

      // 5. 已完成 (灰底黑色斜體作為點綴)
      sRules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$' + colStatusLetter + '2="已完成"')
        .setBackground("#f3f4f6").setFontColor("#6b7280")
        .setRanges(rRange)
        .build());
    }

    // 保留之前的樣品提示 (如果不是樣品加個粗體做區隔，不強佔底色)
    if (colCustIdx !== -1) {
      var colCustLetter = getColumnLetter(colCustIdx + 1);
      sRules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND(NOT(ISBLANK($' + colCustLetter + '2)), ISERROR(SEARCH("樣品", $' + colCustLetter + '2)))')
        .setFontColor("#000000").setBold(true)
        .setRanges([salesSheet.getRange(2, 1, salesSheet.getMaxRows(), salesSheet.getLastColumn())])
        .build());
    }

    salesSheet.setConditionalFormatRules(sRules);
    
    // 基礎樣式套用與置中
    salesSheet.getDataRange().setHorizontalAlignment("center").setVerticalAlignment("middle").setFontFamily("Noto Sans TC");
    if (colCustIdx !== -1) salesSheet.getRange(1, colCustIdx + 1, salesSheet.getLastRow(), 1).setHorizontalAlignment("left");
    
    // 自動寫入狀態下拉選單，確保操作一致
    if (colStatusIdx !== -1) {
      var statusRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(["待指派", "配送中", "已完成", "退回分公司", "已取消"], true)
        .build();
      salesSheet.getRange(2, colStatusIdx + 1, salesSheet.getMaxRows() - 1, 1).setDataValidation(statusRule);
    }
    
    salesSheet.setFrozenRows(1);
  }
}

/** V2632.16: 司機端取消任務 */
function adminCancelTaskV2(taskId, branch, token) {
  try {
    var ctx = _requireDriver_(token);
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
    var data = sheet.getDataRange().getValues();
    var h = data[0].map(function (v) { return String(v).trim(); });
    var idIdx = h.indexOf("單號");
    var statusIdx = h.indexOf("狀態");
    var branchIdx = h.indexOf("分公司");
    var vehIdx = findHIdx_Core(h, "VEHICLE");
    if (idIdx === -1 || statusIdx === -1) return "找不到單號或狀態欄位";

    for (var i = 1; i < data.length; i++) {
        var idMatch = String(data[i][idIdx]).trim() === String(taskId).trim();
        // 有傳入分公司時才比對，沒傳入時僅比對單號（相容舊版）
        var branchMatch = (!branch || branchIdx === -1) ? true : String(data[i][branchIdx]).trim() === String(branch).trim();
        if (idMatch && branchMatch) {
            // V41: 司機只能取消自己車上的單
            if (ctx.role === 'driver' && vehIdx !== -1 && !_driverMayUseCar_(ctx, data[i][vehIdx])) {
              return "🔒 無權取消其他車輛的任務: " + taskId;
            }
            sheet.getRange(i + 1, statusIdx + 1).setValue("已取消");
            // 清除戰情室快取，防止舊狀態覆蓋回來
            _clearWarRoomCache_();
            return "✅ 任務 " + taskId + " 已取消成功";
        }
    }
    return "找不到對應的單號: " + taskId;
  } catch (e) {
    return "取消失敗: " + e.message;
  }
}

/** 輔助：取得欄位英文字母 */
function getColumnLetter(col) {
  var letter = "";
  while (col > 0) {
    var t = (col - 1) % 26;
    letter = String.fromCharCode(65 + t) + letter;
    col = (col - t - 1) / 26;
  }
  return letter;
}

/** V2632.11: 3 天數據清理與自動封存 (防止系統變慢) */
function cleanupOldLogsAndTasks_V11(e) {
  _requireSystemContext_(e);
  // V41: 整個封存流程加鎖。舊版 clearContents() → setValues() 之間沒有鎖，司機此時 appendRow 的資料會被整批覆蓋掉
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { console.error("cleanupOldLogsAndTasks_V11: 取得鎖失敗，本次略過"); return; }
  try {
    _cleanupOldLogsAndTasksCore_(getSS_V11());
  } finally {
    lock.releaseLock();
  }
}

function _cleanupOldLogsAndTasksCore_(ss) {
  var cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 3);
  var cutoffStr = Utilities.formatDate(cutoffDate, "GMT+8", "yyyy/MM/dd");

  var cleanSheet = function (sheetName, dateHeader) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return;
    var h = data[0].map(function (v) { return String(v).trim(); });
    var idx = h.indexOf(dateHeader);
    if (idx === -1) return;

    // 準備封存表
    var archiveName = sheetName + "_封存區";
    var archSheet = ss.getSheetByName(archiveName) || ss.insertSheet(archiveName);
    if (archSheet.getLastRow() === 0) archSheet.appendRow(data[0]);

    var keepData = [data[0]]; // 保留標題
    var moveData = [];
    var cutoffTime = cutoffDate.getTime();

    for (var i = 1; i < data.length; i++) {
      var d = data[i][idx];
      var rowTime = 0;
      if (d instanceof Date) {
        rowTime = d.getTime();
      } else if (d && String(d).trim() !== "") {
        // V2634.2: 強化字串日期解析，預防字串比對產生的 ASCII 排序錯誤
        var parts = String(d).split(/[-/]/);
        if (parts.length >= 3) {
          var y = parseInt(parts[0]), m = parseInt(parts[1]), dld = parseInt(parts[2]);
          if (y < 2000) y += 2000;
          rowTime = new Date(y, m - 1, dld).getTime();
        } else {
          rowTime = Date.parse(String(d)) || 0;
        }
      }

      // 若日期不明，或日期大於等於截止日，則保留
      if (rowTime === 0 || rowTime >= cutoffTime) {
        keepData.push(data[i]);
      } else {
        moveData.push(data[i]);
      }
    }

    if (moveData.length > 0) {
      // 1. 寫入封存區
      archSheet.getRange(archSheet.getLastRow() + 1, 1, moveData.length, moveData[0].length).setValues(moveData);

      // 2. 高效覆寫原始分頁 (代替緩慢的 deleteRow)
      sheet.clearContents();

      // V2634.4: 使用 getMaxColumns() 確保在 clearContents 後仍能清空整盤驗證 (解決 C78 寫入失敗)
      if (sheet.getMaxRows() > 1) {
        sheet.getRange(2, 1, sheet.getMaxRows() - 1, sheet.getMaxColumns()).clearDataValidations();
      }

      sheet.getRange(1, 1, keepData.length, keepData[0].length).setValues(keepData);

      Logger.log(sheetName + " 封存了 " + moveData.length + " 筆，保留 " + (keepData.length - 1) + " 筆。");
    }
  };

  cleanSheet(V11_PROD_CONFIG.SHEET_TASKS, "日期");
  cleanSheet(V11_PROD_CONFIG.SHEET_LOG, "配送完成時間");
}

/**
 * 🌙 每日凌晨 12 點自動重置車隊狀態 (V5.2)
 * 此函式僅重置即時定位與出發時間，不移動任務資料（保留原有的 15 天封存機制）
 */
function autoResetAndArchive_Midnight(e) {
  _requireSystemContext_(e);
  console.log("🚀 啟動年度凌晨狀態重置程序...");
  var ss = getSS_V11();
  
  // 1. 清除車輛最後座標與狀態 (重置車隊面板，確保隔天 ETA 重新起算)
  var sSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_STATUS);
  if (sSheet) {
    var sData = sSheet.getDataRange().getValues();
    if (sData.length > 1) {
      var hS = sData[0].map(v => String(v).trim());
      var idxLat = hS.indexOf("緯度"), idxLng = hS.indexOf("經度"), idxUpd = hS.indexOf("最後更新"), idxTarget = hS.indexOf("目前目標"), idxDep = hS.indexOf("出發時間");
      for (var j = 1; j < sData.length; j++) {
        if (idxLat !== -1) sData[j][idxLat] = "";
        if (idxLng !== -1) sData[j][idxLng] = "";
        if (idxUpd !== -1) sData[j][idxUpd] = "";
        if (idxTarget !== -1) sData[j][idxTarget] = "";
        if (idxDep !== -1) sData[j][idxDep] = "";
      }
      sSheet.getRange(1, 1, sData.length, sData[0].length).setValues(sData);
      console.log("✅ 已重置車隊即時座標與導航紀錄");
    }
  }
  
  // 2. 清除快取，迫使 Dashboard 下次載入時重新抓取
  _clearWarRoomCache_();
  console.log("✨ 每日狀態重置完成。");
}

/**
 * 🛠️ 一鍵啟動：設定每日凌晨重置觸發器
 */
function setupMidnightResetTrigger(e) {
  _requireSystemContext_(e);
  const funcName = 'autoResetAndArchive_Midnight';
  const triggers = ScriptApp.getProjectTriggers();
  
  // 先清除舊的，避免重複執行
  triggers.forEach(t => { 
    if (t.getHandlerFunction() === funcName) ScriptApp.deleteTrigger(t); 
  });

  // 設定新的：每天凌晨 0 點執行
  ScriptApp.newTrigger(funcName)
    .timeBased()
    .everyDays(1)
    .atHour(0)
    .create();

  return "✅ 每日凌晨重置觸發器已重新設定成功！系統將在每天 00:00 執行重置。";
}


/** 
 * V2634.3 緊急復原工具
 * 將「派送清單_封存區」中，日期晚於 3/13 的資料移回「派送清單」
 */
function emergencyRestoreTasks(e) {
  try {
    _requireSystemContext_(e);
    var ss = getSS_V11();
    var taskSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
    var archiveSheet = ss.getSheetByName("派送清單_封存區");
    if (!archiveSheet) return "❌ 找不到封存分頁";

    var data = archiveSheet.getDataRange().getValues();
    if (data.length <= 1) return "ℹ️ 封存區無資料";

    var h = data[0].map(v => String(v).trim());
    var idx = h.indexOf("日期");
    if (idx === -1) return "❌ 封存區格式錯誤 (找不到日期欄位)";

    // 動態截止日：往前推 7 天
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    cutoff.setHours(0, 0, 0, 0);
    var cutoffTime = cutoff.getTime();

    var toRestore = [];
    var toKeep = [data[0]];

    for (var i = 1; i < data.length; i++) {
      var d = data[i][idx];
      var rowTime = 0;
      if (d instanceof Date) {
        rowTime = d.getTime();
      } else {
        var parts = String(d).split(/[-/]/);
        if (parts.length >= 3) {
          var y = parseInt(parts[0]), m = parseInt(parts[1]), dl = parseInt(parts[2]);
          if (y < 2000) y += 2000;
          rowTime = new Date(y, m - 1, dl).getTime();
        }
      }

      if (rowTime >= cutoffTime) {
        toRestore.push(data[i]);
      } else {
        toKeep.push(data[i]);
      }
    }

    if (toRestore.length > 0) {
      // V2634.5: 復原時也必須清除目標表的驗證規則，否則會被 C78 等儲存格擋下
      if (taskSheet.getMaxRows() > 1) {
        taskSheet.getRange(2, 1, taskSheet.getMaxRows() - 1, taskSheet.getMaxColumns()).clearDataValidations();
      }

      // 附加回主表
      taskSheet.getRange(taskSheet.getLastRow() + 1, 1, toRestore.length, toRestore[0].length).setValues(toRestore);

      // 更新封存表
      archiveSheet.clearContents();
      archiveSheet.getRange(1, 1, toKeep.length, toKeep[0].length).setValues(toKeep);

      _clearWarRoomCache_();
      applyProfessionalStyles_V11();
      return "✅ 成功復原 " + toRestore.length + " 筆訂單（近 7 天），請重新整理頁面。";
    }
    return "ℹ️ 封存區內無近 7 天的訂單。";
  } catch (e) { return "❌ 復原失敗: " + e.message; }
}


/**
 * ℹ️ 派遣系統邏輯已遷移至 DispatchLogic.js
 */

/** V11.26: 手動同步舊有的送貨日誌單號 (支援封存區與多重欄位比對) */
function syncOldLogsOrderId_V11(e) {
  _requireSystemContext_(e);
  var ss = getSS_V11();
  var logSheetNames = [V11_PROD_CONFIG.SHEET_LOG, V11_PROD_CONFIG.SHEET_LOG + "_封存區"];
  var taskSheetNames = [V11_PROD_CONFIG.SHEET_TASKS, V11_PROD_CONFIG.SHEET_TASKS + "_封存區", "派進清單_封存區"]; // 包含可能的錯別字分頁
  
  // 建立任務對照表 (日期|客戶|地址|車號) -> OrderId
  var taskMap = {};
  taskSheetNames.forEach(function(name) {
    var s = ss.getSheetByName(name);
    if (!s) return;
    var data = s.getDataRange().getValues();
    if (data.length <= 1) return;
    var h = data[0].map(function(v) { return String(v).trim(); });
    var idxId = findHIdx_Core(h, "ID");
    var idxV = findHIdx_Core(h, "VEHICLE");
    var idxAddr = findHIdx_Core(h, "ADDRESS");
    var idxCust = findHIdx_Core(h, "CUSTOMER");
    var idxDate = findHIdx_Core(h, "DATE");
    
    if (idxId === -1 || idxV === -1 || idxDate === -1) return;
    
    for (var i = 1; i < data.length; i++) {
       var d = data[i][idxDate];
       var dateStr = (d instanceof Date) ? Utilities.formatDate(d, "GMT+8", "yyyy/MM/dd") : String(d || "").split(' ')[0].trim();
       var cust = String(data[i][idxCust] || "").trim();
       var addr = String(data[i][idxAddr] || "").trim();
       var car = String(data[i][idxV] || "").trim().toUpperCase();
       var id = String(data[i][idxId] || "").trim();
       
       if (dateStr && id) {
         // 建立複合鍵：日期|客戶|地址|車號
         var key = dateStr + "|" + cust + "|" + addr + "|" + car;
         taskMap[key] = id;
       }
    }
  });

  var totalCount = 0;
  logSheetNames.forEach(function(lName) {
    var logSheet = ss.getSheetByName(lName);
    if (!logSheet) return;
    
    var logRange = logSheet.getDataRange();
    var logValues = logRange.getValues();
    if (logValues.length <= 1) return;
    
    var logHeaders = logValues[0].map(function(v) { return String(v).trim(); });
    var colLogOrderId = logHeaders.indexOf("單號");
    var colLogFinishTime = logHeaders.indexOf("配送完成時間");
    var colLogCar = logHeaders.indexOf("車牌號碼");
    var colLogCust = logHeaders.indexOf("客戶名稱");
    var colLogAddr = logHeaders.indexOf("送貨地址");
    
    if (colLogOrderId === -1) {
      ensureHeaders_V11(logSheet);
      logValues = logSheet.getDataRange().getValues();
      logHeaders = logValues[0].map(function(v) { return String(v).trim(); });
      colLogOrderId = logHeaders.indexOf("單號");
    }
    
    if (colLogOrderId === -1) return;

    var count = 0;
    for (var i = 1; i < logValues.length; i++) {
      var curId = String(logValues[i][colLogOrderId] || "").trim();
      if (curId === "" || curId === "undefined") {
        var dt = logValues[i][colLogFinishTime];
        var dateStr = (dt instanceof Date) ? Utilities.formatDate(dt, "GMT+8", "yyyy/MM/dd") : String(dt || "").split(' ')[0].trim();
        var cust = String(logValues[i][colLogCust] || "").trim();
        var addr = String(logValues[i][colLogAddr] || "").trim();
        var car = String(logValues[i][colLogCar] || "").trim().toUpperCase();
        
        var key = dateStr + "|" + cust + "|" + addr + "|" + car;
        var matchId = taskMap[key];
        
        if (matchId) {
          logValues[i][colLogOrderId] = matchId;
          count++;
        }
      }
    }
    
    if (count > 0) {
      logSheet.getRange(1, 1, logValues.length, logValues[0].length).setValues(logValues);
      totalCount += count;
    }
  });
  
  if (totalCount > 0) {
    return "✅ 成功向後補齊 " + totalCount + " 筆單號！(含封存區比對)";
  } else {
    return "ℹ️ 目前沒有找到可同步的遺漏單號。";
  }
}

/**
 * V16.0: 批次更新任務排序 (seq)
 * @param {Array} sequenceData - 格式: [{id: "單號", seq: 數字}, ...]
 * @param {String} vehicleName - 車牌/司機代碼
 */
function adminUpdateSequence_V11(sequenceData, vehicleName, token) {
  _requireAdmin_(token);
  if (!sequenceData || !sequenceData.length) return "無更新資料";
  
  const ss = getSS_V11();
  const sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(v => String(v).trim());
  
  const colId = findHIdx_Core(headers, "ID");
  const colSeq = findHIdx_Core(headers, "SEQ");
  
  if (colId === -1 || colSeq === -1) return "❌ 找不到單號或順序欄位";
  
  let updatedCount = 0;
  const seqColVals = data.slice(1).map(r => [r[colSeq]]);
  sequenceData.forEach(item => {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][colId]) === String(item.id)) {
        seqColVals[i - 1][0] = item.seq;
        updatedCount++;
        break;
      }
    }
  });
  if (updatedCount > 0) sheet.getRange(2, colSeq + 1, seqColVals.length, 1).setValues(seqColVals); // V41: 一次寫回
  _clearWarRoomCache_();
  
  return "✅ 成功更新 " + updatedCount + " 筆任務順序 (" + vehicleName + ")";
}

/**
 * V11.25: 縮網址工具 (升級 HTTPS 並增加超時處理)
 */
function shortenUrl_V11(longUrl) {
  if (!longUrl || longUrl.indexOf("http") === -1) return longUrl;
  // 如果已經是短網址則跳過
  if (longUrl.indexOf("tinyurl.com") !== -1 || longUrl.length < 30) return longUrl;
  
  try {
    const api = "https://tinyurl.com/api-create.php?url=" + encodeURIComponent(longUrl.trim());
    const response = UrlFetchApp.fetch(api, {
      muteHttpExceptions: true,
      timeout: 10000 // 給 API 10 秒時間
    });
    const shortUrl = response.getContentText();
    return (shortUrl && shortUrl.startsWith("http")) ? shortUrl : longUrl;
  } catch (e) {
    return longUrl;
  }
}

/**
 * V11.25: 批次縮網址並推送 LINE (優化正則偵測)
 */
function pushLineMessageWithShortUrls_V11(msg) {
  _requireCtx_();
  // 精準捕捉網址，避免抓到後面的換行或空白
  const urlRegex = /https?:\/\/[a-zA-Z0-9\-\.\/\?&%=_]+/g;
  const urls = msg.match(urlRegex);
  
  let finalMsg = msg;
  if (urls) {
    // 為了避免重複替換，先去重
    const uniqueUrls = Array.from(new Set(urls));
    uniqueUrls.forEach(function(url) {
      const short = shortenUrl_V11(url);
      if (short !== url) {
        // 使用 split/join 全域替換
        finalMsg = finalMsg.split(url).join(short);
      }
    });
  }
  
  return pushLineMessage_V11(finalMsg);
}

/** V11.20: 批次退回分公司邏輯 */
function adminBatchReturnTasks_V11(updates, token) {
  var lock = LockService.getScriptLock();
  try {
    _requireAdmin_(token);
    if (!lock.tryLock(15000)) throw new Error("系統忙碌中");
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
    var data = sheet.getDataRange().getValues();
    var h = data[0].map(v => String(v).trim());
    
    var colId = findHIdx_Core(h, "ID");
    var colStat = findHIdx_Core(h, "STATUS");
    var colReason = findHIdx_Core(h, "RETURN_REASON");
    
    var colVeh = findHIdx_Core(h, "VEHICLE");
    var colDriv = findHIdx_Core(h, ["派遣司機", "司機"]);
    
    if (colStat === -1 || colReason === -1) throw new Error("找不到狀態或退回原因欄位");

    // V12.5：同步將被退回的項目，複製一份到「業務配送清單」，供後續業務查收
    var returnedRowsToCopy = [];
    updates.forEach(up => {
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][colId]) === String(up.id)) {
          
          // 1. 建立副本供業務清單：將狀態歸零為「待指派」，並清空原指派車輛與司機
          var clonedRow = [...data[i]];
          clonedRow[colStat] = "待指派"; 
          if (colVeh !== -1) clonedRow[colVeh] = "";
          if (colDriv !== -1) clonedRow[colDriv] = "";
          clonedRow[colReason] = up.reason;
          returnedRowsToCopy.push(clonedRow);

          // 2. 原始表更新：改為「退回分公司」存檔
          sheet.getRange(i + 1, colStat + 1).setValue("退回分公司");
          sheet.getRange(i + 1, colReason + 1).setValue(up.reason);
          break;
        }
      }
    });

    // 執行複製到業務表
    if (returnedRowsToCopy.length > 0) {
        var salesSheet = ensureSalesDeliverySheet_Core(ss); // 調用 OcrEngine.js 中宣告的全域共用函式
        returnedRowsToCopy.forEach(row => {
            salesSheet.appendRow(row);
        });
        // 依照公司排序
        sortSalesSheetByCompany_Core(salesSheet); // 調用 OcrEngine.js 中宣告的排序共用函式
    }
    
    // V11.26: 重新抓取並執行「退回優先」排序邏輯
    var updatedData = sheet.getDataRange().getValues();
    var header = updatedData[0];
    var rows = updatedData.slice(1);
    
    var idxDate = findHIdx_Core(header, "DATE");
    var idxStat = findHIdx_Core(header, "STATUS");
    var idxCust = findHIdx_Core(header, "CUSTOMER");

    rows.sort(function(a, b) {
      var dA = new Date(a[idxDate]).getTime();
      var dB = new Date(b[idxDate]).getTime();
      if (dA !== dB) return dA - dB;
      var scoreA = (a[idxStat] === "退回分公司") ? 0 : 1;
      var scoreB = (b[idxStat] === "退回分公司") ? 0 : 1;
      if (scoreA !== scoreB) return scoreA - scoreB;
      return String(a[idxCust]).localeCompare(String(b[idxCust]));
    });

    sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
    _clearWarRoomCache_();
    applyProfessionalStyles_V11();
    
    return { success: true, message: "成功退回，並已同步至業務配送清單" };
  } catch (e) { return { success: false, error: e.message }; }
  finally { lock.releaseLock(); }
}

/**
 * V11.26: 批次寫入撿貨明細 (子表)
 * 此功能會自動比對產品主檔，帶出圖片與規格
 */
function upsertPickingItems_V11(uniqueKey, items) {
  _requireCtx_();
  if (!items || items.length === 0) return;
  
  var ss = getSS_V11();
  var sheet = ss.getSheetByName("撿貨明細") || ss.insertSheet("撿貨明細");
  
  // 初始化標頭 (如果新表)
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["單號KEY", "項次", "產品編號", "片數", "批號", "圖檔連結", "中文系列", "尺寸", "撿貨狀態", "更新時間"]);
    sheet.getRange("1:1").setBackground("#1e293b").setFontColor("#ffffff").setFontWeight("bold");
  }
  
  // V41 加速：舊版逐列 deleteRow + 逐筆 appendRow (每次都是一趟 API)，改為一次讀、記憶體過濾、一次寫
  var productMap = lookupProductMasterData_V11();
  var now = new Date();
  var newRows = items.map(function (item) {
    var pInfo = findProductInfo_V11(productMap, item.code);
    if (!pInfo || !pInfo.name) pInfo = { name: "未建檔", size: "", img: "", pcsPerBox: "", kgPerBox: "" };
    return [uniqueKey, item.seq, item.code, item.qty, item.lot, pInfo.img, pInfo.name, pInfo.size, "待撿貨", now];
  });

  var lastRow = sheet.getLastRow();
  var data = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 10).getValues() : [];
  var hasOld = data.some(function (r) { return String(r[0]) === String(uniqueKey); });
  if (!hasOld) {
    // 沒有舊明細：直接整塊附加
    sheet.getRange(lastRow + 1, 1, newRows.length, 10).setValues(newRows);
    return;
  }
  var kept = data.filter(function (r) { return String(r[0]) !== String(uniqueKey); }).concat(newRows);
  if (data.length > 0) sheet.getRange(2, 1, data.length, 10).clearContent();
  if (kept.length > 0) sheet.getRange(2, 1, kept.length, 10).setValues(kept);
}

function normalizeProductCode_V11(code) {
  var s = String(code || "").trim().toUpperCase();
  // 移除所有括號及其中的內容，支援半形 ()、全形 （）、中括號 []、全形中括號 ［］
  s = s.replace(/[\(\（\[\［].*?[\)\）\]\］]/g, "");
  // 防呆：避免有些使用者括號漏了後半段，直接切掉第一個括號後的所有字元
  s = s.replace(/[\(\（\[\［].*$/g, "");
  return s.replace(/\s/g, "");
}

function parsePositiveNumber_V11(value) {
  var text = String(value || "").replace(/,/g, "").trim();
  var match = text.match(/[\d.]+/);
  if (!match) return 0;
  var num = Number(match[0]);
  return isNaN(num) ? 0 : num;
}

function calcBoxQtyFromPieces_V11(qty, pcsPerBox) {
  var pieces = parsePositiveNumber_V11(qty);
  var perBox = parsePositiveNumber_V11(pcsPerBox);
  if (!pieces || !perBox) return "";
  var boxes = pieces / perBox;
  return Math.round(boxes * 100) / 100;
}

function calcItemWeightKg_V11(qty, pcsPerBox, kgPerBox) {
  var pieces = parsePositiveNumber_V11(qty);
  var perBox = parsePositiveNumber_V11(pcsPerBox);
  var kgBox = parsePositiveNumber_V11(kgPerBox);
  if (!pieces || !perBox || !kgBox) return "";
  return Math.round((pieces / perBox) * kgBox * 10) / 10;
}

function findProductInfo_V11(productMap, code) {
  productMap = productMap || {};
  var key = normalizeProductCode_V11(code);
  if (!key) return {};
  if (productMap[key]) return productMap[key];

  var bestKey = "";
  Object.keys(productMap).forEach(function (mapKey) {
    if (!mapKey) return;
    var isPrefixMatch = mapKey.indexOf(key) === 0 || key.indexOf(mapKey) === 0;
    if (!isPrefixMatch) return;
    if (!bestKey || mapKey.length < bestKey.length) bestKey = mapKey;
  });
  return bestKey ? productMap[bestKey] : {};
}

function readChunkedCacheJson_V11(cache, baseKey) {
  try {
    var metaText = cache.get(baseKey + "_meta");
    if (!metaText) return null;
    var meta = JSON.parse(metaText);
    var count = Number(meta.count || 0);
    if (!count) return null;
    var parts = [];
    for (var i = 0; i < count; i++) {
      var part = cache.get(baseKey + "_" + i);
      if (part == null) return null;
      parts.push(part);
    }
    return JSON.parse(parts.join(""));
  } catch (e) {
    console.log("分段快取讀取失敗: " + e.message);
    return null;
  }
}

function writeChunkedCacheJson_V11(cache, baseKey, value, seconds) {
  try {
    var text = JSON.stringify(value);
    var chunkSize = 80000;
    var count = Math.ceil(text.length / chunkSize);
    for (var i = 0; i < count; i++) {
      cache.put(baseKey + "_" + i, text.slice(i * chunkSize, (i + 1) * chunkSize), seconds);
    }
    cache.put(baseKey + "_meta", JSON.stringify({ count: count, length: text.length }), seconds);
    return true;
  } catch (e) {
    console.log("分段快取寫入失敗: " + e.message);
    return false;
  }
}

/**
 * V11.26: 讀取外部產品主檔並建立快取地圖
 */
function lookupProductMasterData_V11() {
  var cache = CacheService.getScriptCache();
  // V41: 舊 key (v13~v20) 早已自然過期 (最長 6 小時)，不需要每次呼叫都 remove 8 次
  var cacheKey = "product_master_map_v21_pack";
  var cachedData = readChunkedCacheJson_V11(cache, cacheKey);
  if (cachedData && Object.keys(cachedData).length > 0) return cachedData;
  
  try {
    var sourceIds = V11_PROD_CONFIG.PRODUCT_MASTER_SS_IDS;
    var map = {};
    var findHeader = function (header, names) {
      var normalized = header.map(function (h) { return String(h || "").trim().toLowerCase().replace(/\s/g, ""); });
      for (var n = 0; n < names.length; n++) {
        var key = String(names[n]).toLowerCase().replace(/\s/g, "");
        var exact = normalized.indexOf(key);
        if (exact !== -1) return exact;
        for (var h = 0; h < normalized.length; h++) {
          if (normalized[h] && normalized[h].indexOf(key) !== -1) return h;
        }
      }
      return -1;
    };

    sourceIds.forEach(function (ssId) {
     try { // V39.15: 單一來源價目表打不開/讀取失敗時，不應拖垮其他來源的資料(否則明細的箱/片換算會全部消失)
      var ss = SpreadsheetApp.openById(ssId);
      var data = null, header = null;
      var idxCode = -1, idxName = -1, idxOrigName = -1, idxSize = -1, idxImg = -1, idxPcsPerBox = -1, idxKgPerBox = -1;

      // V39.17: 原本邏輯是「掃全部分頁，抓到第一個有『編號』欄位的就停」，
      // 這樣如果同一份試算表裡有別的分頁(例如客戶對照表)剛好也有一欄叫「編號」，
      // 會誤抓到錯的表，抓出來的商品碼完全對不上實際訂單、也不會報錯或是空的，難以察覺。
      // 改成分三個優先層級找分頁，且候選分頁必須同時找到「編號」跟「片/箱」欄位才算數：
      // 第一層：分頁名稱完全等於「編號價目表」
      // 第二層：分頁名稱含有「編號」或「價目」或「價格」字樣
      // 第三層(最後手段)：其餘所有分頁
      var allSheets = ss.getSheets();
      var tier1 = [], tier2 = [], tier3 = [];
      allSheets.forEach(function (s) {
        var sName = s.getName();
        if (sName === "編號價目表") tier1.push(s);
        else if (/編號|價目|價格/.test(sName)) tier2.push(s);
        else tier3.push(s);
      });
      var sheetsToScan = tier1.concat(tier2, tier3);

      for (var si = 0; si < sheetsToScan.length; si++) {
        var cand = sheetsToScan[si];
        var candData = cand.getDataRange().getValues();
        if (!candData || candData.length < 2) continue;
        var candHeader = candData[0].map(function (v) { return String(v).trim(); });

        // V39.21: 真正的 bug 根因！原本寫成 ["漢樺編號","編號"]，"漢樺編號" 排最優先。
        // 但安帝嘉/喜悅納/高雅瓷的價目表裡，「編號」(自己的商品編號，如 RN61298) 跟「漢樺編號」
        // (跨公司對照用的另一欄) 是「同時並存」的兩個不同欄位，優先抓到漢樺編號那欄，
        // 導致整批商品都用錯欄位的內容當編號，跟訂單上實際出現的編號完全對不上。
        // 改成優先找「編號」，「漢樺編號」只在完全沒有「編號」欄時才當備案(給漢樺自己的表用)。
        var cIdxCode = findHeader(candHeader, ["編號", "漢樺編號"]);
        // V39.18: 確認分頁名稱一律是「編號價目表」，不再要求同一分頁必須連「片/箱」欄位都找到，
        // 避免片/箱欄位命名對不上關鍵字時，連名稱/尺寸都一起抓不到（比原本更糟）。
        // 只要求「編號」欄位存在即可判定為有效商品表，片/箱欄位另外用完整關鍵字表去找。
        if (cIdxCode === -1) continue;

        idxCode = cIdxCode;
        idxName = findHeader(candHeader, ["中文系列", "系列"]);
        idxOrigName = findHeader(candHeader, ["原廠品名", "原廠名稱", "英文品名", "品名名"]);
        idxSize = findHeader(candHeader, ["尺寸(cm)", "尺寸"]);
        idxImg = findHeader(candHeader, ["單片圖", "單片連結網址", "主圖URL", "雲端圖片"]);
        idxPcsPerBox = findHeader(candHeader, ["片/箱", "片箱", "每箱片數", "每箱片", "箱裝片數", "裝箱片數", "每箱入數", "箱入數", "入數", "入り数"]);
        idxKgPerBox = findHeader(candHeader, ["KG/箱", "kg/箱", "公斤/箱"]);

        // 回填比對成功的這張表
        data = candData;
        header = candHeader;
        break;
      }
      if (idxCode === -1 || !data) return;
      
      for (var i = 1; i < data.length; i++) {
        var rawCode = String(data[i][idxCode]).trim();
        var code = normalizeProductCode_V11(rawCode);
        if (!code) continue;
        
        var rawImg = idxImg !== -1 ? String(data[i][idxImg] || "").trim() : "";
        var finalImg = rawImg;
        
        // V12 Image Fix: 偵測 Google Drive 連結並轉換為極度穩定的 lh3 直接渲染格式
        if (rawImg.indexOf("drive.google.com") !== -1) {
          var dId = "";
          var m1 = rawImg.match(/[?&]id=([^&]+)/);
          var m2 = rawImg.match(/\/d\/([^\/]+)/);
          if (m1 && m1[1]) dId = m1[1];
          else if (m2 && m2[1]) dId = m2[1];
          
          if (dId) {
              finalImg = "https://lh3.googleusercontent.com/d/" + dId;
          }
        }
        
        map[code] = {
          name: idxName !== -1 ? data[i][idxName] || "" : "",
          originalName: idxOrigName !== -1 ? data[i][idxOrigName] || "" : "",
          size: idxSize !== -1 ? data[i][idxSize] || "" : "",
          img: finalImg,
          pcsPerBox: idxPcsPerBox !== -1 ? data[i][idxPcsPerBox] || "" : "",
          kgPerBox: idxKgPerBox !== -1 ? data[i][idxKgPerBox] || "" : ""
        };
      }
     } catch (srcErr) {
      console.log("主檔來源讀取失敗 (ssId=" + ssId + "): " + srcErr.message);
     }
    });

    // V39.16: 抓到的商品數過少(例如全部來源都失敗)時不寫入快取，避免把壞結果凍結一小時，下次呼叫會重新嘗試
    if (Object.keys(map).length > 0) {
      writeChunkedCacheJson_V11(cache, cacheKey, map, 3600);
    } else {
      console.log("主檔讀取結果為空，略過快取寫入");
    }
    return map;
  } catch (e) {
    console.log("主檔讀取失敗: " + e.message);
    return {};
  }
}

/** V11.20: LINE 推播核心 */
function pushLineMessage_V11(msg, token) {
  _requireAdmin_(token);
  var token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  var targetId = PropertiesService.getScriptProperties().getProperty('LINE_TARGET_ID');
  if (!token || !targetId) return;

  var url = "https://api.line.me/v2/bot/message/push";
  var payload = {
    "to": targetId,
    "messages": [{ "type": "text", "text": msg }]
  };
  var options = {
    "method": "post",
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token
    },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };
  UrlFetchApp.fetch(url, options);
}

/**
 * 📨 Telegram 到貨通知：初始化（Token + 各分公司到貨群組 Chat ID 寫入 Script Properties）
 * 分流架構：每個分公司對應一個專屬到貨群組。目前高雅瓷已設定，安帝嘉/喜悅納待補。
 * 用法：部署後第一次結案會自動呼叫；亦可手動執行確保已設定。
 */
function _initTelegramDelivery_V11() {
  try {
    _requireSystemContext_();
    var props = PropertiesService.getScriptProperties();
    // TG_TOKEN 請在「專案設定 → 指令碼屬性」手動設定，不寫進原始碼
    // (舊版曾寫死在此並推上公開 repo，該 bot token 已視為外洩，請至 @BotFather /revoke 後換新)
    if (!props.getProperty('TG_TOKEN')) console.warn("⚠️ TG_TOKEN 尚未設定，Telegram 到貨通知不會發送");
    // 各分公司 → 到貨群組 Chat ID
    props.setProperty('TG_BRANCH_GROUPS', JSON.stringify({
      "高雅瓷": "-5590086103",
      "安帝嘉": "-1004388719757", // V39.22: 群組升級成 supergroup 後 chat_id 改變，舊的 -5567522188 已失效
      "喜悅納": "-5418269706"
    }));
    console.log("✅ Telegram 到貨通知設定完成（三家公司分流已啟用）");
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 📨 Telegram 到貨通知：確保設定就緒（無則自動初始化）
 */
function _ensureTelegramDelivery_V11() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TG_BRANCH_GROUPS')) {
    props.setProperty('TG_BRANCH_GROUPS', JSON.stringify({
      "高雅瓷": "-5590086103",
      "安帝嘉": "-1004388719757",
      "喜悅納": "-5418269706"
    }));
    return;
  }
  // 若既有 map 有分公司群組為空（舊版預留空字串），自動補上目前設定值
  try {
    var map = JSON.parse(props.getProperty('TG_BRANCH_GROUPS') || "{}");
    var defaults = {
      "高雅瓷": "-5590086103",
      "安帝嘉": "-1004388719757", // V39.22: 群組升級成 supergroup 後 chat_id 改變，舊的 -5567522188 已失效
      "喜悅納": "-5418269706"
    };
    var changed = false;
    for (var key in defaults) {
      if (!map[key]) { map[key] = defaults[key]; changed = true; }
    }
    // V39.22: 安帝嘉群組已從一般群組升級成 supergroup，Telegram 會換發新的 chat_id，
    // 舊 id 對這個群組來說永久失效，不會是「暫時抓不到」，所以就算 map 裡已經有值(非空)也要強制覆蓋成新的
    if (map["安帝嘉"] === "-5567522188") {
      map["安帝嘉"] = "-1004388719757";
      changed = true;
    }
    if (changed) {
      props.setProperty('TG_BRANCH_GROUPS', JSON.stringify(map));
      console.log("✅ Telegram 到貨群組設定已自動補齊");
    }
  } catch (e) {
    console.error("自動補齊 TG 群組設定失敗: " + e.message);
  }
}

/**
 * 📨 Telegram 到貨通知：取得指定分公司的到貨群組 Chat ID
 * @param {string} branch 分公司名稱（如「高雅瓷」）
 * @return {string} Chat ID；未設定回傳空字串
 */
function _getTgGroupIdForBranch_V11(branch) {
  try {
    _ensureTelegramDelivery_V11();
    var props = PropertiesService.getScriptProperties();
    var map = JSON.parse(props.getProperty('TG_BRANCH_GROUPS') || "{}");
    var b = String(branch || "").trim();
    // 直接比對
    if (map[b]) return map[b];
    // 模糊比對：分公司值可能帶其他字樣
    for (var key in map) {
      if (key && b.indexOf(key) !== -1) return map[key];
    }
    return "";
  } catch (e) {
    return "";
  }
}

/**
 * 📨 Telegram 到貨通知：統計指定分公司「今日配送」筆數
 * 今日合計 = 該分公司日期為今天的所有單據；已送達 = 狀態已完成/已送達/結案
 * @param {string} branch 分公司名稱
 * @return {Object} { total, delivered }
 */
function _getBranchTodayStats_V11(branch) {
  var total = 0, delivered = 0;
  try {
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
    if (!sheet) return { total: total, delivered: delivered };
    var data = sheet.getDataRange().getValues();
    var h = data[0].map(function (v) { return String(v).trim(); });
    var idxDate = findHIdx_Core(h, "DATE");
    var idxBranch = findHIdx_Core(h, "BRANCH");
    var idxStatus = findHIdx_Core(h, "STATUS");
    if (idxDate === -1 || idxBranch === -1 || idxStatus === -1) return { total: total, delivered: delivered };

    var todayStr = Utilities.formatDate(new Date(), "GMT+8", "yyyy/MM/dd");
    for (var i = 1; i < data.length; i++) {
      var rowBranch = String(data[i][idxBranch] || "").trim();
      if (!rowBranch || rowBranch.indexOf(branch) === -1) continue;
      var d = data[i][idxDate];
      var dateStr = (d instanceof Date)
        ? Utilities.formatDate(d, "GMT+8", "yyyy/MM/dd")
        : String(d || "").split(' ')[0].trim();
      if (dateStr !== todayStr) continue;
      total++;
      var status = String(data[i][idxStatus] || "").trim();
      if (status === "已完成" || status === "已送達" || status === "結案") delivered++;
    }
  } catch (e) {
    console.error("統計今日配送失敗: " + e.message);
  }
  return { total: total, delivered: delivered };
}

/**
 * 📨 Telegram 到貨通知：推送簽收卡片圖片 + 文字摘要（依分公司分流）
 * @param {Blob} photoBlob 簽收卡片圖檔 (JPEG)
 * @param {string} caption 文字摘要
 * @param {string} branch 分公司名稱（決定發送到哪個群組）
 */
function pushTelegramDeliveryPhoto_V11(photoBlob, caption, branch) {
  try {
    _requireCtx_();
    _ensureTelegramDelivery_V11();
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('TG_TOKEN');
    var chatId = _getTgGroupIdForBranch_V11(branch);
    if (!token || !chatId) { console.log("TG 未設定群組（分公司: " + branch + "），略過"); return false; }

    var formData = {
      'chat_id': chatId,
      'caption': caption,
      'parse_mode': 'HTML'
    };
    var boundary = "----tg" + Date.now();
    var body = [];
    for (var key in formData) {
      body.push("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + key + "\"\r\n\r\n" + formData[key] + "\r\n");
    }
    var bytes = photoBlob.getBytes();
    body.push("--" + boundary + "\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"delivery.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n");
    var prefix = body.join("");
    var suffix = "\r\n--" + boundary + "--\r\n";

    var payload = Utilities.newBlob(prefix).getBytes()
      .concat(bytes)
      .concat(Utilities.newBlob(suffix).getBytes());

    var options = {
      method: 'post',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary },
      payload: payload,
      muteHttpExceptions: true
    };
    var resp = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendPhoto", options);
    var json = JSON.parse(resp.getContentText());
    if (json.ok) { console.log("📨 TG 到貨卡片推送成功"); return true; }
    console.error("TG 推送失敗: " + resp.getContentText());
    return false;
  } catch (e) {
    console.error("TG 推送異常: " + e.message);
    return false;
  }
}

/**
 * 🚀 核心功能：同步「業務配送清單」的司機下拉選單
 * 功用：自動讀取系統白名單，找出該列對應分公司的「業務」與「司機」，套用到下拉選單中！
 */
function syncAllDriverValidationsByBranch() {
  try {
    var ss = getSS_V11();
    var sheetW = ss.getSheetByName("系統白名單");
    var sheetT = ss.getSheetByName("業務配送清單");
    
    if (!sheetW || !sheetT) return;
    
    var wData = sheetW.getDataRange().getValues();
    var wh = wData[0].map(function(v){ return String(v).trim(); });
    var cName = wh.indexOf("姓名"), cRole = wh.indexOf("身分類型"), cBranch = wh.indexOf("所屬分公司"), cActive = wh.indexOf("帳號啟用");
    
    if (cName === -1 || cBranch === -1) return;
    
    var map = {}; 
    for (var i = 1; i < wData.length; i++) {
      if (cActive !== -1 && String(wData[i][cActive]).trim() === "否") continue;
      var role = String(wData[i][cRole] || "").trim();
      if (role.indexOf("業務") === -1 && role.indexOf("司機") === -1) continue;
      
      var branch = String(wData[i][cBranch] || "").trim();
      var name = String(wData[i][cName] || "").trim();
      if (!branch || !name) continue;
      
      if (!map[branch]) map[branch] = [];
      map[branch].push(name);
    }
    
    var tData = sheetT.getDataRange().getValues();
    var th = tData[0].map(function(v){ return String(v).trim(); });
    var idxB = th.indexOf("分公司"), idxD = th.indexOf("派遣司機");
    if (idxB === -1 || idxD === -1) return;
    
    var validArray = [];
    for (var j = 1; j < tData.length; j++) {
      var rowB = String(tData[j][idxB]).trim();
      var list = map[rowB] || [];
      if (list.length > 0) {
        validArray.push([SpreadsheetApp.newDataValidation().requireValueInList(list, true).build()]);
      } else {
        validArray.push([null]);
      }
    }
    
    if (validArray.length > 0) {
      sheetT.getRange(2, idxD + 1, validArray.length, 1).setDataValidations(validArray);
    }
    return "同步完成";
  } catch (err) {
    return "同步失敗: " + err;
  }
}

/** 
 * 防止授權失效的甦醒函式
 * 讓系統每小時自動執行一次，確保「以管理員身份執行」的授權永遠保持新鮮
 */
function keepSystemAlive_V11() {
  try {
    // 隨便讀取一個試算表資料，讓 Google 知道授權仍在使用中
    var ss = SpreadsheetApp.openById(V11_PROD_CONFIG.SS_ID);
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_WHITELIST);
    if (sheet) {
      sheet.getRange(1, 1).getValue();
      console.log("✅ 系統授權已自動甦醒 (每小時自動執行)");
    }
  } catch (e) {
    console.error("❌ 甦醒失敗: " + e.message);
  }
}

/**
 * 查詢指定車牌最近 15 筆里程紀錄 (起始/結束里程、行駛里程與對應工作表列號)
 */
function getMileageHistory_V11(car, yearMonth, token) {
  try {
    _requireDriver_(token);
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_SCHEDULE);
    if (!sheet) return { success: false, msg: "找不到行程表" };
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return { success: true, list: [], months: [], currentMonth: yearMonth || "" };
    var h = data[0].map(function (v) { return String(v).trim(); });

    var findSCol = function (names) { for (var n of names) { var p = h.indexOf(n); if (p !== -1) return p; } return -1; };
    var colDate = findSCol(["日期"]);
    var colCar = findSCol(["車牌", "車牌號碼", "車輛"]);
    var colStartMile = findSCol(["起始里程", "開始里程", "上班里程"]);
    var colEndMile = findSCol(["結束里程", "下班里程"]);
    var colTotal = findSCol(["當日總里程", "總里程", "單日里程", "行駛里程"]);
    var colAmt = findSCol(["加油金額", "油費金額", "油費"]);
    var colLit = findSCol(["加油公升數", "加油公升", "加油量", "公升數"]);

    if (colDate === -1) colDate = 0;
    if (colCar === -1) colCar = 1;

    var normCar = String(car).trim().toUpperCase().replace(/[-\s]/g, "");

    // V39.12: 改為「按月」查詢，不再固定抓最近15筆。
    // 原本固定15筆的問題：加油不是每天發生，最近15筆「里程」紀錄很可能一筆加油都沒有，
    // 加油歷史畫面篩選完就變空清單、看起來像「沒反應」。改按月抓取，該月全部紀錄都會顯示，
    // 同時回傳這台車「有資料的月份清單」，前端可以做月份切換。
    var allRows = [];
    var monthSet = {};
    for (var i = 1; i < data.length; i++) {
      var rowCar = String(data[i][colCar]).trim().toUpperCase().replace(/[-\s]/g, "");
      if (rowCar !== normCar) continue;

      var dateVal = data[i][colDate];
      var formattedDate = "", sortKey = 0, ym = "";
      var dObj = null;
      if (dateVal) {
        if (dateVal instanceof Date) {
          dObj = dateVal;
          formattedDate = Utilities.formatDate(dateVal, "GMT+8", "yyyy/MM/dd");
        } else {
          formattedDate = String(dateVal).split(" ")[0];
          var parsed = new Date(formattedDate.replace(/\//g, "-"));
          if (!isNaN(parsed.getTime())) dObj = parsed;
        }
        if (dObj) {
          sortKey = dObj.getTime();
          ym = Utilities.formatDate(dObj, "GMT+8", "yyyy-MM");
        }
      }
      if (ym) monthSet[ym] = true;

      allRows.push({
        rowNum: i + 1, // 1-indexed sheet row number
        date: formattedDate,
        ym: ym,
        sortKey: sortKey,
        start: colStartMile >= 0 ? String(data[i][colStartMile]).trim() : "",
        end: colEndMile >= 0 ? String(data[i][colEndMile]).trim() : "",
        total: colTotal >= 0 ? String(data[i][colTotal]).trim() : "",
        amount: colAmt >= 0 ? String(data[i][colAmt]).trim() : "",
        litres: colLit >= 0 ? String(data[i][colLit]).trim() : ""
      });
    }

    var months = Object.keys(monthSet).sort().reverse(); // 有資料的月份，新到舊
    // 預設(未指定 yearMonth)：最近一個月 = 有資料的月份中最新的那個；若該車完全沒資料，退回本月
    var targetYm = yearMonth || months[0] || Utilities.formatDate(new Date(), "GMT+8", "yyyy-MM");

    var list = allRows.filter(function (r) { return r.ym === targetYm; });
    list.sort(function (a, b) {
      if (b.sortKey !== a.sortKey) return b.sortKey - a.sortKey;
      return b.rowNum - a.rowNum;
    });
    list.forEach(function (r) { delete r.sortKey; delete r.ym; }); // 排序用欄位不回傳給前端

    return { success: true, list: list, months: months, currentMonth: targetYm };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 修正特定列號的里程紀錄
 * @param {number} rowNum 工作表列號 (1-indexed)
 * @param {string} type 'start' (上班里程) 或 'end' (下班里程)
 * @param {number} newMileage 新的里程數字
 */
function updateMileageRecord_V11(rowNum, type, newMileage, token) {
  try {
    var ctx = _requireDriver_(token);
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_SCHEDULE);
    if (!sheet) return { success: false, msg: "找不到行程表" };
    var h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (v) { return String(v).trim(); });
    
    var findSCol = function (names) { for (var n of names) { var p = h.indexOf(n); if (p !== -1) return p; } return -1; };
    var colStartMile = findSCol(["起始里程", "開始里程", "上班里程"]);
    var colEndMile = findSCol(["結束里程", "下班里程"]);
    var colTotal = findSCol(["當日總里程", "總里程", "單日里程", "行駛里程"]);
    
    var val = Number(newMileage);
    if (isNaN(val) || val <= 0) return { success: false, msg: "請輸入有效的正數里程" };
    if (!_rowBelongsToDriver_(sheet, h, rowNum, ctx)) return { success: false, msg: "🔒 無權修改其他車輛的紀錄" };
    
    var targetCol = -1;
    if (type === 'start') {
      targetCol = colStartMile;
    } else if (type === 'end') {
      targetCol = colEndMile;
    }
    
    if (targetCol < 0) return { success: false, msg: "找不到里程對應欄位" };
    
    // 寫入新里程
    sheet.getRange(rowNum, targetCol + 1).setValue(val);
    
    // 重新計算總里程 (end - start)
    if (colTotal >= 0 && colStartMile >= 0 && colEndMile >= 0) {
      var startKm = Number(sheet.getRange(rowNum, colStartMile + 1).getValue()) || 0;
      var endKm = Number(sheet.getRange(rowNum, colEndMile + 1).getValue()) || 0;
      if (endKm > startKm) {
        sheet.getRange(rowNum, colTotal + 1).setValue(endKm - startKm);
      } else {
        sheet.getRange(rowNum, colTotal + 1).setValue(""); // 清空
      }
    }
    
    // 清除快取
    _clearWarRoomCache_();
    
    return { success: true, msg: "✅ 里程修正成功！" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * 修正特定列號的加油紀錄
 * @param {number} rowNum 工作表列號 (1-indexed)
 * @param {string} type 'amt' (加油金額) 或 'lit' (加油公升數)
 * @param {number} newVal 新的數值
 */
function updateFuelRecord_V11(rowNum, type, newVal, token) {
  try {
    var ctx = _requireDriver_(token);
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_SCHEDULE);
    if (!sheet) return { success: false, msg: "找不到行程表" };
    var h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (v) { return String(v).trim(); });
    
    var findSCol = function (names) { for (var n of names) { var p = h.indexOf(n); if (p !== -1) return p; } return -1; };
    var colAmt = findSCol(["加油金額", "油費金額", "油費"]);
    var colLit = findSCol(["加油公升數", "加油公升", "加油量", "公升數"]);
    
    var val = Number(newVal);
    if (isNaN(val) || val < 0) return { success: false, msg: "請輸入有效的數值" };
    if (!_rowBelongsToDriver_(sheet, h, rowNum, ctx)) return { success: false, msg: "🔒 無權修改其他車輛的紀錄" };
    
    var targetCol = -1;
    if (type === 'amt') {
      targetCol = colAmt;
    } else if (type === 'lit') {
      targetCol = colLit;
    }
    
    if (targetCol < 0) return { success: false, msg: "找不到加油對應欄位" };
    
    sheet.getRange(rowNum, targetCol + 1).setValue(val);
    
    // 清除快取
    _clearWarRoomCache_();
    
    return { success: true, msg: "✅ 加油紀錄修正成功！" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/** V41: 行程表第 rowNum 列的車牌是否為此司機可操作的車 (admin 一律允許) */
function _rowBelongsToDriver_(sheet, h, rowNum, ctx) {
  if (!ctx || ctx.role !== 'driver') return true;
  var r = parseInt(rowNum, 10);
  if (isNaN(r) || r < 2 || r > sheet.getLastRow()) return false;
  var colCar = -1;
  ["車牌", "車牌號碼", "車輛"].forEach(function (n) { if (colCar === -1 && h.indexOf(n) !== -1) colCar = h.indexOf(n); });
  if (colCar === -1) colCar = 1;
  var car = String(sheet.getRange(r, colCar + 1).getValue() || "").trim();
  return _driverMayUseCar_(ctx, car);
}

function formatLastUpdate(timestamp) {
  if (!timestamp) return "";
  try {
    var date;
    if (typeof timestamp === "object" && timestamp instanceof Date) {
      date = timestamp;
    } else if (typeof timestamp === "string") {
      date = new Date(timestamp);
      if (isNaN(date)) {
        var match = timestamp.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
        if (match) return timestamp;
        return "";
      }
    } else {
      return "";
    }
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    var hour = String(date.getHours()).padStart(2, "0");
    var minute = String(date.getMinutes()).padStart(2, "0");
    return month + "/" + day + " " + hour + ":" + minute;
  } catch (e) {
    return "";
  }
}

/**
 * 申訴 API：分公司對某一筆訂單的運費提出申訴
 */
function submitFreightAppeal(taskId, branch, reason, expectedFee, token) {
  var lock = LockService.getScriptLock();
  try {
    _requireAdmin_(token);
    if (!lock.tryLock(15000)) throw new Error("系統忙碌中，請稍後再試。");
    
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
    if (!sheet) throw new Error("找不到派送清單");
    
    var data = sheet.getDataRange().getValues();
    var h = data[0].map(v => String(v).trim());
    var idxId = h.indexOf("單號");
    var idxBr = h.indexOf("分公司");
    var idxStatus = h.indexOf("申訴狀態");
    var idxReason = h.indexOf("申訴理由");
    var idxAdjust = h.indexOf("調整後運費");
    
    if (idxId === -1 || idxStatus === -1 || idxReason === -1) {
      throw new Error("系統欄位不完整，無法申訴。請管理員重新初始化欄位。");
    }
    
    var targetRow = -1;
    for (var i = 1; i < data.length; i++) {
      var rowId = String(data[i][idxId]).trim();
      var rowBr = idxBr !== -1 ? String(data[i][idxBr]).trim() : "";
      if (rowId === String(taskId) && (branch === "全部" || rowBr === branch)) {
        targetRow = i + 1;
        break;
      }
    }
    
    if (targetRow === -1) throw new Error("找不到該筆訂單");
    
    // 寫入申訴資料
    sheet.getRange(targetRow, idxStatus + 1).setValue("申訴中");
    sheet.getRange(targetRow, idxReason + 1).setValue(reason + " (期望金額: $" + expectedFee + ")");
    if (idxAdjust !== -1) {
      sheet.getRange(targetRow, idxAdjust + 1).setValue(""); // 清空舊的調整後金額
    }
    
    // 清除快取
    _clearDashboardCache_();
    
    return { success: true, message: "✅ 申訴已成功提交！" };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 審批 API：管理端同意調整或駁回申訴
 */
function resolveFreightAppeal(taskId, status, replyNote, finalFee, token) {
  var lock = LockService.getScriptLock();
  try {
    _requireAdmin_(token);
    if (!lock.tryLock(15000)) throw new Error("系統忙碌中，請稍後再試。");
    
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
    if (!sheet) throw new Error("找不到派送清單");
    
    var data = sheet.getDataRange().getValues();
    var h = data[0].map(v => String(v).trim());
    var idxId = h.indexOf("單號");
    var idxStatus = h.indexOf("申訴狀態");
    var idxReply = h.indexOf("申訴處理說明");
    var idxAdjust = h.indexOf("調整後運費");
    
    if (idxId === -1 || idxStatus === -1 || idxReply === -1 || idxAdjust === -1) {
      throw new Error("系統欄位不完整");
    }
    
    var targetRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idxId]).trim() === String(taskId)) {
        targetRow = i + 1;
        break;
      }
    }
    
    if (targetRow === -1) throw new Error("找不到該筆訂單");
    
    sheet.getRange(targetRow, idxStatus + 1).setValue(status); // "已調整" 或 "已駁回"
    sheet.getRange(targetRow, idxReply + 1).setValue(replyNote);
    if (status === "已調整") {
      sheet.getRange(targetRow, idxAdjust + 1).setValue(parseFloat(finalFee) || 0);
    } else {
      sheet.getRange(targetRow, idxAdjust + 1).setValue(""); // 駁回則無調整金額
    }
    
    _clearDashboardCache_();
    return { success: true, message: "✅ 申訴案件已處理完成！" };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * V39.23: 對帳頁面直接手動調整核定運費 (不經過申訴流程，供內部管理端直接改)
 * @param {string} taskId 單號
 * @param {string} branch 分公司 (可傳空字串，僅比對單號)
 * @param {number} newFee 新的核定運費金額
 */
function manualAdjustFreight_V11(taskId, branch, newFee, token) {
  var lock = LockService.getScriptLock();
  try {
    _requireAdmin_(token);
    if (!lock.tryLock(15000)) throw new Error("系統忙碌中，請稍後再試。");

    var feeVal = parseFloat(newFee);
    if (isNaN(feeVal) || feeVal < 0) throw new Error("請輸入有效的運費金額");

    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
    if (!sheet) throw new Error("找不到派送清單");

    var data = sheet.getDataRange().getValues();
    var h = data[0].map(function (v) { return String(v).trim(); });
    var idxId = h.indexOf("單號");
    var idxBr = h.indexOf("分公司");
    var idxAdjust = h.indexOf("調整後運費");
    if (idxId === -1 || idxAdjust === -1) throw new Error("系統欄位不完整");

    var targetRow = -1;
    for (var i = 1; i < data.length; i++) {
      var rowId = String(data[i][idxId]).trim();
      var rowBr = idxBr !== -1 ? String(data[i][idxBr]).trim() : "";
      if (rowId === String(taskId) && (!branch || rowBr === branch)) {
        targetRow = i + 1;
        break;
      }
    }
    if (targetRow === -1) throw new Error("找不到該筆訂單 [" + taskId + "]");

    sheet.getRange(targetRow, idxAdjust + 1).setValue(feeVal);
    _clearDashboardCache_();
    return { success: true, message: "✅ 運費已調整為 $" + feeVal, newFee: feeVal };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// V41.13: 運費設定 (分析中心「運費統計 → 設定」用)
// 直接讀寫「運費管理表」，格式與 setupFreightRateSheet_V11 一致：
//   A-B 重量上限(KG)/基礎運費、D-E 偏遠地區關鍵字/加乘倍率、G-H 附加項目/費率
// ==========================================
function getFreightSettings_V41(token) {
  _requireAdmin_(token);
  try {
    var r = FreightEngine.loadRates();
    if (!r) return { success: false, error: "找不到運費管理表，請先執行 setupFreightRateSheet_V11" };
    return {
      success: true,
      weightSlabs: r.weightSlabs,                       // [{maxKg, fee}]
      remoteAreas: r.remoteAreas.map(function (a) { return { keywords: a.keywords.join(", "), multiplier: a.multiplier }; }),
      addonFees: Object.keys(r.addonFees).map(function (k) { return { item: k, rate: r.addonFees[k] }; })
    };
  } catch (e) { return { success: false, error: e.message }; }
}

function saveFreightSettings_V41(cfg, token) {
  _requireAdmin_(token);
  var lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(15000)) throw new Error("系統忙碌中，請稍後再試");
    if (!cfg) throw new Error("缺少設定內容");
    var slabs = (cfg.weightSlabs || []).map(function (s) { return [parseFloat(s.maxKg), parseFloat(s.fee)]; })
      .filter(function (s) { return !isNaN(s[0]) && !isNaN(s[1]) && s[0] > 0; })
      .sort(function (a, b) { return a[0] - b[0]; });
    var remotes = (cfg.remoteAreas || []).map(function (a) { return [String(a.keywords || "").trim(), parseFloat(a.multiplier)]; })
      .filter(function (a) { return a[0] && !isNaN(a[1]) && a[1] > 0; });
    var addons = (cfg.addonFees || []).map(function (a) { return [String(a.item || "").trim(), parseFloat(a.rate)]; })
      .filter(function (a) { return a[0] && !isNaN(a[1]); });
    if (!slabs.length) throw new Error("至少要有一個重量級距");

    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_FREIGHT) || ss.insertSheet(V11_PROD_CONFIG.SHEET_FREIGHT);
    // 備份舊設定到「運費管理表_歷史」
    try {
      var hist = ss.getSheetByName(V11_PROD_CONFIG.SHEET_FREIGHT + "_歷史") || ss.insertSheet(V11_PROD_CONFIG.SHEET_FREIGHT + "_歷史");
      var oldVals = sheet.getDataRange().getValues();
      if (oldVals.length) {
        hist.appendRow(["=== " + Utilities.formatDate(new Date(), "GMT+8", "yyyy/MM/dd HH:mm") + " 變更前 ==="]);
        hist.getRange(hist.getLastRow() + 1, 1, oldVals.length, oldVals[0].length).setValues(oldVals);
      }
    } catch (hErr) { console.log("運費設定歷史備份失敗: " + hErr.message); }

    sheet.clear();
    var rows = Math.max(slabs.length, remotes.length, addons.length) + 1;
    var grid = [];
    for (var i = 0; i < rows; i++) grid.push(["", "", "", "", "", "", "", ""]);
    grid[0] = ["重量上限(KG)", "基礎運費", "", "偏遠地區關鍵字", "加乘倍率", "", "附加項目", "費率/單價"];
    slabs.forEach(function (s, i) { grid[i + 1][0] = s[0]; grid[i + 1][1] = s[1]; });
    remotes.forEach(function (a, i) { grid[i + 1][3] = a[0]; grid[i + 1][4] = a[1]; });
    addons.forEach(function (a, i) { grid[i + 1][6] = a[0]; grid[i + 1][7] = a[1]; });
    sheet.getRange(1, 1, grid.length, 8).setValues(grid);
    sheet.getRange("A1:B1").setBackground("#34495e").setFontColor("#ffffff").setFontWeight("bold");
    sheet.getRange("D1:E1").setBackground("#27ae60").setFontColor("#ffffff").setFontWeight("bold");
    sheet.getRange("G1:H1").setBackground("#d35400").setFontColor("#ffffff").setFontWeight("bold");
    FreightEngine._cachedRates = null;
    _clearDashboardCache_();
    return { success: true, message: "✅ 運費設定已儲存 (舊設定已備份至「運費管理表_歷史」)" };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    try { lock.releaseLock(); } catch (e2) { }
  }
}


/**
 * V41.34: 人工改判單據類型 (分析中心明細面板用)。寫入派送清單「單據類型(人工)」欄，規則判定會被覆蓋。
 * docType: '樣品' | '銷貨' | '' (清除人工判定，回到規則)
 */
function setDocTypeOverride_V41(taskId, branch, docType, token) {
  _requireAdmin_(token);
  var lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(15000)) throw new Error("系統忙碌中，請稍後再試");
    var val = String(docType || "").trim();
    if (["樣品", "樣品收費", "樣品免費", "銷貨", "退貨", ""].indexOf(val) === -1) throw new Error("不支援的類型: " + val);
    var ss = getSS_V11();
    var targets = [V11_PROD_CONFIG.SHEET_TASKS, V11_PROD_CONFIG.SHEET_TASKS + "_封存區"];
    for (var s = 0; s < targets.length; s++) {
      var sheet = ss.getSheetByName(targets[s]);
      if (!sheet) continue;
      var data = sheet.getDataRange().getValues();
      var h = data[0].map(function (v) { return String(v).trim(); });
      var idxId = h.indexOf("單號"), idxBr = h.indexOf("分公司"), idxT = h.indexOf("單據類型(人工)");
      if (idxId === -1) continue;
      if (idxT === -1) { idxT = h.length; sheet.getRange(1, idxT + 1).setValue("單據類型(人工)"); }
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][idxId]).trim() !== String(taskId).trim()) continue;
        if (branch && idxBr !== -1 && String(data[i][idxBr]).trim() !== String(branch).trim()) continue;
        sheet.getRange(i + 1, idxT + 1).setValue(val);
        _clearDashboardCache_();
        _clearWarRoomCache_();
        return { success: true, message: "✅ " + taskId + " 已改為「" + (val || "依規則判定") + "」" };
      }
    }
    return { success: false, error: "找不到單號 " + taskId };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    try { lock.releaseLock(); } catch (e2) { }
  }
}
