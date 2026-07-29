const fs = require('fs');
const vm = require('vm');

const htmlPath = '/Users/titankou2002/Library/CloudStorage/GoogleDrive-titankou2002@gmail.com/我的雲端硬碟/BT/Antigravity/智慧物流系統/Index.html';
const content = fs.readFileSync(htmlPath, 'utf8');

// Extract all <script> tags
const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let match;
let count = 0;

while ((match = scriptRegex.exec(content)) !== null) {
  const code = match[1];
  // Ignore external script tags or empty script tags
  if (!code.trim()) continue;
  
  count++;
  console.log(`Checking script tag #${count}...`);
  try {
    // Replace GAS templates <?= ... ?> or <?!= ... ?> to avoid syntax errors in Node
    const preprocessedCode = code
      .replace(/<\?!=[\s\S]*?\?>/g, '{}')
      .replace(/<\?=[\s\S]*?\?>/g, '""');

    new vm.Script(preprocessedCode);
    console.log(`Script tag #${count} is syntax-valid!`);
  } catch (err) {
    console.error(`Syntax error in script tag #${count}:`, err.message);
    // Find line number of error in the original file
    const index = match.index + match[0].indexOf(match[1]);
    const beforeScript = content.substring(0, index);
    const scriptStartLine = beforeScript.split('\n').length;
    
    // Find line in script where error occurred
    const stackLines = err.stack.split('\n');
    const lineMatch = stackLines[0].match(/:(\d+)(?::(\d+))?$/) || stackLines[1].match(/:(\d+)(?::(\d+))?$/);
    if (lineMatch) {
      const errorLineInScript = parseInt(lineMatch[1]);
      const errorLineInFile = scriptStartLine + errorLineInScript - 1;
      console.error(`Error is at line ${errorLineInFile} in Index.html:`);
      
      const fileLines = content.split('\n');
      for (let l = Math.max(0, errorLineInFile - 5); l < Math.min(fileLines.length, errorLineInFile + 5); l++) {
        console.error(`${l + 1}: ${fileLines[l]}`);
      }
    }
  }
}
