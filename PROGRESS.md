# 鈦傳速智慧物流系統 - 開發進度

**最後更新：2026-10-08（V43.34，GAS version 755 / 主 Web App @755）**

---

## 2026-10-08 V43.34 — 預覽：已送達預設現場照片、可切銷貨單；圖片直連不再卡「載入中」

- **使用者回饋**：①未送達看銷貨單、送達後預設要看現場拍照，也要能切換看單據 ②有的點了卡「載入中」很久；有的已送達卻跳出銷貨單。
- **根因**：
  - 卡住：簽收照片每次都先叫伺服器 `getSignPhotoBase64` 把整張照片轉 base64 再傳回前端（還要再 canvas 重畫），要等好幾秒。
  - 已送達卻顯示銷貨單：同地址一起結案（batch）時，送貨日誌「簽收單照片」只記在主單單號，其他單在 `signPhotoMap` 找不到照片 → 舊邏輯就退回顯示銷貨單（例：禾欣）。另外舊邏輯只認 `status === '已完成'`，「結案 / 退貨完成」也會掉到銷貨單。
- **修法**（Dashboard.html）：
  - `showTaskPreview`：已送達（已完成/結案/退貨完成）→ 預設「現場照片」，標題列有「現場照片｜銷貨單」切換鈕；未送達 → 銷貨單；都沒有 → 地圖定位。
  - `_findSitePhoto_`：本單沒照片時，找同日、同車、同地址（`addrLooseMatch`）已有照片的單借用（批次結案）。仍找不到才顯示銷貨單並提示。
  - `setPreviewImage`：直接用 `lh3.googleusercontent.com/d/<id>` 給 `<img>` 載入（瀏覽器直連，快），只有直連失敗才退回伺服器 base64。拿掉 `showBeautifiedReceipt / drawBeautifiedCanvas`（司機端早已上傳框好的簽收單，不再前端重畫；很舊的原始照片就照原樣顯示）。
  - 下載檔名：現場照片 `客戶_日期_地址_分公司.jpg`，銷貨單加 `_銷貨單`。
- **驗證**：本機測試頁確認切換鈕預設「現場照片」、切到「銷貨單」檔名跟著換、橫式單據視窗不超出 1440×900。部署 version 755 → @755，`srcline` 確認新碼、5 個 `<script>` `node --check` 通過。
- **未驗證**：正式頁需登入；若某些照片沒開「知道連結者可檢視」，直連會失敗→自動退回伺服器轉檔（較慢但能看）。

---

## 2026-10-08 V43.33 — 戰情室圖片預覽重新設計

- **使用者回饋**：①視窗比例過大（直式簽收單兩邊一大片空白）②標題列 emoji 拿掉 ③關閉鈕被擋住（視窗位置記憶 + 標題列 padding 溢出）④右鍵另存的檔名也要是「客戶_日期_地址_分公司」⑤點按出現畫面的邏輯怪怪的。
- **新設計**（Dashboard.html）：
  - **點一下站點立刻開視窗**，先顯示「載入中…」，圖到了再補上；拿掉原本「單擊要等 0.26 秒判斷是不是雙擊」的延遲。沒有圖片的站直接在地圖上定位並提示。
  - **連點別站不會錯圖**：`openPreviewShell()` 每開一次 `seq+1`，`setPreviewImage(seq, …)` 若 seq 已過期（使用者關掉或改看別站）就丟掉晚回來的舊圖。
  - **視窗置中、大小跟著圖片比例**：`.pv-card` 寬度由圖片決定（最小 320px，最大螢幕寬−32px，高度不超過螢幕），不再記憶拖移位置、也不再拖移 → 關閉鈕永遠看得到。`box-sizing:border-box` 修正標題列溢出。
  - **標題列**：`客戶｜簽收單 / 銷貨單`＋「地圖定位」「下載」「關閉」，全部無 emoji。原本雙擊定位的功能改成視窗裡的「地圖定位」鈕。
  - **關閉**：點暗色背景 / ESC / 關閉鈕。開窗後 0.4 秒內點背景不關（避免習慣雙擊時第二下把剛開的視窗關掉）。
  - **右鍵**：圖片 `contextmenu` 改成自訂選單「下載圖片（顯示檔名）」，走同一個 `downloadPreviewImage()`，檔名與下載鈕一致（瀏覽器原生「另存圖片」無法指定檔名，所以攔下來）。
  - 舊 API 相容：`previewImage(url, fileName)` 仍可用（內部改走 openPreviewShell + setPreviewImage）；拿掉 `initPreviewDraggable` 與 `img_preview_pos` 位置記憶。
