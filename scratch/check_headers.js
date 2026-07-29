function checkLogHeaders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("送貨日誌");
  if (!sheet) {
    Logger.log("Sheet '送貨日誌' not found");
    return;
  }
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Logger.log("Headers: " + JSON.stringify(headers));
}

function syncOldData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = ss.getSheetByName("送貨日誌");
  var taskSheet = ss.getSheetByName("任務清單"); // Assuming this is V11_PROD_CONFIG.SHEET_TASKS
  
  if (!logSheet || !taskSheet) {
    Logger.log("Sheets not found");
    return;
  }
  
  var logData = logSheet.getDataRange().getValues();
  var taskData = taskSheet.getDataRange().getValues();
  
  var logH = logData[0].map(v => String(v).trim());
  var taskH = taskData[0].map(v => String(v).trim());
  
  var colLogCar = logH.indexOf("車牌號碼");
  var colLogCust = logH.indexOf("客戶名稱");
  var colLogAddr = logH.indexOf("送貨地址");
  var colLogTime = logH.indexOf("配送完成時間");
  var colLogOrderId = logH.indexOf("單號");
  
  var colTaskId = taskH.indexOf("ID");
  if (colTaskId === -1) colTaskId = taskH.indexOf("單號");
  var colTaskCar = taskH.indexOf("車牌");
  var colTaskCust = taskH.indexOf("客戶名稱");
  if (colTaskCust === -1) colTaskCust = taskH.indexOf("CUSTOMER");
  var colTaskAddr = taskH.indexOf("地址");
  if (colTaskAddr === -1) colTaskAddr = taskH.indexOf("ADDRESS");
  
  Logger.log("Log Col Indices: " + JSON.stringify({car: colLogCar, cust: colLogCust, addr: colLogAddr, time: colLogTime, orderId: colLogOrderId}));
  Logger.log("Task Col Indices: " + JSON.stringify({id: colTaskId, car: colTaskCar, cust: colTaskCust, addr: colTaskAddr}));
}
