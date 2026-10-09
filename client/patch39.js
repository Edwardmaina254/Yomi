const fs = require('fs');
let content = fs.readFileSync('src/lib/types.ts', 'utf8');

content = content.replace('const timer = setTimeout(() => controller.abort(), 7000);', 'const timer = setTimeout(() => controller.abort(), 15000);');

fs.writeFileSync('src/lib/types.ts', content);
console.log('Increased timeout to 15000ms');
