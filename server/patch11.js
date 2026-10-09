const fs = require('fs');
const lines = fs.readFileSync('src/index.ts', 'utf8').split('\n');
const start = lines.findIndex(l => l.includes('const mapChapters = '));
const end = lines.findIndex((l, i) => i > start && l.startsWith('};'));
const mapChaptersStr = lines.slice(start, end+1).join('\n');
const detectStart = lines.findIndex(l => l.includes('const detectType ='));
const detectEnd = lines.findIndex((l, i) => i > detectStart && l.startsWith('};'));
const detectStr = lines.slice(detectStart, detectEnd+1).join('\n').replace(/any/g, ''); // strip TS any

const script = `
const { MANGA } = require('@consumet/extensions');
const { createComicK } = require('./dist/index.js');
${detectStr.replace(/: string/g, '')}
${mapChaptersStr}
const c = createComicK();
c.fetchMangaInfo('naruto').then(data => {
    console.log(mapChapters(data, 'comick').chapters.length);
}).catch(console.error);
`;
fs.writeFileSync('test_map.js', script);
console.log('Script created');
