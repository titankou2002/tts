/**
 * ⏰ 智慧物流系統 ─ 每小時到貨自動彙整通知模組 V1.0
 * 
 * 核心邏輯：
 * 1. 每小時定時觸發執行，比對「派送清單」中完成時間在過去 65 分鐘內的已完成訂單。
 * 2. 依「分公司」進行分組統計，若無新到貨資料則完全靜音（不發送訊息）。
 * 3. 讀取「系統白名單」中對應分公司且啟用的「line通知人」（支援個人 User ID 與群組 Group ID）。
 * 4. 個別使用各自機器人的 Token 發送無聲通知 (notificationDisabled: true)。
 */

/**
 * 🚀 一鍵初始化：寫入三家分公司 LINE 機器人的 Access Token
 */
function initScriptProperties_HourlyNotify_V11() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty("LINE_TOKEN_GAOYACI", "hzlR1hr0qkVqcoIo60dqdxomaloGS8dyL3lpENhMLZYLvcNNi1KbM+lhsABoOIO2leCOFrpxFhP1Gq2qxPY2NtmHm+KNlsSAYoES4jqKIpZUSHbbwgFvcrv0kF4LJb7TJ4lMiRHOz+0JNta0zXfwdgdB04t89/1O/w1cDnyilFU=");
  props.setProperty("LINE_TOKEN_XIYENA", "TWnnSSNt2W6WT+GzFomkzpO1pjmnFUnHBwzX8WELv8QqRUKud4b1l+oYScv/U9roOFVSJGJ3PKNu/epFUll/LkbqLYGj7gVtKJFrWKdqCQqwTHZmOEAtXak2sUNUyXWW2JRwOdKyFqbdbEhJpsCA0QdB04t89/1O/w1cDnyilFU=");
  props.setProperty("LINE_TOKEN_ANDIGA", "TVEmQdRFexP0Y+dKjMtwfwiCcwfMlqHXvv7KJ67bcsZyS9+3Uvy7Yw1buPOTMMBrCUEeyN1Ti8c/dok3d7J30+TfXcYmCWoHINPm4BU2l0GSssA6ywn4oafnYFl5xhFpfgHeloxX4RzLninKLl9MugdB04t89/1O/w1cDnyilFU=");
  return "✅ 高雅瓷、喜悅納、安帝嘉 LINE Token 已成功寫入指令碼屬性！";
}

/**
 * ⏰ 建立固定時間通知排程：10:00 / 12:00 / 14:00 / 17:00
 */
function setupHourlyDeliverySummaryTrigger_V11() {
  // 先清除舊的同名排程，避免重複
  removeAllDeliverySummaryTriggers_V11();
  
  var TRIGGER_HOURS = [10, 12, 14, 17]; // 早上10點、中午12點、下午2點、下午5點
  
  TRIGGER_HOURS.forEach(function(hour) {
    ScriptApp.newTrigger('hourlyDeliverySummaryJob')
      .timeBased()
      .atHour(hour)
      .everyDays(1)
      .inTimezone("Asia/Taipei")
      .create();
  });
    
  SpreadsheetApp.getUi().alert(
    "✅ 成功建立自動化排程！\n\n" +
    "每天將在以下時間自動發送 LINE 通知：\n" +
    "• 上午 10:00\n" +
    "• 中午 12:00\n" +
    "• 下午 14:00\n" +
    "• 下午 17:00\n\n" +
    "📧 漢樺無人簽收 Email：每日 17:30 自動發送 (假日不發送)\n" +
    "🧼 數據 3 天自動封存清理：每日凌晨 02:00 自動執行\n\n" +
    "⚠️ 若需變更，請先執行「移除排程」再重新建立。"
  );
  
  // 建立漢樺 17:30 Email 排程與凌晨 02:00 數據清理排程
  setupHanHuaEmailTrigger_V11();
  setupCleanupTrigger_V11();
}

/**
 * ⏰ 建立 3 天數據自動封存清理排程 (每天凌晨 02:00 自動執行)
 */
function setupCleanupTrigger_V11() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'cleanupOldLogsAndTasks_V11') {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  ScriptApp.newTrigger('cleanupOldLogsAndTasks_V11')
    .timeBased()
    .atHour(2)
    .everyDays(1)
    .inTimezone("Asia/Taipei")
    .create();
  
  console.log("✅ 成功建立每日凌晨 02:00 的 3 天數據封存自動清理排程！");
}

/**
 * 🗑️ 移除所有到貨通知排程（避免重複或更換時間時殘留舊觸發器）
 */
