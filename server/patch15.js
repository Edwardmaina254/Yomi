const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');

content = content.replace(".then(r => {\\n                        return {", ".then((r: any) => {\\n                        return {");
content = content.replace("let mdexInfo;\\n            [primaryData, extSet, fallbackResultsRaw, mdexInfo]", "let mdexInfo: any;\\n            [primaryData, extSet, fallbackResultsRaw, mdexInfo]");
content = content.replace("let mdexInfo;\\n            [primaryData, extSet, mdexInfo]", "let mdexInfo: any;\\n            [primaryData, extSet, mdexInfo]");

fs.writeFileSync('src/index.ts', content);
console.log('Fixed TS errors');
