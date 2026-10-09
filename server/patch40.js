const fs = require('fs');
let content = fs.readFileSync('src/index.ts', 'utf8');

const target1 = `const data = await fetchMangaDex(\`https://api.mangadex.org/manga?includes[]=cover_art&order[followedCount]=desc&limit=30&hasAvailableChapters=true&contentRating[]=safe&\${dateParam}=\${encodeURIComponent(sinceStr)}&\${langQuery}\`);`;
const replace1 = `const data = await fetchMangaDex(\`https://api.mangadex.org/manga?includes[]=cover_art&order[followedCount]=desc&limit=30&hasAvailableChapters=true&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&\${dateParam}=\${encodeURIComponent(sinceStr)}&\${langQuery}\`);`;
content = content.replace(target1, replace1);

const target2 = `const data = await fetchMangaDex(\`https://api.mangadex.org/manga?includes[]=cover_art&order[updatedAt]=desc&limit=30&hasAvailableChapters=true&contentRating[]=safe&\${langQuery}\`);`;
const replace2 = `const data = await fetchMangaDex(\`https://api.mangadex.org/manga?includes[]=cover_art&order[updatedAt]=desc&limit=30&hasAvailableChapters=true&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&\${langQuery}\`);`;
content = content.replace(target2, replace2);

fs.writeFileSync('src/index.ts', content);
console.log('Patched content ratings on homepage endpoints');
