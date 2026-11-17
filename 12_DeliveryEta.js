/**
 * 鈦傳速｜到貨預估查詢 (2026-11-17)
 *
 * 給高雅瓷 LINE 機器人在客戶群組回答「今天送○○案大概幾點到」用。
 *   doGet ?action=deliveryEta&company=<客戶簡稱>&branch=<分公司>&date=yyyy/MM/dd&q=<案名或地名關鍵字>
 *
 * 1. 身分驗證：不用共用金鑰。機器人帶一次性 nonce 來，這裡回頭向機器人正式網址確認這個 nonce 真的是它發的，
 *    確認後發一枚 6 小時的 token (存 ScriptCache)，之後機器人帶 token 即可，不必每次回頭確認。
 * 2. 只回傳「這家客戶」的站點；同車其他客戶只給「前面還有幾站」的數字，不給名稱與地址。
 * 3. 預估方式 (各站統一一套，取代 tracking.html 的直線 30km/h + 固定 15 分鐘)：
 *    - 起點：車輛即時位置 (20 分鐘內有更新)；否則用今天最後一張已完成單的位置與時間；都沒有就視為尚未出發，不報時間。
 *    - 第一段車程用 Google 路況 (calculatePreciseMinutes_V11，已有快取)；之後各段用距離估。
 *    - 每站停留與每公里車程，用近期實際完成時間校正 (etaCalibration_)，沒有足夠資料時用預設值。
 * 4. 每次有報出時間就寫一筆到「到貨預估記錄」分頁，之後可對照實際完成時間看誤差。
 */

var ETA_CFG = {
  BOT_EXEC: 'https://script.google.com/macros/s/AKfycbxB2wyCEt-0xeXL43Ak7NvkB2oNGVMfXwJRJvMZcCR0GYhpNlIbTtEwqy_G4pVJ5N-x/exec',
  TOKEN_TTL: 21600,          // token 6 小時
  GPS_FRESH_MIN: 20,         // 車輛位置幾分鐘內算新
  ROAD_FACTOR: 1.35,         // 直線距離 → 道路距離
  DEF_DWELL: 14,             // 預設每站停留 (分)
  DEF_MIN_PER_KM: 2.6,       // 預設每公里車程 (分)，約時速 23 公里
  DEF_PER_100KG: 0.8,        // 預設每 100 公斤多花的卸貨時間 (分)
  LOG_SHEET: '到貨預估記錄',
  DEPOT: { lat: 24.9555, lng: 121.3390 } // 鶯歌倉庫一帶 (只在完全沒有位置資料時當起點參考，不會用來報時間)
};

