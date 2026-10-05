/**
 * V42.60 操作記錄（登入安全第一階段）
 *
 * 做法：每個「會改資料」或「敏感」的後端功能，原本的實作改名為 xxx_impl_（結尾底線 = 前端無法直接呼叫，繞不過記錄），
 * 原名稱改成這裡的記錄外殼：執行原功能 → 記下「誰、做了什麼、對象、修改前→後、結果」→ 回傳原結果。
 * - 記錄寫在獨立試算表「鈦傳速_操作記錄」(只有擁有者能改)，每月一個分頁，最新的在最上面。
 * - 記錄失敗絕不影響原功能；功能內部互相呼叫只記最外層那一次。
 * - 密碼、登入憑證、照片一律不寫進記錄。
 */

var AUDIT_SS_PROP = 'AUDIT_SS_ID';
var AUDIT_HEADERS = ['時間', '人員', '角色', '分公司', '動作', '對象', '內容', '修改前 → 修改後', '結果', '錯誤訊息', '耗時(ms)', '功能代號', '系統'];
var AUDIT_SYSTEM = '物流'; // V43.17: 版面記錄神器也寫進同一個記錄檔，用「系統」欄區分
var __AUDIT_DEPTH__ = 0;
var __AUDIT_CHANGES__ = []; // Settings.js 的 _logAudit 會把「修改前→後」放進來

