function checkApiKey() {
  var key = PropertiesService.getScriptProperties().getProperty('VISION_API_KEY');
  if (key) {
    Logger.log("API Key exists: " + key.substring(0, 5) + "...");
  } else {
    Logger.log("API Key is MISSING!");
  }
}
