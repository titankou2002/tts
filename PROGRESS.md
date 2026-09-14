# 鈦傳速智慧物流系統 - 開發進度

**最後更新：2026-09-14（QC 驗貨頁還原）**

---

## 2026-09-14 — QC.html 變成庫位表：原因與還原

`https://bigt.cc/tts/QC.html` 本身沒壞，iframe 仍是物流 Web App `?p=warehouse`。

Code.js：`p=warehouse` 或 `wh` → HTML 檔 **`Warehouse`**，標題「倉庫驗貨系統」。

**真正被蓋掉的是** 智慧物流系統裡的 `Warehouse.html`（驗貨：分配驗貨／對點／確認裝車）。2026-09-11 commit `2ed8439` 把它換成庫位表 PWA 包殼（iframe 倉庫全集 GAS）。

**已做：**
- 從 git `af3a6f1`（2026-07-29）還原驗貨頁（約 59KB，含「分配驗貨」）
- `clasp push` + deploy `AKfycbz3DuFG6dOC5O0aXQ-7Ng6SOH-Su3MYQe7iVid5OuMFCKTDQ70ecxzror78asPHfiyUTw` **@597**
- 誤蓋上去的包殼備份：`Warehouse.pwa-wrapper.backup.html.bak`

**庫位表沒有改名叫 Warehouse Tool。**
- 庫位表本體：倉庫全集 `warehouse_grid_ui.html`
- 線上：`/tts/Warehouse.html` 以及別名 `/tts/Warehousetools.html`（本機 `Warehousetools.html`，PWA 名「鈦傳速倉儲工具」，iframe 同一個庫位表 GAS）
- 驗貨：`/tts/QC.html` → 本檔 `Warehouse.html`

不要再把庫位表包殼寫進這個專案的 `Warehouse.html`。

---

## 🎯 今日工作 (2026-07-17) — OCR 品項代號抓不到的根因修復

### 問題描述

發票 150716009 的品項代號 KP12010 無法被提取，且不是 O/0 混淆問題（V39.2 已處理該類）。OCR 輸出格式散亂：項次、代號、名稱、數量各自獨立成行。

### 修復過程（三個版本迭代）

**V39.3 第一步：備案正則去掉 `\b` 邊界**（OcrEngine.js `extractProductCodeFallback()`）
- 原本 `/\b([A-Z]{2}\d{5,6})\b/` 的 `\b` 在換行符/特殊字符旁可能失效
- 改為 `/([A-Z]{2}\d{5,6})/`，O/0 混淆模式同步修改
- 結果：仍抓不到 ❌

**V39.3 第二步：備案觸發條件改進**（OcrEngine.js 行 556-597 附近）
- 原本只在 `items.length === 0` 時觸發備案
- 改為：items 為空 **或** 所有代號都不在 productMap 中（無效代號）時都觸發
- 結果：仍抓不到 ❌

**V39.4 真正根因：表尾截斷規則誤殺**（OcrEngine.js 行 176-177）
- 這張發票備註為「註:92公斤/直接找管理員**簽收**、貨下地下室、限高2.1米」
- 舊的 footer 截斷正則包含單獨的 `簽\s*收`，匹配到備註中的「管理員簽收」
- 導致 tableText 被截成只剩「代號\n註:92公斤/直接找管理員」
- **KP12010 根本不在解析文字裡**，所以前面改再多提取邏輯都無效
- 修復：單獨「簽收」必須帶冒號 `簽\s*收\s*[:：]` 才視為表尾（表格底部印的是「客戶簽收:」，一定有冒號；備註中「找管理員簽收、」後面是頓號，不會誤觸發）
- 結果：✅ **KP12010 成功提取，數量 3 片正確**

### 修復後行為

- KP12010 走主要邏輯（segments）正常提取，符合「2英文+5數字」標準格式
- 數量從「1箱*2片+1片=3片」的 `=3片` 正確抓到 3
- 正常發票不受影響：「※」「客戶簽收」「製表」等其他截斷條件全部保留
- 只有「備註含簽收字樣」的發票行為改變——而這些發票原本就是壞的

### 經驗教訓

**提取失敗時，先確認目標字串有沒有進到解析文字（tableText）裡，再改提取規則。** 這次前兩輪都在改提取邏輯，但真正問題是輸入文字在更上游就被截斷了。

### 已修改檔案

