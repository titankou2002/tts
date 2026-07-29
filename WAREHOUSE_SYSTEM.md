# 倉庫驗貨系統 — 三階段流程

## 系統架構

```
 ┌─────────────┐     ┌──────────────┐     ┌─────────────┐
 │  分配驗貨    │ →   │  倉管對點    │ →   │  司機確認   │
 │ (倉管預驗)   │     │ (二次確認)   │     │ (APP勾選)   │
 └─────────────┘     └──────────────┘     └─────────────┘
        ↓                    ↓                    ↓
   驗貨狀態              驗貨狀態             司機確認狀態
   = 已分配              = 已上車             = 已確認
```

## 工作表欄位

### 派送清單（新增大欄位）

| 欄位名稱 | 用途 | 值 |
|---------|------|----|
| 驗貨狀態 | 倉管階段標記 | `空白` 未處理 / `已分配` 分配驗貨完成 / `已上車` 對點完成 |
| 實際載貨人 | 誰載走這批貨 | 司機姓名 |
| 驗貨時間 | 倉管對點時間 | yyyy/MM/dd HH:mm:ss |
| 司機確認狀態 | 司機本人確認 | `空白` 未確認 / `已確認` |
| 司機確認時間 | 司機確認時間 | yyyy/MM/dd HH:mm:ss |

### 其他相關欄位

| 欄位名稱 | 用途 |
|---------|------|
| 派遣司機 | 排車系統指派的主司機 |
| 回鶯歌 | boolean，是否需要回載到鶯歌 |
| 狀態 | 配送階段：待指派 → 配送中 → 已完成 |

## 頁面存取

### 倉庫驗貨頁
```
?page=warehouse
```
功能：三階段驗貨作業

### 排車頁
```
?page=dispatch
```
功能：派遣司機、回鶯歌設定、批次儲存

## 操作流程

### ① 分配驗貨（倉管）
1. 打開倉庫頁 → 看到今日配送清單
2. 逐筆確認貨品 → 按「☐ 分配驗貨」
3. 如無司機 → 從下拉選單選司機
4. 按「儲存」寫入後台
5. 已分配的卡片：左藍邊框 + 按鈕變「✅ 完成分配」

### ② 倉管對點（二次確認）
1. 確認貨品已上車
2. 勾選卡片左側方格
3. 按「確認裝車」
4. 寫入：驗貨狀態 = 已上車、實際載貨人、驗貨時間

**限制**：必須先完成分配驗貨 + 司機確認，才能勾方格

### ③ 司機確認（司機端 APP）
1. 司機打開倉庫頁（WebView 嵌入 APP）
2. 看到已分配給自己的貨品
3. 勾選「司機確認」
4. 按「儲存」寫入後台
5. 寫入：司機確認狀態 = 已確認、司機確認時間

## 統計資訊

頂部統計列可點開摺疊，展開後顯示各司機狀態：
```
恐龍  待裝 5 / 已載 5  未上 0
紹軒  待裝 5 / 已載 3  未上 2  ← 紅字閃爍
```

## 程式檔案

| 檔案 | 路徑 | 用途 |
|------|------|------|
| Warehouse.html | GAS 前端 | 倉庫驗貨 UI、三階段按鈕、圖片預覽、統計 |
| DispatchLogic.js | GAS 後端 | getUnDispatchedTasks_V3、batchWarehouseSave_V3、verifyTask_V3 |
| DispatchSystem.html | GAS 前端 | 排車系統（司機選單、回鶯歌、批次儲存） |

### 關鍵後端函式

**batchWarehouseSave_V3(jsonStr)**
- 接收 JSON: `[{ id, whStatus, assignedDriver, whDriver, driverConfirm }]`
- 批次寫入：驗貨狀態、派遣司機、實際載貨人、司機確認狀態、司機確認時間

**batchDispatchSave_V3(jsonStr)**
- 接收 JSON: `[{ id, assignedDriver, isBackYingge, whDriver }]`
- 批次寫入：派遣司機、回鶯歌、實際載貨人、狀態（→配送中）

## 部署

```
GAS Script ID: 1zglEKB-_mUB_auoB1WfAsftNEMY95VHLz_dGUF6g0oicLKAAHZp17maf
穩定部署 @452: AKfycbz3DuFG6dOC5O0aXQ-7Ng6SOH-Su3MYQe7iVid5OuMFCKTDQ70ecxzror78asPHfiyUTw
測試部署 @448: AKfycbxSgm94nLU9dSFiocH_ueaArpxZDejfwcVxGSwq6b4X6QN1ISP4pBpEbR7tmQUqydlM6w
```

更新步驟：
```
clasp push -f
clasp deploy -i <deploymentId> -d "版本說明"
```