- **驗證**：本機測試頁（抽出 CSS/JS + 800×1600 假簽收單，1440×900 視窗）截圖確認：視窗貼合圖片、三顆按鈕都在、右鍵選單顯示正確檔名、點背景關閉。部署 version 754 → 主 Web App @754，`exec?p=srcline` 確認含新碼，5 個 `<script>` `node --check` 通過。
- **未驗證**：線上需管理端登入，實際下載存檔未在正式頁實測。

---

## 2026-10-08 V43.32 — 簽收單預覽：按標題列/拖移不再關閉

- **現象**：V43.31 後框中框已修好，但按預覽視窗上方的標題列（想拖移）視窗就關掉。
- **根因**：`<div id="imgPreviewOverlay" onclick="closePreview()">`——整個預覽視窗本身綁了關閉，只有圖片和按鈕有 `stopPropagation`，所以點標題列、圖片周圍的深色區都會關閉。
- **修法**（Dashboard.html）：
  - 拿掉 overlay 上的 `onclick="closePreview()"`；點視窗外面關閉仍由 `previewImage` 的 `closeOnOutsideClick` 處理，ESC 也照樣關。
  - 拖移放開那一下的 click 若落在視窗外，用 `__previewJustDragged`（300ms）略過，不誤關。
  - `initPreviewDraggable` 的 document mousemove/mouseup 只綁一次（原本每開一次預覽就多疊一組監聽）；按下載/關閉鈕不觸發拖移。
- **部署**：version 753 → redeploy 主 Web App @753；`exec?p=srcline&f=Dashboard` 確認含新碼、overlay 已無 onclick，5 個 `<script>` 皆 `node --check` 通過。

---

## 2026-10-08 V43.31 — 戰情室簽收單預覽：框中框修復、下載可用並自動命名

- **現象**：戰情室點已完成訂單看簽收單，照片外面被框了兩層（標題/地址/已送達章重複）；「⬇ 下載」按了沒反應，右鍵也存不了。
- **根因**：
  - 司機端結案時 `Index.html buildBeautifiedCanvas()` 已經把照片畫成 800×1600 的簽收單才上傳（`photo_sign`），戰情室 `Dashboard.html drawBeautifiedCanvas()` 又把這張「已經框好的圖」當原始照片再框一次。
  - 下載鈕原本是 `<a href="drive.google.com/uc?export=download…" target="_blank">`，在 GAS iframe（又包在 bigt.cc OS.html 裡）打不開；預覽圖本身是 canvas 產生的 data URL，跟 Drive 連結也對不上。
- **修法**（Dashboard.html）：
  - `drawBeautifiedCanvas`：圖片若是 800×1600（司機端已框好）直接顯示，不再重畫；舊的原始照片才照舊加框。
  - 新增 `downloadPreviewImage()`：data URL 直接轉 blob 存檔；Drive 圖先用 `getSignPhotoBase64` 取內容再存檔（不靠 Drive 下載網址）。
  - 新增 `receiptFileName(task)`：檔名 `客戶_YYYYMMDD_地址_分公司.jpg`，地址括號改成 `-`、去掉 `\ / : * ? " < > |` 與空白。例：`顧佳_20261008_新北市五股區壟鉤路7-5號-中誌加工_安帝嘉.jpg`。
  - `previewImage(url, fileName)` 多帶檔名參數；拿掉不再使用的 Drive 下載網址。含 `?` 的 regex 改 `new RegExp()` 字串建構（避開 GAS 精簡器）。