// ───────── 取值小工具 ─────────
function _aStr_(v, n) { var s = String(v == null ? '' : v).trim(); n = n || 60; return s.length > n ? s.slice(0, n) + '…' : s; }
function _aIds_(v) {
  // 從參數裡找出單號：id / taskId / orderId 欄位，JSON 字串會先解析
  var out = [];
  var walk = function (x, depth) {
    if (x == null || depth > 4) return;
    if (typeof x === 'string') {
      var t = x.trim();
      if ((t.charAt(0) === '[' || t.charAt(0) === '{') && t.length < 200000) { try { walk(JSON.parse(t), depth + 1); } catch (e) { } }
      return;
    }
    if (Array.isArray(x)) { x.forEach(function (y) { walk(y, depth + 1); }); return; }
    if (typeof x === 'object') {
      ['id', 'taskId', 'orderId'].forEach(function (k) { if (x[k] != null && x[k] !== '') out.push(String(x[k]).trim()); });
      Object.keys(x).forEach(function (k) { if (typeof x[k] === 'object' || (typeof x[k] === 'string' && /^[\[{]/.test(x[k]))) walk(x[k], depth + 1); });
    }
  };
  walk(v, 0);
  return out.filter(function (x, i, a) { return x && a.indexOf(x) === i; });
}
function _aIdList_(ids) { return ids.length > 6 ? ids.slice(0, 6).join('、') + ' 等 ' + ids.length + ' 張' : ids.join('、'); }

// ───────── 「內容」欄寫成看得懂的中文 (2026-10-01，以前沒寫專屬內容的功能會整包 JSON 寫進去) ─────────
// 單號已經在「對象」欄；電話、座標、照片、內部代號不寫。不認得的欄位也不寫 (寫出來只是看不懂的英文代號)。
var AUDIT_KEY_LABELS_ = {
  customer: '客戶', customerName: '客戶', contact: '聯絡人', contactName: '聯絡人', address: '地址', note: '備註', notes: '備註', noteWrap: '包裝備註',
  date: '日期', items: '品項', boxes: '箱數', weight: '重量', size: '尺寸', type: '類型', vehicle: '車輛', timeSlot: '時段',
  specifiedArrive: '指定到貨', etaTime: '預計到達', branch: '分公司', reason: '原因', assignedSales: '業務', assignedDriver: '司機',
  plate: '車牌', name: '姓名', qty: '數量', status: '狀態', wrap: '包裝', wrapSeal: '封膜', sealWrap: '封膜', isSalesDelivery: '業務自送'
};
/** 排序類功能傳的是單號清單 (可能是純字串、也可能是 {id} 物件)，照原順序取出 */
function _aSeq_(v) {
  if (typeof v === 'string') { var t = v.trim(); if (/^\[/.test(t)) { try { v = JSON.parse(t); } catch (e) { return []; } } else return t ? [t] : []; }
  var out = [];
  (function walk(x, d) {
    if (x == null || d > 4) return;
    if (Array.isArray(x)) { x.forEach(function (y) { walk(y, d + 1); }); return; }
    if (typeof x === 'object') { var id = x.id || x.taskId || x.orderId; if (id) out.push(String(id).trim()); return; }
    var s2 = String(x).trim(); if (s2) out.push(s2);
  })(v, 0);
  return out.filter(function (x, i, a) { return a.indexOf(x) === i; });
}
/** 對象欄：客戶縮寫＋單號，例如「衡棋 151001013-喜」 */
function _aCustOrder_(a) {
  var p = a[0] || {};
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch (e) { p = {}; } }
  if (Array.isArray(p)) p = p[0] || {};
  var cust = p.customerName || p.customer || '';
  try { if (cust && typeof cleanCustName_V11 === 'function') cust = cleanCustName_V11(cust) || cust; } catch (e) { }
  return [_aStr_(cust, 20), _aStr_(p.orderId || p.id || '')].filter(String).join(' ');
}

/** LINE 訊息壓成一行：去掉標題（🌀…🌀）、項目符號、分隔線；單號放最前面，多筆用「；」隔開 */
function _aLineOneLine_(msg) {
  var items = [], cur = [];
  String(msg == null ? '' : msg).split(/\r?\n/).forEach(function (l) {
    l = l.trim();
    if (!l) return;
    if (/^[➖—＿_=~\-\s]+$/.test(l)) { if (cur.length) items.push(cur); cur = []; return; }
    if (/^🌀.*🌀$/.test(l)) return;
    cur.push(l.replace(/^(?:🟧|🟦|🟩|🟨|🟥|🔸|🔹|▪️|▪|•|・)\s*/, '').trim());
  });
  if (cur.length) items.push(cur);
  var out = items.map(function (it) {
    var head = it.filter(function (x) { return /^(?:❌|✅|⭕|🚚|⚠️)/.test(x); });
    var ids = it.filter(function (x) { return head.indexOf(x) === -1 && /^(?:[A-Z]{1,2}\d{5,}|\d{6,}-.)/.test(x); });
    var rest = it.filter(function (x) { return head.indexOf(x) === -1 && ids.indexOf(x) === -1; });
    return head.concat(ids, rest).join(' ');
  }).filter(String).join('；');
  return _aStr_(out, 300);
}

function _aOrder_(ids) { return ids.length ? '新順序：' + ids.slice(0, 12).join(' → ') + (ids.length > 12 ? ' …共 ' + ids.length + ' 張' : '') : ''; }
function _aReturnDetail_(a) {
  var list = a[0];
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch (e) { list = []; } }
  if (!Array.isArray(list)) list = [list];
  var reasons = {};
  list.forEach(function (x) { if (x && x.reason) reasons[_aStr_(x.reason, 40)] = 1; });
  var r = Object.keys(reasons);
  return list.length + ' 張退回' + (r.length ? '，原因：' + r.join('／') : '');
}
function _aVal_(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'boolean') return v ? '是' : '';
  if (typeof v === 'string') { if (/^data:|^https?:/.test(v) || v.length > 300) return ''; return _aStr_(v.replace(/\s+/g, ' '), 60); }
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    var xs = v.map(function (x) { return x && typeof x === 'object' ? _aObj_(x) : _aVal_(x); }).filter(String);
    return xs.slice(0, 8).join('、') + (xs.length > 8 ? ' 等 ' + xs.length + ' 項' : '');
  }
  if (typeof v === 'object') return _aObj_(v);
  return '';
}
function _aObj_(o) {
  var sku = o.sku || o.code || o.productCode || o.name;
  if (sku && (o.qty != null || o.quantity != null)) return sku + '×' + (o.qty != null ? o.qty : o.quantity);
  return Object.keys(o).filter(function (k) { return AUDIT_KEY_LABELS_[k] && !/token|pwd|password|photo|image|thumbnail|phone|location|gps/i.test(k); })
    .map(function (k) { var t = _aVal_(o[k]); return t ? AUDIT_KEY_LABELS_[k] + ' ' + t : ''; }).filter(String).join('，');
}
function _aHuman_(args, target) {
  return Array.prototype.slice.call(args).map(function (x) {
    if (typeof x === 'string') { var t = x.trim(); if (/^[\[{]/.test(t)) { try { return _aVal_(JSON.parse(t)); } catch (e) { return ''; } } return (/^[A-Za-z0-9_-]{20,}={0,2}\.[A-Za-z0-9_-]{20,}/.test(t) || (target && t === target)) ? '' : _aVal_(t); }
    return _aVal_(x);
  }).filter(String).join('｜').slice(0, 500);
}

/** 通用參數摘要：遮蔽密碼/憑證/照片，截斷長字串 */
function _aSummary_(args) {
  var TOKEN_RE = /^[A-Za-z0-9_-]{20,}={0,2}\.[A-Za-z0-9_-]{20,}={0,2}$/; // base64EncodeWebSafe 會帶 = 補位
  var SECRET_KEY = /token|pwd|password|photo|img|image|b64|base64|blob|thumbnail|signature/i;
  var seen = 0;
  var clean = function (x, depth) {
    if (++seen > 400) return '…';
    if (x == null) return x;
    if (typeof x === 'string') {
      if (TOKEN_RE.test(x)) return '[登入憑證]';
      if (/^data:|^[A-Za-z0-9+\/=]{500,}$/.test(x)) return '[檔案]';
      return x.length > 120 ? x.slice(0, 120) + '…' : x;
    }
    if (typeof x !== 'object') return x;
    if (depth > 3) return '…';
    if (Array.isArray(x)) {
      var arr = x.slice(0, 15).map(function (y) { return clean(y, depth + 1); });
      if (x.length > 15) arr.push('…共 ' + x.length + ' 筆');
      return arr;
    }
    var o = {};
    Object.keys(x).forEach(function (k) { o[k] = SECRET_KEY.test(k) ? (x[k] ? '[略]' : '') : clean(x[k], depth + 1); });
    return o;
  };
  try {
    var list = Array.prototype.slice.call(args).map(function (a) { return clean(a, 0); })
      .filter(function (a) { return a !== '[登入憑證]'; });
    var s = JSON.stringify(list);
    return s.length > 1500 ? s.slice(0, 1500) + '…' : s;
  } catch (e) { return ''; }
}

/** 驗貨批次儲存的內容：「16 張 → 已分配；實際載貨：唐業霖」(依狀態／載貨人分組) */
function _aWhBatchDetail_(a) {
  var list = a[0];
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch (e) { return ''; } }
  if (!Array.isArray(list)) return '';
  var groups = {}, order = [];
  list.forEach(function (x) {
    if (!x) return;
    var parts = [];
    if (x.whStatus) parts.push(_aStr_(x.whStatus, 20));
    var drv = x.assignedDriver || x.whDriver;
    if (drv) parts.push('實際載貨：' + _aStr_(drv, 20));
    var k = parts.join('；') || '更新';
    if (!groups[k]) { groups[k] = 0; order.push(k); }
    groups[k]++;
  });
  return order.map(function (k) { return groups[k] + ' 張 → ' + k; }).join('\n');
}

// ───────── 每個功能怎麼記 ─────────
// label: 動作名稱；target(args): 對象；detail(args): 內容；ids(args): 需要比對「修改前→後」的單號 (派送清單)
// who(args): 還沒有登入身分時 (登入功能本身) 用來判斷是誰；noArgs: 參數完全不記 (密碼類)
var AUDIT_SPECS = {
  // ── 登入 ──
  sysVerifyPwd: { label: '管理端登入', noArgs: true, who: function () { return '管理員（共用密碼）'; } },
  verifyNameAndIssueToken: { label: '司機端登入（點名字）', who: function (a) { return _aStr_(a[0]); }, target: function (a) { return _aStr_(a[0]); }, detail: function () { return ''; } },
  generateParamUrlForDriver: { label: '產生司機專屬登入連結', target: function (a) { return _aStr_(a[0]); }, detail: function () { return ''; } },
  setAdminPassword: { label: '修改管理員密碼', noArgs: true },
  loginWithGoogle_V43: {
    label: 'Google 登入', noArgs: true, target: function (a) { return _aStr_(a[1]); },
    resultDetail: function (r) { return ({ ok: '登入成功', pending: '申請審核中', need_apply: '尚未申請帳號', disabled: '帳號已停用，擋下', error: '' })[r && r.status] || ''; }
  },
  loginWithLine_V43: {
    label: 'LINE 登入', noArgs: true, target: function (a) { return _aStr_(a[1]); },
    resultDetail: function (r) { return ({ ok: '登入成功', pending: '申請審核中', need_apply: '尚未申請帳號', disabled: '帳號已停用，擋下', error: '' })[r && r.status] || ''; }
  },
  applyAccount_V43: {
    label: '申請帳號', noArgs: true,
    detail: function (a) { var f = a[1] || {}; return _aStr_(f.name) + '｜' + _aStr_(f.title) + '｜' + _aStr_(f.branch); }
  },
  decideAccount_V43: { label: '審核帳號申請', noArgs: true, target: function (a) { return _aStr_(a[0]); }, detail: function (a) { return a[1] === 'approve' ? '核准' : '拒絕'; } },

  // ── 派車 / 排序 ──
  recordDispatch_V3: {
    label: '派車', ids: function (a) { return _aIds_(a[0]); },
    target: function (a) { return _aIdList_(_aIds_(a[0])); },
    detail: function (a) { var c = a[1] || {}; return (_aIds_(a[0]).length) + ' 張 → ' + _aStr_(c.plate) + ' ' + _aStr_(c.name) + (c.source ? '（' + _aStr_(c.source) + '）' : ''); }
  },
  adminDispatchTasks: {
    label: '派車（戰情室）', ids: function (a) { return _aIds_(a[0]); },
    target: function (a) { return _aIdList_(_aIds_(a[0])); },
    detail: function (a) { return _aIds_(a[0]).length + ' 張 → ' + _aStr_(a[1]); }
  },
  adminUnassignTask: { label: '取消指派', ids: function (a) { return _aIds_(a[0]); }, target: function (a) { return _aIdList_(_aIds_(a[0])); } },
  cancelDispatch_V3: { label: '撤回派車', ids: function (a) { return [_aStr_(a[0])]; }, target: function (a) { return _aStr_(a[0]); } },
  adminResetAllAssignments: { label: '⚠ 重置全部派車', detail: function () { return '清除所有訂單的派車'; } },
  recordDispatchOrder: { label: '調整派車順序', target: function (a) { return _aIdList_(_aSeq_(a[0])); }, detail: function (a) { return _aOrder_(_aSeq_(a[0])); } },
  adminUpdateSequence_V11: { label: '調整配送順序（戰情室）', target: function (a) { return _aStr_(a[1]); }, detail: function (a) { return _aOrder_(_aSeq_(a[0])); } },
  adjustTaskSequence_V6: { label: '調整配送順序', target: function (a) { return _aStr_(a[0]) + ' / ' + _aStr_(a[1]); }, detail: function () { return ''; } },
  updateTaskOrder: { label: '司機調整配送順序', target: function (a) { return _aIdList_(_aSeq_(a[0])); }, detail: function (a) { return _aOrder_(_aSeq_(a[0])); } },
  updateBackYinggeStatus_V3: { label: '回鶯歌標記', ids: function (a) { return [_aStr_(a[0])]; }, target: function (a) { return _aStr_(a[0]); }, detail: function (a) { return a[2] ? '標記回鶯歌' : '取消回鶯歌'; } },

  // ── 訂單 ──
  adminAddTempTask: { label: '新增臨時任務', target: _aCustOrder_ },
  upsertOrderFromOcr_V2: { label: 'OCR 建立／更新訂單', target: _aCustOrder_, detail: function () { return ''; } },
  adminCancelTaskV2: { label: '取消任務', ids: function (a) { return [_aStr_(a[0])]; }, target: function (a) { return _aStr_(a[0]); } },
  adminDeleteTask_V11: { label: '⚠ 刪除任務', ids: function (a) { return [_aStr_(a[0])]; }, target: function (a) { return _aStr_(a[0]); } },
  adminBatchReturnTasks_V11: { label: '批次退回分公司', ids: function (a) { return _aIds_(a[0]); }, target: function (a) { return _aIdList_(_aIds_(a[0])); }, detail: _aReturnDetail_ },
  setDocTypeOverride_V41: { label: '改單據類型', ids: function (a) { return [_aStr_(a[0])]; }, target: function (a) { return _aStr_(a[0]); }, detail: function (a) { return '改為「' + _aStr_(a[2]) + '」'; } },
  batchSetDocTypeOverride_V42: { label: '批次改單據類型', ids: function (a) { return _aIds_(a[0]); }, target: function (a) { return _aIdList_(_aIds_(a[0])); } },
  manualAdjustFreight_V11: { label: '手動調整運費', ids: function (a) { return [_aStr_(a[0])]; }, target: function (a) { return _aStr_(a[0]); }, detail: function (a) { return '運費改為 ' + _aStr_(a[2]); } },
  saveFreightSettings_V41: { label: '修改運費設定' },
  addCommonLocation_V41: { label: '新增指送地點', target: function (a) { return _aStr_(a[0]); }, detail: function (a) { return _aStr_(a[1]) + '｜' + _aStr_(a[2], 80); } },

  // ── 驗貨 ──
  verifyTask_V3: { label: '驗貨確認', ids: function (a) { return [_aStr_(a[0])]; }, target: function (a) { return _aStr_(a[0]); }, detail: function (a) { return a[1] ? '實際載貨：' + _aStr_(a[1]) : ''; } },
  undoVerifyTask_V3: { label: '取消驗貨', ids: function (a) { return [_aStr_(a[0])]; }, target: function (a) { return _aStr_(a[0]); } },
  batchWarehouseSave_V3: { label: '驗貨批次儲存', ids: function (a) { return _aIds_(a[0]); }, target: function (a) { return _aIdList_(_aIds_(a[0])); }, detail: _aWhBatchDetail_ },

  // ── 司機 ── (配送結案、打卡/加油/保養回報、出發導航 原本就記在 送貨日誌/每日行程表/各分頁，這裡不重複記)
  driverRedoTask: { label: '司機重新回報', ids: function (a) { return [_aStr_(a[0])]; }, target: function (a) { return _aStr_(a[0]); } },
  updateFuelRecord_V11: { label: '修改加油記錄', detail: function (a) { return '第 ' + _aStr_(a[0]) + ' 列｜' + _aStr_(a[1]) + ' 改為 ' + _aStr_(a[2]); } },
  updateMileageRecord_V11: { label: '修改里程記錄', detail: function (a) { return '第 ' + _aStr_(a[0]) + ' 列｜' + _aStr_(a[1]) + ' 改為 ' + _aStr_(a[2]); } },

  // ── 系統設定 / 敏感資料 ──
  sysSaveEdits: { label: '系統設定：修改資料', target: function (a) { return _aStr_(a[0]); }, detail: function (a) { return '修改 ' + ((a[1] || []).length) + ' 格｜新增 ' + ((a[2] || []).length) + ' 列'; } },
  sysDeleteRows: { label: '⚠ 系統設定：刪除資料列', target: function (a) { return _aStr_(a[0]); }, detail: function (a) { return '刪除 ' + ((a[1] || []).length) + ' 列'; } },
  sysGetWhitelist: { label: '查看系統白名單', detail: function () { return ''; } },
  createTodaySignPhotoZip: { label: '下載簽收照片', detail: function (a) { return _aStr_(a[0]) + (a[1] ? '｜' + _aStr_(a[1]) : ''); } },
  pushLineMessage_V11: { label: '發送 LINE 訊息', detail: function (a) { return _aLineOneLine_(a[0]); } }
};

// ───────── 核心：執行 + 記錄 ─────────
function _audited_(name, impl, args) {
  if (__AUDIT_DEPTH__ > 0) return impl.apply(this, args); // 內部呼叫：只記最外層
  __AUDIT_DEPTH__++;
  __AUDIT_CHANGES__ = [];
  var t0 = Date.now(), spec = AUDIT_SPECS[name] || {}, before = null, ids = [], result, err = null;
  try { if (spec.ids) { ids = spec.ids(args) || []; before = _auditSnapshot_(ids); } } catch (e0) { before = null; }
  try {
    result = impl.apply(this, args);
    return result;
  } catch (e) {
    err = e;
    throw e;
  } finally {
    __AUDIT_DEPTH__--;
    try {
      var diff = '';
      if (before) diff = _auditDiff_(before, _auditSnapshot_(ids));
      if (__AUDIT_CHANGES__.length) diff = (diff ? diff + '\n' : '') + __AUDIT_CHANGES__.join('\n');
      _auditWrite_(name, spec, args, result, err, diff, Date.now() - t0);
    } catch (e2) { console.error('操作記錄寫入失敗：' + (e2 && e2.message)); }
    __AUDIT_CHANGES__ = [];
  }
}

function _auditOutcome_(result, err) {
  var msg = '';
  if (err) msg = err.message || String(err);
  else if (result && typeof result === 'object') {
    if (result.success === false || result.ok === false) msg = String(result.error || result.message || '失敗');
    else if (result.error && result.success !== true && !result.token) msg = String(result.error);
  } else if (typeof result === 'string' && /^\s*(❌|⚠️|🚨|🔒)/.test(result)) msg = result;
  if (!msg && result && typeof result === 'object' && result.status === 'error') msg = String(result.message || '失敗');
  var status = '成功';
  if (/AUTH_REQUIRED|AUTH_FORBIDDEN|🔒/.test(msg)) status = '拒絕';
  else if (msg) status = '失敗';
  else if (result && typeof result === 'object' && result.duplicated) status = '重複送出（已略過）';
  return { status: status, msg: _aStr_(msg, 300) };
}

var AUDIT_ROLE_LABEL = { admin: '管理端', driver: '司機', warehouse: '驗貨', system: '系統' };

function _auditWrite_(name, spec, args, result, err, diff, ms) {
  var ctx = (typeof __AUTH_CTX__ !== 'undefined') ? __AUTH_CTX__ : null;
  var who = ctx && ctx.name ? String(ctx.name) : '';
  if (!who && spec.who) { try { who = spec.who(args); } catch (e) { } }
  if (!who && typeof __AUDIT_WHO__ !== 'undefined' && __AUDIT_WHO__) who = __AUDIT_WHO__;
  var oc = _auditOutcome_(result, err);
  var detail = '';
  if (!spec.noArgs) {
    try { detail = spec.detail ? spec.detail(args) : _aHuman_(args, spec.target ? spec.target(args) : ''); } catch (e) { detail = ''; }
  }
  if (spec.resultDetail) { try { detail = spec.resultDetail(result, args) || detail; } catch (e) { } }
  var target = '';
  try { target = spec.target ? spec.target(args) : ''; } catch (e) { }
  var row = [
    Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd HH:mm:ss'),
    who || (oc.status === '拒絕' ? '（未登入／憑證無效）' : ''),
    ctx ? (AUDIT_ROLE_LABEL[ctx.role] || ctx.role || '') : '',
    ctx && ctx.branch ? String(ctx.branch) : '',
    spec.label || name,
    target,
    detail,
    diff ? (diff.length > 3000 ? diff.slice(0, 3000) + '…' : diff) : '',
    oc.status,
    oc.msg,
    ms,
    name,
    AUDIT_SYSTEM
  ];
  _auditPutRow_(row);
}

// ───────── 寫入記錄檔 (V43.17：物流、版面記錄神器兩個專案共用同一段寫法，兩邊要保持一致) ─────────
/** 把一列記錄插到本月分頁的最上面 (標題列下方) */
function _auditPutRow_(row) {
  row = row.map(function (v) {
    if (typeof v === 'string' && v.length > 40000) v = v.slice(0, 40000) + '…'; // 單格上限 50000 字
    return v;
  });
  var sh = _auditSheet_();
  // 兩個專案會同時寫同一個分頁，各自的鎖擋不到對方 → 優先用 Sheets API 把「插入一列 + 寫入」一次做完 (不會互相蓋掉)
  if (_auditApiInsert_(sh, row)) { _auditCleanBlankRows_(sh); return; }
  var safe = row.map(function (v) { return (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v; }); // 防止被當成公式
  var lock = LockService.getScriptLock();
  var locked = false;
  try { locked = lock.tryLock(8000); } catch (e) { locked = false; }
  try {
    if (locked) {
      // V43.13: 新插入的列會沿用標題列黑底；先清格式再寫內容，寫入失敗就把這列刪掉改加在最下面，
      // 避免留下「黑色空白列」而且漏記
      sh.insertRowsAfter(1, 1);
      var r2 = sh.getRange(2, 1, 1, safe.length);
      try {
        r2.setFontWeight('normal').setBackground(null).setFontColor(null);
        r2.setValues([safe]);
      } catch (eW) {
        try { sh.deleteRow(2); } catch (eD) { }
        sh.appendRow(safe);
      }
      _auditCleanBlankRows_(sh);
    } else {
      sh.appendRow(safe); // 拿不到鎖就退而求其次加在最下面，至少不漏記
    }
  } finally {
    if (locked) { try { lock.releaseLock(); } catch (e) { } }
  }
}

/** Sheets API：同一個請求裡「在第 2 列插入空列 (格式沿用下面的資料列) + 寫入內容」，成功回 true；API 不能用就回 false 改走舊方法 */
/** Sheets API 的儲存格：「yyyy/MM/dd HH:mm:ss」寫成真正的日期時間 (跟舊記錄一樣可排序、篩選)，其他照原樣 */
function _auditApiCell_(v) {
  var m = typeof v === 'string' && /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(v);
  if (m) {
    var serial = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 86400000 + 25569;
    return { userEnteredValue: { numberValue: serial }, userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'yyyy/mm/dd hh:mm:ss' } } };
  }
  if (typeof v === 'number') return { userEnteredValue: { numberValue: v } };
  return { userEnteredValue: { stringValue: String(v == null ? '' : v) } };
}

