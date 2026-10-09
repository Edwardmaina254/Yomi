const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');
content = content.replace("console.error('Chapter fetch error:', error.message);", "console.error('Chapter fetch error:', error.stack);");
fs.writeFileSync('src/index.ts', content);
console.log('Stack trace added');