- **部署**：`clasp push -f` → version 752 → redeploy 主 Web App @752。`exec?p=srcline&f=Dashboard` 抓線上原始碼確認含新函式，5 個 `<script>` 皆 `node --check` 通過（剛部署完約 1 分鐘內還會抓到舊版快取）。
- **未驗證**：需管理端登入，實際下載未在瀏覽器實測；右鍵另存在 iframe 內仍可能被瀏覽器限制，請用「⬇ 下載」鈕。

---

## 2026-10-06 V43.30 — 帳號申請通知一律發「高雅瓷私密專區」＋ git 修復

- **需求**：鈦傳速、漢樺沒有自己的 Telegram 群組，帳號申請會退回私訊高弘治，老闆沒空時沒人能按核准。
- **修法**（Accounts.js）：新增 `ACCOUNT_NOTIFY_BRANCH = '高雅瓷'` 與 `_accountNotifyChat_()`，`_notifyAccountRequest_`（附核准/拒絕按鈕）和 `_notifyAccountEvent_`（核准/停用等異動）全部改發高雅瓷群組（-5590086103，與到貨通知同一群），不再依分公司分流；抓不到群組 ID 才退回私訊（`ACCOUNT_FALLBACK_CHAT`）。審核權限不變：按的人仍須登入且是白名單「主管」。
- **部署**：`clasp push -f` → version 751 → redeploy 主 Web App `AKfycbz3…` @750→@751。後端單改，bigt.cc 頁面不用動。
- **git 修復（完整過程）**：
  1. **發現問題**：這台電腦的 repo 被 Drive 同步弄壞——`.git/refs/remotes/origin/main.lock` 從 10/1 殘留（fetch 失敗）、`origin/main` 參照遺失、本機停在 V41.57（3 個沒推的 commit）而 GitHub 已到 V43.x、約 50 個檔案被清成 0 byte（PROGRESS.md、各說明 MD、圖示、deploy.yml 等）、Drive 產生 66 個「X 2.js / X 3.json」重複檔。
  2. **三邊比對**：`clasp pull` 到暫存區 → 本機 GAS 原始碼與線上 GAS HEAD 完全相同（最新）；GitHub 的 GAS 原始碼停在 V41.53，缺 Accounts.js / AuditLog.js / GoogleLogin.html / TtsVault.html。
  3. **補進 GitHub**（commit `dca403d`）：在暫存區乾淨 clone 用 `git hash-object` + `update-index` 寫入（避開 Mac 大小寫互撞）GAS 現行原始碼 17 檔（Code/Auth/DispatchLogic/OcrEngine/Settings/Accounts/AuditLog/GoogleLogin/TtsVault/Index/Dashboard/DispatchSystem/Warehouse/WebDashboard/tracking/appsscript.json/.claspignore）；PROGRESS.md 由「PROGRESS 2.md」還原；deploy.yml 排除 GoogleLogin.html / TtsVault.html（GAS 樣板，不上傳 bigt.cc）。推送前已檢查無 Telegram token / API 金鑰。GitHub Actions FTP 部署 bigt.cc 成功。
  4. **修本機**：舊本機 commit 打 tag `backup-local-V41.57` → 刪殘留鎖檔與壞掉的 `main-r` 參照 → `git fetch` → `git reset --mixed origin/main` → 確認被改的檔全是 0 byte 後 `git checkout -- .` 還原 → `git status` 乾淨、與 origin/main 同步。
  5. **重複檔**：66 個「X 2 / X 3」移到 `_重複檔備份_20261006/`（未刪，確認不需要可整個刪）。測試用 Excel「鈦傳速物流派車神器 (3).xlsx / (3)_修正版.xlsx」與 `Warehouse.pwa-wrapper.backup.html.bak` 已移到 Mac 垃圾桶。
  6. **本機防護**：`.git/info/exclude` 排除 `.clasprc.json`（含 OAuth token，絕不可 commit）、`Approve.html`、`_重複檔備份_*/`、`.DS_Store*`。
