/**
 * 🌸 高雅瓷 LINE 機器人專用 ─ 查貨與進度查詢擴充模組 (完全不干擾原本功能版)
 */
const GY_CONFIG = {
  SS_ID: "1M-Ewy58fQs-QmqzO5nERoXDCm7lm6S_mrrAIR1mUOtA", // 鈦傳速主要資料庫 ID
  WHITELIST_SHEET: "經銷商白名單",
  CHANNEL_ACCESS_TOKEN: PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN'), // 💡 動態讀取高雅瓷專案原生的 Token，100% 防打錯字！
  LIFF_ID: "2006323632-Abcdef" // 鈦傳速 LIFF ID
};

function logErrorToSheet(msgText) {
  try {
    var ss = SpreadsheetApp.openById("1M-Ewy58fQs-QmqzO5nERoXDCm7lm6S_mrrAIR1mUOtA");
    var sheet = ss.getSheetByName("debug_log");
    if (!sheet) {
      sheet = ss.insertSheet("debug_log");
      sheet.appendRow(["時間", "偵錯訊息"]);
    }
    sheet.appendRow([new Date(), msgText]);
  } catch (e) {}
}

function handleLineBotWebhook_GaoYaCi(e) {
  try {
    // ⚡ 瞬間攔截 LINE 官方的「Verify 驗證」虛擬請求，0.001秒回傳，防超時 (Timeout)
    if (e && e.postData && e.postData.contents) {
      if (e.postData.contents.indexOf("U00000000000000000000000000000000") !== -1) {
        return true;
      }
    }
    
    if (!e || !e.postData || !e.postData.contents) return false;
    var data = JSON.parse(e.postData.contents);
    if (!data || !data.events || data.events.length === 0) return false;
    
    var event = data.events[0];
    if (event.type === 'message' && event.message.type === 'text' && (event.source.type === 'user' || event.source.type === 'group' || event.source.type === 'room')) {
      var text = String(event.message.text).trim().toLowerCase();
      var userId = event.source.userId;
      if (!userId) return false; // 若群組中拿不到個人 LINE ID 則略過
      var replyToken = event.replyToken;

      var keywords = ["查貨", "進度", "送貨", "配送", "我的貨", "車到哪", "進度查詢", "物流", "貨在哪", "tracking", "status"];
      var isQuery = false;
      for (var k = 0; k < keywords.length; k++) {
        if (text.indexOf(keywords[k]) !== -1) {
          isQuery = true;
          break;
        }
      }

      if (!isQuery) return false;

      logErrorToSheet("🔍 偵測到「查貨」關鍵字，開始處理。使用者 ID: " + userId);

      var ss = SpreadsheetApp.openById(GY_CONFIG.SS_ID);
      var sheet = ss.getSheetByName(GY_CONFIG.WHITELIST_SHEET);
      if (!sheet) {
        logErrorToSheet("❌ 找不到「經銷商白名單」工作表");
        replyGaoYaCiLine_Core(replyToken, [{"type": "text", "text": "⚠️ 系統設定錯誤：找不到「經銷商白名單」，請聯絡管理員。"}]);
        return true;
      }

      var wData = sheet.getDataRange().getValues();
      var headers = wData[0].map(function(v) { return String(v).trim().toLowerCase(); });
      var colUserId = headers.indexOf("userid");
      var colCompany = headers.indexOf("公司");
      var colName = headers.indexOf("名字");

      if (colUserId === -1) {
        logErrorToSheet("❌ 白名單缺少 userid 欄位");
        replyGaoYaCiLine_Core(replyToken, [{"type": "text", "text": "⚠️ 系統設定錯誤：缺少「userid」欄位。"}]);
        return true;
      }

      var dealerCompany = "";
      var userName = "";
      var isMatched = false;

      for (var i = 1; i < wData.length; i++) {
        var row = wData[i];
        var currentUserId = String(row[colUserId]).trim();
        if (currentUserId === userId) {
          dealerCompany = colCompany !== -1 ? String(row[colCompany]).trim() : "";
          userName = colName !== -1 ? String(row[colName]).trim() : "";
          isMatched = true;
          break;
        }
      }

      logErrorToSheet("🔍 比對結果：Matched=" + isMatched + ", 經銷商=" + dealerCompany + ", 姓名=" + userName);

      if (!isMatched) {
        logErrorToSheet("⚠️ 使用者未綁定白名單，發送 LINE ID 提示訊息");
        replyGaoYaCiLine_Core(replyToken, [
          {"type": "text", "text": "🔍 您好！感謝您使用高雅瓷物流查詢服務。\n\n您的 LINE 帳戶尚未綁定「經銷商白名單」查詢權限。請複製下方您的 LINE ID，並提供給管理員設定授權即可！"},
          {"type": "text", "text": userId}
        ]);
      } else {
        var liffUrl = "https://liff.line.me/" + GY_CONFIG.LIFF_ID;
        var welcomeText = "您好，" + userName + " (" + (dealerCompany || "高雅瓷") + ")！\n\n點選下方按鈕，即可秒查今日配送細節、司機資訊與即時定位！";
        
        logErrorToSheet("✅ 使用者已綁定，開始發送 Buttons 查詢卡片...");
        replyGaoYaCiLine_Core(replyToken, [
          {
            "type": "template",
            "altText": "高雅瓷今日送貨進度查詢",
            "template": {
              "type": "buttons",
              "title": "🚚 今日配送狀態查詢",
              "text": welcomeText.substring(0, 60),
              "actions": [{"type": "uri", "label": "📦 點此開啟今日進度頁面", "uri": liffUrl}]
            }
          }
        ]);
      }
      return true;
    }
  } catch (err) {
    logErrorToSheet("💥 系統執行出錯：" + err.message);
  }
  return false;
}

