// --- ⚙️ 核心設定區 (對齊正確 ID) ---
const props = PropertiesService.getScriptProperties();
const CONFIG = {
  TOKEN: props.getProperty('LINE_CHANNEL_ACCESS_TOKEN'),
  DATA_SS_ID: '1WpBX1Bj-H0_452ltfV38B7alywRsqh-LTUKRfAkxPVs' 
};

// --- 🚀 Webhook 入口 ---
function doPost(e) {
  const output = ContentService.createTextOutput("OK");
  try {
    // 🔍 【診斷日誌】記錄所有進入 doPost 的原始 Webhook 事件，幫助抓出 Verify 請求結構
    try {
      var ssDbg = SpreadsheetApp.openById(CONFIG.DATA_SS_ID);
      var logSheet = ssDbg.getSheetByName("log");
      if (logSheet) {
        logSheet.appendRow([
          Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy/MM/dd HH:mm:ss"),
          "RAW_WEBHOOK",
          e && e.postData ? String(e.postData.contents) : "no contents",
          JSON.stringify(e || {})
        ]);
      }
    } catch(dbgErr) {}

    // ⚡ 瞬間攔截 LINE 官方的「Verify 驗證」虛擬請求，0.001秒回傳，防超時 (Timeout)
    if (e && e.postData && e.postData.contents) {
      if (e.postData.contents.indexOf("U00000000000000000000000000000000") !== -1) {
        return output;
      }
    }

    // 💡 經銷商物流查貨攔截 (完全不傷原本功能)
    if (typeof handleLineBotWebhook_GaoYaCi === 'function') {
      if (handleLineBotWebhook_GaoYaCi(e)) return output;
    }

    const msg = JSON.parse(e.postData.contents);
    if (!msg.events || !msg.events[0]) return output;
    const event = msg.events[0];
    const replyToken = event.replyToken, userId = event.source.userId.trim(), input = (event.message.text || '').trim();

    // 1. 🆕 新朋友歡迎詞 (自動發送一次)
    const welcomeNewKey = `newfriend_${userId}`;
    if (!props.getProperty(welcomeNewKey)) {
      sendPush(userId, "🌟 全新AI客服上線囉✨\n📢 「特約經銷許可制」\n⚠️ 目前仍處於Beta階段\n❤️ 敬請多多包涵❤️");
      props.setProperty(welcomeNewKey, "sent");
    }

    // 2. 🕵️ 權限檢查 (白名單對齊：userid, 等級, 名字, 通知業務ID)
    const auth = checkAuth(userId, input);
    if (!auth.allowed) return sendReply(replyToken, auth.msg);

    // 3. 載入資料與動態標題映射
    const dbSS = SpreadsheetApp.openById(CONFIG.DATA_SS_ID);
    const db = {
      main: dbSS.getSheetByName('保留單').getDataRange().getValues(),
      stock: dbSS.getSheetByName('庫存表').getDataRange().getValues(),
      price: dbSS.getSheetByName('編號價目表').getDataRange().getValues()
    };
    const maps = {
      main: getHeaderMap(db.main),
      stock: getHeaderMap(db.stock),
      price: getHeaderMap(db.price)
    };

    // 4. ✅ 審核通過後的首次歡迎
    const welcomePassedKey = `welcome_${userId}`;
    if (!props.getProperty(welcomePassedKey)) {
      sendPush(userId, `🎉 歡迎加入高雅瓷AI智能客服！\n親愛的 ${auth.name}，您已成功通過審核，現在可以開始查詢囉！💎`);
      props.setProperty(welcomePassedKey, "sent");
    }

    // 5. 分流處理
    const queries = input.toLowerCase().split('\n').map(q => q.trim()).filter(q => q);
    let fullReply = "";
    for (let q of queries) {
      if (['說明','幫助','help'].includes(q)) return sendReply(replyToken, getHelpText());
      fullReply += routeDispatcher(q, db, maps, auth);
    }

    // 6. 回覆與業務推播
    if (fullReply.trim()) {
      sendReply(replyToken, fullReply.trim());
      handleSalesPush(auth, queries, fullReply, userId); // 業務聯防
    }
  } catch(err) { Logger.log('System Error: ' + err); }
  return output;
}

// --- 🛠 系統工具 ---
function getHeaderMap(data) {
  const map = {};
  data[0].forEach((h, i) => { if (h) map[String(h).trim()] = i; });
  return map;
}

function checkAuth(uid, input) {
  const ss = SpreadsheetApp.openById(CONFIG.DATA_SS_ID);
  const data = ss.getSheetByName('白名單').getDataRange().getValues();
  const map = getHeaderMap(data);
  const user = data.find(r => r[map['userid']] === uid);
  const now = new Date();
  const nowStr = Utilities.formatDate(now, "Asia/Taipei", "yyyy/MM/dd HH:mm:ss");

  if (!user) return { allowed: false, msg: "⛔ 歡迎加入高雅瓷-AI智能客服\n\n📢 您尚未通過審核流程\n📝 請輸入：\n🏢【公司名稱】+ 👤【姓名】" };
  
  // 每日 20 次限制
  const limitKey = `limit_${uid}_${Utilities.formatDate(now, "GMT+8", "yyyyMMdd")}`;
  let count = parseInt(props.getProperty(limitKey) || "0");
  const userLevel = String(user[map['等級']]).toLowerCase();
  if (userLevel === 'free' && count >= 20) return { allowed: false, msg: "⚠️ 今日查詢已達 20 次上限，請明日再試。" };
  props.setProperty(limitKey, (count + 1).toString());

  // Log 記錄
  ss.getSheetByName('log').appendRow([nowStr, uid, input, user[map['名字']], user[map['等級']]]);
  return { allowed: true, level: userLevel, name: user[map['名字']], salesID: user[map['通知業務ID']] };
}

function sendReply(tk, txt) {
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post', headers: { Authorization: "Bearer " + CONFIG.TOKEN },
    payload: JSON.stringify({ replyToken: tk, messages: [{ type: 'text', text: txt.substring(0, 5000) }] }),
    contentType: 'application/json'
  });
}

function sendPush(to, txt) {
  try { UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post', headers: { Authorization: "Bearer " + CONFIG.TOKEN },
    payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: txt.substring(0, 5000) }] }),
    contentType: 'application/json'
  }); } catch(e) {}
}

function safeN(v) { let n = parseFloat(String(v).replace(/[^\d.-]/g, '')); return isFinite(n) ? n : 0; }

function shortenURL(url) {
  if(!url || !url.startsWith('http')) return "";
  try { return UrlFetchApp.fetch("https://is.gd/create.php?format=simple&url=" + encodeURIComponent(url)).getContentText(); } 
  catch (e) { return url; }
}