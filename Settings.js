/**
 * 鈦傳速｜系統設定專用後端引擎 V34.9
 * 負責處理戰情室中【系統設定】的五大獨立報表讀取與 CRUD，完全不干擾 Code.js 的派車邏輯
 */

/**
 * 一次性初始化函式：建立「車輛保養」分頁並填入中文標題列。
 * 此函式只需在 GAS 後台執行一次，之後即可正常使用。
 * 同時清除英文暫時分頁「工作表6」。
 */
function sysInitMaintSheet() {
    var ss = SpreadsheetApp.openById(V11_PROD_CONFIG.SS_ID);

    // 刪除英文暫時分頁（如果存在）
    ['VehicleMaint', '工作表6', 'Sheet6', 'Sheet 6'].forEach(function (name) {
        var s = ss.getSheetByName(name);
        if (s) ss.deleteSheet(s);
    });

    // 建立或取得「車輛保養」分頁
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_MAINT);
    if (!sheet) {
        sheet = ss.insertSheet(V11_PROD_CONFIG.SHEET_MAINT);
    }

    // 若已有標題列，不覆蓋
    var existing = sheet.getRange(1, 1).getValue();
    if (existing && String(existing).trim() !== '') {
        return '車輛保養分頁已存在標題列，未做修改。現有第一欄標題：' + existing;
    }

    // 填入中文標題列
    var headers = [
        '保養日期', '車牌號碼', '保養人員',
        '本次里程(km)', '下次保養里程(km)', '距上次間隔(天)',
        '變速箱油', '方向機油',
        '前輪碟盤', '後輪碟盤', '前輪來令片', '後輪來令片',
        '空氣濾芯', '冷氣濾網',
        '右前輪胎', '右後輪胎', '左前輪胎', '左後輪胎',
        '火星塞', '皮帶', '備註'
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

    // 美化標題列
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground('#1e3a5f');
    headerRange.setFontColor('#ffffff');
    headerRange.setFontWeight('bold');
    sheet.setFrozenRows(1);

    return '✅ 車輛保養分頁建立完成！共建立 ' + headers.length + ' 個欄位標題。';
}

// ──────────────────────────────
// 工具函式
// ──────────────────────────────

/**
 * 一次性初始化函式：建立「修改紀錄」分頁並填入英文標題列（方便識別）。
 * 此函式只需在 GAS 後台執行一次。
 */
function sysInitAuditSheet() {
    var ss = SpreadsheetApp.openById(V11_PROD_CONFIG.SS_ID);

    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_AUDIT);
    if (!sheet) {
        sheet = ss.insertSheet(V11_PROD_CONFIG.SHEET_AUDIT);
    }

    // 若已有標題列，不覆蓋
    var existing = sheet.getRange(1, 1).getValue();
    if (existing && String(existing).trim() !== '') {
        return '修改紀錄分頁已存在，未做修改。';
    }

    var headers = [
        '修改時間', '操作人Email', '操作人姓名', '操作類型',
        '影響分頁', '影響列號', '欄位名稱', '修改前內容', '修改後內容', '備註'
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground('#2d1b69');
    headerRange.setFontColor('#ffffff');
    headerRange.setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 160); // 修改時間
    sheet.setColumnWidth(2, 200); // Email
    sheet.setColumnWidth(7, 150); // 欄位名稱
    sheet.setColumnWidth(8, 200); // 修改前
    sheet.setColumnWidth(9, 200); // 修改後

    return '✅ 修改紀錄分頁建立完成！共建立 ' + headers.length + ' 個欄位標題。';
}

function sysVerifyPwd(pwd) {
    if (String(pwd).trim() !== '54088') throw new Error('密碼錯誤，拒絕存取');
    return true;
}

/**
 * 從資料表（由舊到新排列）中，從底部往上找指定車號或司機最新一筆的日期。
 * @param {string[][]} data - 原始二維陣列（含標題列）
 * @param {number} keyColIdx - 車號或司機欄位的索引
 * @param {number} dateColIdx - 日期欄位的索引
 * @param {string} targetKey - 要過濾的值
 * @returns {Date|null}
 */
