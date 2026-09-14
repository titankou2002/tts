/**
 * 🚚 鈦傳速智慧物流 - 運費計算引擎 (FreightEngine) V2.1
 * 專責處理：
 * 1. 讀取並載入後台「運費管理表」設定 (包含重量、偏遠地區與附加費用)
 * 2. 依重量級距查表做為基礎運費
 * 3. 進行偏遠加乘倍率與附加服務費合計，並產生詳細的計算明細說明
 * 建置日期：2026-08-27
 */

const FreightEngine = {
  _cachedRates: null,

  /**
   * 從後台「運費管理表」讀取完整的費率與加成規則
   */
  loadRates: function() {
    if (this._cachedRates) return this._cachedRates;
    try {
      // V41: 改用 openById，不依賴 container-bound 情境 (從觸發器 / 獨立部署呼叫時 getActiveSpreadsheet 會是 null → 靜默退回 $400)
      var ss = (typeof getSS_V11 === 'function') ? getSS_V11() : SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName((typeof V11_PROD_CONFIG !== 'undefined' && V11_PROD_CONFIG.SHEET_FREIGHT) || "運費管理表");
      if (!sheet) return null;
      var data = sheet.getDataRange().getValues();
      
      var weightSlabs = [];
      var remoteAreas = [];
      var addonFees = {};

      for (var i = 1; i < data.length; i++) {
        // 1. 重量級距 (Col A-B)
        var wMax = parseFloat(data[i][0]);
        var wFee = parseFloat(data[i][1]);
        if (!isNaN(wMax) && !isNaN(wFee)) {
          weightSlabs.push({ maxKg: wMax, fee: wFee });
        }
        
        // 2. 偏遠地區 (Col D-E)
        var remoteKws = String(data[i][3] || "").trim();
        var remoteMult = parseFloat(data[i][4]);
        if (remoteKws && !isNaN(remoteMult)) {
          remoteAreas.push({ keywords: remoteKws.split(/[,，\s]+/), multiplier: remoteMult });
        }

        // 3. 附加費用 (Col G-H)
        var addonItem = String(data[i][6] || "").trim();
        var addonRate = parseFloat(data[i][7]);
        if (addonItem && !isNaN(addonRate)) {
          addonFees[addonItem] = addonRate;
        }
      }

      // 依重量上限由小到大排序級距
      weightSlabs.sort(function(a, b) { return a.maxKg - b.maxKg; });

      this._cachedRates = {
        weightSlabs: weightSlabs,
        remoteAreas: remoteAreas,
        addonFees: addonFees
      };
      return this._cachedRates;
    } catch (e) {
      console.error("載入運費設定失敗: " + e.message);
      return null;
    }
  },

  /**
   * 根據地址自動歸類為 Zone 0~8 (供看板統計與分析篩選使用)
   */
  getZone: function(address) {
    if (!address) return "Zone 0";
    var addr = String(address);
    if (addr.includes("桃園") || addr.includes("鶯歌") || addr.includes("八德")) return "Zone 0";
    if (["三重", "蘆洲", "新莊", "中和", "永和"].some(k => addr.includes(k))) return "Zone 1";
    if (["板橋", "土城", "樹林"].some(k => addr.includes(k)) || addr.includes("板橋")) return "Zone 2";
    if (addr.includes("台北") || addr.includes("臺北")) return "Zone 3";
    if (["五股", "泰山", "林口"].some(k => addr.includes(k))) return "Zone 4";
    if (["汐止", "深坑", "淡水", "三芝"].some(k => addr.includes(k))) return "Zone 5";
    if (addr.includes("基隆") || addr.includes("瑞芳")) return "Zone 6";
    if (addr.includes("新竹") || addr.includes("苗栗")) return "Zone 7";
    if (addr.includes("宜蘭") || addr.includes("花蓮") || addr.includes("台東") || addr.includes("臺東") || addr.includes("屏東")) return "Zone 8";
    return "Zone 0"; // 預設 Zone 0
  },

  /**
   * V39.23: 獨立的偏遠地區判定 - 只需要地址，不需要重量，
   * 供 OCR 掃描建單當下就能判定並寫入「是否偏遠」欄位，不用等到對帳頁面才動態算。
   * 回傳 { isRemote, multiplier, keyword }
   */
  getRemoteInfo: function(address) {
    var addr = String(address || "");
    var rates = this.loadRates();
    if (!rates || !addr) return { isRemote: "否", multiplier: 1.0, keyword: "" };

    for (var j = 0; j < rates.remoteAreas.length; j++) {
      var kws = rates.remoteAreas[j].keywords;
      for (var k = 0; k < kws.length; k++) {
        if (kws[k] && addr.indexOf(kws[k]) !== -1) {
          var mult = rates.remoteAreas[j].multiplier;
          return { isRemote: "是(倍率 " + mult + ")", multiplier: mult, keyword: kws[k] };
        }
      }
    }
    return { isRemote: "否", multiplier: 1.0, keyword: "" };
  },

  /**
   * 計算特定任務的運費，回傳 { isRemote, estFee, detail }
   */
  calculateFreight: function(address, weight, options) {
    options = options || {};
    var weightVal = parseFloat(weight) || 0;
    
    // 載入後台設定
    var rates = this.loadRates();
    if (!rates) {
      return { isRemote: "否", estFee: 400, detail: "載入設定失敗，套用預設運費 $400" };
    }

    // 1. 依重量取得基礎運費
    var baseFee = 0;
    for (var i = 0; i < rates.weightSlabs.length; i++) {
      if (weightVal <= rates.weightSlabs[i].maxKg) {
        baseFee = rates.weightSlabs[i].fee;
        break;
      }
    }
    if (baseFee === 0 && rates.weightSlabs.length > 0) {
      baseFee = rates.weightSlabs[rates.weightSlabs.length - 1].fee;
    }
    var detailParts = ["[重量基費(" + Math.round(weightVal) + "kg)$" + baseFee + "]"];
    var subTotal = baseFee;

    // 2. 判定偏遠地區加乘
    // 規則：若是外包/指送貨運行 (carrierFlag 有值)，因司機僅送到本地集貨站，故不計偏遠費率
    var multiplier = 1.0;
    var matchedRemote = false;
    var matchedKeyword = "";
    var isCarrierDelivery = (options.carrierFlag && String(options.carrierFlag).trim() !== "");

    if (options.isRemoteVal && options.isRemoteVal === "否") {
      // 儲存格明確覆寫為否
      matchedRemote = false;
      multiplier = 1.0;
    } else if (options.isRemoteVal && options.isRemoteVal.indexOf("是") !== -1) {
      // 儲存格明確覆寫為是
      var mMatch = options.isRemoteVal.match(/[\d.]+/);
      multiplier = mMatch ? (parseFloat(mMatch[0]) || 1.0) : 1.0;
      matchedRemote = multiplier > 1.0;
      matchedKeyword = "指定";
    } else if (!isCarrierDelivery) {
      // 儲存格空白，且非貨運行指送時，自動比對地址
      for (var j = 0; j < rates.remoteAreas.length; j++) {
        var kws = rates.remoteAreas[j].keywords;
        for (var k = 0; k < kws.length; k++) {
          if (kws[k] && String(address || "").indexOf(kws[k]) !== -1) {
            multiplier = rates.remoteAreas[j].multiplier;
            matchedRemote = true;
            matchedKeyword = kws[k];
            break;
          }
        }
        if (matchedRemote) break;
      }
    }
    
    if (multiplier > 1.0) {
      subTotal = subTotal * multiplier;
      detailParts.push("[偏遠地區(" + matchedKeyword + ")x" + multiplier + "]");
    }

    var isRemoteStr = matchedRemote ? "是(倍率 " + multiplier + ")" : "否";

    // 3. 計算附加服務費
    var addonsTotal = 0;
    
    // 指定時間送貨
    if (options.isTimedDeliver === "是" && rates.addonFees["指定時間送貨"]) {
      var amt = rates.addonFees["指定時間送貨"];
      addonsTotal += amt;
      detailParts.push("[指定送貨$" + amt + "]");
    }
    // 指定時間退貨
    if (options.isTimedReturn === "是" && rates.addonFees["指定時間退貨"]) {
      var amt = rates.addonFees["指定時間退貨"];
      addonsTotal += amt;
      detailParts.push("[指定退貨$" + amt + "]");
    }
    // 等候超時費
    if (options.isOvertimeWait === "是" && rates.addonFees["等候超時費"]) {
      var amt = rates.addonFees["等候超時費"];
      addonsTotal += amt;
      detailParts.push("[等候超時$" + amt + "]");
    }
    // 加倍搬運費
    if (options.isHeavyCarry === "是" && rates.addonFees["加倍搬運費(每百公斤)"]) {
      var rate = rates.addonFees["加倍搬運費(每百公斤)"];
      var amt = Math.ceil(weightVal / 100) * rate;
      addonsTotal += amt;
      detailParts.push("[搬運費$" + amt + "]");
    }

    var finalFee = Math.round(subTotal + addonsTotal);
    var detailStr = detailParts.join(" + ") + " = 總計$" + finalFee;

    // 4. 判定貨運行折扣
    if (options.carrierFlag && options.carrierDiscount && options.carrierDiscount < 1.0 && options.carrierDiscount > 0) {
      var discountedFee = Math.round(finalFee * options.carrierDiscount);
      detailStr += " * [貨運行折扣(" + options.carrierFlag + ") " + Math.round(options.carrierDiscount * 100) + "%] = 折扣後總計$" + discountedFee;
      finalFee = discountedFee;
    }

    return {
      isRemote: isRemoteStr,
      estFee: finalFee,
      detail: detailStr
    };
  }
};
