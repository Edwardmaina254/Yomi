const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');

const targetFilter1 = `if (rating === 'erotica' || rating === 'pornographic' || rating === 'adult' || status === 'pornographic') return false;`;
const replaceFilter1 = `if (rating === 'pornographic' || status === 'pornographic') return false;`;

const targetFilter2 = `if (titleLower.includes('sex') || titleLower.includes('porn') || titleLower.includes('hentai') || titleLower.includes('smut')) return false;`;
const replaceFilter2 = `if (titleLower.includes('sex') || titleLower.includes('porn') || titleLower.includes('hentai')) return false;`;

content = content.replace(targetFilter1, replaceFilter1);
content = content.replace(targetFilter2, replaceFilter2);

fs.writeFileSync('src/index.ts', content);
console.log('Patched NSFW filter');
