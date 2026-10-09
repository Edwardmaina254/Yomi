const fs = require('fs');
let content = fs.readFileSync('src/lib/types.ts', 'utf8');

const target = `    // Second query: explicitly pull Korean-language (manhwa) titles with the
    // same tag so genre results always carry both manga AND manhwa, even when
    // the tag is manga-heavy.
    if (hit) {`;

const replace = `    // Second query: explicitly pull Korean-language (manhwa) titles with the
    // same tag so genre results always carry both manga AND manhwa, even when
    // the tag is manga-heavy.
    if (hitId || want === 'ecchi') {`;

content = content.replace(target, replace);
fs.writeFileSync('src/lib/types.ts', content);
console.log('Fixed hit reference');
