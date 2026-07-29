/**
 * 鈦傳速｜AI 訂單識別與寫入規範 V0316.35 (介面優化版)
 * 獨立運作檔案，避免影響原 Code.js 核心
 */

/**
 * 預處理 OCR 取得的純文字
 * 移除換行符號、合併多餘空格、全形轉半形、統一大小寫
 */
function preprocessOcrText(rawText) {
    if (!rawText) return "";
    let text = String(rawText);
    // 全形轉半形
    text = text.replace(/[\uff01-\uff5e]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xfee0); });
    // 移除換行符號、合併多餘空格
    text = text.replace(/\r?\n|\r/g, " ");
    text = text.replace(/\s+/g, " ");
    // 統一大小寫 (轉大寫方便比對 AA, EE, SS, WW, KG)
    text = text.toUpperCase();
    return text.trim();
}

/**
 * 核心共用：確保「業務配送清單」分頁存在，且標頭同步
 * V11.PROD.UTIL
 */
function ensureSalesDeliverySheet_Core(ss) {
    var targetName = "業務配送清單";
    var sheet = ss.getSheetByName(targetName);
    if (!sheet) {
        sheet = ss.insertSheet(targetName);
        var sourceSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
        if (sourceSheet) {
            var headerRange = sourceSheet.getRange(1, 1, 1, sourceSheet.getLastColumn());
            var headers = headerRange.getValues();
            sheet.getRange(1, 1, 1, headers[0].length).setValues(headers);
            
            // 套用基礎凍結樣式
            sheet.setFrozenRows(1);
            sheet.getRange(1, 1, 1, headers[0].length)
                 .setBackground("#1e293b")
                 .setFontColor("#cbd5e1")
                 .setFontWeight("bold");
        }
    }
    return sheet;
}

/**
 * 對業務配送清單執行排序 (依照分公司 -> 日期排序)
 */
function sortSalesSheetByCompany_Core(sheet) {
    var range = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn());
    var data = range.getValues();
    if (data.length <= 0) return;
    
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(v){ return String(v).trim(); });
    var idxB = typeof findHIdx_Core === 'function' ? findHIdx_Core(headers, "BRANCH") : headers.indexOf("分公司");
    var idxD = typeof findHIdx_Core === 'function' ? findHIdx_Core(headers, "DATE") : headers.indexOf("日期");
    var idxC = typeof findHIdx_Core === 'function' ? findHIdx_Core(headers, "CUSTOMER") : headers.indexOf("客戶");

    // 🧪 使用 JS 記憶體內排序，實現複雜的「樣品分流」邏輯
    data.sort(function(a, b) {
        // 1. 樣品優先順序：沒包含「樣品」的排在前面 (出貨)，包含的排後面 (樣品)
        var isSampleA = (idxC !== -1 && String(a[idxC]).indexOf("樣品") !== -1) ? 1 : 0;
        var isSampleB = (idxC !== -1 && String(b[idxC]).indexOf("樣品") !== -1) ? 1 : 0;
        if (isSampleA !== isSampleB) return isSampleA - isSampleB;

        // 2. 分公司排序
        if (idxB !== -1) {
            var bA = String(a[idxB]), bB = String(b[idxB]);
            if (bA !== bB) return bA.localeCompare(bB);
        }

        // 3. 日期反向排序 (最新的在上面)
        if (idxD !== -1) {
            var dA = a[idxD] instanceof Date ? a[idxD].getTime() : 0;
            var dB = b[idxD] instanceof Date ? b[idxD].getTime() : 0;
            return dB - dA;
        }
        return 0;
    });

    range.setValues(data);
}

/** V34.20: 獲取指送對照表資料 (寫死表單以提高效能與準確率) */
function getDirectMap_V20() {
    return [
        { key: "弘昇", fullName: "弘昇貨運", address: "桃園市八德區後庄街52-1號(弘昇貨運)", phone: "" },
        { key: "財利", fullName: "財利貨運", address: "新北市鶯歌區德昌二街70巷32弄88號-5(財利貨運)", phone: "" },
        { key: "超奕", fullName: "超奕貨運", address: "新北市三峽區麻園路40之9號(超奕貨運)", phone: "" },
        { key: "世鵬", fullName: "世鵬貨運", address: "新北市鶯歌區尖山路101巷18號之5(世鵬貨運)", phone: "" },
        { key: "尚毅", fullName: "尚毅貨運", address: "桃園市八德區興豐路2350巷506號(尚毅貨運)", phone: "" },
        { key: "韋承", fullName: "韋承加工", address: "新北市鶯歌區高職西街118巷42-25號(韋承加工)", phone: "" },
        { key: "鈦度", fullName: "鈦度加工", address: "新北市五股區民義路一段282-1號(鈦度加工)", phone: "" },
        { key: "中誌", fullName: "中誌加工", address: "新北市五股區壟鉤路7-5號(中誌加工)", phone: "" },
        { key: "棨新", fullName: "棨新陶瓷", address: "新北市鶯歌區高職西街118巷42之51號(棨新)", phone: "" },
        { key: "仟聖,任聖,仼聖,韌聖", fullName: "仟聖加工", address: "新北市鶯歌區西湖街279巷11號(仟聖加工)", phone: "" },
        { key: "甲等", fullName: "甲等加工", address: "新北市鶯歌區二甲路297號(甲等加工)", phone: "" },
        { key: "晨亦", fullName: "晨亦加工", address: "新北市鶯歌區西湖街279巷20-3號(晨亦)", phone: "" },
        { key: "宜美", fullName: "宜美加工", address: "新北市鶯歌區高職西街118巷42-28號(宜美加工)", phone: "" },
        { key: "金眾", fullName: "金眾加工", address: "桃園市八德區興豐路2350巷289號(金眾加工)", phone: "" },
        { key: "積福", fullName: "積福加工", address: "新北市鶯歌區高職西街118巷42-29號(積福加工)", phone: "" },
        { key: "文德", fullName: "文德加工", address: "新北市蘆洲區中正路518巷1號(文德加工)", phone: "" },
        { key: "全鉞", fullName: "全鉞實業", address: "新北市五股區民義路一段287巷22-10號(全鉞)", phone: "" },
        { key: "百興", fullName: "百興加工", address: "新北市蘆洲區環堤大道398-1號 396號(百興加工)", phone: "" },
        { key: "中薪", fullName: "中薪", address: "新北市鶯歌區大湖路160號(中薪)", phone: "" }
    ];
}

