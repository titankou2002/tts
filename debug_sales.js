function debugGetSalesMap(e) {
  _requireSystemContext_(e);
  var ss = getSS_V11();
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

function testFreightEngineCalculation(e) {
  _requireSystemContext_(e);
  var address1 = "桃園市桃園區中正路1號"; // Zone 0, No remote, weight 120kg
  var res1 = FreightEngine.calculateFreight(address1, 120, { isTimedDeliver: false });
  Logger.log("Test 1 (桃園市區): " + JSON.stringify(res1));

  var address2 = "宜蘭縣宜蘭市中山路二段"; // Zone 8, Remote x1.5, weight 450kg, 指定送貨+搬運
  var res2 = FreightEngine.calculateFreight(address2, 450, { isTimedDeliver: true, isHeavyCarry: true });
  Logger.log("Test 2 (宜蘭偏遠+附加服務): " + JSON.stringify(res2));
}