function _etaJson_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/** 驗證呼叫端是高雅瓷機器人；成功回傳 { ok:true, tk } */
function _etaAuth_(p) {
  var cache = CacheService.getScriptCache();
  var tk = String(p.tk || '');
  if (/^[A-Za-z0-9]{32,64}$/.test(tk) && cache.get('eta_tk_' + tk) === '1') return { ok: true, tk: tk };
  var n = String(p.n || '');
  if (!/^[A-Za-z0-9]{32,64}$/.test(n)) return { ok: false };
  try {
    var res = UrlFetchApp.fetch(ETA_CFG.BOT_EXEC + '?ac=etaNonce&n=' + encodeURIComponent(n), { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) return { ok: false };
    var j = JSON.parse(res.getContentText() || '{}');
    if (!j || j.ok !== true) return { ok: false };
  } catch (e) { return { ok: false }; }
  var fresh = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').substring(0, 48);
  cache.put('eta_tk_' + fresh, '1', ETA_CFG.TOKEN_TTL);
  return { ok: true, tk: fresh };
}

/** 試算表數字欄若被設成日期格式，getValues 會給 Date；這裡還原成原本的數字 (緯度欄就是這種情況) */
function _etaNum_(v) {
  if (v === '' || v === null || v === undefined) return NaN;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return (v.getTime() - new Date(1899, 11, 30, 0, 0, 0).getTime()) / 86400000;
  return parseFloat(String(v).replace(/,/g, ''));
}
function _etaValidLL_(lat, lng) { return isFinite(lat) && isFinite(lng) && lat > 21 && lat < 26.5 && lng > 119 && lng < 123; }
function _etaKm_(a, b, c, d) {
  var R = 6371, r = Math.PI / 180, dLat = (c - a) * r, dLng = (d - b) * r;
  var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function _etaHm_(min) {
  min = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  return ('0' + Math.floor(min / 60)).slice(-2) + ':' + ('0' + (min % 60)).slice(-2);
}
function _etaNowMin_() {
  var s = Utilities.formatDate(new Date(), 'GMT+8', 'HH:mm').split(':');
  return Number(s[0]) * 60 + Number(s[1]);
}
function _etaParseHm_(s) {
  var m = String(s || '').match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function _etaPlate_(v) { return String(v || '').toUpperCase().replace(/[\s\-_]/g, ''); }
function _etaAddrKey_(a) { return String(a || '').replace(/\s/g, '').replace(/[（(].*$/, '').replace(/臺/g, '台'); }
function _etaDone_(st) { return /已完成|已送達|結案/.test(String(st || '')); }
function _etaDead_(st) { return /取消|退回分公司/.test(String(st || '')); }

/** 用近期實際完成時間校正：同一天同一台車，相鄰兩站的完成時間差 ≈ 停留 + 每公里 × 距離 + 每百公斤 × 重量。結果快取一天。 */
function etaCalibration_(force) {
  var cache = CacheService.getScriptCache(), key = 'eta_calib_v1';
  if (!force) { var hit = cache.get(key); if (hit) { try { return JSON.parse(hit); } catch (e) { } } }
  var out = { dwell: ETA_CFG.DEF_DWELL, perKm: ETA_CFG.DEF_MIN_PER_KM, per100kg: ETA_CFG.DEF_PER_100KG, n: 0, src: 'default' };
  try {
    var ss = getSS_V11(), rows = [];
    [V11_PROD_CONFIG.SHEET_TASKS, V11_PROD_CONFIG.SHEET_TASKS + '_封存區'].forEach(function (name) {
      var sh = ss.getSheetByName(name);
      if (!sh || sh.getLastRow() < 2) return;
      var d = sh.getDataRange().getValues(), h = d[0].map(function (v) { return String(v).trim(); });
      var c = { date: h.indexOf('日期'), car: h.indexOf('車牌'), lat: h.indexOf('緯度'), lng: h.indexOf('經度'), fin: h.indexOf('配送完成時間'), w: h.indexOf('重量(kg)'), addr: h.indexOf('送貨地址') };
      if (c.date < 0 || c.car < 0 || c.lat < 0 || c.lng < 0 || c.fin < 0) return;
      var start = Math.max(1, d.length - 2500); // 只看最近約 2500 列
      for (var i = start; i < d.length; i++) {
        var f = d[i][c.fin];
        if (!(f instanceof Date)) continue;
        var lat = _etaNum_(d[i][c.lat]), lng = _etaNum_(d[i][c.lng]);
        if (!_etaValidLL_(lat, lng)) continue;
        var car = _etaPlate_(d[i][c.car]);
        if (!car || car.indexOf('外車') === 0) continue;
        rows.push({ k: car + '|' + Utilities.formatDate(f, 'GMT+8', 'yyyyMMdd'), t: f.getTime(), lat: lat, lng: lng, w: Number(d[i][c.w]) || 0, a: _etaAddrKey_(c.addr >= 0 ? d[i][c.addr] : '') });
      }
    });
    rows.sort(function (a, b) { return a.k < b.k ? -1 : a.k > b.k ? 1 : a.t - b.t; });
    // 同車同日同地址合併成一站 (重量加總，取最後完成時間)
    var stops = [];
    rows.forEach(function (r) {
      var last = stops[stops.length - 1];
      if (last && last.k === r.k && last.a === r.a) { last.w += r.w; last.t = Math.max(last.t, r.t); }
      else stops.push({ k: r.k, a: r.a, t: r.t, lat: r.lat, lng: r.lng, w: r.w });
    });
    var X = [], Y = [];
    for (var j = 1; j < stops.length; j++) {
      var p = stops[j - 1], q = stops[j];
      if (p.k !== q.k) continue;
      var gap = (q.t - p.t) / 60000, km = _etaKm_(p.lat, p.lng, q.lat, q.lng) * ETA_CFG.ROAD_FACTOR;
      if (gap < 4 || gap > 110 || km > 45) continue; // 排除批次結案、午休、回倉再出車
      X.push([1, km, q.w / 100]); Y.push(gap);
    }
    if (X.length >= 40) {
      var fit = _etaLeastSquares3_(X, Y);
      if (fit) {
        out.dwell = Math.min(30, Math.max(6, fit[0]));
        out.perKm = Math.min(5, Math.max(1.5, fit[1]));
        out.per100kg = Math.min(3, Math.max(0, fit[2]));
        out.n = X.length; out.src = 'history';
        out.dwell = Math.round(out.dwell * 10) / 10; out.perKm = Math.round(out.perKm * 100) / 100; out.per100kg = Math.round(out.per100kg * 100) / 100;
      }
    }
  } catch (e) { console.error('etaCalibration_ 失敗: ' + e.message); }
  try { cache.put(key, JSON.stringify(out), 21600); } catch (e2) { }
  return out;
}

/** 三個係數的最小平方法 (正規方程式，高斯消去) */
function _etaLeastSquares3_(X, Y) {
  var A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], B = [0, 0, 0], i, j, k;
  for (i = 0; i < X.length; i++) for (j = 0; j < 3; j++) { B[j] += X[i][j] * Y[i]; for (k = 0; k < 3; k++) A[j][k] += X[i][j] * X[i][k]; }
  for (i = 0; i < 3; i++) {
    var piv = i;
    for (j = i + 1; j < 3; j++) if (Math.abs(A[j][i]) > Math.abs(A[piv][i])) piv = j;
    if (Math.abs(A[piv][i]) < 1e-9) return null;
    var t = A[i]; A[i] = A[piv]; A[piv] = t; var tb = B[i]; B[i] = B[piv]; B[piv] = tb;
    for (j = i + 1; j < 3; j++) { var f = A[j][i] / A[i][i]; for (k = i; k < 3; k++) A[j][k] -= f * A[i][k]; B[j] -= f * B[i]; }
  }
  var x = [0, 0, 0];
  for (i = 2; i >= 0; i--) { var s = B[i]; for (j = i + 1; j < 3; j++) s -= A[i][j] * x[j]; x[i] = s / A[i][i]; }
  return x;
}

/**
 * 純計算：一台車今天的站點 → 各站預估到達 (分鐘，當日 00:00 起算)。
 * stops：依配送順序排好的未完成站 [{lat,lng,weight}]；origin：{lat,lng,min}；firstLegMin：第一段的路況車程 (可為 null)
 */
function etaPlanStops_(stops, origin, firstLegMin, calib) {
  var t = origin.min, lat = origin.lat, lng = origin.lng, out = [];
  for (var i = 0; i < stops.length; i++) {
    var s = stops[i], drive;
    if (i === 0 && firstLegMin !== null && firstLegMin !== undefined && isFinite(firstLegMin)) drive = firstLegMin;
    else if (_etaValidLL_(s.lat, s.lng) && _etaValidLL_(lat, lng)) drive = Math.max(3, _etaKm_(lat, lng, s.lat, s.lng) * ETA_CFG.ROAD_FACTOR * calib.perKm);
    else drive = 20; // 沒座標的站，給一個保守的固定車程
    var arrive = t + drive;
    out.push({ arrive: arrive, drive: drive });
    t = arrive + calib.dwell + (Number(s.weight) || 0) / 100 * calib.per100kg;
    if (_etaValidLL_(s.lat, s.lng)) { lat = s.lat; lng = s.lng; }
  }
  return out;
}

/** 預估時間 → 對客人講的區間 (越遠、前面站越多，區間越寬)，四捨到 10 分鐘 */
function etaWindow_(arriveMin, nowMin, stopsAhead) {
  var d = Math.max(0, arriveMin - nowMin);
  var lo = arriveMin - Math.max(5, d * 0.12);
  var hi = arriveMin + Math.max(15, d * 0.3 + stopsAhead * 6);
  lo = Math.max(nowMin, Math.floor(lo / 10) * 10);
  hi = Math.ceil(hi / 10) * 10;
  if (hi - lo < 20) hi = lo + 20;
  return { from: _etaHm_(lo), to: _etaHm_(hi) };
}

function handleDeliveryEtaApi_(e) {
  var p = (e && e.parameter) || {};
  var auth = _etaAuth_(p);
  if (!auth.ok) return _etaJson_({ success: false, error: 'forbidden' });
  try {
    _asSystem_('ETA_API');
    var res = deliveryEtaQuery_(String(p.company || ''), String(p.branch || ''), String(p.date || ''), String(p.q || ''));
    res.tk = auth.tk;
    return _etaJson_(res);
  } catch (err) {
    console.error('deliveryEta 失敗: ' + err.message);
    return _etaJson_({ success: false, tk: auth.tk, error: '查詢暫時失敗' });
  }
}

function deliveryEtaQuery_(company, branch, dateStr, q) {
  company = String(company || '').trim();
  if (company.length < 2) return { success: false, error: '缺少客戶名稱' };
  var todayStr = Utilities.formatDate(new Date(), 'GMT+8', 'yyyy/MM/dd');
  dateStr = String(dateStr || '').replace(/-/g, '/').trim();
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(dateStr)) dateStr = todayStr;
  var isToday = dateStr === todayStr;

  var war = getWarRoomData_V11(false, dateStr);
  if (!war || !war.success) return { success: false, error: '資料讀取失敗' };
  // 今天的快取可能是戰情室不帶日期讀的 (含未來日期的單)，這裡一律只留指定日期
  var tasks = (war.tasks || []).filter(function (t) { return String(t.date || '') === dateStr; });

  // 座標：緯度欄是日期格式，getWarRoomData 讀不到，這裡依列號自己讀一次 (只有當日主表的列才有 rowIndex 可對)
  var llByRow = {};
  try {
    var sh = getSS_V11().getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
    var hh = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (v) { return String(v).trim(); });
    var cLat = hh.indexOf('緯度'), cLng = hh.indexOf('經度'), cId = hh.indexOf('單號'), lastRow = sh.getLastRow();
    if (cLat >= 0 && cLng >= 0 && cId >= 0 && lastRow >= 2) {
      var lats = sh.getRange(2, cLat + 1, lastRow - 1, 1).getValues(), lngs = sh.getRange(2, cLng + 1, lastRow - 1, 1).getValues(), ids = sh.getRange(2, cId + 1, lastRow - 1, 1).getValues();
      for (var r = 0; r < lats.length; r++) {
        var la = _etaNum_(lats[r][0]), lo = _etaNum_(lngs[r][0]);
        if (_etaValidLL_(la, lo)) llByRow[(r + 2) + '|' + String(ids[r][0]).trim()] = { lat: la, lng: lo };
      }
    }
  } catch (eLL) { console.error('讀座標失敗: ' + eLL.message); }
  tasks.forEach(function (t) {
    var ll = llByRow[t.rowIndex + '|' + t.id];
    if (ll) { t._lat = ll.lat; t._lng = ll.lng; }
    else if (_etaValidLL_(Number(t.lat), Number(t.lng))) { t._lat = Number(t.lat); t._lng = Number(t.lng); }
  });

  // 這家客戶的單 (名稱比對沿用經銷商查詢的規則)
  var key = cleanCustName_V11(company), rawKey = company;
  var mine = tasks.filter(function (t) {
    if (branch && String(t.branch || '').trim() !== branch) return false;
    // 2026-11-17：只認完全相同的客戶名稱（兩邊都先經 cleanCustName_V11 清洗）。原本雙向包含比對，
    // 綁定的簡稱較短時會比到名稱裡含這幾個字的別家客戶，把別家的地址與到貨時間回到群組。
    var c = cleanCustName_V11(String(t.customer || ''));
    return key.length >= 2 && (c === key || String(t.customer || '').trim() === rawKey);
  });
  if (!mine.length) return { success: true, date: dateStr, isToday: isToday, total: 0, matches: [] };

  // 關鍵字 (案名、地名) 篩選；篩不到就回全部，讓機器人列出來給客人選
  var qq = String(q || '').replace(/\s/g, '');
  var hit = mine, narrowed = false;
  if (qq.length >= 2) {
    var f = mine.filter(function (t) { return (String(t.address) + String(t.location || '')).replace(/\s/g, '').indexOf(qq) !== -1; });
    if (f.length) { hit = f; narrowed = true; }
  }

  var calib = etaCalibration_(false), nowMin = _etaNowMin_();
  var driverBy = {};
  (war.vehicles || []).forEach(function (v) { driverBy[_etaPlate_(v.name)] = String(v.driver || ''); });

  // 每台車只算一次
  var planBy = {};
  function planFor(vehicle) {
    var vk = _etaPlate_(vehicle);
    if (planBy[vk]) return planBy[vk];
    var all = tasks.filter(function (t) { return _etaPlate_(t.vehicle) === vk && !_etaDead_(t.status); });
    var done = all.filter(function (t) { return _etaDone_(t.status); });
    var pend = all.filter(function (t) { return !_etaDone_(t.status); });
    pend.sort(function (a, b) { return (a.seq || 9999) - (b.seq || 9999); });
    // 同地址合併成一站
    var stops = [];
    pend.forEach(function (t) {
      var ak = _etaAddrKey_(t.address), s = null;
      for (var i = 0; i < stops.length; i++) if (stops[i].ak === ak) { s = stops[i]; break; }
      if (!s) { s = { ak: ak, lat: t._lat, lng: t._lng, weight: 0, ids: [] }; stops.push(s); }
      s.weight += Number(t.weight) || 0; s.ids.push(t.id);
      if (!_etaValidLL_(s.lat, s.lng) && _etaValidLL_(t._lat, t._lng)) { s.lat = t._lat; s.lng = t._lng; }
    });
    // 車輛位置：同車牌可能有重複列，取有座標且最新的那筆
    var pos = null;
    (war.vehiclePositions || []).forEach(function (vp) {
      if (_etaPlate_(vp.vehicle) !== vk || !_etaValidLL_(vp.lat, vp.lng)) return;
      var m = String(vp.lastUpdate || '').match(/(\d{4}\/\d{1,2}\/\d{1,2})\s+(\d{1,2}):(\d{2})/);
      if (!m || normalizeDate_Core(m[1]) !== todayStr) return;
      var um = Number(m[2]) * 60 + Number(m[3]);
      if (!pos || um > pos.min) pos = { lat: vp.lat, lng: vp.lng, min: um, target: String(vp.targetAddr || '') };
    });
    var plan = { stops: stops, state: 'assigned', arrive: {}, ahead: {}, stale: false };
    if (!isToday || !stops.length) { planBy[vk] = plan; return plan; }
    // 司機已指定「正前往」的那一站排到最前面
    if (pos && pos.target) {
      var tk2 = _etaAddrKey_(pos.target);
      for (var s2 = 1; s2 < stops.length; s2++) if (stops[s2].ak === tk2) { stops.unshift(stops.splice(s2, 1)[0]); break; }
    }
    var origin = null, firstLeg = null, lastDoneMin = null, lastDone = null;
    done.forEach(function (t) { var fm = _etaParseHm_(t.finishTime); if (fm !== null && (lastDoneMin === null || fm > lastDoneMin)) { lastDoneMin = fm; lastDone = t; } });
    if (pos && nowMin - pos.min <= ETA_CFG.GPS_FRESH_MIN && nowMin - pos.min >= -5) {
      origin = { lat: pos.lat, lng: pos.lng, min: nowMin };
      if (_etaValidLL_(stops[0].lat, stops[0].lng)) { try { firstLeg = calculatePreciseMinutes_V11(pos.lat, pos.lng, stops[0].lat, stops[0].lng); } catch (eM) { firstLeg = null; } }
      plan.state = 'onroute';
    } else if (lastDone && _etaValidLL_(lastDone._lat, lastDone._lng)) {
      // 位置沒更新，但今天已經送完幾站：從最後完成的那站、那個時間往後推；若推出來已經過了現在，代表資料落後
      origin = { lat: lastDone._lat, lng: lastDone._lng, min: lastDoneMin };
      plan.state = 'onroute'; plan.stale = (nowMin - lastDoneMin) > 60;
    } else if (done.length || pos) {
      plan.state = 'onroute'; plan.stale = true; // 已出車但沒有可用的位置與時間
    }
    if (origin && !plan.stale) {
      var legs = etaPlanStops_(stops, origin, firstLeg, calib);
      stops.forEach(function (s, i) {
        var a = Math.max(legs[i].arrive, nowMin + (i === 0 ? 2 : 5 + i * 3)); // 不報已經過去的時間
        s.ids.forEach(function (id) { plan.arrive[id] = a; plan.ahead[id] = i; });
      });
    } else {
      stops.forEach(function (s, i) { s.ids.forEach(function (id) { plan.ahead[id] = i; }); });
    }
    planBy[vk] = plan;
    return plan;
  }

  // 同車同地址的單合併成一筆回覆
  var groups = [], gBy = {};
  hit.forEach(function (t) {
    var gk = _etaPlate_(t.vehicle) + '|' + _etaAddrKey_(t.address) + '|' + (_etaDone_(t.status) ? 'D' : _etaDead_(t.status) ? 'X' : 'P');
    var g = gBy[gk];
    if (!g) {
      g = gBy[gk] = { ids: [], address: String(t.address || ''), place: '', branch: String(t.branch || ''), vehicle: String(t.vehicle || ''), status: String(t.status || ''), timeSlot: '', specifiedArrive: '', finishTime: '', boxes: [], weight: 0, seq: t.seq || 9999 };
      groups.push(g);
    }
    g.ids.push(t.id); g.weight += Number(t.weight) || 0;
    if (t.boxes) g.boxes.push(String(t.boxes));
    if (!g.place && t.location && !/^\[.*\]$/.test(String(t.location).trim())) g.place = String(t.location).trim();
    if (!g.timeSlot && t.timeSlot) g.timeSlot = String(t.timeSlot).trim();
    if (!g.specifiedArrive && t.specifiedArrive) g.specifiedArrive = String(t.specifiedArrive);
    if (t.finishTime && (!g.finishTime || t.finishTime > g.finishTime)) g.finishTime = String(t.finishTime);
  });

  var logRows = [];
  var matches = groups.map(function (g) {
    var o = { ids: g.ids, address: g.address, place: g.place, branch: g.branch, timeSlot: g.timeSlot, specifiedArrive: g.specifiedArrive, boxes: g.boxes.join('、'), weight: Math.round(g.weight) };
    if (_etaDone_(g.status)) { o.state = 'done'; o.finishTime = g.finishTime; return o; }
    if (_etaDead_(g.status)) { o.state = 'returned'; return o; }
    if (!g.vehicle) { o.state = 'unassigned'; return o; }
    o.driver = driverBy[_etaPlate_(g.vehicle)] || '';
    var plan = planFor(g.vehicle), id0 = g.ids[0];
    o.state = plan.state; o.stale = !!plan.stale;
    if (plan.ahead[id0] !== undefined) o.stopsAhead = plan.ahead[id0];
    if (plan.arrive[id0] !== undefined) {
      var w = etaWindow_(plan.arrive[id0], nowMin, o.stopsAhead || 0);
      o.etaFrom = w.from; o.etaTo = w.to;
      logRows.push([new Date(), dateStr, g.ids.join(','), company, g.vehicle, o.stopsAhead || 0, _etaHm_(plan.arrive[id0]), w.from, w.to, calib.src]);
    }
    return o;
  });
  // 還沒到的排前面，已送達的排後面
  var ord = { onroute: 0, assigned: 1, unassigned: 2, done: 3, returned: 4 };
  matches.sort(function (a, b) { return (ord[a.state] - ord[b.state]) || ((a.stopsAhead || 0) - (b.stopsAhead || 0)); });

  if (logRows.length) { try { _etaLog_(logRows); } catch (eLog) { console.error('到貨預估記錄寫入失敗: ' + eLog.message); } }
  return { success: true, date: dateStr, isToday: isToday, total: mine.length, narrowed: narrowed, now: _etaHm_(nowMin), matches: matches.slice(0, 8), calib: calib };
}

/** 寫入「到貨預估記錄」；同一張單 10 分鐘內不重複記 */
function _etaLog_(rows) {
  var cache = CacheService.getScriptCache();
  rows = rows.filter(function (r) { var k = 'eta_lg_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(r[2]))).substring(0, 20); if (cache.get(k)) return false; cache.put(k, '1', 600); return true; });
  if (!rows.length) return;
  var ss = getSS_V11(), sh = ss.getSheetByName(ETA_CFG.LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(ETA_CFG.LOG_SHEET);
    sh.appendRow(['查詢時間', '配送日期', '單號', '客戶', '車牌', '前面站數', '預估到達', '回覆區間起', '回覆區間迄', '校正來源']);
    sh.setFrozenRows(1);
  }
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/**
 * 預估準確度：把「到貨預估記錄」對上派送清單的實際完成時間 (在編輯器手動執行，看執行記錄)。
 * 回傳 { n, hitRate (實際落在回覆區間內的比例), avgErrMin (預估到達與實際完成的平均差，分鐘) }
 */
function etaAccuracyReport_V1(e) {
  _requireSystemContext_(e);
  var ss = getSS_V11(), lg = ss.getSheetByName(ETA_CFG.LOG_SHEET);
  if (!lg || lg.getLastRow() < 2) { console.log('還沒有預估記錄'); return { n: 0 }; }
  var fin = {};
  [V11_PROD_CONFIG.SHEET_TASKS, V11_PROD_CONFIG.SHEET_TASKS + '_封存區'].forEach(function (name) {
    var sh = ss.getSheetByName(name); if (!sh || sh.getLastRow() < 2) return;
    var d = sh.getDataRange().getValues(), h = d[0].map(function (v) { return String(v).trim(); }), ci = h.indexOf('單號'), cf = h.indexOf('配送完成時間');
    if (ci < 0 || cf < 0) return;
    for (var i = 1; i < d.length; i++) if (d[i][cf] instanceof Date) fin[String(d[i][ci]).trim()] = d[i][cf];
  });
  var rows = lg.getRange(2, 1, lg.getLastRow() - 1, 10).getValues(), n = 0, hit = 0, err = 0;
  rows.forEach(function (r) {
    var id = String(r[2]).split(',')[0].trim(), f = fin[id];
    if (!f) return;
    if (Utilities.formatDate(f, 'GMT+8', 'yyyy/MM/dd') !== normalizeDate_Core(r[1])) return;
    var fm = _etaParseHm_(Utilities.formatDate(f, 'GMT+8', 'HH:mm')), est = _etaParseHm_(_fmtArriveTime_(r[6])), a = _etaParseHm_(_fmtArriveTime_(r[7])), b = _etaParseHm_(_fmtArriveTime_(r[8]));
    if (fm === null || est === null) return;
    n++; err += Math.abs(fm - est); if (a !== null && b !== null && fm >= a - 5 && fm <= b + 15) hit++;
  });
  var out = { n: n, hitRate: n ? Math.round(hit / n * 100) + '%' : '-', avgErrMin: n ? Math.round(err / n) : '-' };
  console.log(JSON.stringify(out));
  return out;
}
