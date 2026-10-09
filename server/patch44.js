const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');

const target = 'const coverUrl = coverFile ? `https://mangadex.org/covers/${d.id}/${coverFile}` : null;';
const replace = 'const coverUrl = coverFile ? `https://uploads.mangadex.org/covers/${d.id}/${coverFile}.256.jpg` : null;';

content = content.replace(target, replace);
fs.writeFileSync('src/index.ts', content);
console.log('Patched coverUrl in backend');