- **注意（外殼頁同名檔）**：repo 裡 `DRIVER.html / OS.html / QC.html / Analytics.html / approve.html / index.html` 是 **bigt.cc 外殼頁**，跟 GAS 同名檔（DRIVER/OS/QC/Analytics/Approve/Index）內容不同；Mac 檔名不分大小寫，`index.html`↔`Index.html`、`approve.html`↔`Approve.html` 會互撞。本機資料夾保留 GAS 版，這 6 個外殼檔在本機 git 設 `skip-worktree`——**改外殼頁請在另一份 clone 改再 push，不要直接 `git add` 本機這幾個檔**，否則會用 GAS 版蓋掉 bigt.cc 外殼頁。
- **缺口**：V42.x ～ V43.29 另一台電腦沒有寫進度紀錄，只有 git log / GAS 版本描述可查。

---

## 2026-09-16 V41.57 — 分析中心 502 Bad Gateway：暖機快取，避免冷算撞 Web App 30 秒執行上限

- **現象**：白屏修復後，`getDashboardData` 的 `google.script.run` 呼叫長時間等待後回 502（`GET .../callback?nocache_id=6... 502 (Bad Gateway)`）。
- **根因**：1111 回覆 `getDashboardData`（Code.js:782）整支包的 try/catch，真正 throw 只會回傳 `{success:false,error}` JSON 而不是 502 → 502 是 **Web App 執行逾時**（~30s 被砍）。冷快取時要載「任務表 + 封存區」186 天資料、每列跑 FreightEngine／貨運行判定／行程表 RichText 讀取，耗時超過上限 → 快取永遠寫不進去 → 每次都冷算 → 每次都 502。
- **修法**：
  - 重算核心抽成共用 `_computeDashboardDataCore_V11()`（不含授權/快取），`getDashboardData` 與暖機函式共用同一份邏輯（無行為差異）。
  - 快取 TTL 600s → 3600s，減少冷算頻率。
  - 新增 `warmDashboardCache_V11(e)`：由定時觸發器每小時暖機；也可在編輯器**手動執行一次**立即暖機。
  - 新增 `setupDashboardWarmTrigger_V11(e)`：建立每小時暖機排程（重複執行會先刪舊）。
- **部署**：push 到 HEAD → `clasp version` 建 635 → `clasp redeploy @633→635`（V8.8.23）。已 pull 驗證 HEAD 含新函式。
- **使用者需做一次**：Apps Script 編輯器執行 `warmDashboardCache_V11`（暖機）＋ `setupDashboardWarmTrigger_V11`（建排程）。
- **待辦**：舊副本機器 push 前先 git pull。

---

## 2026-09-16 V41.56 — 分析中心整頁白屏修復：HtmlService 精簡器截斷字串內 `//`

- **現象**：`https://bigt.cc/tts/Analytics.html` 白屏，console 報 `Uncaught SyntaxError: Invalid or unexpected token (userCodeAppPanel?createOAuthDialog=true:600:34)`。
- **根因**：GAS HtmlService 部署管線的精簡器會把「緊接在 regex 後面、含 `//` 的字串」當註解，`//` 之後到行尾全部截斷（專案曾在 Dashboard.html:4614 記錄過此坑）。WebDashboard.html 的 `fixUrl = 'https://lh3.googleusercontent.com/d/' + m[0];`（緊接在前一樣的 `u.match(/[-\w]{25,}/)` regex 之後）被截成 `fixUrl = 'https:` → 字串永不閉合 → 整支 script 無法解析。
- **修法**：把含 `//` 的 URL 字串拆兩段串接（`'https:/' + '/...'`，執行結果 URL 不變、任何單一字串內都不再出現 `//`）：
  - `WebDashboard.html`：分析中心照片縮圖 URL（本次元凶）
  - `Dashboard.html`：戰情室 openstreetmap 圖磚、g0v 縣市邊界 JSON、照片縮圖 URL（同款地雷預防）
