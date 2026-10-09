const fs = require('fs');
let content = fs.readFileSync('src/lib/types.ts', 'utf8');

const targetAlias = `    if (!hit) {
      const alias: Record<string, string> = {
        isekai: 'Fantasy',
        'school life': 'School',
        seinen: 'Drama',
        thriller: 'Mystery',
        horror: 'Horror',
        scifi: 'Sci-Fi',
      };
      const near = alias[want];
      if (near) hit = tags.find((t) => norm(t.name) === norm(near));
    }
    const query = new URLSearchParams();
    if (hit) query.append('includedTags[]', hit.id);
    else query.set('title', genre);
    query.append('includes[]', 'cover_art');
    query.set('limit', String(limit));
    if (offset > 0) query.set('offset', String(offset));
    query.set('order[followedCount]', 'desc');
    query.set('hasAvailableChapters', 'true');
    query.append('contentRating[]', 'safe');
    query.append('contentRating[]', 'suggestive');`;

const replaceAlias = `    if (!hit) {
      const alias: Record<string, string> = {
        isekai: 'Fantasy',
        'school life': 'School',
        seinen: 'Drama',
        thriller: 'Mystery',
        horror: 'Horror',
        scifi: 'Sci-Fi',
        bl: "Boys' Love",
        yaoi: "Boys' Love",
        ecchi: 'Harem'
      };
      const near = alias[want];
      if (near) hit = tags.find((t) => norm(t.name) === norm(near));
    }
    const query = new URLSearchParams();
    
    if (want === 'ecchi') {
        // Ecchi doesn't have a direct tag on MangaDex, it relies on contentRating
        query.append('contentRating[]', 'suggestive');
        query.append('contentRating[]', 'erotica');
        // Optionally add Romance or Harem to narrow it down, but let's just show top suggestive/erotica
    } else {
        if (hit) query.append('includedTags[]', hit.id);
        else query.set('title', genre);
        
        query.append('contentRating[]', 'safe');
        query.append('contentRating[]', 'suggestive');
        query.append('contentRating[]', 'erotica');
    }

    query.append('includes[]', 'cover_art');
    query.set('limit', String(limit));
    if (offset > 0) query.set('offset', String(offset));
    query.set('order[followedCount]', 'desc');
    query.set('hasAvailableChapters', 'true');`;

content = content.replace(targetAlias, replaceAlias);

const targetGenres = `export const GENRES = [
  "Action", "Romance", "Fantasy", "Drama", "Thriller", "Comedy",
  "Horror", "Sci-Fi", "Isekai", "Seinen", "School", "Adventure",
];`;
const replaceGenres = `export const GENRES = [
  "Action", "Romance", "Fantasy", "Drama", "Thriller", "Comedy",
  "Horror", "Sci-Fi", "Isekai", "Seinen", "School", "Adventure",
  "Ecchi", "BL", "Yaoi"
];`;
content = content.replace(targetGenres, replaceGenres);

fs.writeFileSync('src/lib/types.ts', content);
console.log('Patched genres');
