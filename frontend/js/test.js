const fs = require('fs');
const code = fs.readFileSync('/Users/akhil/Downloads/qaforge-v5/frontend/js/api-tester.js', 'utf8');
try {
  new Function(code);
  console.log("No syntax errors!");
} catch (e) {
  console.log("Syntax error:", e);
}