function _auditApiInsert_(sh, row) {
  var cache = CacheService.getScriptCache();
  if (typeof Sheets === 'undefined' || !Sheets.Spreadsheets || cache.get('audit_api_off')) return false;
  try {
    var sid = sh.getSheetId();
    Sheets.Spreadsheets.batchUpdate({
      requests: [
        { insertDimension: { range: { sheetId: sid, dimension: 'ROWS', startIndex: 1, endIndex: 2 }, inheritFromBefore: false } },
        {
          updateCells: {
            start: { sheetId: sid, rowIndex: 1, columnIndex: 0 }, fields: 'userEnteredValue,userEnteredFormat.numberFormat',
            rows: [{ values: row.map(_auditApiCell_) }]
          }
        }
      ]
    }, sh.getParent().getId());
    return true;
  } catch (e) {
    console.warn('操作記錄 Sheets API 寫入失敗，改用一般寫法：' + (e && e.message));
    try { cache.put('audit_api_off', '1', 3600); } catch (e2) { }
    return false;
  }
}

/** 清掉之前寫入失敗留下的黑色空白列 (每 30 分鐘最多檢查一次，只看最上面 1000 列) */
function _auditCleanBlankRows_(sh) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'audit_blank_chk_' + sh.getName();
    if (cache.get(key)) return;
    cache.put(key, '1', 1800);
    var n = Math.min(sh.getLastRow(), 1000);
    if (n < 2) return;
    var vals = sh.getRange(2, 1, n - 1, 1).getValues();
    for (var i = vals.length - 1; i >= 0; i--) {
      if (vals[i][0] === '' || vals[i][0] == null) sh.deleteRow(i + 2);
    }
  } catch (e) { }
}

