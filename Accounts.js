/**
 * V43.0 / V43.9 帳號系統：Google 或 LINE 登入 + 帳號申請 + 主管在 Telegram 按鈕審核
 *
 * 流程
 *  1. bigt.cc 外殼頁放登入按鈕 (Google Identity Services / LINE LIFF)，取得 Google 或 LINE 簽發的身分證明 (ID token)，
 *     用 postMessage 交給 iframe 裡的系統頁面，再送到這裡驗證 (loginWithGoogle_V43 / loginWithLine_V43)。
 *  2. 在「系統白名單」找得到 (Google 比 Email 欄、LINE 比「line id」欄) 且帳號啟用 → 依「身分類型」發登入憑證
 *     (主管/行政=管理端、業務=後台唯讀、司機、倉管)。
 *     找不到 → 填申請 (applyAccount_V43) → 寫進「帳號申請」分頁 → 發「高雅瓷私密專區」Telegram 群組，附「核准／拒絕」網址按鈕。
 *  3. 按鈕網址帶 HMAC 簽章 (防竄改)，打開 bigt.cc/tts/approve.html；群組裡人人看得到按鈕，
 *     所以真正的權限檢查是「按的人要登入，而且是白名單裡的主管」(decideAccount_V43)。
 *     核准時白名單若已有同名的人，就把這次的 Email / LINE ID 補進那一列，不另外建重複帳號。
 *  4. 停用 / 改身分：直接改白名單。每次操作都會比對白名單 (快取 60 秒)，所以停用後 1 分鐘內所有裝置失效。
 *
 * 不對 Telegram 機器人設 webhook (保留系統、elitile 也共用 @Titankou2002_bot)，按鈕一律用網址按鈕。
 * LINE 用「高雅瓷line機器人」這個 LINE Login 頻道 (與收集白名單 LINE ID 的機器人同一個提供者，ID 才對得上)。
 */

var GOOGLE_LOGIN_CLIENT_ID = '488092523611-2012hnf14cch4s7p6sl3dp37dvihjsdm.apps.googleusercontent.com';
var LINE_LOGIN_CHANNEL_ID = '2007666611';
var ACCOUNT_REQ_SHEET = '帳號申請';
var ACCOUNT_REQ_HEADERS = ['申請ID', '申請時間', 'Email', 'LINE ID', 'Google名稱', '姓名', '申請身分', '分公司', '電話', '備註', '狀態', '審核人', '審核時間', '通知群組', '通知訊息ID'];
var ACCOUNT_TITLES = ['主管', '行政', '業務', '司機', '倉管'];
var ACCOUNT_BRANCHES = ['高雅瓷', '安帝嘉', '喜悅納', '漢樺', '鈦傳速'];
// V43.30: 所有帳號申請／帳號異動一律發「高雅瓷私密專區」(= 高雅瓷分公司群組)，不再依分公司分流，
// 老闆沒空時群組裡其他主管也能按核准；群組 ID 抓不到時才退回私訊高弘治
var ACCOUNT_NOTIFY_BRANCH = '高雅瓷';
var ACCOUNT_FALLBACK_CHAT = '1094832646';
var APPROVE_PAGE_URL = 'https://bigt.cc/tts/approve.html';
var ACCOUNT_TTL_SEC = { admin: 30 * 86400, viewer: 30 * 86400, driver: 90 * 86400, warehouse: 30 * 86400 };
var __AUDIT_WHO__ = '';

/** 身分類型 → 系統角色 */
function _roleForTitle_(title) {
  var t = String(title || '').trim();
  if (t === '主管' || t === '行政') return 'admin';
  if (t === '業務') return 'viewer';
  if (t === '司機') return 'driver';
  if (t === '倉管') return 'warehouse';
  return '';
}

// ───────── 身分證明驗證 ─────────
/** Google：簽章、對象、有效期都由 Google tokeninfo 端點檢查 */
function _verifyGoogleIdToken_(idToken) {
  if (!idToken || typeof idToken !== 'string' || idToken.length > 6000 || idToken.split('.').length !== 3) throw new Error('Google 登入資料無效，請重新登入');
  var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('Google 登入驗證失敗，請重新登入');
  var p = JSON.parse(resp.getContentText());
  if (p.aud !== GOOGLE_LOGIN_CLIENT_ID) throw new Error('Google 登入來源不符');
  if (['accounts.google.com', 'https://accounts.google.com'].indexOf(p.iss) === -1) throw new Error('Google 登入來源不符');
  if (String(p.email_verified) !== 'true') throw new Error('這個 Google 帳號的 Email 尚未驗證');
  if (!p.exp || Number(p.exp) * 1000 < Date.now()) throw new Error('Google 登入已過期，請重新登入');
  var email = String(p.email || '').trim().toLowerCase();
  if (!email) throw new Error('取不到 Google 帳號的 Email');
  __AUDIT_WHO__ = email;
  return { provider: 'google', key: email, email: email, lineId: '', name: String(p.name || ''), label: email };
}