/** V34.23: 標籤過濾函式，防止抓到下一個欄位的標籤 */
function cleanLabelValue_V23(val) {
    if (!val) return "";
    // 排除掉地址中常見的標籤文字，避免 greediness 抓過頭
    const labels = ["客戶", "名稱", "日期", "地址", "電話", "重量", "單號", "業務", "頁次", "備註", "送貨", "銷貨", "單位"];
    let cleaned = val.trim();
    labels.forEach(l => {
        // 如果抓到的內容包含標籤且後面帶有冒號或空格，則切斷
        const regex = new RegExp("[:：\\s]*(" + l.split("").join("\\s*") + ")[:：\\s]*.*$", "i");
        cleaned = cleaned.replace(regex, "");
    });
    return cleaned.trim();
}

function inferWrapSealFromOcr_V11(result, rawText) {
    var text = String(rawText || "").toUpperCase();
    var address = String(result && result.address || "").trim();
    var note = String(result && result.note || "").trim();
    var branch = String(result && result.branch || "").trim();
    var customerCode = String(result && result.customerCode || "").trim().toUpperCase();

    var freightText = (text + " " + address + " " + note).replace(/\s/g, "");
    if (/[\u4e00-\u9fffA-Z0-9]{1,12}(?:貨運|物流|托運)/i.test(freightText)) return "封";

    var normalizedAddress = address.replace(/\s/g, "");
    if (normalizedAddress) {
        var isTaipeiArea = /(台北市|臺北市|新北市|台北|臺北|新北)/.test(normalizedAddress);
        var isTaoyuan = /(桃園市|桃園縣|桃園)/.test(normalizedAddress);
        var hasOtherCity = /(?:基隆市|新竹縣|新竹市|苗栗縣|台中市|臺中市|彰化縣|南投縣|雲林縣|嘉義縣|嘉義市|台南市|臺南市|高雄市|屏東縣|宜蘭縣|花蓮縣|台東縣|臺東縣|澎湖縣|金門縣|連江縣)/.test(normalizedAddress);
        if (isTaipeiArea || isTaoyuan) return "";
        if (hasOtherCity) return "封";
    }

    if (!customerCode) {
        var codeMatch = text.match(/客\s*戶\s*名\s*稱\s*[:：]?\s*.*?\b([A-Z]{1,3}\d{0,6})(?:-\d+)?\b/);
        if (codeMatch) customerCode = codeMatch[1];
    }

    if (customerCode) {
        if (branch.indexOf("高雅瓷") !== -1) return customerCode.indexOf("A") === 0 ? "" : "封";
        if (branch.indexOf("安帝嘉") !== -1 || branch.indexOf("喜悅納") !== -1) return customerCode.indexOf("AB") === 0 ? "" : "封";
    }

    return "";
}

/**
 * 核心：規則引擎解析標準
 * input: 預處理過的 OCR 純文字, 登入者的分公司 (fallback)
 * output: 結構化 JSON 物件
 */