function _findLatestDate(data, keyColIdx, dateColIdx, targetKey) {
    for (var i = data.length - 1; i >= 1; i--) {
        if (keyColIdx < 0 || String(data[i][keyColIdx]).trim() === targetKey) {
            var rawDate = String(data[i][dateColIdx]).trim();
            var d = new Date(rawDate);
            if (!isNaN(d.getTime())) return d;
        }
    }
    return null;
}

// ──────────────────────────────
// 1. 系統白名單 (需密碼)
// ──────────────────────────────
function sysGetWhitelist(pwd) {
    sysVerifyPwd(pwd);
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_WHITELIST);
    if (!sheet) return { headers: [], data: [] };
    var raw = sheet.getDataRange().getDisplayValues();
    return { headers: raw[0] || [], data: raw.slice(1) };
}

// ──────────────────────────────
// 2. 車輛管理 (全部)
// ──────────────────────────────
function sysGetVehicles() {
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_VEHICLE);
    if (!sheet) return { headers: [], data: [] };
    var raw = sheet.getDataRange().getDisplayValues();
    return { headers: raw[0] || [], data: raw.slice(1) };
}

// ──────────────────────────────
// 3. 送貨日誌 (依「車牌號碼」或「司機」篩選，近 30 天)
// ──────────────────────────────
function sysGetDeliveryLog(carNo, driverName) {
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_LOG);
    if (!sheet) return { headers: [], data: [] };
    var raw = sheet.getDataRange().getDisplayValues();
    if (raw.length < 2) return { headers: raw[0] || [], data: [] };

    var h = raw[0];
    var carIdx = h.indexOf('車牌號碼');
    if (carIdx < 0) carIdx = h.indexOf('車牌');
    var driverIdx = h.indexOf('司機');
    var dateIdx = h.indexOf('配送完成時間');
    if (dateIdx < 0) dateIdx = h.indexOf('送達日期');
    if (dateIdx < 0) dateIdx = h.indexOf('日期');

    // 決定篩選條件
    var keyIdx = -1, keyVal = '';
    if (carNo) { keyIdx = carIdx; keyVal = carNo; }
    else if (driverName) { keyIdx = driverIdx; keyVal = driverName; }

    if (!keyVal) {
        return { headers: h, data: raw.slice(Math.max(1, raw.length - 300)).reverse() };
    }

    var latestDate = _findLatestDate(raw, keyIdx, dateIdx, keyVal);
    if (!latestDate) return { headers: h, data: [] };

    var threshold = new Date(latestDate.getTime());
    threshold.setDate(threshold.getDate() - 30);

    var resultData = [];
    for (var i = raw.length - 1; i >= 1; i--) {
        if (String(raw[i][keyIdx]).trim() !== keyVal) continue;
        var d = new Date(String(raw[i][dateIdx]).trim());
        if (isNaN(d.getTime())) { resultData.push(raw[i]); continue; }
        if (d >= threshold && d <= latestDate) {
            resultData.push(raw[i]);
        } else if (d < threshold) {
            break;
        }
    }
    return { headers: h, data: resultData };
}

// ──────────────────────────────
// 4. 每日行程表 (依「車牌號碼」或「司機」篩選，抓最新一天 + 行程足跡)
// ──────────────────────────────
function sysGetItinerary(carNo, driverName) {
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_SCHEDULE);
    if (!sheet) return { headers: [], data: [], footprint: [] };
    var raw = sheet.getDataRange().getDisplayValues();
    if (raw.length < 2) return { headers: raw[0] || [], data: [], footprint: [] };

    var h = raw[0];
    var carIdx = h.indexOf('車牌號碼');
    if (carIdx < 0) carIdx = h.indexOf('車牌');
    var driverIdx = h.indexOf('司機');
    var dateIdx = h.indexOf('日期');
    if (dateIdx < 0) dateIdx = h.indexOf('配送完成時間');

    var keyIdx = -1, keyVal = '';
    if (carNo) { keyIdx = carIdx; keyVal = carNo; }
    else if (driverName) { keyIdx = driverIdx; keyVal = driverName; }

    var resultData = [];
    var latestDateStr = '';

    if (!keyVal) {
        resultData = raw.slice(Math.max(1, raw.length - 100)).reverse();
    } else {
        var latestDate = _findLatestDate(raw, keyIdx, dateIdx, keyVal);
        if (!latestDate) return { headers: h, data: [], footprint: [] };
        latestDateStr = Utilities.formatDate(latestDate, 'GMT+8', 'yyyy/MM/dd');
        for (var i = raw.length - 1; i >= 1; i--) {
            if (String(raw[i][keyIdx]).trim() !== keyVal) continue;
            var dStr = String(raw[i][dateIdx]).trim();
            var d = new Date(dStr);
            if (!isNaN(d.getTime())) {
                var dFmt = Utilities.formatDate(d, 'GMT+8', 'yyyy/MM/dd');
                if (dFmt === latestDateStr) resultData.push(raw[i]);
                else if (d < latestDate) break;
            }
        }
    }

    // 行程足跡：從送貨日誌讀取同日同車/司機的打卡紀錄，抽出路名 + 時間
    var footprint = [];
    if (keyVal && latestDateStr) {
        footprint = _buildFootprint(ss, carNo, driverName, latestDateStr);
    }

    return { headers: h, data: resultData, footprint: footprint, dateStr: latestDateStr };
}

