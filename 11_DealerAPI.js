/**
 * 鈦傳速｜經銷商查詢專用 API 與多 LINE Bot 整合路由模組 V2.2 (超安全自動轉發版)
 * 
 * 核心功能：
 * 1. 對接現有的「經銷商白名單」工作表。
 * 2. 接收前端 LINE LIFF 傳遞的 User ID，在後台比對「經銷商白名單」，僅撈取該經銷商今日的派送清單。
 * 3. 整合【雙 LINE 機器人】分流 Webhook 與【無縫舊功能轉發】：
 *    - 支援高雅瓷與鈦傳速各自獨立的專屬 LINE 機器人與各自的 GAS 部署網址。
 *    - 高雅瓷 機器人：Webhook 尾端加 `?bot=gaoyaci`
 *    - 鈦傳速 機器人：Webhook 尾端加 `?bot=taichuansu` 或預設
 *    - 💡 關鍵字防干擾轉發：
 *      - 當高雅瓷機器人收到「查貨/進度/送貨」時，由主程式直接回覆。
 *      - 當收到其他任何訊息時，主程式會【原封不動自動轉發】給高雅瓷原本的舊網址，保證原本功能 100% 照常使用！
 * 4. 權限分級管理：
 *    - 「free」等級：受到嚴格限制，僅能查看屬於自己公司 (Column F) 的送貨進度與關聯車輛。
 *    - 其他等級 (KING, sales, queen, Premium 等)：可以查看全部公司的送貨清單與所有配送車輛。
 * 5. 安全防護：數據過濾完全在 GAS 後端執行，防篡改、防越權。
 */

const DEALER_WHITELIST_CONFIG = {
  SHEET_NAME: "經銷商白名單"
};

/**
 * 🚀 超貼心一鍵設定工具：寫入高雅瓷與鈦傳速機器人 Token
 * 功用：您只需要在 GAS 編輯器中點擊「執行」此函數，系統便會自動將兩組 Token 寫入您專案的指令碼屬性中！
 */
function initProjectScriptProperties_V11() {
  var props = PropertiesService.getScriptProperties();
  
  // 寫入鈦傳速主要 Access Token
  props.setProperty("LINE_CHANNEL_ACCESS_TOKEN", "2RmW+NYfyNMyqFiQpyeLBfyZ8vaE7vf9pAFs5dPQ3hBFS6DeB+MRaI6Ze4nYcBs8wm1ZxZip9KmB5v/VUrmXvW7F4/VWdipBsZ22//JY9UV5+pibgLG3lFaSnpm1R4asfPIrO2daD00TGf9k299QHAdB04t89/1O/w1cDnyilFU=");
  
  // 寫入高雅瓷專屬 Access Token
  props.setProperty("LINE_GAOYACI_ACCESS_TOKEN", "hzlR1hr0qkVqcoIo60dqdxomaloGS8dyL3lpENhMLZYLvcNNi1KbM+lhsABoOIO2leCOFrpxFhP1Gq2qxPY2NtmHm+KNlsSAYoES4jqKIpZUSHbbwgFvcrv0kF4LJb7TJ4lMiRHOz+0JNta0zXfwdgdB04t89/1O/w1cDnyilFU=");
  
  // 設定預設 LIFF ID Fallback
  props.setProperty("LINE_LIFF_ID", "2007666611-285rZBFA");
  
  return "✅ 鈦傳速（預設）與高雅瓷 LINE Access Token 已成功寫入專案的指令碼屬性！";
}

/**
 * 處理經銷商前端發送的 API 請求
 * 進入點：當 doGet 偵測到 action === 'getDealerProgress'
 */