function parseOcrToOrder_V2(preprocessedText, loginBranch) {
    // V34.23: 表格偵測強化 - 偵測項次、代號、名稱(排除客戶名稱)、數量等關鍵字起點
    const text = preprocessedText;
    // 使用排除邏輯，避免「客戶名稱」誤導表格起點
    var tableStartIdx = text.search(/(?:項\s*次|代\s*號|(?<!客戶)名\s*稱|數\s*量\s*單\s*位)/);
    // 如果環境不支援 lookbehind，則用更嚴格的匹配
    if (tableStartIdx === -1) {
        tableStartIdx = text.search(/(?:項\s*次|代\s*號|數\s*量\s*單\s*位)/);
    }
    const metadataText = (tableStartIdx !== -1) ? text.substring(0, tableStartIdx) : text;
    var tableText = (tableStartIdx !== -1) ? text.substring(tableStartIdx) : text; // 如果沒抓到標頭，嘗試掃描全圖

    // V37.31: 截斷表格尾部 footer/免責聲明，防止簽章名字(如 Doris)或備註干擾品項辨識
    // V39.4: 「簽收」須帶冒號才視為表尾，避免備註中「找管理員簽收、」等字樣導致表格被提前截斷 (品項被切掉)
    var footerIdx = tableText.search(/(?:※|製\s*表|倉\s*管\s*[:：]|客\s*戶\s*簽\s*收|簽\s*收\s*[:：]|款\s*項\s*未\s*付)/i);
    if (footerIdx !== -1) {
        tableText = tableText.substring(0, footerIdx);
    }

    // V35.8: 備註區補強 - 防止「備 項次 代號 註:」被誤判為表格起點，導致備註內容(重量/電話/時間)被切除
    // 當 tableStartIdx 誤切時，從切除段落中再額外抓一次備註內容
    var backupNoteZone = "";
    if (tableStartIdx !== -1) {
        var afterCut = text.substring(tableStartIdx);
        // 匹配 "代號 (備?) 註: 內容" 的模式，抓出 「:」後 到 「名稱/數量」前 的備註主體
        var bnMatch = afterCut.match(/[注註]\s*[:：]\s*([\s\S]*?)(?:\s+名\s*稱|\s+數\s*量|$)/i);
        if (bnMatch && bnMatch[1].trim().length > 2) {
            backupNoteZone = bnMatch[1].trim();
        }
    }

    var result = {
        branch: "",
        orderId: "",
        uniqueKey: "", // branch-orderId
        customerName: "",
        contactName: "", // 新增聯絡人欄位
        phone: "",
        address: "",
        location: "", // 新增地點欄位 (社區/加工廠/案名)
        weight: 0,
        size: "",
        boxes: "",
        etaTime: "",
        date: "",
        note: "",
        customerCode: "",
        wrapSeal: "",
        isValid: false,
        error: ""
    };

    // 1. 分公司判別 (AA, EE, SS, WW，支援字元間含有空格的情況如 E E)
    const branchMap = { 'AA': '安帝嘉', 'EE': '高雅瓷', 'SS': '喜悅納', 'WW': '漢樺' };
    
    // 💡 排除 S/N 批號的干擾：因商品型號尾碼可能為 -S，若剛好與下一行的「S/N批號」相接，
    // 換行空白化後會變成「-S S/N」，其「S S」會被誤判成「SS (喜悅納)」分公司，因此需預先將「S/N」替換。
    // 同時，為了防止品項編號或客戶代碼如 AA-61250, AA 61250 誤判為分公司章，正則後面加上了 negative lookahead 排除後方緊鄰數字的情形。
    var textForBranch = preprocessedText.replace(/S\/N/gi, "");
    var branchMatch = textForBranch.match(/\b(A\s*A|E\s*E|S\s*S|W\s*W)\b(?!\s*[-/]?\s*\d)/i);
    var code = branchMatch ? branchMatch[0].replace(/\s/g, '').toUpperCase() : "";
    result.branch = String(branchMap[code] || loginBranch || "漢樺").trim();

    // 2. 原始單號 (V35.6: 補回單號解析，支持 6~11 碼純數字)
    // V36.27+: 改為在全域 preprocessedText 中搜尋，避免錯位佈局被切除
    var orderMatch = text.match(/(?:銷\s*貨\s*單\s*號|單\s*號)[:：\s]*\s*(\d{6,11})/);
    if (orderMatch) {
        const shortBranchMap = { '安帝嘉': '安', '高雅瓷': '高', '喜悅納': '喜', '漢樺': '漢' };
        var shortBranch = shortBranchMap[result.branch] || (result.branch ? result.branch.charAt(0) : "");
        result.orderId = orderMatch[1] + (shortBranch ? "-" + shortBranch : "");
        result.uniqueKey = result.branch + "-" + result.orderId;
    }

    // 3. 電話與聯絡人聯動 (V35.7.1: 修復電話長度截斷聯絡人 Bug，容忍市話空白)
    // V35.8: 也搜尋備註補強區 (backupNoteZone)
    // V36.28: 加入「聯絡：」標籤支援 (系統自產結案單格式)
    var phoneSearchText = metadataText + (backupNoteZone ? " " + backupNoteZone : "");
    var phoneMatch = phoneSearchText.match(/([0Oo]\s*9[\d\s-]{7,15})/) ||
        phoneSearchText.match(/((?:0[2-8])[\s-]*\d{3,5}[\s-]*\d{3,5}(?:\s*#\s*\d{1,6})?)/) ||
        phoneSearchText.match(/聯\s*絡\s*[:：]\s*[^\s|]+\s*\|\s*([0Oo]\s*9[\d\s-]{7,15})/);
    var phoneIdx = -1;
    var phoneLen = 0;
    if (phoneMatch) {
        var rawPhone = (phoneMatch[2] || phoneMatch[1]).replace(/[-\s]/g, "");
        // 自動將 O/o 修正回數值 0 (手機專用)
        if (rawPhone.match(/^[Oo]9/)) {
            rawPhone = rawPhone.replace(/^[Oo]/, '0');
        }

        if (rawPhone.startsWith("09")) {
            result.phone = rawPhone.substring(0, 4) + "-" + rawPhone.substring(4, 7) + "-" + rawPhone.substring(7);
        } else {
            result.phone = rawPhone; // 市話直接填入
        }
        phoneIdx = phoneMatch.index;
        phoneLen = phoneMatch[0].length;
    }

    // 3B. 獨立擷取聯絡人 (即使電話沒抓到，依舊要掃描)
    // V35.5: 先識別業務姓名，防止誤抓 (業務：214 謝博皓)
    var salesMatch = metadataText.match(/(?:業\s*務)[:：\s]*\s*(?:\d{1,4}\s*)?([\u4e00-\u9fa5]{2,4})/);
    var salesName = salesMatch ? salesMatch[1].trim() : "";

    // V35.7: 嚴格搜尋範圍限制 - 電話前後 15 個字
    // 如果有電話，以電話為中心找；沒電話，禁用百家姓模糊搜索
    var rangeSource = phoneSearchText; // V34.28: 改用包含備註補強區的來源
    var searchRange = rangeSource;
    if (phoneIdx !== -1) {
        // V35.7.1修正：以電話號碼結尾往後算 15 碼，而不是電話開頭往後算
        searchRange = rangeSource.substring(Math.max(0, phoneIdx - 15), Math.min(rangeSource.length, phoneIdx + phoneLen + 15));
    } else {
        // 如果沒有電話，則搜尋區鎖定在後半段，且不啟動地毯式搜索
        searchRange = metadataText.substring(Math.floor(metadataText.length / 2));
    }

    // 台灣常見百家姓 (約 80 大姓) 作為錨點
    var surnames = "陳林黃張李王吳劉蔡楊許鄭謝洪郭邱曾廖賴徐周蘇葉莊呂江何蕭羅高簡朱鍾彭游詹胡施沈余盧梁趙顏柯翁魏孫戴范方宋鄧杜侯曹薛傅丁溫紀蔣歐藍連唐卓程汪田金尤童陸";

    // 職業/身分前綴 (泥作、設計師等)
    var jobPrefixes = "泥\\s*作|師\\s*[父傅]|設\\s*計(?:師)?|業\\s*主|工\\s*地|工\\s*務|主\\s*任|廠\\s*長|經\\s*理|老\\s*闆|統\\s*包|水\\s*電|木\\s*工|保\\s*全|警\\s*衛|送\\s*貨|收\\s*件|聯\\s*絡|司\\s*機|採\\s*購";

    // 優先匹配帶有「職業前綴/稱謂後綴」的
    // 例如: 泥作陳先生、設計師李姐、聯絡人王經理、王董
    var nameMatch = searchRange.match(new RegExp("((?:(?:" + jobPrefixes + ")\\s*)?[\\u4e00-\\u9fa5]{1,3}\\s*(?:[RrSs]|先生|小姐|哥|姊|姐|老\\s*闆|董|總|太\\s*太|夫\\s*人|Sir))", "i")) ||
        searchRange.match(/(?:聯\s*絡\s*人|收\s*件\s*人|姓?\s*名)[:：\s]*\s*([\u4e00-\u9fa5]{1,5})/);

    if (nameMatch) {
        var n = cleanLabelValue_V23(nameMatch[1]);
        // V35.5: 排除單個「稱」字，且排除識別出的業務姓名
        if (n.length >= 1 && n !== "稱" && n !== salesName && n.length <= 7 && !/^(地址|重量|日期|單號|公斤|電話|公司|備註|客戶|名稱|時間|業務)/.test(n)) {
            result.contactName = n;
        }
    }

    // V34.25: 全局百家姓地毯式搜索 (保底防護網)
    // V35.7: 現在規定只有在電話號碼旁才執行模糊辨識
    if (!result.contactName && phoneIdx !== -1) {
        // 放寬到百家姓前帶有職業稱謂的 (泥作方秋)
        var surnameMatches = searchRange.match(new RegExp("((?:(?:" + jobPrefixes + ")\\s*)?[" + surnames + "][\\u4e00-\u9fa5]{1,3})", "g"));
        if (surnameMatches) {
            for (var i = 0; i < surnameMatches.length; i++) {
                var n = cleanLabelValue_V23(surnameMatches[i]);
                // V35.7: 排除業務姓名
                if (n.length >= 2 && n !== salesName && n.length <= 6 && !/^(地址|重量|日期|單號|公斤|電話|公司|備註|客戶|名稱|時間|聯絡人|收件人|業務)/.test(n)) {
                    result.contactName = n;
                    break;
                }
            }
        }
    }

    // 4. 日期 (V37.30: 為了防止表格起點切除導致日期遺漏，採用「優先全文搜尋標籤，次之搜尋前半部，最後保底」策略)
    var dateMatch = text.match(/(?:銷\s*貨\s*日\s*期|日\s*期|時\s*間)[:：\s]*\s*(\d{2,4}[\s/-]*\d{1,2}[\s/-]*\d{1,2})/) ||
        metadataText.match(/(?:銷\s*貨\s*日\s*期|日\s*期|時\s*間)[:：\s]*\s*(\d{2,4}[\s/-]*\d{1,2}[\s/-]*\d{1,2})/) ||
        text.match(/(\d{2,4}[/-]\d{1,2}[/-]\d{1,2})/);

    if (dateMatch) {
        var dStr = dateMatch[1];
        var parts = dStr.split(/[/-]/);
        // 如果是 MM/DD 格式，補上今年
        if (parts.length === 2) {
            dStr = new Date().getFullYear() + "/" + dStr;
        } else if (parts.length === 3) {
            // 處理民國年：若年份為 3 碼 (例如 115)
            var year = parseInt(parts[0]);
            if (year < 200) {
                parts[0] = year + 1911;
            }
            dStr = parts.join("/");
        }
        result.date = dStr.replace(/-/g, "/");
        result.date = cleanLabelValue_V23(result.date);
    }

    // V37.30: 智慧備用日期解析 - 當 OCR 完全沒抓到日期標籤時，若單號為標準 9 碼數字(含分公司字尾)，則從單號前6碼(YYMMDD)智慧提取日期！
    if (!result.date && result.orderId) {
        var pureId = result.orderId.replace(/-[安高漢喜]$/i, '').trim();
        if (/^\d{9}$/.test(pureId)) {
            var yy = parseInt(pureId.substring(0, 2), 10);
            var mm = pureId.substring(2, 4);
            var dd = pureId.substring(4, 6);
            var mNum = parseInt(mm, 10);
            var dNum = parseInt(dd, 10);
            if (mNum >= 1 && mNum <= 12 && dNum >= 1 && dNum <= 31) {
                result.date = (yy + 2011) + "/" + mm + "/" + dd;
            }
        }
    }


    // 5. 重量關鍵字強化 (V34.22: 加入「公斤」前綴容錯)
    // V35.8: 也搜尋備註補強區 (backupNoteZone)
    var weightMatch = metadataText.match(/(?:重\s*量)[:：\s]*\s*(\d{1,5}(?:\.\d{1,2})?)/i) ||
        metadataText.match(/(\d{1,5}(?:\.\d{1,2})?)\s*(?:K\s*G|公\s*斤)/i) ||
        (backupNoteZone && backupNoteZone.match(/(\d{1,5}(?:\.\d{1,2})?)\s*(?:K\s*G|公\s*斤)/i));
    if (weightMatch) {
        result.weight = parseFloat(weightMatch[1]) || 0;
    }

    // 6. 到貨時間詞彙擴充 (V34.22: 補上 午前、午後)
    // V35.8: 也搜尋備註補強區 (backupNoteZone)
    var timeSearchText = metadataText + (backupNoteZone ? " " + backupNoteZone : "");
    var timeMatch = timeSearchText.match(/(\d{1,2}[:：]\d{2})/) ||
        timeSearchText.match(/((?:早上|上午|午前|下午|午後|中午前|之前)\s*\d{1,2}點?)/) ||
        timeSearchText.match(/(中午前|午前|午後|上午|下午|早上|中午|晚上)/) ||
        timeSearchText.match(/(\d{1,2}點)/);
    if (timeMatch) {
        result.etaTime = (timeMatch[1] || timeMatch[0]).replace('：', ':');
    }

    // 7. 客戶名稱 (V34.23: 加入標籤過濾, V34.27 防呆: 「名稱」必須接冒號，防止剛好掃到表格標題的「名稱」進而抓到品名)
    var custMatch = metadataText.match(/(?:客\s*戶\s*名\s*稱|客\s*戶|抬\s*頭|名\s*稱\s*[:：])\s*[:：\s]*\s*([^\s]{2,40})/);
    if (!custMatch) {
        // V34.28: 如果在上半部沒抓到，放寬到全文件搜尋 (解決 OCR 把客戶名稱排在後面的問題)
        custMatch = preprocessedText.match(/(?:客\s*戶\s*名\s*稱|客\s*戶|抬\s*頭|名\s*稱\s*[:：])\s*[:：\s]*\s*([^\s]{2,40})/);
    }
    if (custMatch) {
        result.customerName = cleanLabelValue_V23(custMatch[1]);
    }
    var custCodeMatch = preprocessedText.match(/客\s*戶\s*名\s*稱\s*[:：]?\s*.*?\b([A-Z]{1,3}\d{0,6})(?:-\d+)?\b/);
    if (custCodeMatch) {
        result.customerCode = custCodeMatch[1].toUpperCase();
    }

    // 8. 地址 (支援括號內的社區名稱) - V4.1 加入「段」關鍵字
    var addrMatch = preprocessedText.match(/(?:送貨地址|地址|地點)[:：]\s*([^\s\x00-\x1f/]{2,60}(?:路|街|段|巷|弄|號|樓)(?:\([^\)]+\)|\（[^\）]+\）)?)/);
    if (!addrMatch) {
        // V36.27+: 放寬條件，支援「縣市+短字」或「地址: 瑞士/溪湖」這類無路號描述
        addrMatch = preprocessedText.match(/(?:送貨地址|地址|地點)[:：]\s*([^\s]{2,30}(?:\([^\)]+\)|\（[^\）]+\）)?)/) ||
            preprocessedText.match(/([^\s]{2,5}(?:縣|市)[^\s]{2,30}(?:路|街|巷|弄|號|樓|里|鎮|村|鄉)(?:\([^\)]+\)|\（[^\）]+\）)?)/);
    }
    if (addrMatch) {
        var rawParsedAddr = (addrMatch[1] || addrMatch[0]).trim();
        // 將括號內的內容抽離為地點
        var locMatch = rawParsedAddr.match(/\((.*?)\)|（(.*?)）/);
        if (locMatch) {
            result.location = (locMatch[1] || locMatch[2]).trim();
            result.address = rawParsedAddr.replace(/\((.*?)\)|（(.*?)）/, "").trim();
        } else {
            result.address = rawParsedAddr.trim();
        }
    }

    // V4.1 補強：從「導航」關鍵字提取地點 (社區名稱)
    if (!result.location) {
        var navMatch = preprocessedText.match(/(?:導\s*航)[:：]\s*([^\s\x00-\x1f/]{2,20})/);
        if (navMatch) {
            result.location = cleanLabelValue_V23(navMatch[1]);
        }
    }

    // 9. 備註關鍵字與案場資訊 (V34.22: 僅從 metadataText 掃描)
    // V35.8: 也從備註補強區掃描關鍵字
    var noteText = metadataText + (backupNoteZone ? " " + backupNoteZone : "");
    if (result.weight > 0) {
        noteText = noteText.replace(new RegExp(result.weight + "\\s*(KG|公斤|公里|公厅|KG)", "gi"), "");
    }

    // 縮減 lookahead 並排除表格起點字眼
    var ctxMatch = noteText.match(/(?:卸貨區|限高|貨下\s*[bB]\d|換[證証]|限高\s*\d)[^\/／]{0,10}/g);
    if (ctxMatch) {
        let cleanCtx = ctxMatch.map(m => cleanLabelValue_V23(m));
        result.note += " [" + cleanCtx.join(", ") + "]";
    }
    // 10. 備註 (僅在 metadataText 中掃描)
    var bracketRegex = /\[(.*?)\]|【(.*?)】/g;
    var bracketMatch;
    var bracketNotes = [];
    while ((bracketMatch = bracketRegex.exec(metadataText)) !== null) {
        var innerText = bracketMatch[1] || bracketMatch[2];
        if (innerText) {
            bracketNotes.push("[" + innerText.trim() + "]");
        }
    }
    if (bracketNotes.length > 0) {
        result.note = (result.note ? result.note + " " : "") + bracketNotes.join(" ");
    }

    // 尺寸解析（支援 AA/SS 格式 60*120 和 EE 格式 60x120.2cm）
    var sizeMatch = preprocessedText.match(/(\d+(?:\.\d+)?)\s*[x×*X]\s*(\d+(?:\.\d+)?(?:\.\d+)?)\s*(?:cm|CM)?/);
    if (sizeMatch) {
        var s1 = sizeMatch[1];
        var s2 = sizeMatch[2];
        
        // V34.26 防呆機制：若 OCR 誤將前面的字元跟數字連在一起 (例如 批號 8 與 59.8 連成 859.8)
        // 將超過 300 的離譜尺寸前方數字切除，直到小於等於 300
        while (parseFloat(s1) > 300 && s1.length > 2) {
            s1 = s1.substring(1);
            // 如果切掉後變成以 . 開頭，就補回 0
            if (s1.startsWith('.')) s1 = '0' + s1;
        }
        while (parseFloat(s2) > 300 && s2.length > 2) {
            s2 = s2.substring(1);
            if (s2.startsWith('.')) s2 = '0' + s2;
        }
        
        result.size = s1 + 'x' + s2;
    }

    // 箱數解析（三家格式一樣：3箱*2片）
    var boxMatch = preprocessedText.match(/(\d+)\s*箱/);
    if (boxMatch) {
        result.boxes = boxMatch[1] + '箱';
    }

    // 12. 多品項與批號解析 (V11.27: 結構化重構)
    result.items = [];
    // 使用上方定義好的 tableText (包含全圖保底)
    
    if (tableText) {
        var productMap = typeof lookupProductMasterData_V11 === 'function' ? lookupProductMasterData_V11() : {};

        // V11.28: 針對多品項與分次擷取進行代碼定位式優化
        const isWW = result.branch === '漢樺';
        var codes = tableText.match(/\b[A-Z0-9\-/]{4,12}\b/g) || [];
        
        // V37.38: 嚴格篩選出真正的產品編號，排除電話、系統人員、分公司標籤、以及批號或尺寸雜訊
        const filteredCodes = [];
        const seenCodes = new Set();
        
        // Step 1: 預檢候選代碼並標記是否在編號價目表 (productMap) 中
        const candidates = [];
        var hasAnyDbMatch = false;
        
        codes.forEach(c => {
            c = c.trim();
            if (seenCodes.has(c)) return;
            if (/^(AA|EE|SS|WW|Doris|DORIS)$/i.test(c)) return;
            
            var cleanCode = typeof normalizeProductCode_V11 === 'function' ? normalizeProductCode_V11(c) : c.toUpperCase().replace(/\s/g, "");
            var isDbMatch = !!productMap[cleanCode];
            if (isDbMatch) {
                hasAnyDbMatch = true;
            }
            candidates.push({ code: c, isDbMatch: isDbMatch });
            seenCodes.add(c);
        });
        
        // Step 2: 根據資料庫比對結果實施高精度過濾
        candidates.forEach(cand => {
            const c = cand.code;
            if (isWW) {
                if (/^\d{6}$/.test(c)) {
                    if (hasAnyDbMatch && !cand.isDbMatch) return; // 優先保障價目表內的代號
                    filteredCodes.push(c);
                }
            } else {
                // 非漢樺：優先核對價目表；若為新編號，則必須嚴格符合「2個大寫英文 + 4個以上數字，只容許出現 - 符號，絕不包含 / 及其它符號」的標準業務規則
                var isStandardPattern = /^[A-Z]{2}\d{4,}(?:-[A-Z0-9]+)?$/i.test(c);
                if (cand.isDbMatch || isStandardPattern) {
                    if (hasAnyDbMatch && !cand.isDbMatch) return;
                    filteredCodes.push(c);
                }
            }
        });

        // 核心切分：利用產品代號本身作為分割邊界，將表格分割成每個商品獨佔的區間段
        var segments = [];
        for (let i = 0; i < filteredCodes.length; i++) {
            const currentCode = filteredCodes[i];
            const nextCode = filteredCodes[i + 1];
            const startIdx = tableText.indexOf(currentCode);
            const endIdx = nextCode ? tableText.indexOf(nextCode) : tableText.length;
            if (startIdx !== -1) {
                segments.push({
                    code: currentCode,
                    text: tableText.substring(startIdx, endIdx)
                });
            }
        }

        segments.forEach(seg => {
            var code = seg.code;
            var cleanCode = typeof normalizeProductCode_V11 === 'function' ? normalizeProductCode_V11(code) : code.toUpperCase().replace(/\s/g, "");
            var pInfo = productMap[cleanCode] || { name: "", size: "", img: "" };
            
            // B. 抓取該區間對應的數量 (優先匹配帶等號片數或單純片數)
            var qty = "";
            var totalMatch = seg.text.match(/=(\d+)\s*片/) || seg.text.match(/(\d+)\s*片/);
            if (totalMatch) {
                qty = totalMatch[1];
            } else {
                // 保底：抓取該區間中第一個數字作為數量
                var numMatch = seg.text.match(/(\d+)/);
                qty = numMatch ? numMatch[1] : "1";
            }
            
            // C. 放棄批號抓取 (設為空字串，專注於編號與數量的精準抓取)
            var lot = "";
            
            if (code && qty) {
                result.items.push({
                    code: code,
                    qty: qty,
                    lot: lot,
                    name: pInfo.name,
                    size: pInfo.size,
                    img: pInfo.img
                });
            }
        });
        // 如果 segments 失敗，用舊的 rowRegex 做最後保底
        if (result.items.length === 0) {
            var rowRegex = /(\d+)\s+([A-Z0-9]{4,10})\s+.*?\s+(\d+)\s*片/g;
            var m;
            while ((m = rowRegex.exec(tableText)) !== null) {
                var c = m[2];
                var cleanC = typeof normalizeProductCode_V11 === 'function' ? normalizeProductCode_V11(c) : c.toUpperCase().replace(/\s/g, "");
                var p = productMap[cleanC] || { name: "", size: "", img: "" };
                result.items.push({ code: c, qty: m[3], lot: "", name: p.name, size: p.size, img: p.img });
                if (result.items.length >= 10) break;
            }
        }

        // V39.3 備案邏輯改進：不只檢查 items.length，也檢查代號是否有效
        // 條件：items 為空 OR 所有代號都不在 productMap 中（代號無效）
        var needsFallback = result.items.length === 0;
        if (!needsFallback && result.items.length > 0) {
            // 檢查是否所有代號都無效
            var hasValidCode = result.items.some(function(item) {
                var cleanItemCode = typeof normalizeProductCode_V11 === 'function' ? normalizeProductCode_V11(item.code) : item.code.toUpperCase().replace(/\s/g, "");
                return productMap[cleanItemCode];
            });
            needsFallback = !hasValidCode;
        }

        if (needsFallback) {
            var fallbackCode = typeof extractProductCodeFallback === 'function' ? extractProductCodeFallback(tableText) : null;
            if (fallbackCode) {
                var qty = "";
                var totalMatch = tableText.match(/=(\d+)\s*片/) || tableText.match(/(\d+)\s*片/);
                if (totalMatch) qty = totalMatch[1];
                else qty = "1";

                var cleanFallbackCode = typeof normalizeProductCode_V11 === 'function' ? normalizeProductCode_V11(fallbackCode) : fallbackCode.toUpperCase().replace(/\s/g, "");
                var pInfo = productMap[cleanFallbackCode] || { name: "", size: "", img: "" };
                result.items = [{
                    code: fallbackCode,
                    qty: qty,
                    lot: "",
                    name: pInfo.name,
                    size: pInfo.size,
                    img: pInfo.img
                }];
            }
        }

        // V37.33: 優先使用編號從編號價目表 (productMap) 撈出的「標準尺寸」，取代 OCR 直接掃出的「實際尺寸」
        if (result.items && result.items.length > 0) {
            var standardSizes = [];
            result.items.forEach(function(item) {
                if (item.size) {
                    var cleanSize = String(item.size).trim();
                    if (cleanSize && !standardSizes.includes(cleanSize)) {
                        standardSizes.push(cleanSize);
                    }
                }
            });
            if (standardSizes.length > 0) {
                result.size = standardSizes.join(',');
            }
        }
    }

    // 核心欄位檢查
    if (!result.orderId && !result.customerName) {
        result.error = "無法自動辨識關鍵欄位 (單號/客戶)";
        return result;
    }

    // 11. 指送/直送 自動取代 (V34.22: 在上半部搜尋)
    // V36.27+: 改為全域搜尋，支援單號在表格下方的單據 (如雅麗佳案例)
    const directMap = getDirectMap_V20();
    var directMatch = text.match(/(?:指\s*送|直\s*送)\s*[:：\s]*\s*([^\s\x00-\x1f/]{2,100})/);
    if (directMatch) {
        var directText = directMatch[1].replace(/^[:：\s]+/, "").trim();
        var directKeyword = directText.toUpperCase();
        var foundDirect = null;

        // Step A: 先嘗試匹配預設清單 (加工廠/貨運行)
        for (let m of directMap) {
            var keys = m.key.split(/[,，、]/).map(k => String(k).trim().toUpperCase());
            for (let k of keys) {
                if (directKeyword.includes(k) || k.includes(directKeyword)) {
                    foundDirect = m; break;
                }
            }
            if (foundDirect) break;
        }

        if (foundDirect) {
            // 情境 1: 匹配到熟客清單 -> 套用標準化資訊
            result.note = (result.note ? result.note + " " : "") + "[指送：" + foundDirect.fullName + "]";
            result.address = foundDirect.address;
            result.location = foundDirect.fullName;
        } else {
            // 情境 2: 未匹配清單 -> 檢查是否包含地名關鍵字，若有則視為「指送地址」
            // 包含 縣/市/區/路/街... 等特徵
            if (directText.match(/[\u4e00-\u9fff]+(?:縣|市|區|里|鄰|路|街|巷|弄|號|樓)/)) {
                result.address = directText;
                result.location = "[指送地]";
            } else {
                // 純文字備註 (不具地址特徵)
                result.note = (result.note ? result.note + " " : "") + "[指送：" + directText + "]";
            }
        }
    }

    // 唯一鍵
    if (result.branch && result.orderId) {
        result.uniqueKey = result.branch + "-" + result.orderId;
    } else {
        result.uniqueKey = ""; // 如果沒有單號，則不生成 uniqueKey
    }
    result.isValid = true;
    result.wrapSeal = inferWrapSealFromOcr_V11(result, preprocessedText);

    return result;
}

