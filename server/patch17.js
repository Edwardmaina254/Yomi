const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');

content = content.replace("let primaryData, extSet;", "let primaryData, extSet, mdexInfo;");
content = content.replace("let mdexInfo: any;\\n            [primaryData, extSet, fallbackResultsRaw, mdexInfo]", "[primaryData, extSet, fallbackResultsRaw, mdexInfo]");
content = content.replace("let mdexInfo: any;\\n            [primaryData, extSet, mdexInfo]", "[primaryData, extSet, mdexInfo]");
content = content.replace("let mdexInfo;\\n            [primaryData, extSet, fallbackResultsRaw, mdexInfo]", "[primaryData, extSet, fallbackResultsRaw, mdexInfo]");
content = content.replace("let mdexInfo;\\n            [primaryData, extSet, mdexInfo]", "[primaryData, extSet, mdexInfo]");

fs.writeFileSync('src/index.ts', content);
console.log('Fixed mdexInfo scope properly');