function removeAllDeliverySummaryTriggers_V11() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  triggers.forEach(function(trigger) {
    var fn = trigger.getHandlerFunction();
    if (fn === 'hourlyDeliverySummaryJob' || fn === 'sendHanHuaUnattendedEmailReport' || fn === 'cleanupOldLogsAndTasks_V11') {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  
  if (removed > 0) {
    console.log("已移除 " + removed + " 個舊的自動排程。");
  }
}

/**
 * 核心執行程序：由計時器每小時呼叫一次
 */
function hourlyDeliverySummaryJob() {
  var ss = getSS_V11();
  var taskSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
  if (!taskSheet) {
    console.error("hourlyDeliverySummaryJob: 找不到派送清單工作表");
    return;
  }
  
  var data = taskSheet.getDataRange().getValues();
  var h = data[0].map(function (v) { return String(v).trim(); });
  
  var idxId = findHIdx_Core(h, "ID");
  var idxBranch = findHIdx_Core(h, "BRANCH");
  var idxStatus = findHIdx_Core(h, "STATUS");
  var idxFinish = findHIdx_Core(h, "FINISH_TIME");
  var idxCust = findHIdx_Core(h, "CUSTOMER");
  var idxAddr = findHIdx_Core(h, "ADDRESS");
  var idxPhoto = findHIdx_Core(h, "THUMBNAIL");
  
  if (idxStatus === -1 || idxFinish === -1) {
    console.error("hourlyDeliverySummaryJob: 欄位設定錯誤，找不到 STATUS 或 FINISH_TIME 欄位");
    return;
  }
  
  var now = new Date();
  // 抓取過去 120 分鐘完成的，擴大時間區間防止因網路或排程問題遺漏
  var oneHourAgo = new Date(now.getTime() - 120 * 60 * 1000); 
  
  // 讀取已經通知過的單號清單，防止重複發送
  var props = PropertiesService.getScriptProperties();
  var notifiedStr = props.getProperty("NOTIFIED_ORDER_IDS") || "";
  var notifiedIds = notifiedStr.split(",").map(function(s) { return s.trim(); }).filter(Boolean);
  
  var branchTasks = {};
  var taskIds = [];
  var completedRows = [];
  
  for (var i = 1; i < data.length; i++) {
    var statusVal = String(data[i][idxStatus] || "").trim();
    if (statusVal !== "已完成") continue;
    
    var finishVal = data[i][idxFinish];
    var finishDate = null;
    
    if (finishVal instanceof Date) {
      finishDate = finishVal;
    } else if (typeof finishVal === 'string' && finishVal.trim() !== '') {
      finishDate = new Date(finishVal);
    }
    
    if (!finishDate || isNaN(finishDate.getTime())) continue;
    
    // 時間落入過去區間
    if (finishDate >= oneHourAgo && finishDate <= now) {
      var id = idxId !== -1 ? String(data[i][idxId] || "").trim() : "";
      
      // 核心防重：如果這個單號已經報過，就直接跳過不報
      if (id && notifiedIds.indexOf(id) !== -1) continue;
      
      var branchVal = idxBranch !== -1 ? String(data[i][idxBranch] || "").trim() : "";
      var customer = idxCust !== -1 ? String(data[i][idxCust] || "").trim() : "";
      var address = idxAddr !== -1 ? String(data[i][idxAddr] || "").trim() : "";
      var invoiceVal = idxPhoto !== -1 ? String(data[i][idxPhoto] || "").trim() : "";
      
      var taskObj = {
        id: id,
        branch: branchVal,
        customer: customer,
        address: address,
        invoice: invoiceVal,
        photo: "",
        finishTime: Utilities.formatDate(finishDate, "GMT+8", "HH:mm:ss"),
        finishTimeTitle: Utilities.formatDate(finishDate, "GMT+8", "M/d HH:mm") + "送達",
        items: []
      };
      
      if (id) {
        taskIds.push(id);
        completedRows.push(taskObj);
      }
    }
  }
  
  if (completedRows.length === 0) {
    console.log("過去一小時內無新增完成的配送任務。");
    return;
  }
  
  // 💡 批次從「送貨日誌」中比對出真實司機上傳的簽收單照片與司機姓名
  var logInfoMap = lookupSignPhotosFromLog_V11(ss, taskIds);
  completedRows.forEach(function (task) {
    var info = logInfoMap[task.id] || {};
    task.photo = info.photo || "";
    task.driver = info.driver || "";
    task.signType = info.signType || "本人親簽";
  });
  
  // 批次撈取商品詳細清單 (含包裝、片數換算)
  var detailsMap = {};
  try {
    detailsMap = getDriverTaskItemDetails_V11(taskIds) || {};
  } catch (e) {
    console.error("獲取商品明細失敗: " + e.message);
  }
  
  // 注入商品明細並進行分公司分組
  var newlyNotifiedIds = [];
  completedRows.forEach(function (task) {
    var details = detailsMap[task.id];
    if (details && details.items) {
      task.items = details.items;
    }
    
    var branchKey = task.branch || "未分類";
    if (!branchTasks[branchKey]) {
      branchTasks[branchKey] = [];
    }
    branchTasks[branchKey].push(task);
    
    if (task.id) {
      newlyNotifiedIds.push(task.id);
    }
  });
  
  // 依分公司分流發送
  Object.keys(branchTasks).forEach(function (branchName) {
    var tasks = branchTasks[branchName];
    if (tasks.length === 0) return;
    
    // 獲取該分公司白名單中啟用的 line通知人
    var notifiers = getLineNotifiers_V11(ss, branchName);
    if (notifiers.length === 0) {
      console.log("分公司 [" + branchName + "] 無對應的 LINE 通知接收人");
      return;
    }
    
    var msg = null;
    // 💡 混合發送策略：5 筆以內用精美的 Flex 卡片，超過 5 筆直接改為單則純文字彙整（附照片與貨單連結）以防洗版
    if (tasks.length <= 5) {
      try {
        msg = buildHourlySummaryFlexMessage(branchName, tasks);
      } catch (e) {
        console.error("建立 Flex Message 失敗，降級為純文字: " + e.message);
        msg = buildHourlySummaryTextMessage(branchName, tasks);
      }
    } else {
      msg = buildHourlySummaryTextMessage(branchName, tasks);
    }
    
    // 個別進行推播
    notifiers.forEach(function (lineId) {
      try {
        pushLineMessageToId_V11(lineId, msg, branchName);
      } catch (err) {
        console.error("發送通知失敗 (ID: " + lineId + ", 分公司: " + branchName + "): " + err.message);
      }
    });
  });
  
  // 將這次成功發送的單號寫入已通知紀錄，並限制紀錄長度在最近 300 筆內避免超出屬性容量
  var updatedNotifiedIds = notifiedIds.concat(newlyNotifiedIds);
  if (updatedNotifiedIds.length > 300) {
    updatedNotifiedIds = updatedNotifiedIds.slice(updatedNotifiedIds.length - 300);
  }
  props.setProperty("NOTIFIED_ORDER_IDS", updatedNotifiedIds.join(","));
}

/**
 * 從系統白名單獲取特定分公司且已啟用的 LINE 通知人 ID 陣列
 */
function getLineNotifiers_V11(ss, branchName) {
  var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_WHITELIST);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var h = data[0].map(function (v) { return String(v).trim().toLowerCase(); });
  
  var idxActive = -1, idxBranch = -1, idxLine = -1;
  for (var c = 0; c < data[0].length; c++) {
    var val = String(data[0][c]).trim().toLowerCase();
    if (val.indexOf("帳號啟用") !== -1 || val.indexOf("active") !== -1) idxActive = c;
    if (val.indexOf("分公司") !== -1 || val.indexOf("branch") !== -1) idxBranch = c;
    if (val.indexOf("line通知") !== -1 || val.indexOf("line通知人") !== -1) idxLine = c;
  }
  
  // 保底降級索引 (若欄位名稱完全對不上)
  if (idxActive === -1) idxActive = 0;
  if (idxBranch === -1) idxBranch = 4;
  if (idxLine === -1) idxLine = 10;
  
  var notifiers = [];
  for (var i = 1; i < data.length; i++) {
    var activeVal = String(data[i][idxActive] || "").trim();
    var branchVal = String(data[i][idxBranch] || "").trim();
    var lineVal = String(data[i][idxLine] || "").trim();
    
    if (activeVal === "是" && branchVal === branchName && lineVal !== "") {
      notifiers.push(lineVal);
    }
  }
  return notifiers;
}

/**
 * 將 Google Drive 照片網址轉為 LINE 官方 Flex Message 支援的直接下載/顯示網址
 */
function getDirectImageUrl_V11(driveUrl) {
  if (!driveUrl) return "";
  var cleanUrl = String(driveUrl).trim();
  
  // 匹配 id=xxx 或是 /file/d/xxx/ 格式
  var match = cleanUrl.match(/id=([^&]+)/) || cleanUrl.match(/\/file\/d\/([^/]+)/);
  if (match && match[1]) {
    // 使用 thumbnail 格式：此格式直接輸出圖片資料流，LINE 官方伺服器可正確載入
    // sz=w1600 代表最大寬度 1600px，畫質足夠清晰
    return "https://drive.google.com/thumbnail?id=" + match[1] + "&sz=w1600";
  }
  
  return cleanUrl;
}

/**
 * 💡 從「送貨日誌」中，以「單號」批次查詢對應的「簽收單照片」網址
 */
function lookupSignPhotosFromLog_V11(ss, orderIds) {
  var photoMap = {}; // 回傳格式: { orderId: { photo: photoUrl, driver: driverName, signType: signType } }
  if (!orderIds || orderIds.length === 0) return photoMap;
  
  var logSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_LOG);
  if (!logSheet) return photoMap;
  
  var data = logSheet.getDataRange().getValues();
  var h = data[0].map(function (v) { return String(v).trim(); });
  
  var idxId = h.indexOf("單號");
  if (idxId === -1) idxId = findHIdx_Core(h, "ID");
  var idxPhoto = h.indexOf("簽收單照片");
  var idxDriver = h.indexOf("司機");
  var idxSignType = h.indexOf("簽收類型");
  var idxNote = h.indexOf("備註");
  
  if (idxId === -1) return photoMap;
  
  // 建立對照表：以最後一次出現的為準 (最新上傳的照片與司機姓名)
  for (var i = 1; i < data.length; i++) {
    var id = String(data[i][idxId] || "").trim();
    var photo = idxPhoto !== -1 ? String(data[i][idxPhoto] || "").trim() : "";
    var driver = idxDriver !== -1 ? String(data[i][idxDriver] || "").trim() : "";
    var signType = idxSignType !== -1 ? String(data[i][idxSignType] || "").trim() : "";
    var note = idxNote !== -1 ? String(data[i][idxNote] || "").trim() : "";
    
    if (!signType && note) {
      if (note.indexOf("無人") !== -1 || note.indexOf("放置指定位置") !== -1) {
        signType = "無人簽收（放置指定位置）";
      } else {
        signType = "本人親簽";
      }
    }
    
    if (id) {
      photoMap[id] = {
        photo: photo,
        driver: driver,
        signType: signType || "本人親簽"
      };
    }
  }
  return photoMap;
}

