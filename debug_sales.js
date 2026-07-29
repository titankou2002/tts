function debugGetSalesMap() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var salesMap = {};
  try {
    var sheetW = ss.getSheetByName("系統白名單");
    if (sheetW) {
      var wd = sheetW.getDataRange().getValues();
      var wh = wd[0].map(function(v){ return String(v).trim(); });
      var cN = wh.indexOf("姓名"), cB = wh.indexOf("所屬分公司"), cR = wh.indexOf("身分類型"), cA = wh.indexOf("帳號啟用");
      Logger.log("Headers found: cN=" + cN + ", cB=" + cB + ", cR=" + cR + ", cA=" + cA);
      if (cN !== -1 && cB !== -1) {
        for (var w = 1; w < wd.length; w++) {
          if (cA !== -1 && String(wd[w][cA]).trim() === "否") continue;
          var role = cR !== -1 ? String(wd[w][cR] || "").trim() : "";
          var bKey = String(wd[w][cB]).trim();
          var nVal = String(wd[w][cN]).trim();
          
          Logger.log("Row " + w + ": Branch=[" + bKey + "], Name=[" + nVal + "], Role=[" + role + "]");
          
          if (role.indexOf("業務") === -1 && role.indexOf("司機") === -1) continue;
          
          if (!bKey || !nVal) continue;
          if (!salesMap[bKey]) salesMap[bKey] = [];
          salesMap[bKey].push(nVal);
        }
      }
    }
  } catch(e) { Logger.log("Error: " + e); }
  Logger.log("FINAL MAP: " + JSON.stringify(salesMap));
  return salesMap;
}
