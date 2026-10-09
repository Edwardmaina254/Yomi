const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');

const target = `const sanitizeTitle = (title: string) => title.toLowerCase().replace(/\\([^)]+\\)/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\\s+/g, ' ').trim();`;
const replace = `const sanitizeTitle = (title: string) => title.toLowerCase().replace(/\\([^)]+\\)/g, '').replace(/\\[[^\]]+\\]/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\\s+/g, ' ').trim();`;

content = content.replace(target, replace);
fs.writeFileSync('src/index.ts', content);
console.log('Fixed brackets in sanitizeTitle');
