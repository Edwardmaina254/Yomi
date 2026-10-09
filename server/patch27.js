const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');

const target = `            } else {
                searchPromise = p.instance.search(q as string).then(data => ({ providerName: p.name, data }));
            }`;

const replacement = `            } else if (p.name === 'weebcentral') {
                searchPromise = fetch(\`https://weebcentral.com/search/data?text=\${encodeURIComponent(q as string)}&limit=32&offset=0&display_mode=Full+Display\`, { headers: { 'HX-Request': 'true' } })
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
                    });
            } else {
                searchPromise = p.instance.search(q as string).then(data => ({ providerName: p.name, data }));
            }`;

content = content.replace(target, replacement);
fs.writeFileSync('src/index.ts', content);
console.log('Patched weeb search');