/** 行程足跡建構（從送貨日誌抓當日打卡點，依時間排序後抽路名） */
function _buildFootprint(ss, carNo, driverName, targetDateStr) {
    var logSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_LOG);
    if (!logSheet) return [];
    var raw = logSheet.getDataRange().getDisplayValues();
    if (raw.length < 2) return [];

    var h = raw[0];
    var carIdx = h.indexOf('車牌號碼');
    var driverIdx = h.indexOf('司機');
    var dateIdx = h.indexOf('配送完成時間');
    var addrIdx = h.indexOf('送貨地址');
    if (addrIdx < 0) return [];

    var keyIdx = carNo ? carIdx : driverIdx;
    var keyVal = carNo || driverName;

    var points = [];
    for (var i = 1; i < raw.length; i++) {
        if (String(raw[i][keyIdx]).trim() !== keyVal) continue;
        var dStr = String(raw[i][dateIdx]).trim();
        var d = new Date(dStr);
        if (isNaN(d.getTime())) continue;
        var dFmt = Utilities.formatDate(d, 'GMT+8', 'yyyy/MM/dd');
        if (dFmt !== targetDateStr) continue;
        var rawAddr = String(raw[i][addrIdx]);
        var cust = String(raw[i][h.indexOf('客戶名稱')] || "");
        var road = "";
        if (cust.includes("打卡")) {
            road = "【" + cust + "】" + rawAddr;
        } else {
            road = _extractRoad(rawAddr);
        }
        if (!road) continue;
        var timeStr = Utilities.formatDate(d, 'GMT+8', 'HH:mm');
        points.push({ time: timeStr, road: road });
    }

    // 去重相鄰相同路名，按時間排序
    points.sort(function (a, b) { return a.time.localeCompare(b.time); });
    var deduped = [];
    for (var j = 0; j < points.length; j++) {
        if (deduped.length === 0 || deduped[deduped.length - 1].road !== points[j].road) {
            deduped.push(points[j]);
        }
    }
    return deduped;
}

/** 台灣地址 → 路名萃取（如「忠孝東路三段」） */
function _extractRoad(addr) {
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
}

// ──────────────────────────────
// 5. 車輛保養 (依「車牌號碼」篩選，所有歷史，由新到舊)
// ──────────────────────────────
function sysGetMaintenance(carNo) {
    var ss = getSS_V11();
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_MAINT);
    if (!sheet) return { headers: [], data: [] };
    var raw = sheet.getDataRange().getDisplayValues();
    if (raw.length < 2) return { headers: raw[0] || [], data: [] };

    var h = raw[0];
    var carIdx = h.indexOf('車牌號碼');
    if (carIdx < 0) carIdx = h.indexOf('車牌');

    var resultData = [];
    for (var i = raw.length - 1; i >= 1; i--) {
        if (!carNo || String(raw[i][carIdx]).trim() === carNo) {
            resultData.push(raw[i]);
        }
    }
    return { headers: h, data: resultData };
}

