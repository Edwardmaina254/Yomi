const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');

const target1 = `        // Fast path for explicit non-MangaDex selections that succeeded!
        if (providerName !== 'mangadex' && chapters.length > 0) {
            console.log(\`[Chapters] FAST PATH: Explicitly selected provider \${providerName} returned \${chapters.length} chapters.\`);
            const payload = mapChapters(data, providerName as string);
            cache.set(cacheKey, payload);
            return res.json(payload);
        }

        // If we didn't parallelize fallbacks (e.g. MangaDex but missing reqTitle, OR WeebCentral which failed), run them sequentially NOW!
        if (fallbackPromises.length === 0 && (providerName === 'mangadex' || chapters.length === 0)) {`;

const replacement1 = `        // Fast path ONLY for WeebCentral since it has reliable images (Comick images are blocked by Cloudflare)
        if (providerName === 'weebcentral' && chapters.length > 0) {
            console.log(\`[Chapters] FAST PATH: WeebCentral returned \${chapters.length} chapters.\`);
            const payload = mapChapters(data, providerName as string);
            cache.set(cacheKey, payload);
            return res.json(payload);
        }

        // Run sequential fallbacks for MangaDex and Comick (to fetch WeebCentral's working images)
        if (fallbackPromises.length === 0) {`;

content = content.replace(target1, replacement1);
fs.writeFileSync('src/index.ts', content);
console.log('Patched fast path logic');