/** 取得本月的記錄分頁；記錄檔不存在就自動建立 (擁有者 = 部署者本人，其他人預設無權限) */
function _auditSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(AUDIT_SS_PROP);
  var ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('鈦傳速_操作記錄');
    props.setProperty(AUDIT_SS_PROP, ss.getId());
    var info = ss.getSheets()[0];
    info.setName('說明');
    info.getRange(1, 1, 4, 1).setValues([
      ['鈦傳速物流系統「操作記錄」— 由系統自動寫入，請勿手動修改或分享編輯權限。'],
      ['每個月一個分頁（例如 2026-10），最新的記錄在最上面。'],
      ['「修改前 → 修改後」只有派車、取消、改運費、改單據類型、驗貨、系統設定等功能會記錄。'],
      ['密碼、登入憑證、照片不會寫入記錄。']
    ]);
  }
  var tab = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy-MM');
  var sh = ss.getSheetByName(tab);
  if (!sh) {
    // 兩個專案可能同時建立新月份分頁：建立失敗就再找一次 (對方剛建好)
    try { sh = ss.insertSheet(tab, 0); } catch (eIns) { sh = ss.getSheetByName(tab); if (!sh) throw eIns; return _auditEnsureHeader_(sh); }
    sh.getRange(1, 1, 1, AUDIT_HEADERS.length).setValues([AUDIT_HEADERS])
      .setFontWeight('bold').setBackground('#111827').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 150); sh.setColumnWidth(5, 150); sh.setColumnWidth(6, 180); sh.setColumnWidth(7, 320); sh.setColumnWidth(8, 360);
  }
  return _auditEnsureHeader_(sh);
}