| 檔案 | 修改 |
|------|------|
| OcrEngine.js 行 176-177 | footer 截斷正則：`簽收` → `簽收[:：]`、`倉管` → `倉管[:：]` |
| OcrEngine.js `extractProductCodeFallback()` | 去掉 `\b` 邊界（V39.3） |
| OcrEngine.js 行 556-597 | 備案觸發條件：items 為空或所有代號無效時觸發 |

### 部署

- ✅ clasp push -f 覆蓋現有部署（18 個檔案）
- ✅ 實測發票 150716009：KP12010 提取成功

---

## 📊 整體進度

| 階段 | 狀態 | 備註 |
|------|------|------|
| 代碼模組化分割 | ✅ 完成 | 4,611 行 → 6 個模組，核心 Code.js ~800 行 |
| 全域命名空間衝突修復 | ✅ 完成 | APP_VERSION、OCR_VERSION 重複聲明已解決 |
| HTML 語法錯誤修復 | ✅ 完成 | DispatchSystem.html、tracking.html 模板字符串修復 |
| 遺失函數恢復 | ✅ 完成 | getWarRoomData_V11()、checkTodayAttendance() 已恢復 |
| 司機列表顯示 | 🔄 進行中 | getManagementData() 需手動修改 |
| 時間戳格式修復 | 🔄 進行中 | formatLastUpdate() 需手動修改 |
| Clasp 部署 | ❌ 阻滯 | Chrome Plugin EMFILE 問題持續 |

---

## 🔧 已完成修改

### 1. 代碼模組化
- **分割目標達成：** Code.js (4,611 → ~800 行)
- **新增模組：**
  - AuthUtils.js (6KB)
  - ProductUtils.js (12KB)
  - VerifyPicking.js (13KB)
  - AdminUtils.js (20KB)
  - VehicleLogic.js (25KB)
  - OcrEngine.js (已重命名 OCR_VERSION)

### 2. 全域命名空間修復
- 刪除 Code_BACKUP.js (重複 APP_VERSION)
- OcrEngine.js: `APP_VERSION` → `OCR_VERSION`

### 3. HTML 模板字符串修復
- **DispatchSystem.html (行 600-614)：** 單引號 → 雙引號
- **tracking.html (行 2283, 2295)：** 單引號 → 雙引號

### 4. 函數恢復
- **getWarRoomData_V11()：** 返回 {success, tasks, vehiclePositions, drivers}，15 分鐘快取
- **checkTodayAttendance()：** 查詢車輛排程表，返回里程/油量等資料

---

## 🚨 當前阻塞問題

### 1. Clasp Push 失敗
```
EMFILE: too many open files
open '...Chrome/Default/Extensions/.../assets/architectureDiagram-*.js'
```

**狀態：** 即使重啟系統仍未解決  
**原因：** Chrome Plugin 占用檔案描述符過多  
**替代方案：** 直接在 GAS 編輯器手動修改代碼

---

## ✏️ 待手動修改（在 GAS 編輯器中）

### 修改 1：getManagementData() - 硬編碼版本

**位置：** Code.gs - getManagementData() 函數

**替換為：**
```javascript
function getManagementData() {
  return {
    success: true,
    drivers: [
      { name: "簡紹軒", car: "BXD1236", role: "司機" },
      { name: "恐龍", car: "CAP8377", role: "司機" },
      { name: "李易璋", car: "RDB3599", role: "司機" },
      { name: "唐業霖", car: "3296YD", role: "司機" },
      { name: "許宗榮", car: "回頭車", role: "司機" }
    ]
  };
}
```

**預期結果：** Admin 頁面司機列表顯示 5 名司機

---

### 修改 2：formatLastUpdate() - 時間格式修復

**位置：** Code.gs - formatLastUpdate() 函數

