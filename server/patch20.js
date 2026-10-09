const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');

const target1 = `        const allowedKeywords = [
            'mangadex', 'mangapill', 'weebcentral', 'compsci88', 'lastation', 'lowee',
            'comick', 'mangahere', 'zjcdn', 'fmcdn', 'webtoon', 'pstatic', 'myanimelist'
        ];`;
const replace1 = `        const allowedKeywords = [
            'mangadex', 'mangapill', 'weebcentral', 'compsci88', 'lastation', 'lowee', 'planeptune',
            'comick', 'mangahere', 'zjcdn', 'fmcdn', 'webtoon', 'pstatic', 'myanimelist'
        ];`;

content = content.replace(target1, replace1);

const target2 = `} else if (targetUrl.includes('weebcentral.com') || targetUrl.includes('compsci88') || targetUrl.includes('lastation') || targetUrl.includes('lowee')) {`;
const replace2 = `} else if (targetUrl.includes('weebcentral.com') || targetUrl.includes('compsci88') || targetUrl.includes('lastation') || targetUrl.includes('lowee') || targetUrl.includes('planeptune')) {`;

content = content.replace(target2, replace2);

fs.writeFileSync('src/index.ts', content);
console.log('Added planeptune to proxy allowlist');
