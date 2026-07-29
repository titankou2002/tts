function getArchiveDataDiagnostic() {
  const ss = SpreadsheetApp.openById("1M-Ewy58fQs-QmqzO5nERoXDCm7lm6S_mrrAIR1mUOtA");
  const taskSheet = ss.getSheetByName("派送清單");
  const archiveSheet = ss.getSheetByName("派送清單_封存區");
  
  if (!archiveSheet) {
    Logger.log("封存表不存在");
    return;
  }
  
  const archiveData = archiveSheet.getDataRange().getValues();
  const currentData = taskSheet.getDataRange().getValues();
  
  Logger.log("目前派送清單筆數: " + currentData.length);
  Logger.log("目前封存區筆數: " + archiveData.length);
  
  // 檢查封存區是否有最近日期的訂單
  const h = archiveData[0].map(v => String(v).trim());
  const idx = h.indexOf("日期");
  
  if (idx !== -1) {
    let recentInArchive = 0;
    for (let i = 1; i < archiveData.length; i++) {
       let d = archiveData[i][idx];
       let dStr = (d instanceof Date) ? Utilities.formatDate(d, "GMT+8", "yyyy/MM/dd") : String(d).substring(0, 10).replace(/-/g, "/");
       if (dStr >= "2026/03/13") recentInArchive++;
    }
    Logger.log("應保留但被封存的筆數 (>= 2026/03/13): " + recentInArchive);
  }
}

function restoreRecentDataFromArchive() {
  const ss = SpreadsheetApp.openById("1M-Ewy58fQs-QmqzO5nERoXDCm7lm6S_mrrAIR1mUOtA");
  const taskSheet = ss.getSheetByName("派送清單");
  const archiveSheet = ss.getSheetByName("派送清單_封存區");
  const cutoffStr = "2026/03/13";
  
  const archiveData = archiveSheet.getDataRange().getValues();
  const h = archiveData[0].map(v => String(v).trim());
  const idx = h.indexOf("日期");
  
  const toRestore = [];
  const toKeepInArchive = [archiveData[0]];
  
  for (let i = 1; i < archiveData.length; i++) {
    let d = archiveData[i][idx];
    let dStr = (d instanceof Date) ? Utilities.formatDate(d, "GMT+8", "yyyy/MM/dd") : String(d).substring(0, 10).replace(/-/g, "/");
    if (dStr >= cutoffStr) {
      toRestore.push(archiveData[i]);
    } else {
      toKeepInArchive.push(archiveData[i]);
    }
  }
  
  if (toRestore.length > 0) {
    // 復原到派送清單
    taskSheet.getRange(taskSheet.getLastRow() + 1, 1, toRestore.length, toRestore[0].length).setValues(toRestore);
    
    // 從封存區移除
    archiveSheet.clearContents();
    archiveSheet.getRange(1, 1, toKeepInArchive.length, toKeepInArchive[0].length).setValues(toKeepInArchive);
    
    return "✅ 成功復原 " + toRestore.length + " 筆訂單至派送清單";
  }
  return "❌ 無可復原之資料";
}