/** LINE：交給 LINE 的 verify 端點檢查簽章與有效期，並確認是發給我們這個頻道的 */
function _verifyLineIdToken_(idToken) {
  if (!idToken || typeof idToken !== 'string' || idToken.length > 6000 || idToken.split('.').length !== 3) throw new Error('LINE 登入資料無效，請重新登入');
  var resp = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post', payload: { id_token: idToken, client_id: LINE_LOGIN_CHANNEL_ID }, muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) throw new Error('LINE 登入驗證失敗，請重新登入');
  var p = JSON.parse(resp.getContentText());
  if (String(p.aud) !== LINE_LOGIN_CHANNEL_ID || p.iss !== 'https://access.line.me') throw new Error('LINE 登入來源不符');
  if (!p.exp || Number(p.exp) * 1000 < Date.now()) throw new Error('LINE 登入已過期，請重新登入');
  var sub = String(p.sub || '').trim();
  if (!sub) throw new Error('取不到 LINE 帳號');
  var name = String(p.name || '');
  __AUDIT_WHO__ = 'LINE 暱稱「' + (name || sub) + '」';
  return { provider: 'line', key: 'line:' + sub, email: '', lineId: sub, name: name, label: 'LINE 暱稱「' + (name || sub) + '」' };
}

function _verifyIdentity_(idToken, provider) {
  return provider === 'line' ? _verifyLineIdToken_(idToken) : _verifyGoogleIdToken_(idToken);
}

// ───────── 白名單 ─────────
function _whitelistTable_() {
  var sheet = getSS_V11().getSheetByName(V11_PROD_CONFIG.SHEET_WHITELIST);
  if (!sheet) throw new Error('找不到「系統白名單」分頁');
  var data = sheet.getDataRange().getValues();
  var h = data[0].map(function (v) { return String(v).trim(); });
  var col = function (names) { for (var i = 0; i < names.length; i++) { var k = h.indexOf(names[i]); if (k !== -1) return k; } return -1; };
  var lineCol = -1;
  h.forEach(function (x, i) { if (lineCol === -1 && /^line\s*_?\s*id$/i.test(x)) lineCol = i; });
  return {
    sheet: sheet, data: data, h: h,
    c: {
      active: col(['帳號啟用']), email: col(['Email帳號', 'Email', '電郵']), name: col(['姓名']), line: lineCol,
      title: col(['身分類型']), branch: col(['所屬分公司', '分公司']), car: col(['預設車牌', '車牌']),
      switchCar: col(['是否可切換車輛']), phone: col(['手機號碼', '電話']), created: col(['建立日期']), note: col(['備註'])
    }
  };
}

function _rowToAccount_(t, r, rowIdx) {
  var g = function (k) { return t.c[k] === -1 ? '' : String(r[t.c[k]] == null ? '' : r[t.c[k]]).trim(); };
  return { row: rowIdx + 1, email: g('email').toLowerCase(), lineId: g('line'), name: g('name'), title: g('title'), branch: g('branch'), car: g('car'), active: g('active') !== '否', phone: g('phone') };
}

function _accountKeys_(a) {
  var keys = [];
  if (a.email) keys.push(a.email);
  if (a.lineId) keys.push('line:' + a.lineId);
  return keys;
}

/** 用登入身分 (Email 或 LINE ID) 找白名單；同一個身分出現在多列就回報重複 */
function _lookupWhitelistByIdentity_(ident) {
  var t = _whitelistTable_();
  var hits = [];
  for (var i = 1; i < t.data.length; i++) {
    var a = _rowToAccount_(t, t.data[i], i);
    if (_accountKeys_(a).indexOf(ident.key) !== -1) hits.push(a);
  }
  if (hits.length > 1) return { dup: true, names: hits.map(function (x) { return x.name; }) };
  return hits[0] || null;
}
function _lookupWhitelistByEmail_(email) { return _lookupWhitelistByIdentity_({ key: String(email || '').toLowerCase() }); }

