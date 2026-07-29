/**
 * 🌸 高雅瓷 LINE 機器人專用 ─ 查貨與進度查詢擴充模組 (完全不干擾原本功能版)
 * 
 * 🛠️ 整合步驟（極簡 2 步）：
 * 
 * 1. 【新增檔案】：
 *    在大專案中打開您高雅瓷專案 (https://script.google.com/u/0/home/projects/1gtkOkmt_EHWh17qEySV-bARuuCo6p6aRz97o3uKytu6Cj5qHO_Yyhr9-/edit)。
 *    建立一個新檔案叫「GaoYaCi_Bot_Extension」，並將本檔案內容全部複製貼上。
 * 
 * 2. 【修改 doPost】：
 *    打開您原本的程式碼，找到 `doPost(e)` 函數，在最前面（第一行）加入以下三行代碼：
 *    
 *    ```javascript
 *    if (typeof handleLineBotWebhook_GaoYaCi === 'function') {
 *      if (handleLineBotWebhook_GaoYaCi(e)) return ContentService.createTextOutput("OK");
 *    }
 *    ```
 * 
 * 3. 【部署存檔】：
 *    點擊「部署 ➔ 管理部署 ➔ 編輯 ➔ 選擇新版本 ➔ 部署」，即可完美啟用，且 100% 不傷原本功能！
 */

const GY_CONFIG = {
  SS_ID: "1M-Ewy58fQs-QmqzO5nERoXDCm7lm6S_mrrAIR1mUOtA", // 鈦傳速主要資料庫 ID
  WHITELIST_SHEET: "經銷商白名單",
  CHANNEL_ACCESS_TOKEN: "hzlR1hr0qkVqcoIo60dqdxomaloGS8dyL3lpENhMLZYLvcNNi1KbM+lhsABoOIO2leCOFrpxFhP1Gq2qxPY2NtmHm+KNlsSAYoES4jqKIpZUSHbbwgFvcrv0kF4LJb7TJ4lMiRHOz+0JNta0zXfwdgdB04t89/1O/w1cDnyilFU=",
  LIFF_ID: "2007666611-285rZBFA" // 鈦傳速 LIFF ID
};

/**
 * 高雅瓷專用 Webhook 攔截器
 * @param {Object} e - GAS doPost 傳入的事件對象
 * @returns {Boolean} - true 代表已由查貨系統處理並回覆；false 代表非查貨訊息，應交回給原本程式碼處理。
 */
function handleLineBotWebhook_GaoYaCi(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return false;
    var data = JSON.parse(e.postData.contents);
    if (!data || !data.events || data.events.length === 0) return false;
    
    var event = data.events[0];
    // 支援一對一、群組、聊天室文字訊息
    if (event.type === 'message' && event.message.type === 'text' && (event.source.type === 'user' || event.source.type === 'group' || event.source.type === 'room')) {
      var text = String(event.message.text).trim().toLowerCase();
      var userId = event.source.userId;
      if (!userId) return false; // 若群組中拿不到個人 LINE ID 則略過
      var replyToken = event.replyToken;

      // 模糊關鍵字匹配 (支援：送貨、送貨進度、送貨查詢、配送進度、配送查詢、貨到那了、還有多久、查貨、物流等)
      var keywords = ["查貨", "進度", "送貨", "配送", "我的貨", "車到哪", "進度查詢", "物流", "貨在哪", "貨到那了", "貨到哪了", "還有多久", "送貨進度", "送貨查詢", "配送進度", "配送查詢", "tracking", "status"];
      var isQuery = false;
      for (var k = 0; k < keywords.length; k++) {
        if (text.indexOf(keywords[k]) !== -1) {
          isQuery = true;
          break;
        }
      }

      // 如果不是查貨訊息，直接交回給原本的功能處理
      if (!isQuery) return false;

      // 1. 讀取經銷商白名單資料庫
      var ss = SpreadsheetApp.openById(GY_CONFIG.SS_ID);
      var sheet = ss.getSheetByName(GY_CONFIG.WHITELIST_SHEET);
      if (!sheet) {
        replyGaoYaCiLine_Core(replyToken, [{
          "type": "text",
          "text": "⚠️ 系統設定錯誤：找不到「經銷商白名單」工作表，請聯絡管理員。"
        }]);
        return true;
      }

      var wData = sheet.getDataRange().getValues();
      var headers = wData[0].map(function(v) { return String(v).trim().toLowerCase(); });
      
      var colUserId = headers.indexOf("userid");
      var colCompany = headers.indexOf("公司");
      var colName = headers.indexOf("名字");

      if (colUserId === -1) {
        replyGaoYaCiLine_Core(replyToken, [{
          "type": "text",
          "text": "⚠️ 系統設定錯誤：資料庫白名單缺少「userid」欄位。"
        }]);
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

      // 2. 根據匹配結果回覆
      if (!isMatched) {
        // 未綁定：回覆 LINE ID，引導其複製提供給管理員設定
        replyGaoYaCiLine_Core(replyToken, [
          {
            "type": "text",
            "text": "🔍 您好！感謝您使用高雅瓷物流查詢服務。\n\n您的 LINE 帳戶尚未綁定「經銷商白名單」查詢權限。請複製下方您的 LINE ID，並提供給管理員設定授權即可！"
          },
          {
            "type": "text",
            "text": userId // 獨立訊息，方便手機長按複製
          }
        ]);
      } else {
        // 已綁定：發送高雅瓷專屬 Buttons 樣板卡片開啟 LIFF 追蹤網頁
        var liffUrl = "https://liff.line.me/" + GY_CONFIG.LIFF_ID;
        var welcomeText = "您好，" + userName + " (" + (dealerCompany || "高雅瓷專屬") + ")！\n\n點選下方按鈕，即可秒查今日配送細節、司機資訊與即時定位！";
        
        replyGaoYaCiLine_Core(replyToken, [
          {
            "type": "template",
            "altText": "高雅瓷今日送貨進度查詢",
            "template": {
              "type": "buttons",
              "title": "🚚 今日配送狀態查詢",
              "text": welcomeText.substring(0, 60), // LINE 限制 Buttons 內文最大 60 字元
              "actions": [
                {
                  "type": "uri",
                  "label": "📦 點此開啟今日進度頁面",
                  "uri": liffUrl
                }
              ]
            }
          }
        ]);
      }

      return true; // 成功攔截並處理
    }
  } catch (err) {
    Logger.log("GaoYaCi Webhook intercept error: " + err.message);
  }
  return false;
}

/**
 * 核心回覆函數
 */
function replyGaoYaCiLine_Core(replyToken, messages) {
  var url = "https://api.line.me/v2/bot/message/reply";
  var payload = {
    "replyToken": replyToken,
    "messages": messages
  };
  var options = {
    "method": "post",
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + GY_CONFIG.CHANNEL_ACCESS_TOKEN
    },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };
  UrlFetchApp.fetch(url, options);
}