- **部署**：`clasp push -f` + 建版本 634 + `clasp redeploy @633→634`（分析中心 iframe 用的 deployment 釘在固定版本，push 不會生效，必須 redeploy）。已用 curl 加 no-cache 重抓線上頁面，解碼後 `node --check` 通過。
- **待辦**：舊副本機器 push 前先 git pull；`\r\n` 換行清洗與網頁模板解析那批（V41.55）也已隨 634 上線。

---

## 2026-09-16 V41.55 — 倉內調貨免運費、指定送貨判定收緊、網頁模板解析修復

- **倉內調貨/送回公司倉庫一律免運費**：`HOME_ADDR_KEYWORDS` 新增「永安倉 / 永安 / 倉內調貨 / 調貨 / 轉倉」（Code.js:38）。`_isHomeAddress_` 改吃「地址 + 備註」，`_annotateDocTypes_` 新增 `isHomeTransfer`：即使原本判銷貨，只要地址/備註命中倉內調貨關鍵字也轉「樣品 (不計運費)」。
- **分析中心「指定送貨」判定收緊**：只有「指定到貨時間」欄位明確勾選/填寫時段才加收 300；備註文字含「指送 / 限時」不再誤判（避免全量誤收）。先前會把 AM/PM 時段的全量單誤判為指定送貨。
- **Dashboard 快取升級 v5**：`_clearDashboardCache_` / `getDashboardData` 改用 `dashboard_stats_v5` 並清舊鍵；未登入時 getDashboardData 回傳 `AUTH_REQUIRED`（不再 throw 被前端吞掉）。
- **網頁模板解析修復（關鍵）**：
  - `_renderPageHtml_` 的 `include()` 與 `JSON.stringify(userInfo/initialPage)` 正則補上 `?>/&gt;` 閉合判定（Code.js:356-362）。
  - `WebDashboard.html` 配合改法：JS 樣板字串由多行壓成單行、`//` 行註解改 `/* */`、`userInfo` 改 `(<?!= JSON.stringify(userInfo || {}) ?>)`、`escapeHTML` 補 `\r\n\` 清洗。原因：HtmlService 模板引擎會把 HTML 文字節點裡的 `<?` 轉成 `&lt;?`，JS 內不會；先前正則沒要求閉合，遇到樣板字串內的 `?>` 序列可能被誤判成模板標記。
- **授權體驗**：新增 `authorizeScript()` 一鍵授權函式；`onOpen` 在非容器介面（Web App / 觸發器）呼叫時靜默退回；`Analytics.html` 掛上 Google 帳號一次性啟用授權提示 overlay。
- **待辦**：本批尚未 clasp push；分頁整理（使用者說太多）仍未做。

**補記（承接 @611 V41.42 → 現在）**：
- V41.43 樣品/退貨判定附原因 `docWhy`、分析中心標籤滑過可看、點一下可改判為一般銷貨
- V41.44 修正「大量銷貨單被判退貨」（銷/退分開彙總，純數字流水號不吃報表退貨判定）
- V41.45 指送對照表預設加入 安帝嘉/喜悅納 鶯歌倉（高職東街13號）；`HOME_ADDR_KEYWORDS` 加高職東街
- V41.46 AI 排車改用「排車習慣記錄」做路線熟悉度配車
- V41.47 試算表選單重整 + 一鍵刪除用不到的分頁
- V41.48 / V41.49 OCR 指送辨識容錯、指送比對改「視窗搜尋」
- V41.50 指送貨運行/加工廠 → 一律「貨運行集貨」（折扣 0.5）
- V41.51 排車視窗新增「🤖 AI 排車」按鈕
- V41.52 司機端指定時間提示補齊：只有計費旗標（指定送貨=是）沒填時間的單也顯示 ⏰
- V41.53 @622 戰情室/排車/分析中心/驗貨 全站按鈕統一回饋（hover 提亮、按下縮放 0.95、disabled 變淡）

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