/** 每次操作都要比對的「帳號目前狀態」，身分 (email / line:ID) → {active, title}；快取 60 秒 (停用後最慢 1 分鐘生效) */
function _accountStatusMap_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('acct_status_v2');
  if (hit) { try { return JSON.parse(hit); } catch (e) { } }
  var t = _whitelistTable_(), map = {};
  for (var i = 1; i < t.data.length; i++) {
    var a = _rowToAccount_(t, t.data[i], i);
    _accountKeys_(a).forEach(function (k) {
      map[k] = map[k] ? { active: false, title: '', dup: true } : { active: a.active, title: a.title }; // 重複身分一律擋
    });
  }
  try { cache.put('acct_status_v2', JSON.stringify(map), 60); } catch (e) { }
  return map;
}
function _clearAccountStatusCache_() {
  try { CacheService.getScriptCache().removeAll(['acct_status_v1', 'acct_status_v2', 'deactivated_drivers_v1']); } catch (e) { }
}

/** 個人登入 (Google / LINE) 發的憑證 */
function _isPersonalToken_(ctx) { return !!ctx && ((ctx.via === 'google' && ctx.email) || (ctx.via === 'line' && ctx.lineId)); }

/** 給 _requireAuth_ 用：個人登入的憑證，每次都要確認帳號沒被停用、身分沒被改掉 */
function _checkGoogleAccountStillValid_(ctx) {
  var key = ctx.via === 'line' ? 'line:' + ctx.lineId : String(ctx.email).toLowerCase();
  var st = _accountStatusMap_()[key];
  if (!st || !st.active) throw new Error('🔒 AUTH_REQUIRED：此帳號已停用，請聯繫主管');
  if (_roleForTitle_(st.title) !== ctx.role || st.title !== ctx.title) throw new Error('🔒 AUTH_REQUIRED：你的權限已變更，請重新登入');
}

// ───────── 登入 ─────────
function _loginWithIdentity_(ident) {
  var w = _lookupWhitelistByIdentity_(ident);
  if (w && w.dup) return { status: 'error', message: '這個帳號在白名單出現多次（' + w.names.join('、') + '），請主管修正後再登入' };
  if (w) {
    if (!w.active) return { status: 'disabled', label: ident.label, message: '你的帳號已停用，請聯繫主管' };
    var role = _roleForTitle_(w.title);
    if (!role) return { status: 'error', label: ident.label, message: '你的帳號還沒設定身分類型，請聯繫主管' };
    var ttl = ACCOUNT_TTL_SEC[role] || 30 * 86400;
    var loginAt = Date.now();
    var payload = { role: role, name: w.name, title: w.title, branch: w.branch, car: w.car, via: ident.provider, lt: loginAt };
    if (ident.email) payload.email = ident.email;
    if (ident.lineId) payload.lineId = ident.lineId;
    var token = _issueToken_(payload, ttl);
    __AUTH_CTX__ = { role: role, name: w.name, email: ident.email, lineId: ident.lineId, title: w.title, branch: w.branch };
    return { status: 'ok', token: token, role: role, title: w.title, name: w.name, branch: w.branch, car: w.car, email: ident.email, via: ident.provider, loginAt: loginAt, expiresAt: Date.now() + ttl * 1000 };
  }
  var req = _findLatestRequest_(ident.key);
  if (req && req.status === '待審核') return { status: 'pending', email: ident.label, name: req.name, submittedAt: req.time };
  return { status: 'need_apply', email: ident.label, googleName: ident.name, rejected: !!(req && req.status === '已拒絕') };
}

function loginWithGoogle_V43_impl_(idToken, app) {
  try { return _loginWithIdentity_(_verifyGoogleIdToken_(idToken)); } catch (e) { return { status: 'error', message: e.message }; }
}
function loginWithLine_V43_impl_(idToken, app) {
  try { return _loginWithIdentity_(_verifyLineIdToken_(idToken)); } catch (e) { return { status: 'error', message: e.message }; }
}