/** 舊分頁補上後來新增的標題 (例如「系統」)；每個分頁 6 小時檢查一次 */
function _auditEnsureHeader_(sh) {
  try {
    var cache = CacheService.getScriptCache(), key = 'audit_hdr_' + sh.getSheetId();
    if (cache.get(key)) return sh;
    var n = AUDIT_HEADERS.length;
    if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
    var cur = sh.getRange(1, 1, 1, n).getValues()[0];
    for (var i = 0; i < n; i++) {
      if (String(cur[i]).trim() === '') sh.getRange(1, i + 1).setValue(AUDIT_HEADERS[i]).setFontWeight('bold').setBackground('#111827').setFontColor('#ffffff');
    }
    cache.put(key, '1', 21600);
  } catch (e) { }
  return sh;
}

// ───────── 修改前 → 修改後 (派送清單) ─────────
function _auditSnapshot_(ids) {
  if (!ids || !ids.length || ids.length > 300) return null;
  var sheet = getSS_V11().getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
  if (!sheet) return null;
  var data = sheet.getDataRange().getDisplayValues();
  var h = data[0].map(function (v) { return String(v).trim(); });
  var cId = h.indexOf('單號');
  if (cId === -1) return null;
  var want = {};
  ids.forEach(function (x) { want[String(x).trim()] = true; });
  var rows = {};
  for (var i = 1; i < data.length; i++) {
    var k = String(data[i][cId]).trim();
    if (want[k] && !rows[k]) rows[k] = data[i];
  }
  return { h: h, rows: rows, ids: Object.keys(want) };
}

