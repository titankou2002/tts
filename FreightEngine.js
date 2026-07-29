/**
 * 🚚 鈦傳速智慧物流 - 運費計算引擎 (FreightEngine) V1.0
 * 專責處理：1. 行政區/地址判定分區 (Zone 0~8) 2. 依公式計算參考運費
 * 建置日期：2026-04-15
 */

const FreightEngine = {
  
  /**
   * 1. 分區判定邏輯 (Zone Detector)
   * 依據地址自動歸類為 Zone 0~8
   */
  getZone: function(address) {
    if (!address) return "Z0";
    const addr = String(address);
    
    // 優先判定核心區 (Zone 0: 桃園/鶯歌/八德)
    if (addr.includes("桃園") || addr.includes("鶯歌") || addr.includes("八德")) return "Zone 0";
    
    // Zone 1: 新北核心一 (三重、蘆洲、新莊、中永和)
    const z1 = ["三重", "蘆洲", "新莊", "中和", "永和"];
    if (z1.some(k => addr.includes(k))) return "Zone 1";
    
    // Zone 2: 新北核心二 (板橋、土城、樹林)
    const z2 = ["板橋", "土城", "樹林"];
    if (z2.some(k => addr.includes(k))) return "Zone 2";
    
    // Zone 3: 台北市區
    if (addr.includes("台北市") || addr.includes("臺北市")) return "Zone 3";
    
    // Zone 4: 五股、泰山、林口
    const z4 = ["五股", "泰山", "林口"];
    if (z4.some(k => addr.includes(k))) return "Zone 4";
    
    // Zone 5: 汐止、深坑、淡水、三芝
    const z5 = ["汐止", "深坑", "淡水", "三芝"];
    if (z5.some(k => addr.includes(k))) return "Zone 5";
    
    // Zone 6: 基隆、瑞芳
    if (addr.includes("基隆") || addr.includes("瑞芳")) return "Zone 6";
    
    // Zone 7: 新竹、苗栗
    if (addr.includes("新竹") || addr.includes("苗栗")) return "Zone 7";
    
    // Zone 8: 宜蘭、花蓮或其他偏遠
    if (addr.includes("宜蘭") || addr.includes("花蓮")) return "Zone 8";

    return "Zone 0"; // 預設歸零區，提醒人員檢查
  },

  /**
   * 2. 參考運費計算公式
   * 公式：參考運費 = [分區基礎點費] + [重量加成]
   */
  calculateReference: function(zone, weight) {
    // 基礎點費表 (預設值，之後改由 SHEET_FREIGHT 讀取)
    const baseFeeTable = {
        "Zone 0": 250,
        "Zone 1": 350,
        "Zone 2": 400,
        "Zone 3": 500,
        "Zone 4": 450,
        "Zone 5": 600,
        "Zone 6": 750,
        "Zone 7": 1200,
        "Zone 8": 1800
    };

    const base = baseFeeTable[zone] || 400;
    let bonus = 0;
    
    // 重量加成邏輯：
    // < 500kg: 不加價
    // 500~1000kg: +200
    // > 1000kg: +500
    if (weight >= 1000) bonus = 500;
    else if (weight >= 500) bonus = 200;

    return base + bonus;
  },

  /**
   * 3. 欄位自動生成 (供 Code.js 使用)
   */
  getFreightInfo: function(address, weight) {
      const zone = this.getZone(address);
      const fee = this.calculateReference(zone, weight);
      return {
          zone: zone,
          referenceFee: fee
      };
  }
};