// ───────── 申請 ─────────
function _accountReqSheet_() {
  var ss = getSS_V11();
  var sh = ss.getSheetByName(ACCOUNT_REQ_SHEET);
  if (!sh) {
    sh = ss.insertSheet(ACCOUNT_REQ_SHEET);
    sh.getRange(1, 1, 1, ACCOUNT_REQ_HEADERS.length).setValues([ACCOUNT_REQ_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var h = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v).trim(); });
  while (h.length && !h[h.length - 1]) h.pop();
  var missing = ACCOUNT_REQ_HEADERS.filter(function (x) { return h.indexOf(x) === -1; });
  if (missing.length) { sh.getRange(1, h.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold'); h = h.concat(missing); }
  return { sheet: sh, h: h };
}

function _readRequests_() {
  var t = _accountReqSheet_();
  var last = t.sheet.getLastRow();
  var rows = last < 2 ? [] : t.sheet.getRange(2, 1, last - 1, t.h.length).getValues();
  return rows.map(function (r, i) {
    var o = {};
    t.h.forEach(function (k, j) { o[k] = r[j]; });
    var email = String(o['Email'] || '').toLowerCase(), lineId = String(o['LINE ID'] || '').trim();
    return {
      row: i + 2, id: String(o['申請ID'] || ''), time: o['申請時間'] instanceof Date ? Utilities.formatDate(o['申請時間'], 'GMT+8', 'yyyy/MM/dd HH:mm') : String(o['申請時間'] || ''),
      email: email, lineId: lineId, key: email || (lineId ? 'line:' + lineId : ''),
      label: email || ('LINE 暱稱「' + (String(o['Google名稱'] || '') || lineId) + '」'),
      googleName: String(o['Google名稱'] || ''), name: String(o['姓名'] || ''),
      title: String(o['申請身分'] || ''), branch: String(o['分公司'] || ''), phone: String(o['電話'] || ''), note: String(o['備註'] || ''),
      status: String(o['狀態'] || ''), reviewer: String(o['審核人'] || ''), chat: String(o['通知群組'] || ''), msgId: String(o['通知訊息ID'] || '')
    };
  });
}
function _findLatestRequest_(key) {
  var list = _readRequests_().filter(function (r) { return r.key && r.key === key; });
  return list.length ? list[list.length - 1] : null;
}
function _setRequestFields_(row, fields) {
  var t = _accountReqSheet_();
  Object.keys(fields).forEach(function (k) {
    var c = t.h.indexOf(k);
    if (c !== -1) t.sheet.getRange(row, c + 1).setValue(fields[k]);
  });
}

function applyAccount_V43_impl_(idToken, form, provider) {
  var lock = LockService.getScriptLock();
  try {
    var ident = _verifyIdentity_(idToken, provider);
    form = form || {};
    var clean = function (v, n) { var s = String(v == null ? '' : v).replace(/[\r\n\t]/g, ' ').trim(); if (/^[=+\-@]/.test(s)) s = "'" + s; return s.slice(0, n); };
    var name = clean(form.name, 20), title = clean(form.title, 10), branch = clean(form.branch, 10), phone = clean(form.phone, 20), note = clean(form.note, 100);
    if (!name) return { status: 'error', message: '請填寫姓名' };
    if (ACCOUNT_TITLES.indexOf(title) === -1) return { status: 'error', message: '請選擇職位' };
    if (ACCOUNT_BRANCHES.indexOf(branch) === -1) return { status: 'error', message: '請選擇分公司' };
    var w = _lookupWhitelistByIdentity_(ident);
    if (w && !w.dup) return { status: 'error', message: '這個帳號已經在白名單裡，直接登入即可' };
    if (!lock.tryLock(15000)) return { status: 'error', message: '系統忙碌中，請稍後再試' };
    var prev = _findLatestRequest_(ident.key);
    if (prev && prev.status === '待審核') return { status: 'pending', email: ident.label, name: prev.name, submittedAt: prev.time };

    var now = new Date();
    var id = 'R' + Utilities.formatDate(now, 'GMT+8', 'yyyyMMddHHmmss') + Math.floor(Math.random() * 900 + 100);
    var t = _accountReqSheet_();
    var vals = { '申請ID': id, '申請時間': Utilities.formatDate(now, 'GMT+8', 'yyyy/MM/dd HH:mm:ss'), 'Email': ident.email, 'LINE ID': ident.lineId, 'Google名稱': clean(ident.name, 40), '姓名': name, '申請身分': title, '分公司': branch, '電話': phone, '備註': note, '狀態': '待審核' };
    t.sheet.appendRow(t.h.map(function (k) { return vals.hasOwnProperty(k) ? vals[k] : ''; }));
    var row = t.sheet.getLastRow();
    lock.releaseLock();

    var sent = _notifyAccountRequest_({ id: id, label: ident.label, name: name, title: title, branch: branch, phone: phone, note: note, time: vals['申請時間'] });
    if (sent) _setRequestFields_(row, { '通知群組': sent.chat, '通知訊息ID': sent.messageId });
    return { status: 'pending', email: ident.label, name: name, submittedAt: vals['申請時間'], notified: !!sent };
  } catch (e) {
    return { status: 'error', message: e.message };
  } finally {
    try { lock.releaseLock(); } catch (e2) { }
  }
}

// ───────── Telegram 通知 (網址按鈕，不設 webhook) ─────────
function _accountLinkSecret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('ACCOUNT_LINK_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('ACCOUNT_LINK_SECRET', s); }
  return s;
}
function _signApproveLink_(id, action) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(id + '|' + action, _accountLinkSecret_())).replace(/=+$/, '');
}
function _checkApproveLink_(id, action, sig) {
  if (!id || ['approve', 'reject'].indexOf(action) === -1 || !sig) return false;
  return _safeEqual_(_signApproveLink_(id, action), String(sig));
}
function _approveUrl_(id, action) {
  return APPROVE_PAGE_URL + '?r=' + encodeURIComponent(id) + '&a=' + action + '&s=' + encodeURIComponent(_signApproveLink_(id, action));
}
function _tgEsc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function _tgCall_(method, payload) {
  var token = PropertiesService.getScriptProperties().getProperty('TG_TOKEN');
  if (!token) return null;
  var resp = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  try { return JSON.parse(resp.getContentText()); } catch (e) { return null; }
}

