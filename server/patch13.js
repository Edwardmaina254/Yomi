const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');
content = content.replace("let fallbackResultsRaw: any[] = [];\\n        let mdexInfo;", "let fallbackResultsRaw: any[] = [];\n        let mdexInfo;");
fs.writeFileSync('src/index.ts', content);
console.log('Fixed syntax error');
