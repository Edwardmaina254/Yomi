const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');

const targetProviders = `    const providers = [
        { name: 'mangadex', instance: new MANGA.MangaDex() },
        { name: 'comick', instance: createComicK() }
    ];`;
    
const replacementProviders = `    const providers = [
        { name: 'weebcentral', instance: new MANGA.WeebCentral() },
        { name: 'mangadex', instance: new MANGA.MangaDex() },
        { name: 'comick', instance: createComicK() }
    ];`;

content = content.replace(targetProviders, replacementProviders);

const targetOrder = `const order: Record<string, number> = { 'mangadex': 5, 'comick': 4, 'weebcentral': 3, 'mangahere': 2, 'mangapill': 1 };`;
const replacementOrder = `const order: Record<string, number> = { 'weebcentral': 5, 'mangadex': 4, 'comick': 3, 'mangahere': 2, 'mangapill': 1 };`;

content = content.replace(targetOrder, replacementOrder);

fs.writeFileSync('src/index.ts', content);
console.log('Restored WeebCentral as king');