function _notifyAccountRequest_(r) {
  try {
    var chat = _accountNotifyChat_();
    var text = '🆕 <b>帳號申請</b>\n'
      + '姓名：' + _tgEsc_(r.name) + '（本人填寫）\n'
      + '申請身分：' + _tgEsc_(r.title) + '\n'
      + '分公司：' + _tgEsc_(r.branch) + '\n'
      + '登入帳號：' + _tgEsc_(r.label) + '\n'
      + (r.phone ? '電話：' + _tgEsc_(r.phone) + '\n' : '')
      + (r.note ? '備註：' + _tgEsc_(r.note) + '\n' : '')
      + '申請時間：' + _tgEsc_(r.time) + '\n\n'
      + '請<b>主管</b>按下方按鈕審核（會請你登入確認身分，非主管按了無效）';
    var res = _tgCall_('sendMessage', {
      chat_id: chat, text: text, parse_mode: 'HTML', disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: '✅ 核准', url: _approveUrl_(r.id, 'approve') }, { text: '❌ 拒絕', url: _approveUrl_(r.id, 'reject') }]] }
    });
    if (res && res.ok) return { chat: String(chat), messageId: String(res.result.message_id) };
    console.error('帳號申請 TG 通知失敗：' + JSON.stringify(res));
    return null;
  } catch (e) { console.error('帳號申請 TG 通知異常：' + e.message); return null; }
}

function _tgMarkDecided_(req, text) {
  if (!req.chat || !req.msgId) return;
  _tgCall_('editMessageText', { chat_id: req.chat, message_id: Number(req.msgId), text: text, parse_mode: 'HTML', disable_web_page_preview: true });
}

/** 群組通知：停用、核准等帳號異動 (純文字，不附按鈕) */
function _accountNotifyChat_() { return _getTgGroupIdForBranch_V11(ACCOUNT_NOTIFY_BRANCH) || ACCOUNT_FALLBACK_CHAT; }

function _notifyAccountEvent_(branch, text) {
  try { _tgCall_('sendMessage', { chat_id: _accountNotifyChat_(), text: text, parse_mode: 'HTML' }); } catch (e) { }
}

// ───────── 審核 (approve.html → iframe ?p=approve) ─────────
/** doGet 渲染審核頁時用：驗證網址簽章後回傳申請內容 (網址本身就是 Telegram 群組看得到的資訊) */
function _approvePageInfo_(p) {
  var id = String(p.r || ''), action = String(p.a || ''), sig = String(p.s || '');
  if (!_checkApproveLink_(id, action, sig)) return { valid: false, message: '這個審核連結無效或已被修改' };
  var req = _readRequests_().filter(function (x) { return x.id === id; })[0];
  if (!req) return { valid: false, message: '找不到這筆申請' };
  return { valid: true, id: id, action: action, sig: sig, name: req.name, title: req.title, branch: req.branch, email: req.label, phone: req.phone, note: req.note, time: req.time, status: req.status, reviewer: req.reviewer };
}

