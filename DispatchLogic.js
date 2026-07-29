/**
 * ==========================================
 * 🚚 派車系統 V15.1 超強讀取版 (數據同步對標)
 * ==========================================
 */

const CONFIG = {
  SS_ID: "1M-Ewy58fQs-QmqzO5nERoXDCm7lm6S_mrrAIR1mUOtA",
  SHEET_TASKS: "派送清單",
  SHEET_VEHICLE: "車輛管理"
};

function getSS() { return SpreadsheetApp.openById(CONFIG.SS_ID); }

/** 標頭尋找器 (忽略空格、精準對位) */
function _findHeader(arr, keys) {
    for (let k of keys) {
        let i = arr.findIndex(h => h === k); if (i !== -1) return i;
        i = arr.findIndex(h => h.replace(/\s/g, '').includes(k)); if (i !== -1) return i;
    }
    return -1;
}

/** 1. 取得任務 (V15.1) */
function getUnDispatchedTasks_V3() {
  try {
    const ss = getSS();
    const sheet = ss.getSheetByName(CONFIG.SHEET_TASKS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h).trim());

    const findH = _findHeader;

    const idx = {
      date: findH(headers, ['日期']),
      branch: findH(headers, ['分公司']),
      orderNo: findH(headers, ['單號']),
      customer: findH(headers, ['客戶']),
      address: findH(headers, ['地址']),
      weight: findH(headers, ['重量']),
      status: findH(headers, ['狀態']), // 🔍 對標 Dashboard 的狀態欄
      timeSlot: findH(headers, ['到貨時間']),
      size: findH(headers, ['尺寸']),
      boxes: findH(headers, ['箱數']),
      thumbnail: findH(headers, ['圖檔', '縮圖']),
      isBack: findH(headers, ['回鶯歌']),
      order: findH(headers, ['順序', '趟次']),
      isReturn: findH(headers, ['退貨']),
      dispatchDriver: findH(headers, ['派遣司機']),
      plate: findH(headers, ['車牌', '車號']),
      whStatus: findH(headers, ['驗貨狀態']),
      whDriver: findH(headers, ['實際載貨人', '驗貨人']),
      whTime: findH(headers, ['驗貨時間']),
      shippingType: findH(headers, ['配送方式', '任務類型', '方式']),
      type: findH(headers, ['類型', '單別']),
      wrapSeal: findH(headers, ['封膠膜', '膠膜', '封膜']),
      note: findH(headers, ['備註', '備註欄', '備註事項']),
      returnReason: findH(headers, ['退回原因', '退回備註']),
      driverConfirm: findH(headers, ['司機確認狀態'])
    };

    for (let n = 1; n <= 10; n++) {
        idx["itemCode" + n] = headers.indexOf("品項" + n + "編號");
        idx["itemQty" + n] = headers.indexOf("品項" + n + "數量");
    }

    const tasks = [];
    const productMap = (typeof lookupProductMasterData_V11 === 'function') ? lookupProductMasterData_V11() : {};
    const normalizeCode = (code) => (typeof normalizeProductCode_V11 === 'function')
        ? normalizeProductCode_V11(code)
        : String(code || '').trim().toUpperCase().replace(/\s/g, '');
    const findProduct = (code) => (typeof findProductInfo_V11 === 'function')
        ? findProductInfo_V11(productMap, code)
        : (productMap[normalizeCode(code)] || {});
    const calcBoxes = (qty, pcsPerBox) => (typeof calcBoxQtyFromPieces_V11 === 'function')
        ? calcBoxQtyFromPieces_V11(qty, pcsPerBox)
        : '';
    const calcWeight = (qty, pcsPerBox, kgPerBox) => (typeof calcItemWeightKg_V11 === 'function')
        ? calcItemWeightKg_V11(qty, pcsPerBox, kgPerBox)
        : '';
    const tz = Session.getScriptTimeZone();
    const todayStr = Utilities.formatDate(new Date(), tz, "yyyy/MM/dd");
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        
        // 🔒 1. 狀態嚴格過濾
        const sStr = String(row[idx.status] || '').trim();
        const skipKeys = ['已完成', '已送達', '結案', '取消'];
        if (skipKeys.some(k => sStr === k || sStr.includes(k))) continue;

        // 📅 2. 日期有效性
        let dVal = "";
        if (row[idx.date] instanceof Date) dVal = Utilities.formatDate(row[idx.date], tz, "yyyy/MM/dd");
        else dVal = String(row[idx.date] || '').trim();
        if (!dVal || dVal === "" || dVal.includes("1899")) continue;
        dVal = dVal.replace(/-/g, '/');
        var dParts = dVal.split('/');
        if (dParts.length >= 3) {
            var dyY = dParts[0].trim();
            var dyM = ('0' + dParts[1].replace(/\D/g, '')).slice(-2);
            var dyD = ('0' + dParts[2].replace(/\D/g, '').substring(0, 2)).slice(-2);
            var yNum2 = parseInt(dyY, 10);
            if (!isNaN(yNum2)) {
                if (yNum2 < 200) dyY = String(yNum2 + 1911);
                else if (dyY.length === 2) dyY = '20' + dyY;
            }
            dVal = dyY + '/' + dyM + '/' + dyD;
        }
        if (dVal < todayStr) continue;

        // 🚛 3. 指派判定 (同步對標)
        let drv = String(row[idx.dispatchDriver] || '').trim();
        let plate = String(row[idx.plate] || '').trim();
        
        // V15.3 Fix: 如果狀態是「待指派」，則強制清空指派資訊，避免殘留文字造成不同步
        if (sStr === '待指派' || sStr === '') {
            drv = '';
            plate = '';
        }
        const finalAssigned = drv || plate; 

        const backRaw = String(row[idx.isBack] || '').toUpperCase();
        const isB = (backRaw.includes('T') || backRaw.includes('1') || backRaw.includes('V') || backRaw.includes('回'));

        tasks.push({
            id: String(row[idx.orderNo]), date: dVal, branch: String(row[idx.branch]||''),
            customer: String(row[idx.customer] || ''), address: String(row[idx.address]||''),
            weight: parseFloat(row[idx.weight]) || 0, 
            timeSlot: (row[idx.timeSlot] instanceof Date) ? Utilities.formatDate(row[idx.timeSlot], tz, "HH:mm") : String(row[idx.timeSlot] || '').trim(),
            size: String(row[idx.size]||''), boxes: String(row[idx.boxes]||'0'),
            thumbnail: String(row[idx.thumbnail]||''), isBackYingge: isB,
            status: sStr,
            // V8.5 Fix: 雙重判定退貨標籤，同時檢查「退貨」欄與「配送方式」欄
            isReturn: (idx.isReturn !== -1 && (String(row[idx.isReturn]).includes('是') || String(row[idx.isReturn]).includes('退'))) || 
                     (idx.shippingType !== -1 && String(row[idx.shippingType]).includes('退貨')),
            assignedDriver: finalAssigned, vehicle: plate, order: Number(row[idx.order]) || 999, rowIndex: i + 1,
            whStatus: String(row[idx.whStatus] || '').trim(),
            whDriver: String(row[idx.whDriver] || '').trim(),
            whTime: String(row[idx.whTime] || '').trim(),
            driverConfirm: idx.driverConfirm !== -1 ? String(row[idx.driverConfirm] || '').trim() : '',
            shippingType: idx.shippingType !== -1 ? String(row[idx.shippingType] || '').trim() : '',
            type: idx.type !== -1 ? String(row[idx.type] || '').trim() : '',
            note: idx.note !== -1 ? String(row[idx.note] || '').trim() : '',
            wrapSeal: (function() {
                var ws = idx.wrapSeal !== -1 ? String(row[idx.wrapSeal] || '').trim() : '';
                if (ws) return ws;
                return String(idx.note !== -1 ? String(row[idx.note] || '').trim() : '').indexOf('膠膜') !== -1 ? '封' : '';
            })(),
            returnReason: idx.returnReason !== -1 ? String(row[idx.returnReason] || '').trim() : '',
            items: (() => {
                const arr = [];
                const sizeArr = String(row[idx.size] || '').split(/[,，、；;\/]+/).map(s => String(s).trim()).filter(Boolean);
                for (let n = 1; n <= 10; n++) {
                    const cIdx = idx["itemCode" + n];
                    const qIdx = idx["itemQty" + n];
                    if (cIdx !== -1 && qIdx !== -1) {
                        const code = String(row[cIdx] || '').trim();
                        const qty = String(row[qIdx] || '').trim();
                        if (code && qty) {
                            const pInfo = findProduct(code);
                            const itemSize = String(pInfo.size || '').trim() || sizeArr[n - 1] || sizeArr[0] || '';
                            arr.push({
                                code: code,
                                qty: qty,
                                size: itemSize,
                                pcsPerBox: pInfo.pcsPerBox || '',
                                boxQty: calcBoxes(qty, pInfo.pcsPerBox),
                                kgPerBox: pInfo.kgPerBox || '',
                                itemWeight: calcWeight(qty, pInfo.pcsPerBox, pInfo.kgPerBox),
                                image: pInfo.img || '',
                                series: pInfo.name || '',
                                originalName: pInfo.originalName || ''
                            });
                        }
                    }
                }
                return arr;
            })()
        });
    }
    return { success: true, tasks: tasks };
  } catch (e) { return { success: false, error: e.message }; }
}

