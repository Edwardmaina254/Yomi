const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');

content = content.replace("let fallbackResultsRaw: any[] = [];", "let fallbackResultsRaw: any[] = [];\\n        let mdexInfo;");
content = content.replace("let mdexInfo;\\n            [primaryData, extSet, fallbackResultsRaw, mdexInfo]", "[primaryData, extSet, fallbackResultsRaw, mdexInfo]");
content = content.replace("let mdexInfo;\\n            [primaryData, extSet, mdexInfo]", "[primaryData, extSet, mdexInfo]");

fs.writeFileSync('src/index.ts', content);
console.log('Fixed mdexInfo scope');
