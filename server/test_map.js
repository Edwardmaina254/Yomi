
const { MANGA } = require('@consumet/extensions');
const { createComicK } = require('./dist/index.js');
const detectType = (manga: ) => {
    if (manga.type && typeof manga.type === 'string' && manga.type.toLowerCase() !== 'manga' && manga.type.toLowerCase() !== 'comic') {
        const t = manga.type.toLowerCase();
        if (t === 'manhwa' || t === 'manhua') return t;
    }
    
    if (manga.altTitles && Array.isArray(manga.altTitles)) {
        if (manga.altTitles.some((t: ) => t.ko)) return 'manhwa';
        if (manga.altTitles.some((t: ) => t.zh || t['zh-hk'] || t['zh-ro'])) return 'manhua';
    }
    
    const textToScan = [
        typeof manga.title === 'string' ? manga.title : '',
        manga.title?.native || '',
        ...(manga.altTitles || []).flatMap((t: ) => Object.values(t))
    ].join(' ');

    if (/[\uAC00-\uD7AF]/.test(textToScan)) return 'manhwa';
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(textToScan)) return 'manga';
    if (/[\u4E00-\u9FFF]/.test(textToScan)) return 'manhua';

    return 'manga';
};

const c = createComicK();
c.fetchMangaInfo('naruto').then(data => {
    console.log(mapChapters(data, 'comick').chapters.length);
}).catch(console.error);