/** 2. 取得司機 */
function getDrivers_V3() {
  try {
    const ss = getSS();
    const sheet = ss.getSheetByName(CONFIG.SHEET_VEHICLE);
    const data = sheet.getDataRange().getValues();
    const h = data[0].map(v => String(v).trim());
    const cp = h.findIndex(n => n.includes('車牌'));
    const cn = h.findIndex(n => n.includes('司機') || n.includes('姓名'));
    const drivers = [];
    for (let i = 1; i < data.length; i++) {
        if (data[i][cn]) drivers.push({ plate: String(data[i][cp]).trim(), name: String(data[i][cn]).trim() });
    }
    return { success: true, drivers: drivers };
  } catch (e) { return { success: false, error: e.message }; }
}

/** 3. 核心指派 (寫入 V, W, G, H, AD 欄位) */
function recordDispatch_V3(tasks, config) {
  var lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(15000)) throw new Error("同步鎖定中");
    const ss = getSS();
    const sheet = ss.getSheetByName(CONFIG.SHEET_TASKS);
    const data = sheet.getDataRange().getValues();
    const h = data[0].map(v => String(v).trim());
    
    const cId = h.indexOf('單號');
    const cDrv = h.indexOf('派遣司機');     // V
    const cShi = h.indexOf('派遣車次');     // W
    const cPla = h.findIndex(v => v === '車牌' || v === '車號'); // G
    const cSta = h.indexOf('狀態');        // H
    const cOrd = h.findIndex(v => v === '順序' || v === '趟次'); // AD

    let curMax = 0;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][cPla]) === config.plate) curMax = Math.max(curMax, Number(data[i][cOrd]) || 0);
    }

    const triplen = tasks.length;
    let tripTotalWeight = 0;
    tasks.forEach(t => tripTotalWeight += Number(t.weight||0));
    
    // 🚚 V15.2: 取得車身資訊以計算利用率
    const vRef = ss.getSheetByName(CONFIG.SHEET_VEHICLE).getDataRange().getValues();
    const vH = vRef[0].map(v => String(v).trim());
    const vIdxP = vH.indexOf('車牌');
    const vIdxL = vH.indexOf('總載重');
    let vMax = (config.plate.includes('BX') || config.plate.includes('BND')) ? 6000 : 3500; // Default
    const vMatch = vRef.find(r => String(r[vIdxP]).trim() === config.plate);
    if(vMatch && vIdxL !== -1) vMax = Number(vMatch[vIdxL]) || vMax;
    const utilization = (tripTotalWeight / vMax * 100).toFixed(1) + "%";

    tasks.forEach(t => {
      let rIdx = 0;
      for(let k=1; k<data.length; k++) { if(String(data[k][cId]) === String(t.id)) { rIdx = k+1; break; } }
      if (rIdx) {
        if(cDrv !== -1) sheet.getRange(rIdx, cDrv+1).setValue(config.name);
        if(cShi !== -1) sheet.getRange(rIdx, cShi+1).setValue(config.shift);
        if(cPla !== -1) sheet.getRange(rIdx, cPla+1).setValue(config.plate);
        if(cSta !== -1) sheet.getRange(rIdx, cSta+1).setValue('配送中');
        if(cOrd !== -1) { curMax++; sheet.getRange(rIdx, cOrd+1).setValue(curMax); }
      }
    });
    
    // 一趟一列記錄，供地址群組型排車分析使用
    logDispatchHabit_V8(ss, {
      tasks: tasks,
      config: config,
      tripTotalWeight: tripTotalWeight,
      utilization: utilization,
      source: config.source || '戰情室指派',
      operator: config.operator || 'System_AI'
    });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

