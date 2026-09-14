/**
 * 🧹 智慧物流系統：屬性空間深度清理工具 V2.0
 * 
 * 💡 目的：解決 Google Apps Script 屬性空間 (9KB/100KB 限制) 爆滿問題。
 * 截圖顯示系統中存有大量的 UUID (例如: 01ffd...ae33) 且值為 "1" 的垃圾屬性。
 */

/**
 * 核心清理函式：執行此函式可清空所有垃圾
 */
function cleanupSystemProperties(e) {
  _requireSystemContext_(e);
  var props = PropertiesService.getScriptProperties();
  var allData = props.getProperties();
  var deleteCount = 0;
  var keys = Object.keys(allData);
  
  console.log("🚀 開始掃描屬性... 總數: " + keys.length);
  
  var kept = {};
  for (var key in allData) {
    var value = allData[key];
    
    // 垃圾判斷邏輯：
    // 1. 標準 UUID (36 碼含連字號) 且值為 "1"
    var isUuidJunk = (key.length >= 32 && value === "1" && key.includes('-'));
    // 1b. V41: 司機端 genUUID() 產生的格式：u + 13 位時間戳 + 4~8 位亂碼 (例如 u1757600000000abc123)，值為 "1"
    var isDriverUuidJunk = (value === "1" && /^u\d{13}[a-z0-9]{3,10}$/.test(key));
    
    // 2. 舊的地理位置快取 (GEO_ 開頭)
    var isGeoCache = (key.indexOf('GEO_') === 0);
    
    // 3. 追蹤快取 (TRACE_ 打頭，通常為舊資料)
    var isTraceCache = (key.indexOf('TRACE_') === 0);

    if (isUuidJunk || isDriverUuidJunk || isGeoCache || isTraceCache) {
      deleteCount++;
    } else {
      kept[key] = value;
    }
  }
  // V41: 一次性覆寫 (deleteAllOthers=true)，不再逐筆 deleteProperty (4000+ 筆會超過 6 分鐘)
  if (deleteCount > 0) props.setProperties(kept, true);
  
  console.log("✅ 清理完成！");
  console.log("🗑️ 刪除垃圾數量: " + deleteCount);
  console.log("💾 剩餘屬性數量: " + (keys.length - deleteCount));
  console.log("✨ 現在空間已清開，您可以執行 setGoogleMapsApiKey() 或手動新增屬性了。");
}

/**
 * 🛠️ 快速設定 Google Maps API Key
 * 請在下方填入您的 KEY 後，點擊執行。
 */
function setGoogleMapsApiKey(apiKey) {
  // V41: 金鑰改由參數傳入 (在編輯器執行 setGoogleMapsApiKey('你的KEY'))，不再寫進原始碼；建議直接在「專案設定 → 指令碼屬性」設定
  _requireSystemContext_();
  var API_KEY = String(apiKey || "").trim();
  if (!API_KEY || API_KEY.includes("YOUR_REAL")) {
    console.warn("⚠️ 請以參數傳入 API 金鑰：setGoogleMapsApiKey('AIza...')");
    return;
  }
  PropertiesService.getScriptProperties().setProperty("GOOGLE_MAPS_API_KEY", API_KEY);
  console.log("✅ GOOGLE_MAPS_API_KEY 設定成功！");
}

/**
 * 🔍 檢查目前的 API Key 是否存在
 */
function checkSystemKeys(e) {
  _requireSystemContext_(e);
  var props = PropertiesService.getScriptProperties().getProperties();
  var keys = ["GOOGLE_MAPS_API_KEY", "GEMINI_API_KEY", "VISION_API_KEY"];
  
  keys.forEach(function(k) {
    if (props[k]) {
      console.log("🆗 " + k + ": 已設定 (" + props[k].substring(0, 5) + "...)");
    } else {
      console.warn("❌ " + k + ": 尚未設定！");
    }
  });
}

/**
 * 🛠️ 救回「狀態」下拉選單
 * 目的：修復 Google Sheets H 欄 (狀態) 下拉選單消失的問題
 */
function restoreStatusValidation(e) {
  _requireSystemContext_(e);
  var ss = getSS_V11();
  var sheet = ss.getSheetByName("派送清單") || ss.getSheets()[0];
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var colStatus = -1;
  
  // 尋找狀態欄位
  for(var i=0; i<headers.length; i++) {
    var h = String(headers[i]).trim();
    if (h === "狀態" || h === "進度") {
      colStatus = i + 1;
      break;
    }
  }
  
  if (colStatus === -1) {
    throw new Error("❌ 找不到「狀態」欄位，請檢查標題列是否有「狀態」二字。");
  }
  
  var range = sheet.getRange(2, colStatus, sheet.getLastRow() - 1);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["待指派", "配送中", "已完成", "退貨", "取消", "結案"], true)
    .setAllowInvalid(false)
    .build();
    
  range.setDataValidation(rule);
  console.log("✅ 已成功救回第 " + colStatus + " 欄 (狀態) 的下拉選單規則！");
  return "✅ 下拉選單已修復，請查看 H 欄。";
}