**替換為：**
```javascript
function formatLastUpdate(timestamp) {
  if (!timestamp) return "";
  try {
    let date;
    if (typeof timestamp === "object" && timestamp instanceof Date) {
      date = timestamp;
    } else if (typeof timestamp === "string") {
      date = new Date(timestamp);
      if (isNaN(date)) {
        const match = timestamp.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
        if (match) return timestamp;
        return "";
      }
    } else {
      return "";
    }
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${month}/${day} ${hour}:${minute}`;
  } catch (e) {
    return "";
  }
}
```

**預期結果：** 時間戳格式為 "MM/dd HH:mm"（例如 "07/08 14:30"）

---

## 📋 資料驗證

### 車輛管理表（車輛管理）
確認表結構：
| 車牌號碼 | 司機 | 載重 |
|---------|------|------|
| BXD1236 | 簡紹軒 | 6000 |
| CAP8377 | 恐龍 | 4000 |
| RDB3599 | 李易璋 | 3500 |
| 3296YD | 唐業霖 | 6000 |
| 回頭車 | 許宗榮 | 4000 |

✅ 資料確認無誤

---

## 🧪 測試計畫

### 第一階段：手動修改測試
- [ ] 在 GAS 編輯器修改 getManagementData()
- [ ] 在 GAS 編輯器修改 formatLastUpdate()
- [ ] 部署到 GAS（新增部署或直接測試）
- [ ] 訪問新部署 URL 測試

### 第二階段：功能驗證
- [ ] Admin 頁面司機列表顯示正常
- [ ] 時間戳格式正確（MM/dd HH:mm）
- [ ] 分公司/車輛分組顯示正常
- [ ] 回頭車選項顯示正常

### 第三階段：全系統測試
- [ ] Picking 頁面功能
- [ ] Dispatch 頁面功能
- [ ] Warehouse Verification 頁面功能
- [ ] Driver App 功能
- [ ] Analytics 頁面功能

---

## 📌 部署連結

| 環境 | Script ID | 狀態 |
|------|-----------|------|
| 舊部署 | AKfycbwjNvDl... | 待更新 |
| 新測試部署 | AKfycbzFtZiyiag60kx... | 測試中 |

---

## 📝 注意事項

1. **Clasp 問題持續存在** - Chrome Plugin 占用檔案描述符，建議：
   - 卸載/禁用有問題的 Chrome Plugin
   - 或使用 GAS 編輯器直接修改代碼

2. **時間同步** - formatLastUpdate() 依賴系統時區，確保 GAS 專案時區正確

3. **硬編碼臨時方案** - getManagementData() 硬編碼版本適合短期測試，長期應修復表格讀取邏輯

---

## 📜 歷史工作 (2026-07-08)

### ✅ 已完成

**OCR 掃描代號識別改進：**
- ✅ OcrEngine.js 加入 `extractProductCodeFallback()` 函數
- ✅ 備案邏輯：當主要代號識別失敗時，自動提取「2英文+5~6數字」的模式
- ✅ 在 第 557-566 行的保底邏輯中添加備案提取（分段快取讀取失敗時觸發）

**Code.js 恢復：**
- ✅ 取消之前不必要的 getManagementData() 硬編碼改動
- ✅ 恢復原始的讀表邏輯（從車輛管理表和白名單表讀取）

**部署：**
- ✅ Clasp push 成功（18 個檔案）

### 🔍 診斷與分析

**問題根因：**
RE612114 代號無法被主要邏輯識別 → OCR 輸出混亂
- 成功案例：RO54505、AA61250 能被正確識別
- 失敗案例：RE612114 散亂在表格中

**解決方案：**
備案邏輯二層防線
1. 第一層（主要）：現有的代號檢驗邏輯 ✓
2. 第二層（備案）：正則 `/\b([A-Z]{2}\d{5,6})\b/` 強制提取 ← 今日新增

### 📋 車輛管理表確認

確認表結構與數據：
| 車牌號碼 | 司機 | 載重 |
|---------|------|------|
| BXD1236 | 簡紹軒 | 6000 |
| CAP8377 | 恐龍 | 4000 |
| RDB3599 | 李易璋 | 3500 |
| 3296YD | 唐業霖 | 6000 |
| 回頭車 | 許宗榮 | 4000 |

## 🧪 測試計畫

下次掃描第一張發票（150713001）時：
- [ ] 確認代號 RE612114 被正確提取
- [ ] 確認名稱「空靈 E.PERLE MATT」識別正常
- [ ] 確認數量「6 片」識別正常

## 📝 後續注意事項

1. **硬編碼版本已撤銷** - getManagementData() 恢復讀表，如司機列表無法顯示，檢查車輛管理表數據
2. **備案邏輯是被動觸發** - 只在主要邏輯失敗時才執行，不會替代現有邏輯
3. **OCR 質量優先** - 長期解決方案仍是確保掃描圖片清晰度

## 2026-09-14 晚 @598（使用者要 596 功能，只修網址驗貨）

- clasp @596 的 `Warehouse.html` 已是庫位表 iframe（1528B），所以 QC 壞了。
- 作法：整包以後端 **@596** 為準（含 Bypass admin password），**只**把 `Warehouse.html` 換成 @592 的驗貨頁（分配驗貨／對點／確認裝車）。
- 沒推 Warehousetools.html、沒動 Code.js / Auth.js（@592 多的 Auth.js 不帶回）。
- 部署同一支：`AKfycbz3DuFG6dOC5O0aXQ-7Ng6SOH-Su3MYQe7iVid5OuMFCKTDQ70ecxzror78asPHfiyUTw` **@598**。
- 請測：https://bigt.cc/tts/QC.html → 應為驗貨，不是庫位表。

## 2026-09-14 晚 @601 V41.37（本機 Claude；取代另一台的 @596–598 作法）

- 問題根因：`bigt.cc/tts/QC.html` 用 iframe 包 `exec?p=warehouse`，**Chrome 封鎖跨網域 iframe 內的 `window.prompt()`**，V41 驗貨頁的密碼 prompt 問不出來 → 黑畫面。另一台電腦的 @596「Bypass admin password」是把**整個後台**授權拿掉（Code.js 舊版、無 Auth.js），不採用。
- 作法：後端維持 V41（@600 全部功能），只針對驗貨頁「略過密碼」：
  - `Auth.js` 新增 `_requireWarehouse_` / `_issueWarehouseToken_`（role=warehouse，30 天）
  - `Code.js` doGet 渲染 Warehouse 時把 token 塞進 `userInfo`
  - `DispatchLogic.js` 5 個驗貨函式改用 `_requireWarehouse_`（admin token 仍可用）；其他 admin 功能不受影響
  - `Warehouse.html` 讀 `WH_USERINFO.token`；備援改頁內登入框，**不可再用 prompt()**
- 已驗證：QC.html 直接顯示待裝車清單，不問密碼。GAS @601；GitHub aa8fc0d。
- `Warehouse.html` 檔名不變、`?p=warehouse` 網址不變。

## 2026-09-14 晚 @602 V41.38（報表留在 bigt.cc、分析中心 iframe 化、行程列精簡）

- 新增 `Analytics.html`（bigt.cc 外殼，與 OS.html 同構，iframe 包 `exec?p=analytics`，-55px 裁掉 GAS 警告列）。
- `Dashboard.html` 報表按鈕：在 iframe 內時 `window.top.location = bigt.cc/tts/Analytics.html`（同分頁），不再跳 script.google.com。
- `WebDashboard.html`：prompt/alert/confirm 全改頁內登入框 / `notify()` / `ask()`（Chrome 封鎖跨網域 iframe 原生對話框）；`body.embedded-iframe` 把版面下推 55px。
- 行程列：不再標「樣品免費」（只留「樣品收費」）；同一地點 >2 家 → 只列第一家 + `+N家`。
- 已在瀏覽器驗證：OS.html → 報表 → 同分頁進 Analytics.html，登入、資料載入正常。
- 待辦：Dashboard.html 仍有 26 處 alert/confirm，在 OS.html iframe 內會靜默失敗（confirm 一律回 false）；需要時逐步改 showToast / 頁內確認。

## 2026-09-14 晚 @603 V41.39（分析中心 司機卡片）

- 司機行程記錄頁的車輛按鈕只列車輛管理表登記的自家車（之前把派送清單「車牌」欄的地址雜值全列出來）。
- 新增司機卡片（依司機名分卡、外車不列）：合計總單量（扣樣品免費）、平均日單量、每日里程數、每公里油耗（油費/km + km/L）、指定準點率（完成時間 ≤ 指定到貨時間；時段取結束時間）。
- `Code.js` getDashboardData 的 orders 多帶 `specifiedArrive`；快取 10 分鐘，按「同步後端」立即生效。

## 2026-09-15 早 @611 V41.42（運費統計重設計、指送地點進運費管理表）

- 運費統計方塊：總運費(含運費/油費)｜單數(一般/退貨/貨運行/偏遠 可點篩選)｜其它狀況(久候/搬運/指定時間 可點篩選)｜客戶分析(前三名，點看全部客戶佔比)。表格「偏遠」欄改「狀況」標籤。
- 分析中心預設區間改「近一週」，表格預設日期新→舊。
- 指送地點：`getDirectMap_V20` 改讀「運費管理表」J–L（簡稱/全名/地址，10 分鐘快取），空白時退回寫死清單。試算表選單「把指送地點清單寫進運費管理表」灌預設值，之後小姐直接在表上增修。
- `saveFreightSettings_V41` 不再建立「運費管理表_歷史」分頁（改用試算表版本記錄），且只清 A–H，不動 J–L。
- 待辦：分頁整理（使用者說太多）— 先盤點再決定合併/刪除，未動。