function updateWhDriver_V3(id, driver) {
  try {
    const ss = getSS();
    const sheet = ss.getSheetByName(CONFIG.SHEET_TASKS);
    const h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(v => String(v).trim());
    const cId = h.indexOf('單號');
    const cWh = h.indexOf('實際載貨人');
    if (cId === -1 || cWh === -1) throw new Error("找不到欄位");
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][cId]) === String(id)) {
        sheet.getRange(i+1, cWh + 1).setValue(driver);
        break;
      }
    }
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

function updateBackYinggeStatus_V3(id, dummy, isB) {
  try {
    const ss = getSS();
    const sheet = ss.getSheetByName(CONFIG.SHEET_TASKS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h).trim());

    const findH = _findHeader;
    const cId = findH(headers, ['單號']);
    const cB = findH(headers, ['回鶯歌']);
    
    if (cId === -1 || cB === -1) throw new Error("無單號或回鶯歌欄位");

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][cId]) === String(id)) { 
          sheet.getRange(i+1, cB+1).setValue(isB ? true : false); 
          break; 
      }
    }
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

function batchDispatchSave_V3(jsonStr) {
  try {
    const ss = getSS();
    const sheet = ss.getSheetByName(CONFIG.SHEET_TASKS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h).trim());
    const findH = _findHeader;
    const cId = findH(headers, ['單號']);
    const cDrv = findH(headers, ['派遣司機']);
    const cYg = findH(headers, ['回鶯歌']);
    const cWh = findH(headers, ['實際載貨人']);
    const cSt = findH(headers, ['狀態']);
    if (cId === -1 || cDrv === -1) throw new Error("無單號或派遣司機欄位");

    const payloads = JSON.parse(jsonStr);
    if (!Array.isArray(payloads) || payloads.length === 0) throw new Error("空資料");

    const rowMap = {};
    for (let i = 1; i < data.length; i++) {
      rowMap[String(data[i][cId]).trim()] = i;
    }

    for (const p of payloads) {
      const rowIdx = rowMap[String(p.id).trim()];
      if (rowIdx === undefined) continue;
      const r = rowIdx + 1;
      const hasDriver = p.assignedDriver && String(p.assignedDriver).trim() !== '';
      sheet.getRange(r, cDrv + 1).setValue(p.assignedDriver || '');
      if (cSt !== -1 && hasDriver) {
        sheet.getRange(r, cSt + 1).setValue('配送中');
      }
      if (cYg !== -1) sheet.getRange(r, cYg + 1).setValue(!!p.isBackYingge);
      if (cWh !== -1) sheet.getRange(r, cWh + 1).setValue(p.whDriver || p.assignedDriver || '');
    }

    return { success: true, count: payloads.length };
  } catch (e) { return { success: false, error: e.message }; }
}

