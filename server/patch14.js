const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');

const target = `const promises = providers.map(p => {
            const searchPromise = p.instance.search(q as string).then(data => ({ providerName: p.name, data }));
            // Speed up search drastically by reducing timeout to 1.2s for instant UX
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Provider timeout')), 2500));
            return Promise.race([searchPromise, timeoutPromise]);
        });`;

const replacement = `const promises = providers.map(p => {
            let searchPromise;
            if (p.name === 'mangadex') {
                searchPromise = fetch(\`https://api.mangadex.org/manga?title=\${encodeURIComponent(q as string)}&limit=24&includes[]=cover_art\`)
                    .then(r => r.json())
                    .then(r => {
                        return {
                            providerName: 'mangadex',
                            data: {
                                results: (r.data || []).map((m: any) => {
                                    const titleObj = m.attributes.title || {};
                                    const titleStr = titleObj.en || titleObj['ja-ro'] || Object.values(titleObj)[0] || '';
                                    const coverRel = m.relationships.find((rel: any) => rel.type === 'cover_art');
                                    const coverFile = coverRel?.attributes?.fileName;
                                    const coverUrl = coverFile ? \`https://uploads.mangadex.org/covers/\${m.id}/\${coverFile}.jpg\` : '';
                                    
                                    return {
                                        id: m.id,
                                        title: titleStr,
                                        image: coverUrl,
                                        description: m.attributes.description?.en || Object.values(m.attributes.description || {})[0] || '',
                                        status: m.attributes.status,
                                        contentRating: m.attributes.contentRating,
                                        altTitles: m.attributes.altTitles || []
                                    };
                                })
                            }
                        };
                    });
            } else {
                searchPromise = p.instance.search(q as string).then(data => ({ providerName: p.name, data }));
            }
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Provider timeout')), 2500));
            return Promise.race([searchPromise, timeoutPromise]);
        });`;

content = content.replace(target, replacement);
fs.writeFileSync('src/index.ts', content);
console.log('Patched mangadex search');