function decideAccount_V43_impl_(id, action, sig, idToken, provider) {
  var lock = LockService.getScriptLock();
  try {
    if (!_checkApproveLink_(id, action, sig)) return { success: false, message: '這個審核連結無效或已被修改' };
    var ident = _verifyIdentity_(idToken, provider);
    var me = _lookupWhitelistByIdentity_(ident);
    if (!me || me.dup || !me.active || me.title !== '主管') {
      __AUTH_CTX__ = null;
      return { success: false, message: '只有白名單裡的「主管」可以審核帳號申請（你目前登入的是 ' + ident.label + '）' };
    }
    __AUTH_CTX__ = { role: 'admin', name: me.name, email: ident.email, lineId: ident.lineId, title: me.title, branch: me.branch };
    if (!lock.tryLock(15000)) return { success: false, message: '系統忙碌中，請稍後再試' };

    var req = _readRequests_().filter(function (x) { return x.id === id; })[0];
    if (!req) return { success: false, message: '找不到這筆申請' };
    if (req.status !== '待審核') return { success: false, message: '這筆申請已經處理過了（' + req.status + (req.reviewer ? '，' + req.reviewer : '') + '）' };
    var nowStr = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd HH:mm:ss');

    if (action === 'approve') {
      if (_lookupWhitelistByIdentity_({ key: req.key })) return { success: false, message: '這個帳號已經在白名單裡了' };
      var t = _whitelistTable_();
      if (req.lineId && t.c.line === -1) return { success: false, message: '白名單沒有「line id」欄位，無法登記 LINE 帳號' };
      // 白名單已有同名的人 (例如司機原本就在白名單、只是還沒有 LINE ID) → 把身分補進那一列，不建重複帳號
      var same = null;
      for (var i = 1; i < t.data.length; i++) {
        var a = _rowToAccount_(t, t.data[i], i);
        if (a.name && a.name === String(req.name).replace(/^'/, '').trim() && !(req.email ? a.email : a.lineId)) { same = a; break; }
      }
      var merged = false;
      if (same) {
        if (req.email && t.c.email !== -1) t.sheet.getRange(same.row, t.c.email + 1).setValue(req.email);
        if (req.lineId && t.c.line !== -1) t.sheet.getRange(same.row, t.c.line + 1).setValue(req.lineId);
        merged = true;
      } else {
        var row = new Array(t.h.length).fill('');
        var put = function (k, v) { if (t.c[k] !== -1) row[t.c[k]] = v; };
        put('active', '是'); put('email', req.email); put('line', req.lineId); put('name', req.name); put('title', req.title); put('branch', req.branch);
        put('switchCar', req.title === '司機' ? '是' : ''); put('phone', req.phone);
        put('created', Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd'));
        put('note', '帳號申請核准（' + me.name + '）');
        t.sheet.appendRow(row);
      }
      _setRequestFields_(req.row, { '狀態': merged ? '已核准（綁定既有帳號）' : '已核准', '審核人': me.name, '審核時間': nowStr });
      _clearAccountStatusCache_();
      _tgMarkDecided_(req, '✅ <b>帳號申請已核准</b>' + (merged ? '（綁定到白名單既有的「' + _tgEsc_(same.name) + '」）' : '') + '\n'
        + _tgEsc_(req.name) + '（' + _tgEsc_(merged ? same.title : req.title) + '／' + _tgEsc_(merged ? same.branch : req.branch) + '）\n' + _tgEsc_(req.label) + '\n審核：' + _tgEsc_(me.name) + '　' + nowStr);
      return { success: true, message: merged
        ? '已核准，並綁定到白名單既有的「' + same.name + '」（沿用原本的身分類型：' + same.title + '），對方重新整理頁面就能登入'
        : '已核准 ' + req.name + '（' + req.title + '），對方重新整理頁面就能登入', name: req.name };
    }
    _setRequestFields_(req.row, { '狀態': '已拒絕', '審核人': me.name, '審核時間': nowStr });
    _tgMarkDecided_(req, '❌ <b>帳號申請已拒絕</b>\n' + _tgEsc_(req.name) + '（' + _tgEsc_(req.title) + '／' + _tgEsc_(req.branch) + '）\n' + _tgEsc_(req.label) + '\n審核：' + _tgEsc_(me.name) + '　' + nowStr);
    return { success: true, message: '已拒絕 ' + req.name + ' 的申請', name: req.name };
  } catch (e) {
    return { success: false, message: e.message };
  } finally {
    try { lock.releaseLock(); } catch (e2) { }
  }
}

// ───────── V43.17 版面記錄神器共用帳號 ─────────
/**
 * 版面記錄神器 (另一個 GAS 專案) 不另外管帳號：登入時把 LINE / Google 身分證明 POST 到這裡 (doPost ?ait=1)，
 * 由這裡驗證並查「系統白名單」，只回傳這個人自己的姓名／身分／分公司；新人申請也轉到這裡，走同一套 Telegram 審核。
 */
function _aitExternal_(body) {
  body = body || {};
  var provider = body.provider === 'line' ? 'line' : 'google';
  var idToken = String(body.idToken || '');
  if (body.op === 'login') {
    var ident = _verifyIdentity_(idToken, provider);
    var w = _lookupWhitelistByIdentity_(ident);
    if (w && w.dup) return { status: 'error', message: '這個帳號在白名單出現多次（' + w.names.join('、') + '），請主管修正後再登入' };
    if (w) {
      if (!w.active) return { status: 'disabled', message: '你的帳號已停用，請聯繫主管' };
      return { status: 'ok', name: w.name, title: w.title, branch: w.branch, email: ident.email, lineId: ident.lineId, via: ident.provider, label: ident.label };
    }
    var req = _findLatestRequest_(ident.key);
    if (req && req.status === '待審核') return { status: 'pending', email: ident.label, name: req.name, submittedAt: req.time };
    return { status: 'need_apply', email: ident.label, googleName: ident.name, rejected: !!(req && req.status === '已拒絕') };
  }
  if (body.op === 'apply') {
    var form = body.form || {};
    form.note = ('（版面神器）' + String(form.note || '')).slice(0, 100);
    return applyAccount_V43(idToken, form, provider);
  }
  return { status: 'error', message: '不支援的操作' };
}

// ───────── V43.19 版面神器每日 Telegram 日報 (每天 20:00 私訊高弘治) ─────────
/**
 * 內容：每個人今天在版面神器「新增／修改／刪除」了什麼 (讀「鈦傳速_操作記錄」本月分頁，系統 = 版面神器)、
 *       實際使用時間與開啟次數 (讀「版面神器_使用時間」，前端只在畫面開著且有操作時計時)、今天沒用的業務。
 */
var AIT_REPORT_CHAT = '1094832646';

function aitDailyReport_V43(e) {
  _requireSystemContext_(e);
  var text = _aitDailyReportText_(new Date());
  var parts = [];
  while (text.length > 3800) { var cut = text.lastIndexOf('\n\n', 3800); if (cut < 1000) cut = 3800; parts.push(text.slice(0, cut)); text = text.slice(cut); }
  parts.push(text);
  parts.forEach(function (p) { _tgCall_('sendMessage', { chat_id: AIT_REPORT_CHAT, text: p, parse_mode: 'HTML', disable_web_page_preview: true }); });
  return parts.join('');
}

/** 試算表選單「立即發送版面神器日報」 */
function menuAitDailyReport_V43(e) {
  _requireSystemContext_(e);
  aitDailyReport_V43();
  try { SpreadsheetApp.getUi().alert('已發送今天的版面神器日報到 Telegram'); } catch (e2) { }
}

/** 每天 20:00 的排程不存在就自動補建 (由 doGet 順手檢查，6 小時查一次) */
function _ensureAitReportTrigger_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('ait_report_trigger_ok')) return;
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'aitDailyReport_V43'; });
  if (!has) ScriptApp.newTrigger('aitDailyReport_V43').timeBased().atHour(20).nearMinute(0).everyDays(1).inTimezone('Asia/Taipei').create();
  cache.put('ait_report_trigger_ok', '1', 21600);
}