function replyGaoYaCiLine_Core(replyToken, messages) {
  var url = "https://api.line.me/v2/bot/message/reply";
  var options = {
    "method": "post",
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + GY_CONFIG.CHANNEL_ACCESS_TOKEN
    },
    "payload": JSON.stringify({"replyToken": replyToken, "messages": messages}),
    "muteHttpExceptions": true
  };
  UrlFetchApp.fetch(url, options);
}

// 💡 診斷測試函數：請在選單中選取此函數並執行，查看下方日誌輸出
function testConnection() {
  try {
    Logger.log("🔄 開始測試資料庫與 Sheet 連線...");
    var ss = SpreadsheetApp.openById(GY_CONFIG.SS_ID);
    Logger.log("✅ 成功開啟主要物流試算表：" + ss.getName());
    var sheet = ss.getSheetByName(GY_CONFIG.WHITELIST_SHEET);
    if (sheet) {
      Logger.log("✅ 成功讀取「經銷商白名單」分頁，目前總行數：" + sheet.getLastRow());
    } else {
      Logger.log("❌ 找不到「經銷商白名單」分頁，請檢查分頁名稱！");
    }
    
    // 💡 讀取 debug_log 以進行診斷
    var dbgSheet = ss.getSheetByName("debug_log");
    if (dbgSheet) {
      var lastRow = dbgSheet.getLastRow();
      Logger.log("📝 找到 debug_log 分頁，目前總行數：" + lastRow);
      var startRow = Math.max(1, lastRow - 15);
      var rows = dbgSheet.getRange(startRow, 1, lastRow - startRow + 1, 2).getValues();
      for (var i = 0; i < rows.length; i++) {
        var timeStr = Utilities.formatDate(new Date(rows[i][0]), "GMT+8", "HH:mm:ss");
        Logger.log("👉 [" + timeStr + "] " + rows[i][1]);
      }
    } else {
      Logger.log("❌ 找不到 debug_log 分頁，代表 Webhook 請求目前完全沒到達 doPost 入口！");
    }
  } catch (e) {
    Logger.log("❌ 錯誤原因：" + e.message);
  }
}