/**
 * 💡 將陣列分割為指定大小的子陣列 (二維陣列)
 */
function chunkArray_V11(arr, size) {
  var chunks = [];
  for (var i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * 💡 從完整地址中，萃取出「路名/街名/大道名（含段數）」做為地址簡碼
 */
function extractRoadShortName_V11(address) {
  if (!address) return "";
  var clean = String(address).trim();
  // 匹配常見的台灣路名格式，如：民義路一段、意仁坑路、縣民大道二段
  var match = clean.match(/([^市區縣鄉鎮]*?(?:路|街|大道)(?:\s*[一二三四五六七八九十百]+段)?)/);
  if (match && match[1]) {
    var road = match[1];
    // 清除前綴行政區，例如 "五股區民義路" -> "民義路"
    var lastDistrictIdx = Math.max(road.lastIndexOf("市"), road.lastIndexOf("區"), road.lastIndexOf("縣"), road.lastIndexOf("鄉"), road.lastIndexOf("鎮"));
    if (lastDistrictIdx !== -1) {
      road = road.substring(lastDistrictIdx + 1);
    }
    return road;
  }
  return clean.substring(0, 10);
}

/**
 * 💡 使用 TinyURL API 縮短 Google Drive 照片網址，使純文字排版乾淨
 */
function shortenUrl_TinyURL_V11(longUrl) {
  if (!longUrl) return "";
  var cleanUrl = String(longUrl).trim();
  if (cleanUrl.indexOf("http") !== 0) return cleanUrl;
  
  // 1. 嘗試 TinyURL
  try {
    var response = UrlFetchApp.fetch("https://tinyurl.com/api-create.php?url=" + encodeURIComponent(cleanUrl), {
      muteHttpExceptions: true,
      followRedirects: true
    });
    if (response.getResponseCode() === 200) {
      var shortUrl = response.getContentText().trim();
      if (shortUrl && shortUrl.indexOf("http") === 0) {
        return shortUrl;
      }
    }
  } catch (e) {
    console.error("TinyURL 縮網址失敗: " + e.message);
  }
  
  // 2. 備份嘗試 is.gd
  try {
    var response = UrlFetchApp.fetch("https://is.gd/create.php?format=simple&url=" + encodeURIComponent(cleanUrl), {
      muteHttpExceptions: true,
      followRedirects: true
    });
    if (response.getResponseCode() === 200) {
      var shortUrl = response.getContentText().trim();
      if (shortUrl && shortUrl.indexOf("http") === 0) {
        return shortUrl;
      }
    }
  } catch (e) {
    console.error("is.gd 縮網址失敗: " + e.message);
  }
  
  return cleanUrl; // 失敗時保底回傳原網址
}

/**
 * 建立 LINE 官方 Premium Flex Message 卡片樣板 (可滑動的 Carousel 卡片輪播，每張卡片代表一筆到貨單)
 */
function buildHourlySummaryFlexMessage(branchName, tasks) {
  // 分公司佈局色彩主題
  var branchThemes = {
    "安帝嘉": { primary: "#059669", secondary: "#10b981", badgeBg: "#d1fae5", badgeTxt: "#065f46" },
    "高雅瓷": { primary: "#db2777", secondary: "#f472b6", badgeBg: "#fce7f3", badgeTxt: "#9d174d" },
    "喜悅納": { primary: "#0284c7", secondary: "#38bdf8", badgeBg: "#e0f2fe", badgeTxt: "#075985" },
    "漢樺": { primary: "#d97706", secondary: "#fbbf24", badgeBg: "#ffedd5", badgeTxt: "#9a3412" }
  };
  var defaultTheme = { primary: "#475569", secondary: "#64748b", badgeBg: "#f1f5f9", badgeTxt: "#334155" };
  var theme = branchThemes[branchName] || defaultTheme;

  var taskCards = tasks.slice(0, 10).map(function(t) {
    var directPhotoUrl = getDirectImageUrl_V11(t.photo);
    var directInvoiceUrl = getDirectImageUrl_V11(t.invoice);
    
    // 建立品項明細的排版 Box (限秀前三個，多出的顯示等共 X 項)
    var itemBoxes = [];
    var limit = 3;
    if (t.items && t.items.length > 0) {
      var displayItems = t.items.slice(0, limit);
      itemBoxes = displayItems.map(function(item) {
        var qtyDesc = formatDriverItemQty_TextOnly(item.qty, item.boxQty, item.pcsPerBox);
        return {
          "type": "box",
          "layout": "horizontal",
          "contents": [
            {
              "type": "text",
              "text": "• " + item.code,
              "size": "sm",
              "color": "#334155",
              "flex": 3,
              "weight": "bold"
            },
            {
              "type": "text",
              "text": qtyDesc,
              "size": "sm",
              "color": theme.primary,
              "align": "end",
              "flex": 2,
              "weight": "bold"
            }
          ],
          "margin": "xs"
        };
      });
      
      if (t.items.length > limit) {
        itemBoxes.push({
          "type": "text",
          "text": "• ...等共 " + t.items.length + " 項商品",
          "size": "xs",
          "color": "#64748b",
          "margin": "xs",
          "style": "italic"
        });
      }
    } else {
      itemBoxes = [{
        "type": "text",
        "text": "無詳細品項資料",
        "size": "sm",
        "color": "#94a3b8",
        "style": "italic"
      }];
    }
    
    // 取得時間標題
    var timeTitle = t.finishTimeTitle || (t.finishTime ? t.finishTime.substring(0, 5) + "送達" : "已送達");
    
    var bubble = {
      "type": "bubble",
      "size": "mega",
      "styles": {
        "header": { "backgroundColor": "#ffffff" },
        "body": { "backgroundColor": "#ffffff" }
      },
      "header": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": branchName,
            "weight": "bold",
            "color": theme.primary,
            "size": "md"
          }
        ]
      },
      "body": {
        "type": "box",
        "layout": "vertical",
        "paddingTop": "none",
        "contents": (function() {
          var contents = [];
          
          // 如果有照片，在上方加上一條分公司代表色的粗底線，做為視覺裝飾
          // 💡 LINE 規定 box.contents 不得為空，必須至少有一個 filler 子元素
          if (directPhotoUrl) {
            contents.push({
              "type": "box",
              "layout": "vertical",
              "height": "4px",
              "backgroundColor": theme.primary,
              "margin": "none",
              "contents": [{ "type": "filler" }]
            });
          }
          
          // 保底備案：如果沒有簽收照照片，為免資訊遺失，以文字形式秀出「客戶、地址、時間」
          if (!directPhotoUrl) {
            if (t.customer) {
              contents.push({
                "type": "box",
                "layout": "horizontal",
                "contents": [
                  {
                    "type": "text",
                    "text": "客戶：",
                    "color": "#64748b",
                    "size": "sm",
                    "weight": "bold",
                    "flex": 2
                  },
                  {
                    "type": "text",
                    "text": t.customer,
                    "color": "#0f172a",
                    "size": "sm",
                    "flex": 8,
                    "wrap": true
                  }
                ],
                "margin": "md"
              });
            }
            if (t.address) {
              contents.push({
                "type": "box",
                "layout": "horizontal",
                "contents": [
                  {
                    "type": "text",
                    "text": "地址：",
                    "color": "#64748b",
                    "size": "sm",
                    "weight": "bold",
                    "flex": 2
                  },
                  {
                    "type": "text",
                    "text": t.address,
                    "color": "#0f172a",
                    "size": "sm",
                    "flex": 8,
                    "wrap": true
                  }
                ],
                "margin": "md"
              });
            }
            if (t.finishTime) {
              contents.push({
                "type": "box",
                "layout": "horizontal",
                "contents": [
                  {
                    "type": "text",
                    "text": "時間：",
                    "color": "#64748b",
                    "size": "sm",
                    "weight": "bold",
                    "flex": 2
                  },
                  {
                    "type": "text",
                    "text": t.finishTime,
                    "color": "#0f172a",
                    "size": "sm",
                    "flex": 8
                  }
                ],
                "margin": "md"
              });
            }
          }
          
          // 品項明細區 (若明細沒有，就不顯示)
          if (t.items && t.items.length > 0) {
            contents.push(
              {
                "type": "separator",
                "margin": "lg",
                "color": "#e2e8f0"
              },
              {
                "type": "box",
                "layout": "horizontal",
                "margin": "md",
                "contents": [
                  {
                    "type": "text",
                    "text": "明細：",
                    "color": "#64748b",
                    "size": "sm",
                    "weight": "bold",
                    "flex": 2
                  },
                  {
                    "type": "box",
                    "layout": "vertical",
                    "flex": 8,
                    "contents": itemBoxes
                  }
                ]
              }
            );
          }
          
          // 簽收狀態判斷
          var isNoSign = t.signType && (t.signType.indexOf("無人") !== -1 || t.signType.indexOf("放置指定位置") !== -1);
          var signDescText = isNoSign ? "無人簽收，依客戶指示放置指定位置" : "本人親簽";

          contents.push({
            "type": "box",
            "layout": "horizontal",
            "margin": "md",
            "contents": [
              {
                "type": "text",
                "text": "簽收：",
                "color": "#64748b",
                "size": "sm",
                "weight": "bold",
                "flex": 2
              },
              {
                "type": "text",
                "text": signDescText,
                "color": isNoSign ? "#d97706" : "#0f172a",
                "size": "sm",
                "weight": isNoSign ? "bold" : "normal",
                "flex": 8,
                "wrap": true
              }
            ]
          });

          // 卡片底部橫向排版：左邊放銷貨單連結，右邊放簽收狀態徽章
          contents.push({
            "type": "box",
            "layout": "horizontal",
            "margin": "lg",
            "alignItems": "center",
            "contents": [
              {
                "type": "box",
                "layout": "vertical",
                "flex": 7,
                "contents": (function() {
                  if (directInvoiceUrl) {
                    return [{
                      "type": "text",
                      "text": "🔗 開啟銷貨單",
                      "color": "#2563eb",
                      "size": "sm",
                      "weight": "bold",
                      "action": {
                        "type": "uri",
                        "label": "開啟銷貨單",
                        "uri": directInvoiceUrl
                      }
                    }];
                  }
                  return [{ "type": "filler" }];
                })()
              },
              {
                "type": "box",
                "layout": "vertical",
                "flex": 3,
                "backgroundColor": isNoSign ? "#fef3c7" : theme.badgeBg,
                "cornerRadius": "md",
                "paddingAll": "xs",
                "alignItems": "center",
                "contents": [
                  {
                    "type": "text",
                    "text": isNoSign ? "無人簽收" : "已送達",
                    "color": isNoSign ? "#92400e" : theme.badgeTxt,
                    "size": "xs",
                    "weight": "bold"
                  }
                ]
              }
            ]
          });
          
          return contents;
        })()
      }
    };
    
    // 如果有司機拍照照片 (即已經蓋有文字的直式原始圖檔)，加入 Hero 區塊展現
    if (directPhotoUrl) {
      bubble.hero = {
        "type": "image",
        "url": directPhotoUrl,
        "size": "full",
        "aspectRatio": "1:2", // 💡 直式 1:2 比例展現原始卡片圖檔，完全不裁切下半部資訊
        "aspectMode": "cover",
        "action": {
          "type": "uri",
          "label": "查看簽收照原圖",
          "uri": directPhotoUrl
        }
      };
    }
    
    return bubble;
  });

  if (taskCards.length === 1) {
    return {
      "type": "flex",
      "altText": "🚚 " + branchName + " 到貨通知",
      "contents": taskCards[0]
    };
  } else {
    return {
      "type": "flex",
      "altText": "🚚 " + branchName + " " + tasks.length + " 筆到貨彙整",
      "contents": {
        "type": "carousel",
        "contents": taskCards
      }
    };
  }
}

