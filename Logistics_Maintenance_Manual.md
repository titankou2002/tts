# 鈦傳速｜智能運控系統 維護與規範手冊 (V8.8+)

> [!IMPORTANT]
> 本文件記錄了系統核心功能的穩定性規範，特別是與「司機端分享」與「UI 佈局」相關的寫法。
> **除非 USER 明確要求，否則嚴禁修改以下標記為「黃金標準」的程式碼區塊。**

---

## 0. 部署注意事項（重要！每次改程式必看）

### 問題：為什麼推程式後其他人進不去？

每次 `clasp push` 之後，Google 偵測到程式碼變動，會要求擁有者重新授權。
在擁有者點「信任」之前，所有其他使用者看到「需要存取權」畫面，完全無法進入系統。

**根本原因：目前使用 HEAD（最新版）部署，每次推程式碼都等於換門鎖。**

### 正確流程（現在應該這樣做）

```
平常開發：clasp push → 只更新草稿，不影響線上使用者 ✅
要上線時：GAS 後台 → 部署 → 管理部署 → 建立新版本 → 點一次信任 → 完成
```

### 改成版本部署的步驟

1. 進入 [script.google.com](https://script.google.com) → 開啟此專案
2. 右上角「部署」→「管理部署」
3. 找到現有的網頁應用程式部署 → 點「編輯」
4. 版本選「新版本」→ 儲存
5. 之後每次要對外更新：重複步驟 3-4，點一次授權即可

### 不改程式時會自動保持存活嗎？

**會。** `keepSystemAlive_V11` 觸發器每天自動跑，只要不推新程式，其他人永遠能進去。
問題只出在推程式的那一刻。

---

---

## 1. 核心功能：LINE 結案分享 (LINE Share Logic)

### 1.1 問題背景
在行動裝置（特別是 iOS 的桌面捷徑 PWA 模式）中，`navigator.share` 對於 iframe 內的檔案分享有極其嚴格的限制。過於複雜的 `navigator.canShare` 檢查或帶有過多參數（如 `title`, `text`）的分享請求，常會導致瀏覽器基於安全性理由直接封鎖。

### 1.2 黃金標準寫法 (不可變更)
在 `Index.html` 中，分享邏輯必須保持最精簡，僅傳送 `files` 陣列：

```javascript
// 全域變數定義
var shareFile = null;

// 1. 產生檔案 (在 showSuccess 內)
canvas.toBlob(blob => {
    shareFile = new File([blob], 'result.jpg', { type: 'image/jpeg' });
    // ... 後續 UI 顯示
}, 'image/jpeg', 0.85);

// 2. 分享執行 (shareToLine 函數)
async function shareToLine() {
    if (!shareFile) return webAlert('圖片還在產生中...');
    
    // 必須跳過 canShare 檢查，直接嘗試觸發
    if (navigator.share) {
        try {
            await navigator.share({
                files: [shareFile] // 僅傳送檔案陣列，不帶 title/text 以確保最高相容性
            });
        } catch (e) {
            if (e.name !== 'AbortError') {
                webAlert('分享失敗，請長按圖片「分享」或點選「儲存」後手動傳送。');
            }
        }
    } else {
        webAlert('您的瀏覽器不支援直接分享圖片，請長按圖片儲存後分享。');
    }
}
```

---

## 2. UI 佈局：按鈕與圖示規範 (UI/UX Standards)

### 2.1 雙欄按鈕佈局
為了防止在不同尺寸的手機上按鈕位置偏移或溢出，`.photo-2col` 必須使用 **1:1 等分網格**。

**CSS 規範：**
```css
.photo-2col {
    display: grid;
    grid-template-columns: 1fr 1fr; /* 嚴禁改為 7fr 3fr 或其他非對稱比例 */
    gap: 10px;
}
```

### 2.2 相機與相簿圖示
為確保在所有 Android/iOS 版本中都能正確顯示，不使用外部圖片連結作為圖示，統一使用原生 Emoji。

**圖示標準：**
- **相機拍攝**：📷 (Camera Emoji)
- **相簿選取**：🎞️ (Film Frames Emoji)

---

## 3. 部署與同步規範 (Deployment)

### 3.1 部署環境
- **環境**：Google Apps Script (GAS)
- **工具**：CLASP
- **路徑**：`/智慧物流系統/`

### 3.2 恢復機制
若系統發生「自動恢復 (Recovery)」導致代碼倒退回 V6.3.3 等舊版本，必須立即依照此手冊手動修正 `photo-2col` 與 `shareToLine` 區塊，確保功能不中斷。


---

## 4. 系統授權維護 (Authorization Maintenance)

### 4.1 問題背景
當系統設定為「以管理員身份執行 (Execute as Me)」時，Google 的 OAuth 授權令牌 (Token) 會因為管理員長時間未登入後台而失效，導致其他使用者（司機、業務）在進入系統時跳出「無法登入」或「需要授權」的錯誤。

### 4.2 自動喚醒機制 (Keep-Alive)
為了確保授權永遠保持「活躍」，系統必須每小時自動執行一次存取動作，以刷新授權令牌。

**後端函式 (Code.js)：**
```javascript
function keepSystemAlive_V11() {
  try {
    var ss = SpreadsheetApp.openById(V11_PROD_CONFIG.SS_ID);
    var sheet = ss.getSheetByName(V11_PROD_CONFIG.SHEET_WHITELIST);
    if (sheet) {
      sheet.getRange(1, 1).getValue();
      console.log("✅ 系統授權已自動甦醒 (每小時自動執行)");
    }
  } catch (e) {
    console.error("❌ 甦醒失敗: " + e.message);
  }
}
```

### 4.3 觸發器設定規範
必須在 GAS 後台手動設定一個「時間驅動 (Time-driven)」觸發器：
- **執行函式**：`keepSystemAlive_V11`
- **活動來源**：時間驅動
- **類型**：小時計時器
- **間隔**：每 1 小時

---
*最後更新日期：2026-05-14*
*版本：V8.8.2 (Auth-Stability)*