function _auditDiff_(before, after) {
  if (!before || !after) return '';
  var SKIP = /最後更新|更新時間|THUMBNAIL|縮圖/i;
  var show = function (v) { v = String(v == null ? '' : v).trim(); return v === '' ? '（空白）' : (v.length > 40 ? v.slice(0, 40) + '…' : v); };
  var lines = [];
  before.ids.forEach(function (id) {
    var b = before.rows[id], a = after.rows[id];
    if (!b) return;
    if (!a) { lines.push(id + '：整列已移除'); return; }
    var parts = [];
    before.h.forEach(function (col, i) {
      if (!col || SKIP.test(col)) return;
      var j = after.h.indexOf(col);
      var av = j === -1 ? '' : a[j];
      if (String(b[i]) !== String(av)) parts.push(col + ' ' + show(b[i]) + ' → ' + show(av));
    });
    if (parts.length) lines.push(id + '：' + parts.join('；'));
  });
  return lines.join('\n');
}

// ───────── 記錄外殼（名稱 = 原本前端呼叫的名稱） ─────────
function loginWithGoogle_V43() { return _audited_('loginWithGoogle_V43', loginWithGoogle_V43_impl_, arguments); }
function loginWithLine_V43() { return _audited_('loginWithLine_V43', loginWithLine_V43_impl_, arguments); }
function applyAccount_V43() { return _audited_('applyAccount_V43', applyAccount_V43_impl_, arguments); }
function decideAccount_V43() { return _audited_('decideAccount_V43', decideAccount_V43_impl_, arguments); }
function sysVerifyPwd() { return _audited_('sysVerifyPwd', sysVerifyPwd_impl_, arguments); }
function verifyNameAndIssueToken() { return _audited_('verifyNameAndIssueToken', verifyNameAndIssueToken_impl_, arguments); }
function generateParamUrlForDriver() { return _audited_('generateParamUrlForDriver', generateParamUrlForDriver_impl_, arguments); }
function setAdminPassword() { return _audited_('setAdminPassword', setAdminPassword_impl_, arguments); }
function recordDispatch_V3() { return _audited_('recordDispatch_V3', recordDispatch_V3_impl_, arguments); }
function adminDispatchTasks() { return _audited_('adminDispatchTasks', adminDispatchTasks_impl_, arguments); }
function adminUnassignTask() { return _audited_('adminUnassignTask', adminUnassignTask_impl_, arguments); }
function cancelDispatch_V3() { return _audited_('cancelDispatch_V3', cancelDispatch_V3_impl_, arguments); }
function adminResetAllAssignments() { return _audited_('adminResetAllAssignments', adminResetAllAssignments_impl_, arguments); }
function recordDispatchOrder() { return _audited_('recordDispatchOrder', recordDispatchOrder_impl_, arguments); }
function adminUpdateSequence_V11() { return _audited_('adminUpdateSequence_V11', adminUpdateSequence_V11_impl_, arguments); }
function adjustTaskSequence_V6() { return _audited_('adjustTaskSequence_V6', adjustTaskSequence_V6_impl_, arguments); }
function updateTaskOrder() { return _audited_('updateTaskOrder', updateTaskOrder_impl_, arguments); }
function updateBackYinggeStatus_V3() { return _audited_('updateBackYinggeStatus_V3', updateBackYinggeStatus_V3_impl_, arguments); }
function adminAddTempTask() { return _audited_('adminAddTempTask', adminAddTempTask_impl_, arguments); }
function upsertOrderFromOcr_V2() { return _audited_('upsertOrderFromOcr_V2', upsertOrderFromOcr_V2_impl_, arguments); }
function adminCancelTaskV2() { return _audited_('adminCancelTaskV2', adminCancelTaskV2_impl_, arguments); }
function adminDeleteTask_V11() { return _audited_('adminDeleteTask_V11', adminDeleteTask_V11_impl_, arguments); }
function adminBatchReturnTasks_V11() { return _audited_('adminBatchReturnTasks_V11', adminBatchReturnTasks_V11_impl_, arguments); }
function setDocTypeOverride_V41() { return _audited_('setDocTypeOverride_V41', setDocTypeOverride_V41_impl_, arguments); }
function batchSetDocTypeOverride_V42() { return _audited_('batchSetDocTypeOverride_V42', batchSetDocTypeOverride_V42_impl_, arguments); }
function manualAdjustFreight_V11() { return _audited_('manualAdjustFreight_V11', manualAdjustFreight_V11_impl_, arguments); }
function saveFreightSettings_V41() { return _audited_('saveFreightSettings_V41', saveFreightSettings_V41_impl_, arguments); }
function addCommonLocation_V41() { return _audited_('addCommonLocation_V41', addCommonLocation_V41_impl_, arguments); }
function verifyTask_V3() { return _audited_('verifyTask_V3', verifyTask_V3_impl_, arguments); }
function undoVerifyTask_V3() { return _audited_('undoVerifyTask_V3', undoVerifyTask_V3_impl_, arguments); }
function batchWarehouseSave_V3() { return _audited_('batchWarehouseSave_V3', batchWarehouseSave_V3_impl_, arguments); }
function driverRedoTask() { return _audited_('driverRedoTask', driverRedoTask_impl_, arguments); }
function updateFuelRecord_V11() { return _audited_('updateFuelRecord_V11', updateFuelRecord_V11_impl_, arguments); }
function updateMileageRecord_V11() { return _audited_('updateMileageRecord_V11', updateMileageRecord_V11_impl_, arguments); }
function sysSaveEdits() { return _audited_('sysSaveEdits', sysSaveEdits_impl_, arguments); }
function sysDeleteRows() { return _audited_('sysDeleteRows', sysDeleteRows_impl_, arguments); }
function sysGetWhitelist() { return _audited_('sysGetWhitelist', sysGetWhitelist_impl_, arguments); }
function createTodaySignPhotoZip() { return _audited_('createTodaySignPhotoZip', createTodaySignPhotoZip_impl_, arguments); }
function pushLineMessage_V11() { return _audited_('pushLineMessage_V11', pushLineMessage_V11_impl_, arguments); }