/**
 * 寫入與覆蓋邏輯 (情境 A / B)
 */
/**
 * 前端呼叫入口：處理圖片辨識並回傳解析結果
 */
function processVisionOcr_Backend(base64Image, loginBranch) {
    try {
        // 1. 呼叫 Google Vision API 取得純文字
        var rawText = callVisionAI(base64Image);
        if (!rawText) return { success: false, error: "無法從圖片中辨識出文字" };

        // 2. 預處理文字
        var cleanText = preprocessOcrText(rawText);

        // 3. 規則引擎解析
        var parsed = parseOcrToOrder_V2(cleanText, loginBranch);

        // 4. 回傳給前端展示與確認 (不在此處直接寫入)
        return { success: true, data: parsed, rawText: rawText };
    } catch (e) {
        return { success: false, error: "辨識過程出錯：" + e.message };
    }
}

/**
 * 內部函式：呼叫 Google Cloud Vision API
 */
function callVisionAI(base64Data) {
    var apiKey = PropertiesService.getScriptProperties().getProperty('VISION_API_KEY');
    if (!apiKey) throw new Error("未設定 VISION_API_KEY，請聯繫管理員。");

    var url = 'https://vision.googleapis.com/v1/images:annotate?key=' + apiKey;

    var payload = {
        requests: [{
            image: { content: base64Data },
            features: [{ type: "TEXT_DETECTION" }]
        }]
    };

    var options = {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(url, options);
    var resText = response.getContentText();
    var json = JSON.parse(resText);

    // V35.3: 強化錯誤診斷 - 若 API 回傳 error 欄位，直接回傳詳細錯誤
    if (json.error) {
        throw new Error("Vision API 錯誤: " + json.error.message + " (Code: " + json.error.code + ")");
    }

    if (json.responses && json.responses[0]) {
        var res = json.responses[0];
        if (res.error) {
             throw new Error("Vision API 單筆錯誤: " + res.error.message);
        }
        if (res.textAnnotations && res.textAnnotations[0]) {
             return res.textAnnotations[0].description;
        }
    }
    return "";
}

function upsertOrderFromOcr_V2(parsedData) {
    if (!parsedData.isValid) {
        return { success: false, error: parsedData.error };
    }

    var lock = LockService.getScriptLock();
    try {
        if (!lock.tryLock(10000)) return { success: false, error: "系統忙碌中 (單據寫入鎖定)，請稍後再試。" };

        var ss = typeof getSS_V11 === 'function' ? getSS_V11() : SpreadsheetApp.openById(V11_PROD_CONFIG.SS_ID);
        
        // V12 路由優化：根據是否勾選業務配送，決定寫入的目標表單
        var targetSheetName = parsedData.isSalesDelivery ? "業務配送清單" : V11_PROD_CONFIG.SHEET_TASKS;
        var sheet;
        
        if (parsedData.isSalesDelivery) {
            sheet = ensureSalesDeliverySheet_Core(ss); // 自動確保業務表單存在且有標頭
        } else {
            sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
        }

        if (typeof ensureHeaders_V11 === 'function') {
            ensureHeaders_V11(sheet);
        }
        
        var data = sheet.getDataRange().getValues();
        var headers = data[0].map(function (h) { return String(h).trim(); });

        // Ensure 品項1編號 ... 品項10數量 columns exist in SHEET_TASKS
        var maxItemsSupported = 10;
        for (var n = 1; n <= maxItemsSupported; n++) {
            var colCodeName = "品項" + n + "編號";
            var colQtyName = "品項" + n + "數量";
            if (headers.indexOf(colCodeName) === -1) {
                var lastCol = sheet.getLastColumn();
                sheet.getRange(1, lastCol + 1, 1, 2).setValues([[colCodeName, colQtyName]]);
                headers.push(colCodeName, colQtyName);
            }
        }

        // 動態欄位綁定
        var idx = {
            date: headers.indexOf("日期"),
            branch: headers.indexOf("分公司"),
            orderId: headers.indexOf("單號"),
            customer: headers.indexOf("客戶"),
            phone: headers.indexOf("聯絡電話"),
            address: headers.indexOf("送貨地址"),
            location: headers.indexOf("地點"), // 新增地點欄位映射
            weight: headers.indexOf("重量(kg)"),
            size: headers.indexOf("尺寸"),
            boxes: headers.indexOf("箱數"),
            eta: headers.indexOf("到貨時間"),
            note: headers.indexOf("備註"),
            wrapSeal: typeof findHIdx_Core === 'function' ? findHIdx_Core(headers, ["封膠膜", "膠膜", "封膜"]) : headers.indexOf("封膠膜"),
            vehicle: headers.indexOf("車牌"),
            status: headers.indexOf("狀態"),
            seq: headers.indexOf("順序"),
            lat: headers.indexOf("緯度"),
            lng: headers.indexOf("經度"),
            contact: typeof findHIdx_Core === 'function' ? findHIdx_Core(headers, "CONTACT") : headers.indexOf("聯絡人"),
            thumbnail: typeof findHIdx_Core === 'function' ? findHIdx_Core(headers, "THUMBNAIL") : headers.indexOf("貨單縮圖") // V36.6
        };

        for (var n = 1; n <= maxItemsSupported; n++) {
            idx["itemCode" + n] = headers.indexOf("品項" + n + "編號");
            idx["itemQty" + n] = headers.indexOf("品項" + n + "數量");
        }

        // V35.7.1: 修復電話長度截斷聯絡人 Bug，容忍市話空白
        const APP_VERSION = "V35.7.1";
        // 尋找是否已存在 (單號+分公司)
        var targetRow = -1;
        var currentStatus = "";
        for (var i = 1; i < data.length; i++) {
            var b = String(data[i][idx.branch]).trim();
            var o = String(data[i][idx.orderId]).trim();
            if (b + "-" + o === parsedData.uniqueKey) {
                targetRow = i + 1; // 1-based index for row
                currentStatus = String(data[i][idx.status]).trim();
                if (currentStatus === "") currentStatus = "待指派";
                break;
            }
        }

        // 呼叫 Google Maps 轉換經緯度
        var lat = "", lng = "";
        if (parsedData.address) {
            try {
                var res = Maps.newGeocoder().geocode(parsedData.address).results[0];
                if (res) {
                    lat = res.geometry.location.lat;
                    lng = res.geometry.location.lng;
                }
            } catch (e) { }
        }

        // V36.2: 地址重複檢查 (防止跨公司重複配送)
        var addressConflict = null;
        var todayStr = parsedData.date || Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy/MM/dd");

        CacheService.getScriptCache().remove('war_room_data_v2'); // V36.2: 成功寫入後清除快取
        if (targetRow !== -1) {
            // 情境 B: 已存在
            if (currentStatus === "待指派" || currentStatus === "未指派" || currentStatus === "未派車" || currentStatus === "") {
                // 允許覆蓋
                if (idx.weight !== -1 && parsedData.weight) sheet.getRange(targetRow, idx.weight + 1).setValue(parsedData.weight);
                if (idx.size !== -1 && parsedData.size) sheet.getRange(targetRow, idx.size + 1).setValue(parsedData.size);
                if (idx.boxes !== -1 && parsedData.boxes) sheet.getRange(targetRow, idx.boxes + 1).setValue(parsedData.boxes);
                if (idx.note !== -1 && parsedData.note) sheet.getRange(targetRow, idx.note + 1).setValue(parsedData.note);
                if (idx.wrapSeal !== -1) sheet.getRange(targetRow, idx.wrapSeal + 1).setValue((typeof normalizeWrapSeal_Core === 'function' ? normalizeWrapSeal_Core(parsedData.wrapSeal) : (String(parsedData.wrapSeal || "").indexOf("封") !== -1 ? "封" : "")));
                if (idx.address !== -1 && parsedData.address) sheet.getRange(targetRow, idx.address + 1).setValue(parsedData.address);
                if (idx.location !== -1 && parsedData.location) sheet.getRange(targetRow, idx.location + 1).setValue(parsedData.location);
                if (idx.phone !== -1 && parsedData.phone) sheet.getRange(targetRow, idx.phone + 1).setValue("'" + parsedData.phone);
                if (idx.contact !== -1 && parsedData.contactName) sheet.getRange(targetRow, idx.contact + 1).setValue(parsedData.contactName);
                if (idx.eta !== -1 && parsedData.etaTime) sheet.getRange(targetRow, idx.eta + 1).setValue(parsedData.etaTime);
                if (idx.thumbnail !== -1 && parsedData.thumbnail) sheet.getRange(targetRow, idx.thumbnail + 1).setValue(parsedData.thumbnail); // V36.6

                if (lat && lng) {
                    if (idx.lat !== -1) sheet.getRange(targetRow, idx.lat + 1).setValue(lat);
                    if (idx.lng !== -1) sheet.getRange(targetRow, idx.lng + 1).setValue(lng);
                }
                
                // 寫入品項明細到主表欄位
                if (parsedData.items && parsedData.items.length > 0) {
                    for (var n = 1; n <= maxItemsSupported; n++) {
                        var item = parsedData.items[n - 1] || { code: "", qty: "" };
                        var colCodeIdx = idx["itemCode" + n];
                        var colQtyIdx = idx["itemQty" + n];
                        if (colCodeIdx !== -1) sheet.getRange(targetRow, colCodeIdx + 1).setValue(item.code);
                        if (colQtyIdx !== -1) sheet.getRange(targetRow, colQtyIdx + 1).setValue(item.qty);
                    }
                }

                // V11.26: 同步寫入子表 (撿貨明細)
                if (parsedData.items && parsedData.items.length > 0) {
                    upsertPickingItems_V11(parsedData.uniqueKey, parsedData.items);
                }

                return { success: true, message: "已更新現有待指派單據與明細：" + parsedData.uniqueKey, data: parsedData };
            } else {
                return { success: false, error: "單據 [" + parsedData.uniqueKey + "] 已處於「" + currentStatus + "」狀態，禁止覆蓋更新。" };
            }
        } else {
            // 情境 A: 不存在 -> 新增一筆
            var newRow = new Array(headers.length).fill("");
            if (idx.date !== -1) newRow[idx.date] = parsedData.date || todayStr;
            if (idx.branch !== -1) newRow[idx.branch] = parsedData.branch;
            if (idx.orderId !== -1) newRow[idx.orderId] = parsedData.orderId;
            if (idx.customer !== -1) newRow[idx.customer] = parsedData.customerName || "OCR解析代查";
            if (idx.phone !== -1) newRow[idx.phone] = "'" + parsedData.phone;
            if (idx.contact !== -1) newRow[idx.contact] = parsedData.contactName || "";
            if (idx.address !== -1) newRow[idx.address] = parsedData.address;
            if (idx.location !== -1) newRow[idx.location] = parsedData.location || "";
            if (idx.weight !== -1) newRow[idx.weight] = parsedData.weight || 0;
            if (idx.size !== -1 && parsedData.size) newRow[idx.size] = parsedData.size;
            if (idx.boxes !== -1 && parsedData.boxes) newRow[idx.boxes] = parsedData.boxes;
            if (idx.eta !== -1) newRow[idx.eta] = parsedData.etaTime;
            if (idx.note !== -1) newRow[idx.note] = parsedData.note;
            if (idx.wrapSeal !== -1) newRow[idx.wrapSeal] = (typeof normalizeWrapSeal_Core === 'function' ? normalizeWrapSeal_Core(parsedData.wrapSeal) : (String(parsedData.wrapSeal || "").indexOf("封") !== -1 ? "封" : ""));
            if (idx.status !== -1) newRow[idx.status] = "待指派";
            if (idx.vehicle !== -1) newRow[idx.vehicle] = "";
            if (idx.seq !== -1) newRow[idx.seq] = "";
            if (idx.lat !== -1) newRow[idx.lat] = lat;
            if (idx.lng !== -1) newRow[idx.lng] = lng;
            if (idx.thumbnail !== -1) newRow[idx.thumbnail] = parsedData.thumbnail || "";

            // 把品項填入 row 陣列中
            if (parsedData.items && parsedData.items.length > 0) {
                for (var n = 1; n <= maxItemsSupported; n++) {
                    var item = parsedData.items[n - 1] || { code: "", qty: "" };
                    var colCodeIdx = idx["itemCode" + n];
                    var colQtyIdx = idx["itemQty" + n];
                    if (colCodeIdx !== -1) newRow[colCodeIdx] = item.code;
                    if (colQtyIdx !== -1) newRow[colQtyIdx] = item.qty;
                }
            }

            sheet.appendRow(newRow);
            
            // V12: 若寫入業務表，執行自動排序
            if (parsedData.isSalesDelivery) {
                sortSalesSheetByCompany_Core(sheet);
            }
            
            // V11.26: 同步寫入子表 (撿貨明細)
            if (parsedData.items && parsedData.items.length > 0) {
                upsertPickingItems_V11(parsedData.uniqueKey, parsedData.items);
            }

            return { success: true, message: "已成功新增至 [" + targetSheetName + "]：" + parsedData.uniqueKey, data: parsedData };
        }
    } catch (e) {
        return { success: false, error: "upsertOrder 執行錯誤: " + e.message };
    } finally {
        lock.releaseLock();
    }
}

/**
 * V39.3: 備案代號提取 - 當 OCR 識別失敗時，從表格文本中提取符合「2英文+5~6數字」的代號
 * 改進版：去掉 \b 邊界，處理換行符和特殊字符的分散格式
 * 處理字母 O 與數字 0 的混淆 (例如 RO54505 被識別成 R054505)
 * 例如：RE612114、AA61250、RO54505、KP12010
 */
function extractProductCodeFallback(tableText) {
    if (!tableText) return null;
    // 模式 1: 標準「2英文+5~6數字」(不用 \b 邊界，處理換行和特殊字符)
    var codePattern1 = /([A-Z]{2}\d{5,6})/i;
    var match = tableText.match(codePattern1);
    if (match) return match[1].toUpperCase();

    // 模式 2: O/0混淆「1英文+1數字+5數字」(如 R054505 應為 RO54505)
    var codePattern2 = /([A-Z][0O]\d{5})/i;
    match = tableText.match(codePattern2);
    if (match) {
        var code = match[1].toUpperCase();
        // 自動修正：R0 → RO (假設第二位是被誤識為0的O)
        code = code.replace(/([A-Z])0(\d)/, "$1O$2");
        return code;
    }
    return null;
}