// ──────────────────────────────
// 6. 儲存修改（白名單 / 車輛管理 / 日誌 / 行程）+ Audit Trail
// ──────────────────────────────
function sysSaveEdits(tabKey, updates, newRows, pwd) {
    sysVerifyPwd(pwd);
    var ss = getSS_V11();
    var sheetName = _getSheetNameByTab(tabKey);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error('找不到對應的工作表：' + sheetName);

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    // 更新現有儲存格
    if (updates && updates.length > 0) {
        updates.forEach(function (u) {
            var before = sheet.getRange(u.row + 2, u.col + 1).getValue();
            sheet.getRange(u.row + 2, u.col + 1).setValue(u.val);
            _logAudit(ss, tabKey, '修改', u.row + 2, headers[u.col] || ('欄' + (u.col + 1)), before, u.val);
        });
    }

    // 新增列
    if (newRows && newRows.length > 0) {
        newRows.forEach(function (row) {
            sheet.appendRow(row);
            _logAudit(ss, tabKey, '新增', sheet.getLastRow(), '整列', '', row.join(' | '));
        });
    }
    return { ok: true };
}

// ──────────────────────────────
// 7. 刪除勾選列 + Audit Trail
// ──────────────────────────────
function sysDeleteRows(tabKey, rowIdxs, pwd) {
    sysVerifyPwd(pwd);
    var ss = getSS_V11();
    var sheetName = _getSheetNameByTab(tabKey);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) throw new Error('找不到對應的工作表：' + sheetName);

    // 先記錄被刪除的內容
    rowIdxs.forEach(function (idx) {
        var rowData = sheet.getRange(idx + 2, 1, 1, sheet.getLastColumn()).getValues()[0];
        _logAudit(ss, tabKey, '刪除', idx + 2, '整列', rowData.join(' | '), '');
    });

    // 由大到小排序，避免行號位移
    rowIdxs.sort(function (a, b) { return b - a; });
    rowIdxs.forEach(function (idx) {
        sheet.deleteRow(idx + 2);
    });
    return { ok: true, deleted: rowIdxs.length };
}

// ──────────────────────────────
// 工具：Audit Trail 寫入
// ──────────────────────────────
function _logAudit(ss, tabKey, opType, rowNum, colName, before, after) {
    try {
        var auditSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_AUDIT);
        if (!auditSheet) return; // 尚未初始化則靜默跳過
        var email = Session.getActiveUser().getEmail() || 'unknown';
        var sheetName = _getSheetNameByTab(tabKey);
        auditSheet.appendRow([
            new Date(),   // 修改時間
            email,        // 操作人Email
            '',           // 操作人姓名（前台可補）
            opType,       // 操作類型：修改/新增/刪除
            sheetName,    // 影響分頁
            rowNum,       // 影響列號（GS 1-based）
            colName,      // 欄位名稱
            String(before),  // 修改前
            String(after),   // 修改後
            ''            // 備註
        ]);
    } catch (e) { /* 審計失敗不影響主操作 */ }
}

// ──────────────────────────────
// 工具：分頁 key → 工作表名稱
// ──────────────────────────────
function _getSheetNameByTab(tabKey) {
    var map = {
        'whitelist': V11_PROD_CONFIG.SHEET_WHITELIST,
        'vehicles': V11_PROD_CONFIG.SHEET_VEHICLE,
        'logs': V11_PROD_CONFIG.SHEET_LOG,
        'itinerary': V11_PROD_CONFIG.SHEET_SCHEDULE,
        'maintenance': V11_PROD_CONFIG.SHEET_MAINT
    };
    return map[tabKey] || tabKey;
}

function testTrace() {
    try {
        var ss = getSS_V11();
        var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_SCHEDULE);
        var data = sheet.getDataRange().getValues();
        var h = data[0];
        var colTrace = -1;
        for (var j = 0; j < h.length; j++) {
            if (String(h[j]).indexOf('足跡') !== -1) { colTrace = j; break; }
        }
        Logger.log('Trace column index: ' + colTrace);
        if (colTrace >= 0) {
            for (var i = 1; i < data.length; i++) {
                Logger.log('Row ' + (i + 1) + ' trace: ' + data[i][colTrace]);
            }
        }
    } catch (e) { Logger.log(e.message); }
}