/**
 * 建立備用純文字彙整訊息
 */
function buildHourlySummaryTextMessage(branchName, tasks) {
  var lines = [];
  lines.push("【" + branchName + " ｜ 到貨彙整】");
  
  // 取得中文星期，例如 2026/07/21 周二 08:03
  var days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  var now = new Date();
  var dayOfWeek = days[now.getDay()];
  var timeStr = Utilities.formatDate(now, "GMT+8", "yyyy/MM/dd") + " " + dayOfWeek + " " + Utilities.formatDate(now, "GMT+8", "HH:mm");
  lines.push(timeStr);
  lines.push("共計 " + tasks.length + " 筆送達 ✅");
  
  var circledNumbers = ["⓵", "⓶", "⓷", "⓸", "⓹", "⓺", "⓻", "⓼", "⓽", "⓾", "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳"];
  
  tasks.forEach(function (t, idx) {
    lines.push(""); // 每筆之間空一行
    
    // 簽收狀態判斷
    var isNoSign = t.signType && (t.signType.indexOf("無人") !== -1 || t.signType.indexOf("放置指定位置") !== -1);
    var statusTitle = isNoSign ? " 無人簽收 ⚠️" : " 送達 ✅";

    // ⓵ 漢樺 ｜15:29 送達 ✅ (司機有名字則插入時間前)
    var numPrefix = circledNumbers[idx] || (idx + 1) + ".";
    var cleanCust = cleanCustName_V11(t.customer);
    var timeMin = t.finishTime ? t.finishTime.substring(0, 5) : "--:--";
    var driverDesc = t.driver ? " " + t.driver : "";
    lines.push(numPrefix + " " + cleanCust + " ｜" + timeMin + driverDesc + statusTitle);
    
    // 地址簡碼（只取路名，不含門牌）
    var roadShort = extractRoadShortName_V11(t.address);
    if (roadShort) {
      lines.push("地址：" + roadShort);
    }
    
    // 簽收狀態
    var signDesc = isNoSign ? "無人簽收，依客戶指示放置指定位置" : "本人親簽";
    lines.push("簽收：" + signDesc);
    
    // 品項明細：每筆獨立一行 品項：code：qty
    if (t.items && t.items.length > 0) {
      t.items.forEach(function (item) {
        var qtyDesc = formatDriverItemQty_TextOnly(item.qty, item.boxQty, item.pcsPerBox);
        lines.push("品項：" + item.code + "：" + qtyDesc);
      });
    }
    
    // 簽收照片 — 原始直連，穩定不跳轉
    var directPhotoUrl = getDirectImageUrl_V11(t.photo);
    if (directPhotoUrl) {
      lines.push("◎簽收照：");
      lines.push(directPhotoUrl);
    }
    
    // 銷貨單據 — 原始直連
    var directInvoiceUrl = getDirectImageUrl_V11(t.invoice);
    if (directInvoiceUrl) {
      lines.push("◎銷貨單：");
      lines.push(directInvoiceUrl);
    }
  });
  
  return lines.join("\n").trim();
}