function recordDispatchOrder(updates) {
  try {
    const ss = getSS();
    const sheet = ss.getSheetByName(CONFIG.SHEET_TASKS);
    const h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(v => String(v).trim());
    const cId = h.indexOf('單號');
    const cO = h.findIndex(n => n === '順序' || n === '趟次');
    const data = sheet.getDataRange().getValues();
    updates.forEach(up => {
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][cId]) === String(up.id)) { sheet.getRange(i+1, cO+1).setValue(up.order); break; }
      }
    });
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

function cancelDispatch_V3(id) {
  try {
    const ss = getSS();
    const sheet = ss.getSheetByName(CONFIG.SHEET_TASKS);
    const h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(v => String(v).trim());
    const cId = h.indexOf('單號');
    const targetCols = ['派遣司機', '派遣車次', '車牌', '車號', '狀態', '順序', '趟次'];
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][cId]) === String(id)) {
        targetCols.forEach(colName => {
          let ci = h.indexOf(colName);
          if (ci !== -1) sheet.getRange(i+1, ci+1).setValue(colName === '狀態' ? '待指派' : '');
        });
        break;
      }
    }
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

function ensureDispatchHabitSheet_V2(ss) {
  const sheetName = '排車習慣記錄';
  const headers = [
    '記錄時間', '派遣批次ID', '派遣來源', '分公司',
    '車牌', '司機', '派遣車次',
    '訂單數', '訂單清單', '客戶清單',
    '地址數', '地址清單', '主要行政區', '行政區集合',
    '總重量(kg)', '總箱數', '尺寸集合',
    '是否回鶯歌', '載重利用率', '總載重級距',
    '人工備註', '操作人'
  ];

  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);

  const lastCol = Math.max(sheet.getLastColumn(), headers.length);
  const currentHeaders = sheet.getLastRow() > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v).trim())
    : [];
  const hasV2Schema = currentHeaders.indexOf('派遣批次ID') !== -1 && currentHeaders.indexOf('地址清單') !== -1;

  if (sheet.getLastRow() === 0 || !hasV2Schema) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground('#111827')
      .setFontColor('#ffffff')
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    sheet.setFrozenRows(1);
  }

  return { sheet: sheet, headers: headers };
}

