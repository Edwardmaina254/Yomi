const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');

const helper = `// Helper for blazing fast native WeebCentral search to prevent 6s cold starts
async function nativeSearchWeebCentral(q: string) {
    const t = await fetch(\`https://weebcentral.com/search/data?text=\${encodeURIComponent(q)}&limit=32&offset=0&display_mode=Full+Display\`, { headers: { 'HX-Request': 'true' } }).then(r=>r.text());
    const cheerio = require('cheerio');
    const $ = cheerio.load(t);
    const results = $('article.bg-base-300').map((i: any, el: any) => {
        const link = $(el).find('a').first();
        const href = link.attr('href');
        const id = href ? href.split('/series/')[1] : '';
        const title = $(el).find('section.hidden.lg\\\\:block .tooltip a').text().trim() || $(el).find('section a .text-ellipsis').text().trim();
        const image = $(el).find('picture source').first().attr('srcset') || $(el).find('picture img').attr('src');
        return { id, title, image };
    }).get();
    return { results };
}

const extractString`;

content = content.replace("const extractString", helper);

// Now patch /api/search to use this helper
const targetSearch = `                searchPromise = fetch(\`https://weebcentral.com/search/data?text=\${encodeURIComponent(q as string)}&limit=32&offset=0&display_mode=Full+Display\`, { headers: { 'HX-Request': 'true' } })
                    .then(r => r.text())
                    .then(t => {
                        const cheerio = require('cheerio');
                        const $ = cheerio.load(t);
                        const results = $('article.bg-base-300').map((i: any, el: any) => {
                            const link = $(el).find('a').first();
                            const href = link.attr('href');
                            const id = href ? href.split('/series/')[1] : '';
                            const title = $(el).find('section.hidden.lg\\\\:block .tooltip a').text().trim() || $(el).find('section a .text-ellipsis').text().trim();
                            const image = $(el).find('picture source').first().attr('srcset') || $(el).find('picture img').attr('src');
                            return { id, title, image };
                        }).get();
                        return {
                            providerName: 'weebcentral',
                            data: { results }
                        };
                    });`;

const replaceSearch = `                searchPromise = nativeSearchWeebCentral(q as string).then(data => ({ providerName: 'weebcentral', data }));`;
content = content.replace(targetSearch, replaceSearch);

// Now patch parallel fallbacks
const targetFallback1 = `                    let searchResults = await p.instance().search(providerSearchQuery);
                    if (!searchResults.results?.length) {
                        const shortQuery = searchTitle.split(/[^\\w]/).filter(Boolean).slice(0, 4).join(' ');
                        if (shortQuery.length > 3) searchResults = await p.instance().search(shortQuery);
                    }`;
const replaceFallback1 = `                    let searchResults = p.name === 'weebcentral' ? await nativeSearchWeebCentral(providerSearchQuery) : await p.instance().search(providerSearchQuery);
                    if (!searchResults.results?.length) {
                        const shortQuery = searchTitle.split(/[^\\w]/).filter(Boolean).slice(0, 4).join(' ');
                        if (shortQuery.length > 3) searchResults = p.name === 'weebcentral' ? await nativeSearchWeebCentral(shortQuery) : await p.instance().search(shortQuery);
                    }`;
content = content.replace(targetFallback1, replaceFallback1);

// Now patch sequential fallbacks
const targetFallback2 = `                    let searchResults = await p.instance().search(seqProviderSearchQuery);
                    if (!searchResults.results?.length) {
                        const shortQuery = searchTitle.split(/[^\\w]/).filter(Boolean).slice(0, 4).join(' ');
                        if (shortQuery.length > 3) searchResults = await p.instance().search(shortQuery);
                    }`;
const replaceFallback2 = `                    let searchResults = p.name === 'weebcentral' ? await nativeSearchWeebCentral(seqProviderSearchQuery) : await p.instance().search(seqProviderSearchQuery);
                    if (!searchResults.results?.length) {
                        const shortQuery = searchTitle.split(/[^\\w]/).filter(Boolean).slice(0, 4).join(' ');
                        if (shortQuery.length > 3) searchResults = p.name === 'weebcentral' ? await nativeSearchWeebCentral(shortQuery) : await p.instance().search(shortQuery);
                    }`;
content = content.replace(targetFallback2, replaceFallback2);

fs.writeFileSync('src/index.ts', content);
console.log('Patched fallback native search');
