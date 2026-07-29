# 鈦傳速｜三竹簡訊通知與即時追蹤系統 整合開發SOP手冊

本手冊記錄了「鈦傳速物流平台」與「三竹簡訊 (Mitake)」即時查貨簡訊系統的完整規劃與開發藍圖。當申請完三竹簡訊帳號後，即可依此藍圖進行一鍵升級。

---

## 1. 簡訊計費與長度黃金防呆規範

為了幫公司省下每筆簡訊成本，必須嚴格控管簡訊的發送長度：

| 簡訊類型 | 字數限制 | 扣除額度 | 備註 |
| :--- | :--- | :--- | :--- |
| **一般短簡訊** | **70 字以內** | **1 封額度** | 包含中文、英文、數字、標點符號與追蹤網址。 |
| **長簡訊 (LMS)** | **71 ~ 333 字** | **2 封以上額度** | 每多約 64-67 字加收 1 封，建議非必要時控制在單封內。 |

### 網址長度計算：
正式追蹤連結：`https://bigt.cc/tts/tracking.html?p=0912345678` (共 52 字元)。
因此，若要控制在 **1 封簡訊 (70 字內)**，動態簡訊中文內容必須控制在 **18 個字以內**。

---

## 2. 簡訊發送範本設計 (100% 動態生成)

針對「收件人為現場師傅/設計師」的實務情境，設計了以下兩款範本：

### 範本 A：尊榮路段版 (推薦，扣 2 封簡訊，約 88 字)
> **{聯絡人}，今日將配送{路段}的磁磚，以下是配送查詢，請點連結可以看還有多久到貨：{專屬追蹤連結}**
> *   *範例*：林師父，今日將配送中正路的磁磚，以下是配送查詢，請點連結可以看還有多久到貨：`https://bigt.cc/tts/tracking.html?p=0912345678`

### 範本 B：極致省錢版 (嚴格控制在 70 字以內，僅扣 1 封簡訊)
> **鈦傳速:{聯絡人}您好,磁磚由車牌{車牌}配送(第{站次}站),查進度:{專屬追蹤連結}**
> *   *範例*：鈦傳速:林師父您好,磁磚由車牌CAP-3877配送(第1站),查進度:`https://bigt.cc/tts/tracking.html?p=0912345678`

---

## 3. 智慧勾選與過濾邏輯 (Scenario 1 & 2)

當調度員打開簡訊發送視窗時，系統會自動根據以下規則進行「預設勾選」：

1.  **情境一：一般送貨 (預設勾選 ✅)**
    *   **判定條件**：電話欄位為有效台灣手機格式（開頭為 `09` 或 `+8869`），且客戶名稱**不包含**加工廠/貨運行等字眼。
2.  **情境二：加工廠/貨運行 (預設不勾選 ❌)**
    *   **判定條件**：電話欄位為空、或為市內電話（如 `02-`, `03-`），或者客戶名稱中包含：`["加工", "貨運", "弘昇", "大榮", "工廠", "回公司"]`。

---

## 4. UI/UX 介面開發藍圖

### A. 簡訊發送前核對彈窗 (SMS Preview & Edit Modal)
在「派車工作站」點擊 **`✉️ 簡訊通知現場`** 後，會跳出一個覆蓋視窗，列出今日該司機的所有配送站點：

```
+-----------------------------------------------------------------------------+
| ✉️ 傳送簡訊至工地現場 (司機: 李易璋)                                              |
+-----------------------------------------------------------------------------+
| [ ] 1. 中正路 (安帝嘉)                                                       |
|      現場聯絡人: [ 林師父     ] 聯絡手機: [ 0912345678 ] (預設勾選 ✅)         |
|      簡訊預覽: 林師父，今日將配送中正路的磁磚，請點連結... (計 88 字 / 2 封)      |
|                                                                             |
| [ ] 2. 大慶街 (弘昇加工)                                                     |
|      現場聯絡人: [ 弘昇加工   ] 聯絡手機: [ 02-2678888 ] (預設不勾選 ❌)       |
|      簡訊預覽: 弘昇加工，今日將配送大慶街的磁磚，請點連結... (市話不發送)         |
+-----------------------------------------------------------------------------+
| 字數總計防呆提示：本次發送共選取 1 筆，預估扣除三竹簡訊 2 封額度。                    |
+-----------------------------------------------------------------------------+
| [ 🚀 開始發送 (三竹 API) ]                                 [ 取消 ]          |
+-----------------------------------------------------------------------------+
```

---

## 5. 後端與前端 程式碼實作準備 (Developer Blueprint)

當您申請完三竹簡訊帳號後，我們將會實作以下兩大核心模組：

### A. 後端三竹簡訊發送模組 (Code.js / 11_DealerAPI.js)
```javascript
/**
 * 發送三竹簡訊 (UTF-8 規格)
 * @param {string} phone 手機號碼 (如 0912345678)
 * @param {string} message 簡訊內容
 * @return {boolean} 是否發送成功
 */
function sendMitakeSMS_V11(phone, message) {
  var props = PropertiesService.getScriptProperties();
  var username = props.getProperty("MITAKE_USERNAME");
  var password = props.getProperty("MITAKE_PASSWORD");
  
  if (!username || !password) {
    console.error("❌ 三竹簡訊帳號或密碼未於指令碼屬性中設定！");
    return false;
  }
  
  var payload = {
    "username": username,
    "password": password,
    "dstaddr": phone.replace(/\s+/g, '').replace("+886", "0"),
    "smbody": message,
    "CharsetURL": "UTF8"
  };
  
  var options = {
    "method": "post",
    "payload": payload,
    "muteHttpExceptions": true
  };
  
  try {
    var response = UrlFetchApp.fetch("https://smsapi.mitake.com.tw/api/mtk/smans", options);
    var resText = response.getContentText("UTF-8");
    if (resText.includes("statuscode=1") || resText.includes("statuscode=0") || resText.includes("statuscode=2") || resText.includes("statuscode=4")) {
      console.log("✅ 簡訊成功送達三竹平台: " + phone);
      return true;
    } else {
      console.error("❌ 三竹發送失敗，錯誤代碼: " + resText);
      return false;
    }
  } catch (e) {
    console.error("❌ 簡訊傳送發生異常: " + e.message);
    return false;
  }
}
```

### B. 免登入 `phone` 查詢安全 API (11_DealerAPI.js)
```javascript
// 支援免登入 phone 查詢邏輯
if (e.parameter.phone) {
  var phoneNum = e.parameter.phone.trim();
  // 在今日派車日誌中搜尋含有該 phoneNum 的 active 任務
  // 匹配成功後，將其角色 grade 強制設為 "free"
  // 並將經銷商名稱 dealer 設為該任務的 t.customer，完美保密同車其他站點
}
```

---

## 6. 三竹簡訊申請完成後的步驟

1.  **取得資料**：向三竹簡訊申請完成後，您會得到一組 **三竹簡訊帳號** 與 **三竹簡訊密碼**。
2.  **設定屬性**：進入 Google Apps Script 後台 ➔ 專案設定 ➔ 指令碼屬性 ➔ 新增：
    *   屬性：`MITAKE_USERNAME` ➔ 值：`您的三竹帳號`
    *   屬性：`MITAKE_PASSWORD` ➔ 值：`您的三竹密碼`
3.  **召喚 Antigravity**：隨時回來本視窗跟我說：**「三竹簡訊申請好了，請開始串接！」**，我將會立刻為您部署全部功能，讓您的物流系統完成最後一塊拼圖！