/** 5. 智慧派遣大數據記錄器 V9.0 - 一趟一列 / 地址群組導向 */
function logDispatchHabit_V8(ss, data) {
  try {
    const target = ensureDispatchHabitSheet_V2(ss);
    const sheet = target.sheet;
    const headers = target.headers;
    const tasks = Array.isArray(data.tasks) && data.tasks.length ? data.tasks : (data.task ? [data.task] : []);
    if (!tasks.length) return;

    const nowDate = new Date();
    const now = Utilities.formatDate(nowDate, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss");
    const config = data.config || {};

    const toNumber = (val) => {
      const n = parseFloat(String(val || '').replace(/[^\d.\-]/g, ''));
      return isNaN(n) ? 0 : n;
    };
    const uniqueList = (arr) => {
      const seen = {};
      const out = [];
      arr.forEach(v => {
        const text = String(v || '').trim();
        if (!text || seen[text]) return;
        seen[text] = true;
        out.push(text);
      });
      return out;
    };
    const summarizeWeightBand = (weight) => {
      if (weight >= 3000) return '3000+';
      if (weight >= 2500) return '2500-2999';
      if (weight >= 2000) return '2000-2499';
      if (weight >= 1500) return '1500-1999';
      if (weight >= 1000) return '1000-1499';
      if (weight >= 500) return '500-999';
      return '0-499';
    };
    const countByValue = (arr) => {
      const map = {};
      arr.forEach(v => {
        const text = String(v || '').trim();
        if (!text) return;
        map[text] = (map[text] || 0) + 1;
      });
      return map;
    };
    const pickTopKey = (map) => {
      let topKey = '';
      let topCount = -1;
      Object.keys(map).forEach(k => {
        if (map[k] > topCount) {
          topKey = k;
          topCount = map[k];
        }
      });
      return topKey;
    };

    const totalWeight = data.tripTotalWeight || tasks.reduce((sum, t) => sum + toNumber(t.weight), 0);
    const totalBoxes = tasks.reduce((sum, t) => sum + toNumber(t.boxes), 0);
    const orderIds = uniqueList(tasks.map(t => t.id));
    const customers = uniqueList(tasks.map(t => t.customer));
    const addresses = uniqueList(tasks.map(t => t.address));
    const districts = uniqueList(tasks.map(t => extractDistrict(t.address)));
    const districtTop = pickTopKey(countByValue(districts)) || (districts[0] || '未知');
    const sizes = uniqueList(tasks.map(t => t.size));
    const branches = uniqueList(tasks.map(t => t.branch));
    const anyBackYingge = tasks.some(t => !!t.isBackYingge);
    const batchId = Utilities.formatDate(nowDate, Session.getScriptTimeZone(), "yyyyMMddHHmmss") + '-' + String(config.plate || 'UNSET');

    const rowMap = {
      '記錄時間': now,
      '派遣批次ID': batchId,
      '派遣來源': data.source || '戰情室指派',
      '分公司': branches.join('、'),
      '車牌': config.plate || '',
      '司機': config.name || '',
      '派遣車次': config.shift || '1',
      '訂單數': orderIds.length,
      '訂單清單': orderIds.join('、'),
      '客戶清單': customers.join('、'),
      '地址數': addresses.length,
      '地址清單': addresses.join('｜'),
      '主要行政區': districtTop,
      '行政區集合': districts.join('、'),
      '總重量(kg)': totalWeight,
      '總箱數': totalBoxes,
      '尺寸集合': sizes.join('、'),
      '是否回鶯歌': anyBackYingge ? 'TRUE' : 'FALSE',
      '載重利用率': data.utilization || '',
      '總載重級距': summarizeWeightBand(totalWeight),
      '人工備註': data.note || '',
      '操作人': data.operator || 'System_AI'
    };

    const rowData = headers.map(h => rowMap.hasOwnProperty(h) ? rowMap[h] : '');
    sheet.appendRow(rowData);
  } catch (e) { console.error("Logger Error: " + e.message); }
}

/** 6. 行政區辨識組 */
function extractDistrict(addr) {
  if (!addr) return "未知";
  const match = addr.match(/[\u4e00-\u9fff]{2,3}(區)/); // 抓取 桃園區, 八德區 等
  if (match) return match[0];
  // 備用邏輯：如果沒抓到「區」，抓前六碼
  return addr.substring(0, 6);
}

/** 6.5 倉庫批次儲存 (V0708.8) */
function batchWarehouseSave_V3(jsonStr) {
  try {
    const ss = getSS();
    const sheet = ss.getSheetByName(CONFIG.SHEET_TASKS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h).trim());
    const findH = _findHeader;
    const cId = findH(headers, ['單號']);
    const cStat = findH(headers, ['驗貨狀態']);
    const cDrv = findH(headers, ['派遣司機']);
    const cWh = findH(headers, ['實際載貨人']);
    const cConfirm = findH(headers, ['司機確認狀態']);
    const cConfirmTime = findH(headers, ['司機確認時間']);
    if (cId === -1) throw new Error("無單號欄位");

    const payloads = JSON.parse(jsonStr);
    const rowMap = {};
    for (let i = 1; i < data.length; i++) rowMap[String(data[i][cId]).trim()] = i;

    const tz = Session.getScriptTimeZone();
    const now = Utilities.formatDate(new Date(), tz, "yyyy/MM/dd HH:mm:ss");

    for (const p of payloads) {
      const rowIdx = rowMap[String(p.id).trim()];
      if (rowIdx === undefined) continue;
      const r = rowIdx + 1;
      if (cStat !== -1 && p.whStatus !== undefined) sheet.getRange(r, cStat + 1).setValue(p.whStatus || '');
      if (cDrv !== -1 && p.assignedDriver !== undefined) sheet.getRange(r, cDrv + 1).setValue(p.assignedDriver || '');
      if (cWh !== -1 && p.whDriver !== undefined) sheet.getRange(r, cWh + 1).setValue(p.whDriver || p.assignedDriver || '');
      if (cConfirm !== -1 && p.driverConfirm !== undefined) {
        sheet.getRange(r, cConfirm + 1).setValue(p.driverConfirm || '');
        if (cConfirmTime !== -1) sheet.getRange(r, cConfirmTime + 1).setValue(p.driverConfirm === '已確認' ? now : '');
      }
    }
    return { success: true, count: payloads.length };
  } catch (e) { return { success: false, error: e.message }; }
}