/**
 * 箱數/片數純文字格式化
 */
function formatDriverItemQty_TextOnly(qty, boxQty, pcsPerBox) {
  var pieces = Number(String(qty || "").replace(/,/g, "").match(/[\d.]+/)?.[0] || 0);
  var perBox = Number(String(pcsPerBox || "").replace(/,/g, "").match(/[\d.]+/)?.[0] || 0);
  if (!pieces || !perBox) {
    return qty + "片";
  }
  var fullBoxes = Math.floor(pieces / perBox);
  var loosePieces = Math.round((pieces - fullBoxes * perBox) * 100) / 100;
  var parts = [];
  if (fullBoxes) parts.push(fullBoxes + "箱");
  if (loosePieces) parts.push(loosePieces + "片");
  return parts.join("+");
}

/**
 * 依分公司對應 Token，主動發送 LINE Push Message (啟用無聲發送，支援文字與 Flex 物件)
 */
function pushLineMessageToId_V11(lineId, msgObj, branchName) {
  var props = PropertiesService.getScriptProperties();
  var token = "";
  
  var cleanBranch = String(branchName || "").trim();
  if (cleanBranch === "高雅瓷") {
    token = props.getProperty("LINE_TOKEN_GAOYACI");
  } else if (cleanBranch === "喜悅納") {
    token = props.getProperty("LINE_TOKEN_XIYENA");
  } else if (cleanBranch === "安帝嘉") {
    token = props.getProperty("LINE_TOKEN_ANDIGA");
  }
  
  // 保底：若無特定 Token 則使用主要 LINE Token
  if (!token) {
    token = props.getProperty("LINE_CHANNEL_ACCESS_TOKEN");
  }
  
  if (!token) {
    Logger.log("pushLineMessageToId_V11: 無有效 Access Token (分公司: " + branchName + ")");
    return;
  }
  
  var messageObj = {};
  if (typeof msgObj === 'string') {
    messageObj = {
      "type": "text",
      "text": msgObj
    };
  } else {
    messageObj = msgObj;
  }
  
  var url = "https://api.line.me/v2/bot/message/push";
  var payload = {
    "to": lineId,
    "messages": [ messageObj ],
    "notificationDisabled": true // 🔕 無聲推播，手機不震動、不叮咚
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
  
  var response = UrlFetchApp.fetch(url, options);
  var resText = response.getContentText();
  console.log("LINE push to " + lineId + " for " + branchName + " response: " + resText);
  return resText;
}

/**
 * 🧪 測試工具：立刻強迫發送最新一筆已完成訂單的卡片通知
 * 功用：不受一小時時間限制，直接抓取「最新一筆已完成訂單」，模擬發送給您在白名單上設定的通知人。
 */
function testSendHourlySummaryNow_V11() {
  var ss = getSS_V11();
  var taskSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
  if (!taskSheet) return "Error: Sheet not found";
  var data = taskSheet.getDataRange().getValues();
  var h = data[0].map(function (v) { return String(v).trim(); });
  
  var idxId = findHIdx_Core(h, "ID");
  var idxBranch = findHIdx_Core(h, "BRANCH");
  var idxStatus = findHIdx_Core(h, "STATUS");
  var idxFinish = findHIdx_Core(h, "FINISH_TIME");
  var idxCust = findHIdx_Core(h, "CUSTOMER");
  var idxAddr = findHIdx_Core(h, "ADDRESS");
  var idxPhoto = findHIdx_Core(h, "THUMBNAIL");
  
  if (idxStatus === -1) return "Error: STATUS column not found";
  
  // 1. 收集「所有分公司」今天已完成的配送單
  var branchTasks = {};
  var allTaskIds = [];
  
  for (var i = 1; i < data.length; i++) {
    var statusVal = String(data[i][idxStatus] || "").trim();
    if (statusVal !== "已完成") continue;
    
    var branchVal = idxBranch !== -1 ? String(data[i][idxBranch] || "").trim() : "";
    var id = idxId !== -1 ? String(data[i][idxId] || "").trim() : "";
    var customer = idxCust !== -1 ? String(data[i][idxCust] || "").trim() : "";
    var address = idxAddr !== -1 ? String(data[i][idxAddr] || "").trim() : "";
    var invoiceVal = idxPhoto !== -1 ? String(data[i][idxPhoto] || "").trim() : "";
    
    var finishTimeStr = "";
    var finishTimeTitleStr = "";
    var finishVal = data[i][idxFinish];
    if (finishVal instanceof Date) {
      finishTimeStr = Utilities.formatDate(finishVal, "GMT+8", "HH:mm:ss");
      finishTimeTitleStr = Utilities.formatDate(finishVal, "GMT+8", "M/d HH:mm") + "送達";
    } else if (typeof finishVal === 'string' && finishVal.trim() !== '') {
      var parsedDate = new Date(finishVal);
      if (!isNaN(parsedDate.getTime())) {
        finishTimeStr = Utilities.formatDate(parsedDate, "GMT+8", "HH:mm:ss");
        finishTimeTitleStr = Utilities.formatDate(parsedDate, "GMT+8", "M/d HH:mm") + "送達";
      } else {
        finishTimeStr = finishVal.substring(11, 19) || "12:00:00";
        finishTimeTitleStr = (finishVal.substring(5, 16) || "7/20 12:00") + "送達";
      }
    } else {
      finishTimeStr = "12:00:00";
      finishTimeTitleStr = "7/20 12:00送達";
    }
    
    var taskObj = {
      id: id,
      branch: branchVal,
      customer: customer,
      address: address,
      invoice: invoiceVal,
      photo: "",
      finishTime: finishTimeStr,
      finishTimeTitle: finishTimeTitleStr,
      items: []
    };
    
    if (id) {
      if (!branchTasks[branchVal]) {
        branchTasks[branchVal] = [];
      }
      branchTasks[branchVal].push(taskObj);
      allTaskIds.push(id);
    }
  }
  
  if (allTaskIds.length === 0) {
    var alertMsg = "❌ 找不到任何「已完成」狀態的配送單，無法進行測試。請先在試算表中將任一筆單據狀態改為「已完成」。";
    try { SpreadsheetApp.getUi().alert(alertMsg); } catch(e) {}
    return alertMsg;
  }
  
  // 2. 撈取所有品項明細
  var detailsMap = {};
  try {
    detailsMap = getDriverTaskItemDetails_V11(allTaskIds) || {};
  } catch (e) {
    console.error("測試時獲取品項失敗: " + e.message);
  }
  
  // 💡 批次從「送貨日誌」中比對出真實司機上傳的簽收單照片
  var logPhotoMap = lookupSignPhotosFromLog_V11(ss, allTaskIds);
  
  // 3. 注入明細與簽收照片
  Object.keys(branchTasks).forEach(function(branch) {
    var tasks = branchTasks[branch];
    tasks.forEach(function(task) {
      var info = logPhotoMap[task.id] || {};
      task.photo = info.photo || "";
      task.driver = info.driver || "";
      task.signType = info.signType || "本人親簽";
      if (detailsMap[task.id]) {
        task.items = detailsMap[task.id].items || [];
      }
    });
  });
  
  // 4. 依分公司發送通知 (5 筆內用 Flex 卡片，超過 5 筆用純文字彙整)
  var results = [];
  Object.keys(branchTasks).forEach(function(branchName) {
    var tasks = branchTasks[branchName];
    var notifiers = getLineNotifiers_V11(ss, branchName);
    
    if (notifiers.length === 0) {
      results.push("分公司 [" + branchName + "]：無啟用通知人，略過。");
      return;
    }
    
    var msgObj = null;
    var typeDesc = "";
    if (tasks.length <= 5) {
      msgObj = buildHourlySummaryFlexMessage(branchName, tasks);
      typeDesc = "Flex卡片";
    } else {
      msgObj = buildHourlySummaryTextMessage(branchName, tasks);
      typeDesc = "純文字";
    }
    
    notifiers.forEach(function (lineId) {
      try {
        var res = pushLineMessageToId_V11(lineId, msgObj, branchName);
        results.push("[" + branchName + " (" + typeDesc + ")] " + lineId.substring(0, 10) + "... ➔ " + res);
      } catch (err) {
        results.push("[" + branchName + " (" + typeDesc + ")] " + lineId.substring(0, 10) + "... ➔ 失敗: " + err.message);
      }
    });
  });
  
  var successMsg = "✅ 測試發送已完成！\n\n【LINE 官方伺服器回傳結果】\n" + results.join("\n");
  try { SpreadsheetApp.getUi().alert(successMsg); } catch(e) {}
  return successMsg;
}

/**
 * ⏰ 建立漢樺 17:30 未簽收 Email 排程
 */
function setupHanHuaEmailTrigger_V11() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'sendHanHuaUnattendedEmailReport') {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  ScriptApp.newTrigger('sendHanHuaUnattendedEmailReport')
    .timeBased()
    .atHour(17)
    .nearMinute(30)
    .everyDays(1)
    .inTimezone("Asia/Taipei")
    .create();
  
  console.log("✅ 成功建立漢樺 17:30 未簽收 Email 自動排程！");
}