function _aitDailyReportText_(now) {
  var day = Utilities.formatDate(now, 'GMT+8', 'yyyy/MM/dd');
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty(AUDIT_SS_PROP));
  var people = {}; // 姓名 → {title, branch, add:{label:[targets]}, edit, del, denied, min, opens, first, last}
  var P = function (name, title, branch) {
    if (!people[name]) people[name] = { title: title || '', branch: branch || '', add: {}, edit: {}, del: {}, view: {}, denied: 0, min: 0, opens: 0, first: '', last: '' };
    if (title && !people[name].title) people[name].title = title;
    if (branch && !people[name].branch) people[name].branch = branch;
    return people[name];
  };
  var dayOf = function (v) { return v instanceof Date ? Utilities.formatDate(v, 'GMT+8', 'yyyy/MM/dd') : String(v || '').slice(0, 10); };

  // 1. 操作記錄
  var tab = ss.getSheetByName(Utilities.formatDate(now, 'GMT+8', 'yyyy-MM'));
  if (tab && tab.getLastRow() > 1) {
    var n = Math.min(tab.getLastRow() - 1, 5000);
    var rows = tab.getRange(2, 1, n, 13).getValues();
    rows.forEach(function (r) {
      if (String(r[12]) !== '版面神器' || dayOf(r[0]) !== day) return;
      var who = String(r[1] || ''), label = String(r[4] || ''), target = String(r[5] || ''), result = String(r[8] || '');
      if (!who || /^（/.test(who) || label === '登入' || label === '登出') return;
      var p = P(who, String(r[2] || ''), String(r[3] || ''));
      if (result === '拒絕') { p.denied++; return; }
      if (result !== '成功') return;
      var kind = /查看|開啟|查詢|計算/.test(label) ? p.view : /刪除|下架|移除/.test(label) ? p.del : (/建立|新增|打卡|上傳|申請|加入|寄送|記錄$|匯出|產生/.test(label) ? p.add : p.edit);
      (kind[label] = kind[label] || []).push(target);
    });
  }
  // 2. 使用時間
  var us = ss.getSheetByName('版面神器_使用時間');
  if (us && us.getLastRow() > 1) {
    var from = Math.max(2, us.getLastRow() - 500);
    us.getRange(from, 1, us.getLastRow() - from + 1, 8).getDisplayValues().forEach(function (r) {
      if (r[0] !== day || !r[1]) return;
      var p = P(r[1], r[2], r[3]);
      p.opens += Number(r[4]) || 0; p.min += Number(r[5]) || 0; p.first = r[6]; p.last = r[7];
    });
  }
  // 3. 今天沒用的業務 (物流白名單：身分類型 = 業務、帳號啟用)
  var idle = [];
  try {
    var wt = _whitelistTable_();
    for (var i = 1; i < wt.data.length; i++) {
      var a = _rowToAccount_(wt, wt.data[i], i);
      if (a.active && a.title === '業務' && !people[a.name]) idle.push(a.name);
    }
  } catch (eW) { }

  var fmtMin = function (m) { return m < 60 ? m + ' 分' : Math.floor(m / 60) + ' 小時 ' + (m % 60) + ' 分'; };
  var fmtKind = function (obj) {
    return Object.keys(obj).map(function (label) {
      var ts = obj[label].filter(function (x) { return x; });
      var uniq = ts.filter(function (x, i) { return ts.indexOf(x) === i; });
      return _tgEsc_(label) + ' ' + obj[label].length + (uniq.length ? '（' + _tgEsc_(uniq.slice(0, 5).join('、')) + (uniq.length > 5 ? '…' : '') + '）' : '');
    }).join('；');
  };
  var order = { '業務': 0, '行政': 1, '主管': 2, '倉管': 3 };
  var names = Object.keys(people).sort(function (x, y) { var ox = order.hasOwnProperty(people[x].title) ? order[people[x].title] : 9, oy = order.hasOwnProperty(people[y].title) ? order[people[y].title] : 9; return ox - oy || people[y].min - people[x].min; });
  var md = Utilities.formatDate(now, 'GMT+8', 'M/d');
  var out = ['📊 <b>版面神器 ' + md + ' 使用日報</b>'];
  if (!names.length) out.push('今天沒有人使用。');
  names.forEach(function (name) {
    var p = people[name];
    var lines = ['👤 <b>' + _tgEsc_(name) + '</b>' + (p.title ? '（' + _tgEsc_(p.title) + (p.branch ? '・' + _tgEsc_(p.branch) : '') + '）' : '')];
    lines.push('⏱ 實際使用 ' + fmtMin(p.min) + ' · 開啟 ' + p.opens + ' 次' + (p.first ? ' · ' + p.first + '–' + p.last : ''));
    if (Object.keys(p.add).length) lines.push('➕ 新增：' + fmtKind(p.add));
    if (Object.keys(p.edit).length) lines.push('✏️ 修改：' + fmtKind(p.edit));
    if (Object.keys(p.del).length) lines.push('🗑 刪除：' + fmtKind(p.del));
    if (Object.keys(p.view).length) lines.push('🔎 查看：' + fmtKind(p.view));
    if (!Object.keys(p.add).length && !Object.keys(p.edit).length && !Object.keys(p.del).length) lines.push('（只有查看，沒有新增或修改）');
    if (p.denied) lines.push('⚠️ 權限不足被擋 ' + p.denied + ' 次');
    out.push(lines.join('\n'));
  });
  if (idle.length) out.push('😴 今天沒使用的業務：' + _tgEsc_(idle.join('、')));
  return out.join('\n\n');
}