/** 7. 倉庫驗貨 (V1.0) */
function verifyTask_V3(id, actualDriver) {
  try {
    const ss = getSS();
    const sheet = ss.getSheetByName(CONFIG.SHEET_TASKS);
    const h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(v => String(v).trim());
    
    const cId = h.indexOf('單號');
    const cStat = h.indexOf('驗貨狀態');
    const cActD = h.indexOf('實際載貨人');
    const cTime = h.indexOf('驗貨時間');
    
    if (cId === -1 || cStat === -1) throw new Error("找不到驗貨相關欄位");
    
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][cId]) === String(id)) {
        const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss");
        sheet.getRange(i+1, cStat + 1).setValue('已上車');
        sheet.getRange(i+1, cActD + 1).setValue(actualDriver);
        sheet.getRange(i+1, cTime + 1).setValue(now);
        break;
      }
    }
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}

function undoVerifyTask_V3(id) {
  try {
    const ss = getSS();
    const sheet = ss.getSheetByName(CONFIG.SHEET_TASKS);
    const h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(v => String(v).trim());
    
    const cId = h.indexOf('單號');
    const cStat = h.indexOf('驗貨狀態');
    const cActD = h.indexOf('實際載貨人');
    const cTime = h.indexOf('驗貨時間');
    
    if (cId === -1 || cStat === -1) throw new Error("找不到驗貨相關欄位");
    
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][cId]) === String(id)) {
        sheet.getRange(i+1, cStat + 1).setValue('');
        sheet.getRange(i+1, cActD + 1).setValue('');
        sheet.getRange(i+1, cTime + 1).setValue('');
        break;
      }
    }
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
}