/**
 * 📧 漢樺 / 波爾泰 未簽收到貨每日 Email 彙整通知 (每天 17:30 執行，假日不寄)
 * 收件人: anna@anword.com.tw
 */
function sendHanHuaUnattendedEmailReport() {
  var today = new Date();
  var dayOfWeek = today.getDay(); // 0: 週日, 6: 週六
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    console.log("今日為假日，跳過發送漢樺未簽收 Email 通知。");
    return "ℹ️ 今日為假日，不發送郵件。";
  }

  return executeHanHuaEmailSend(false);
}

/**
 * 🧪 測試立即發送漢樺未簽收 Email
 */
function testSendHanHuaEmailReportNow() {
  var res = executeHanHuaEmailSend(true);
  try { SpreadsheetApp.getUi().alert(res); } catch(e) {}
  return res;
}

/**
 * 核心發送邏輯
 */
function executeHanHuaEmailSend(isTestMode) {
  var ss = getSS_V11();
  var logSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_LOG);
  var taskSheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_TASKS);
  if (!logSheet || !taskSheet) return "❌ 找不到送貨日誌或派送清單工作表";

  var props = PropertiesService.getScriptProperties();
  var sentEmailStr = props.getProperty("SENT_HANHUA_EMAIL_ORDER_IDS") || "";
  var sentEmailIds = sentEmailStr.split(",").map(function(s) { return s.trim(); }).filter(Boolean);

  var taskData = taskSheet.getDataRange().getValues();
  var taskH = taskData[0].map(function(v) { return String(v).trim(); });
  var tIdxId = findHIdx_Core(taskH, "ID");
  var tIdxBranch = findHIdx_Core(taskH, "BRANCH");
  var tIdxCust = findHIdx_Core(taskH, "CUSTOMER");
  var tIdxAddr = findHIdx_Core(taskH, "ADDRESS");
  var tIdxDate = findHIdx_Core(taskH, "DATE");
  if (tIdxDate === -1) tIdxDate = findHIdx_Core(taskH, "日期");
  var tIdxThumb = findHIdx_Core(taskH, "THUMBNAIL");
  if (tIdxThumb === -1) tIdxThumb = findHIdx_Core(taskH, "貨單縮圖");

  var taskMap = {};
  for (var i = 1; i < taskData.length; i++) {
    var id = tIdxId !== -1 ? String(taskData[i][tIdxId] || "").trim() : "";
    if (!id) continue;
    taskMap[id] = {
      id: id,
      branch: tIdxBranch !== -1 ? String(taskData[i][tIdxBranch] || "").trim() : "",
      customer: tIdxCust !== -1 ? String(taskData[i][tIdxCust] || "").trim() : "",
      address: tIdxAddr !== -1 ? String(taskData[i][tIdxAddr] || "").trim() : "",
      date: tIdxDate !== -1 ? String(taskData[i][tIdxDate] || "").trim() : "",
      thumbnail: tIdxThumb !== -1 ? String(taskData[i][tIdxThumb] || "").trim() : ""
    };
  }

  var logData = logSheet.getDataRange().getValues();
  var logH = logData[0].map(function(v) { return String(v).trim(); });
  var lIdxId = logH.indexOf("單號");
  var lIdxPhoto = logH.indexOf("簽收單照片");
  var lIdxSignType = logH.indexOf("簽收類型");
  var lIdxNote = logH.indexOf("備註");
  var lIdxTime = logH.indexOf("配送完成時間");
  var lIdxCust = logH.indexOf("客戶名稱");
  var lIdxAddr = logH.indexOf("送貨地址");

  var todayStr = Utilities.formatDate(new Date(), "GMT+8", "yyyy/MM/dd");
  var targetOrders = [];
  var newlySentIds = [];

  for (var j = 1; j < logData.length; j++) {
    var orderId = lIdxId !== -1 ? String(logData[j][lIdxId] || "").trim() : "";
    if (!orderId) continue;

    // 測試模式下不跳過，正式模式下寄過不重複寄
    if (!isTestMode && sentEmailIds.indexOf(orderId) !== -1) continue;

    var signType = lIdxSignType !== -1 ? String(logData[j][lIdxSignType] || "").trim() : "";
    var noteStr = lIdxNote !== -1 ? String(logData[j][lIdxNote] || "").trim() : "";
    
    // 💡 雙重判定：除了「簽收類型」欄位外，亦自動比對「備註」欄位中是否包含「無人」或「放置指定位置」
    var isNoSign = (signType.indexOf("無人") !== -1 || signType.indexOf("放置指定位置") !== -1 ||
                    noteStr.indexOf("無人") !== -1 || noteStr.indexOf("放置指定位置") !== -1);
    if (!isNoSign) continue; // 只針對未簽收的，有簽收的不用顯示

    var tInfo = taskMap[orderId] || {};
    var branch = tInfo.branch || "";
    var cust = tInfo.customer || (lIdxCust !== -1 ? String(logData[j][lIdxCust] || "") : "");
    var addr = tInfo.address || (lIdxAddr !== -1 ? String(logData[j][lIdxAddr] || "") : "");
    var finishTime = lIdxTime !== -1 ? String(logData[j][lIdxTime] || "") : "";
    var photoSign = lIdxPhoto !== -1 ? String(logData[j][lIdxPhoto] || "") : "";
    var invoiceThumb = tInfo.thumbnail || "";

    // 條件：客戶是漢樺、或是分公司漢樺的狀況下(波爾泰也含在內)
    var isTarget = branch.indexOf("漢樺") !== -1 ||
                   cust.indexOf("漢樺") !== -1 ||
                   cust.indexOf("波爾泰") !== -1;

    if (isTarget) {
      var cleanCust = typeof cleanCustName_V11 === 'function' ? cleanCustName_V11(cust) : cust;
      var dateStr = todayStr;
      if (tInfo.date) {
        try {
          dateStr = Utilities.formatDate(new Date(tInfo.date), "GMT+8", "yyyy/MM/dd");
        } catch(e) { dateStr = todayStr; }
      }
      
      targetOrders.push({
        id: orderId,
        date: dateStr,
        finishTime: finishTime,
        customer: cleanCust,
        address: addr,
        invoiceUrl: getDirectImageUrl_V11(invoiceThumb),
        photoUrl: getDirectImageUrl_V11(photoSign)
      });
      newlySentIds.push(orderId);
    }
  }

  if (targetOrders.length === 0) {
    console.log("漢樺/波爾泰無新增未簽收到貨單。");
    return "ℹ️ 漢樺/波爾泰無未簽收（放置指定位置）的到貨單。";
  }

  var htmlBody = buildHanHuaEmailHtml(todayStr, targetOrders);
  var targetEmail = "anna@anword.com.tw, titankou2002@gmail.com";
  
  MailApp.sendEmail({
    to: targetEmail,
    subject: "【無人簽收到貨通知】漢樺 / 波爾泰 每日未簽收到貨彙整報告 (" + todayStr + ")",
    htmlBody: htmlBody
  });

  if (!isTestMode) {
    var updatedSentEmailIds = sentEmailIds.concat(newlySentIds);
    if (updatedSentEmailIds.length > 500) {
      updatedSentEmailIds = updatedSentEmailIds.slice(updatedSentEmailIds.length - 500);
    }
    props.setProperty("SENT_HANHUA_EMAIL_ORDER_IDS", updatedSentEmailIds.join(","));
  }

  console.log("已成功發送漢樺未簽收 Email，共 " + targetOrders.length + " 筆。");
  return "✅ 已成功發送漢樺未簽收 Email (" + targetOrders.length + " 筆) 至 " + targetEmail;
}