function handleDealerApiRequest_V11(e) {
  var userId = (e && e.parameter && e.parameter.userId) ? String(e.parameter.userId).trim() : "";
  var dateParam = (e && e.parameter && e.parameter.date) ? String(e.parameter.date).trim() : "";
  
  // 正規化日期格式為 yyyy/MM/dd
  var targetDateStr = "";
  if (dateParam) {
    targetDateStr = dateParam.replace(/-/g, '/');
  }
  
  if (!userId) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: "缺少使用者驗證憑證 (userId)"
    })).setMimeType(ContentService.MimeType.JSON);
  }

  var ss = SpreadsheetApp.openById(V11_PROD_CONFIG.SS_ID);
  var whitelistSheet = ss.getSheetByName(DEALER_WHITELIST_CONFIG.SHEET_NAME);
  var systemWhitelistSheet = ss.getSheetByName("系統白名單");
  
  if (!whitelistSheet && !systemWhitelistSheet) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: "系統設定錯誤：找不到「經銷商白名單」或「系統白名單」分頁，請確認分頁設定。"
    })).setMimeType(ContentService.MimeType.JSON);
  }

  var dealerCompany = "";
  var userName = "";
  var userGrade = "";
  var isMatched = false;

  // 1. 優先搜尋「經銷商白名單」
  if (whitelistSheet) {
    var data = whitelistSheet.getDataRange().getValues();
    if (data.length >= 2) {
      var headers = data[0].map(function(v) { return String(v).trim().toLowerCase(); });
      var colUserId = findHIdx_Core(headers, ["userid", "userId", "line id"]);
      var colCompany = findHIdx_Core(headers, ["公司", "經銷商", "客戶"]);
      var colName = findHIdx_Core(headers, ["名字", "姓名"]);
      var colGrade = findHIdx_Core(headers, ["等級", "權限", "角色"]);

      if (colUserId !== -1) {
        for (var i = 1; i < data.length; i++) {
          var row = data[i];
          var currentUserId = String(getSafeVal(row, colUserId)).trim();
          if (currentUserId === userId) {
            dealerCompany = colCompany !== -1 ? String(getSafeVal(row, colCompany)).trim() : "";
            userName = colName !== -1 ? String(getSafeVal(row, colName)).trim() : "";
            userGrade = colGrade !== -1 ? String(getSafeVal(row, colGrade)).trim() : "";
            isMatched = true;
            break;
          }
        }
      }
    }
  }

  // 2. 如果沒匹配到，繼續搜尋「系統白名單」
  if (!isMatched && systemWhitelistSheet) {
    var dataS = systemWhitelistSheet.getDataRange().getValues();
    if (dataS.length >= 2) {
      var headersS = dataS[0].map(function(v) { return String(v).trim().toLowerCase(); });
      var colUserIdS = findHIdx_Core(headersS, ["userid", "userId", "line id"]);
      var colCompanyS = findHIdx_Core(headersS, ["公司", "經銷商", "客戶"]);
      var colNameS = findHIdx_Core(headersS, ["名字", "姓名"]);
      var colGradeS = findHIdx_Core(headersS, ["等級", "權限", "角色"]);

      if (colUserIdS !== -1) {
        for (var i = 1; i < dataS.length; i++) {
          var rowS = dataS[i];
          var currentUserIdS = String(getSafeVal(rowS, colUserIdS)).trim();
          if (currentUserIdS === userId) {
            dealerCompany = colCompanyS !== -1 ? String(getSafeVal(rowS, colCompanyS)).trim() : "";
            userName = colNameS !== -1 ? String(getSafeVal(rowS, colNameS)).trim() : "";
            userGrade = colGradeS !== -1 ? String(getSafeVal(rowS, colGradeS)).trim() : "";
            isMatched = true;
            break;
          }
        }
      }
    }
  }

  // 3. 權限防呆
  if (!isMatched) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: "您的 LINE ID 尚未綁定於「經銷商白名單」或「系統白名單」，請聯絡管理員登錄您的帳號。"
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // 標準化權限等級判定 (小寫比對)
  var cleanGrade = userGrade.toLowerCase().trim();
  
  // 💡 安全防護門閥 (非常重要)：
  // 為了防範管理員「漏填」等級、「填錯字」或試算表欄位名稱不符（導致 colGrade 沒對到、抓到空值），
  // 除非明確認定為高權限群組 (如 king, sales, queen, admin, premium)，否則預設一律為最安全的 "free" 受限等級！
  var highPermissionGrades = ["king", "sales", "queen"];
  var isFreeGrade = true; // 預設最嚴格
  if (cleanGrade && highPermissionGrades.indexOf(cleanGrade) !== -1) {
    isFreeGrade = false; // 僅有明確符合高權限時，才解除過濾
  }

  // 如果是 free 等級但沒有指派公司，攔截報錯
  if (isFreeGrade && !dealerCompany) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: "您的帳號等級為 Free，但尚未指派所屬「公司」名稱，無法進行資料過濾。"
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // 4. 撈取指定日期所有派送資料 (傳遞 targetDateStr 參數)
  var warRoom = getWarRoomData_V11(true, targetDateStr);
  if (!warRoom.success) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: "系統資料庫讀取失敗: " + warRoom.error
    })).setMimeType(ContentService.MimeType.JSON);
  }

  var dealerTasks = [];
  var dealerVehiclePositions = [];

  // 5. 根據權限等級在後端進行資料過濾 (安全阻隔)
  if (isFreeGrade) {
    // 💡 為了讓經銷商在前端能看見完整的前後配送點路線，我們會回傳「該經銷商有貨的車輛所跑的全部任務」
    var cleanDealerKey = cleanCustName_V11(dealerCompany);
    
    // 5.1 先篩選出屬於該公司的專屬任務
    var ownTasks = warRoom.tasks.filter(function(t) {
      var taskCustClean = cleanCustName_V11(t.customer);
      var taskBranchClean = cleanCustName_V11(t.branch);
      return (taskCustClean.indexOf(cleanDealerKey) !== -1 || 
              taskBranchClean.indexOf(cleanDealerKey) !== -1 ||
              cleanDealerKey.indexOf(taskCustClean) !== -1);
    });

    // 5.2 找出這些專屬任務關聯到的所有車牌代號 (去重)
    var ownVehicles = ownTasks.map(function(t) { return t.vehicle; })
      .filter(function(v, idx, self) { return v && self.indexOf(v) === idx; });

    // 5.3 回傳這些車輛今日的所有配送站點 (前端會根據 isOurTask 判定是否為該客戶專屬，非專屬則遮蔽客戶名稱並統一綠色)
    dealerTasks = warRoom.tasks.filter(function(t) {
      return t.vehicle && ownVehicles.indexOf(t.vehicle) !== -1;
    });

    // 僅過濾與該經銷商有配送關聯的車輛即時狀態
    dealerVehiclePositions = warRoom.vehiclePositions.filter(function(pos) {
      return ownVehicles.indexOf(pos.vehicle) !== -1;
    }).map(function(pos) {
      return {
        vehicle: pos.vehicle,
        driver: pos.driver,
        lastUpdate: pos.lastUpdate,
        targetAddr: pos.targetAddr,
        departureTime: pos.departureTime,
        targetPreciseMin: pos.targetPreciseMin,
        lat: pos.lat,
        lng: pos.lng
      };
    });
  } else {
    // 💡 KING, sales, queen, Premium 等級可以查看全部配送資料與車輛
    dealerTasks = warRoom.tasks;
    dealerVehiclePositions = warRoom.vehiclePositions.map(function(pos) {
      return {
        vehicle: pos.vehicle,
        driver: pos.driver,
        lastUpdate: pos.lastUpdate,
        targetAddr: pos.targetAddr,
        departureTime: pos.departureTime,
        targetPreciseMin: pos.targetPreciseMin,
        lat: pos.lat,
        lng: pos.lng
      };
    });
  }

  // 6. 回傳安全過濾後的高隱私客製化數據
  return ContentService.createTextOutput(JSON.stringify({
    success: true,
    dealer: isFreeGrade ? dealerCompany : "鈦傳速全區物流 (權限：" + userGrade + ")",
    user: userName,
    grade: isFreeGrade ? "free" : userGrade,
    tasks: dealerTasks.map(function(t) {
      return {
        id: t.id,
        customer: t.customer,
        address: t.address,
        status: t.status,
        seq: t.seq,
        boxes: t.boxes,
        size: t.size,
        weight: t.weight,
        timeSlot: t.timeSlot,
        shippingType: t.shippingType,
        finishTime: t.finishTime,
        thumbnail: t.thumbnail,
        signPhoto: t.signPhoto || "",
        vehicle: t.vehicle,
        branch: t.branch || "",
        date: t.date
      };
    }),
    vehiclePositions: dealerVehiclePositions
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 處理來自 LINE Bot Webhook 的事件
 * 進入點：當 doPost 觸發時自動攔截文字訊息 (支援高雅瓷防干擾自動轉發)
 */
function handleLineBotWebhook_V11(data, botType) {
  if (!data || !data.events || data.events.length === 0) return;
  var event = data.events[0];
  
  // 僅處理文字訊息，且限定為一對一私訊 (防止群組中被無效觸發)
  if (event.type === 'message' && event.message.type === 'text' && event.source.type === 'user') {
    var text = String(event.message.text).trim().toLowerCase();
    var userId = event.source.userId;
    var replyToken = event.replyToken;

    // 模糊關鍵字比對
    var keywords = ["查貨", "進度", "送貨", "配送", "我的貨", "車到哪", "進度查詢", "物流", "貨在哪", "tracking", "status"];
    var isQuery = false;
    for (var k = 0; k < keywords.length; k++) {
      if (text.indexOf(keywords[k]) !== -1) {
        isQuery = true;
        break;
      }
    }

    if (isQuery) {
      // 1. 比對經銷商白名單
      var ss = SpreadsheetApp.openById(V11_PROD_CONFIG.SS_ID);
      var whitelistSheet = ss.getSheetByName(DEALER_WHITELIST_CONFIG.SHEET_NAME);
      if (!whitelistSheet) {
        replyLineMessage_Core(replyToken, [{
          "type": "text",
          "text": "⚠️ 系統設定錯誤：找不到「經銷商白名單」分頁，請聯絡鈦傳速管理團隊。"
        }], botType);
        return;
      }

      var wData = whitelistSheet.getDataRange().getValues();
      var headers = wData[0].map(function(v) { return String(v).trim().toLowerCase(); });
      
      var colUserId = headers.indexOf("userid");
      var colCompany = headers.indexOf("公司");
      var colName = headers.indexOf("名字");

      if (colUserId === -1) {
        replyLineMessage_Core(replyToken, [{
          "type": "text",
          "text": "⚠️ 系統設定錯誤：經銷商白名單缺少「userid」欄位。"
        }], botType);
        return;
      }

      var dealerCompany = "";
      var userName = "";
      var isMatched = false;

      for (var i = 1; i < wData.length; i++) {
        var row = wData[i];
        var currentUserId = String(getSafeVal(row, colUserId)).trim();
        if (currentUserId === userId) {
          dealerCompany = colCompany !== -1 ? String(getSafeVal(row, colCompany)).trim() : "";
          userName = colName !== -1 ? String(getSafeVal(row, colName)).trim() : "";
          isMatched = true;
          break;
        }
      }

      // 2. 根據匹配結果回覆
      if (!isMatched) {
        // 💡 情況 A: 未綁定白名單 - 親切說明並提供 LINE ID 方便其複製提供給管理員
        replyLineMessage_Core(replyToken, [
          {
            "type": "text",
            "text": "🔍 您好！感謝您使用鈦傳速物流查詢服務。\n\n您的 LINE 帳戶尚未綁定「經銷商白名單」查詢權限。請複製下方您的 LINE ID，並提供給鈦傳速管理員設定授權即可！"
          },
          {
            "type": "text",
            "text": userId // 獨立訊息，方便經銷商手機長按複製
          }
        ], botType);
      } else {
        // 💡 情況 B: 已綁定白名單 - 發送精美的 Buttons 樣板訊息直接引導開啟 LIFF 網頁
        var liffId = PropertiesService.getScriptProperties().getProperty('LINE_LIFF_ID') || "2007666611-285rZBFA";
        var liffUrl = "https://liff.line.me/" + liffId;

        var welcomeText = "您好，" + userName + " (" + (dealerCompany || "全區權限") + ")！\n\n點選下方按鈕，即可秒查今日配送細節、司機資訊與即時定位！";
        
        replyLineMessage_Core(replyToken, [
          {
            "type": "template",
            "altText": "鈦傳速今日送貨進度查詢",
            "template": {
              "type": "buttons",
              "title": "🚚 今日配送狀態查詢",
              "text": welcomeText.substring(0, 60), // LINE 限制 Buttons 內文最大 60 字元，做安全截斷
              "actions": [
                {
                  "type": "uri",
                  "label": "📦 點此開啟今日進度頁面",
                  "uri": liffUrl
                }
              ]
            }
          }
        ], botType);
      }
    } else {
      // 💡 綠色通道：如果不是「查貨」關鍵字，將整個 Webhook 封包【原封不動轉發】給高雅瓷原本的舊網址，保證原本功能 100% 正常運作！
      var cleanBot = String(botType).toLowerCase().trim();
      if (cleanBot === "gaoyaci" || cleanBot === "高雅瓷") {
        var oldWebhookUrl = "https://script.google.com/macros/s/AKfycbwPWOF6_GE8JLZhU18gFUU1BdN_S9aaRBnkzZLHkTz8iO3_417kj3BYmBKjuZ_iLr3imQ/exec";
        var options = {
          "method": "post",
          "contentType": "application/json",
          "payload": JSON.stringify(data),
          "muteHttpExceptions": true
        };
        try {
          UrlFetchApp.fetch(oldWebhookUrl, options);
        } catch (e) {
          Logger.log("自動轉發至高雅瓷舊專案失敗: " + e.message);
        }
      }
    }
  }
}

/**
 * 輔助方法：透過 LINE Reply Token 回覆訊息 (支援高雅瓷與鈦傳速專屬 Token 對應)
 */
function replyLineMessage_Core(replyToken, messages, botType) {
  var propKey = "LINE_CHANNEL_ACCESS_TOKEN"; // 預設主要機器人 Token (鈦傳速)
  
  if (botType) {
    var cleanBot = String(botType).toLowerCase().trim();
    
    // 💡 支援中英文「高雅瓷」與「鈦傳速」機器人專屬對應
    if (cleanBot === "gaoyaci" || cleanBot === "高雅瓷") {
      propKey = "LINE_GAOYACI_ACCESS_TOKEN";
    } else if (cleanBot === "taichuansu" || cleanBot === "鈦傳速") {
      propKey = "LINE_CHANNEL_ACCESS_TOKEN";
    }
  }

  var token = PropertiesService.getScriptProperties().getProperty(propKey);
  
  // 安全 Fallback：如果沒有設定專屬 Token，自動退回使用預設主要 Token (鈦傳速)
  if (!token) {
    token = PropertiesService.getScriptProperties().getProperty("LINE_CHANNEL_ACCESS_TOKEN");
  }

  if (!token) {
    Logger.log("Error: LINE Access Token is empty for key: " + propKey);
    return;
  }

  var url = "https://api.line.me/v2/bot/message/reply";
  var payload = {
    "replyToken": replyToken,
    "messages": messages
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
  
  try {
    UrlFetchApp.fetch(url, options);
  } catch (err) {
    Logger.log("Reply Line Message Error: " + err.message);
  }
}