/**
 * 建立漢樺未簽收 Email HTML 內容
 */
function buildHanHuaEmailHtml(todayStr, orders) {
  var html = [];
  html.push('<div style="font-family: Microsoft JhengHei, Arial, sans-serif; max-width: 800px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">');
  html.push('  <div style="background-color: #f59e0b; color: #ffffff; padding: 22px; text-align: center;">');
  html.push('    <h2 style="margin: 0; font-size: 22px; font-weight: bold;">📦 漢樺 / 波爾泰 每日到貨【無人簽收】報告</h2>');
  html.push('    <p style="margin: 6px 0 0 0; font-size: 14px; opacity: 0.95;">發送時間：' + todayStr + ' 下班彙整 ｜ 共計 ' + orders.length + ' 筆依指示放置指定位置</p>');
  html.push('  </div>');
  html.push('  <div style="padding: 24px; background-color: #fafafa;">');
  
  orders.forEach(function(item, idx) {
    html.push('    <div style="border: 1px solid #fed7aa; border-radius: 10px; padding: 18px; margin-bottom: 18px; background-color: #ffffff; box-shadow: 0 2px 8px rgba(0,0,0,0.03);">');
    html.push('      <div style="font-size: 17px; font-weight: bold; color: #9a3412; margin-bottom: 12px; border-bottom: 2px solid #ffedd5; padding-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">');
    html.push('        <span>' + (idx + 1) + '. ' + item.customer + ' (' + item.id + ')</span>');
    html.push('        <span style="font-size: 12px; color: #c2410c; background-color: #ffedd5; padding: 4px 10px; border-radius: 20px;">⚠️ 無人簽收，依指示放置指定位置</span>');
    html.push('      </div>');
    html.push('      <table style="width: 100%; font-size: 14px; color: #334155; border-collapse: collapse; line-height: 1.6;">');
    html.push('        <tr><td style="width: 100px; color: #64748b; font-weight: bold;">📅 送貨日期：</td><td>' + item.date + '</td></tr>');
    html.push('        <tr><td style="color: #64748b; font-weight: bold;">🏢 客戶名稱：</td><td><b>' + item.customer + '</b></td></tr>');
    html.push('        <tr><td style="color: #64748b; font-weight: bold;">📍 送貨地址：</td><td>' + item.address + '</td></tr>');
    if (item.finishTime) {
      html.push('        <tr><td style="color: #64748b; font-weight: bold;">⏱️ 完成時間：</td><td>' + item.finishTime + '</td></tr>');
    }
    html.push('      </table>');
    
    html.push('      <div style="margin-top: 15px; padding-top: 12px; border-top: 1px dashed #e2e8f0;">');
    if (item.photoUrl) {
      html.push('        <div style="margin-bottom: 8px;"><b style="color: #475569; font-size: 13px;">📸 簽收單照片：</b> <a href="' + item.photoUrl + '" target="_blank" style="color: #ea580c; text-decoration: underline; font-weight: bold;">點此查看全尺寸照</a><br><img src="' + item.photoUrl + '" style="max-width: 100%; max-height: 350px; border-radius: 8px; margin-top: 6px; border: 1px solid #cbd5e1;"></div>');
    }
    if (item.invoiceUrl) {
      html.push('        <div style="margin-top: 8px;"><b style="color: #475569; font-size: 13px;">📄 銷貨單據縮圖：</b> <a href="' + item.invoiceUrl + '" target="_blank" style="color: #0284c7; text-decoration: underline; font-weight: bold;">點此查看銷貨單</a><br><img src="' + item.invoiceUrl + '" style="max-width: 100%; max-height: 350px; border-radius: 8px; margin-top: 6px; border: 1px solid #cbd5e1;"></div>');
    }
    html.push('      </div>');
    html.push('    </div>');
  });
  
  html.push('  </div>');
  html.push('  <div style="background-color: #f1f5f9; color: #64748b; padding: 14px; text-align: center; font-size: 12px; border-top: 1px solid #e2e8f0;">');
  html.push('    此郵件由 鈦傳速智慧物流系統 自動發送，請勿直接回覆。');
  html.push('  </div>');
  html.push('</div>');
  return html.join('\n');
}
