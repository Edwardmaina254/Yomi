const fs = require('fs');
let content = fs.readFileSync('src/lib/types.ts', 'utf8');

const targetFunc = `async function searchMangaDexByGenre(
  genre: string,
  limit = 24,
  offset = 0
): Promise<MangaResult[]> {
  try {
    const norm = (s: string) => s.toLowerCase().replace(/[\\s\\-_]+/g, '');
    const want = norm(genre);
    const tags = await loadMangaDexTags();
    let hit = tags.find((t) => norm(t.name) === want);
    if (!hit) {
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
    }`;

const replacementFunc = `const MD_TAGS_MAP: Record<string, string> = {
  thriller: '07251805-a27e-4d59-b488-f0bfbec15168',
  scifi: '256c8bd9-4904-4360-bf4f-508a76d67183',
  action: '391b0423-d847-456f-aff0-8b0cfc03066b',
  psychological: '3b60b75c-a2d7-4860-ab56-05f391bb889c',
  romance: '423e2eae-a7a2-4a8b-ac03-a8351462d71d',
  comedy: '4d32cc48-9f00-4cca-9b5a-a839f0764984',
  "boys'love": '5920b825-4181-4a17-beeb-9918b0ff7a30',
  adventure: '87cc87cd-a395-47af-b27a-93258283bbc6',
  "girls'love": 'a3c67850-4684-404e-9b7f-c69850ee5da6',
  harem: 'aafb99c1-7f60-43fa-b75f-fc9502ce29c7',
  isekai: 'ace04997-f6bd-436e-b261-779182193d3d',
  drama: 'b9af3a63-f058-46de-a9a0-e0c13906197a',
  school: 'caaa44eb-cd40-4177-b930-79d3ef2afe87',
  schoollife: 'caaa44eb-cd40-4177-b930-79d3ef2afe87',
  horror: 'cdad7e68-1419-41dd-bdce-27753074a640',
  fantasy: 'cdc58593-87dd-415e-bbc0-2ec27bf404cc',
  mystery: 'ee968100-4191-4968-93d3-f82d72be7e46',
  sliceoflife: 'e5301a23-ebd9-49dd-a0cb-2add944c7fe9',
  supernatural: 'eabc5b4c-6aff-42f3-b657-3e90cbd00b75',
};

export async function searchMangaDexByGenre(
  genre: string,
  limit = 24,
  offset = 0
): Promise<MangaResult[]> {
  try {
    const norm = (s: string) => s.toLowerCase().replace(/[\\s\\-_]+/g, '');
    const want = norm(genre);
    
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
    
    const mappedGenre = alias[want] ? norm(alias[want]) : want;
    
    // FAST PATH: Lookup hardcoded MD tags to prevent extra 1000ms latency from fetching tags list
    let hitId = MD_TAGS_MAP[mappedGenre];
    
    if (!hitId && want !== 'ecchi') {
        const tags = await loadMangaDexTags();
        const hit = tags.find((t) => norm(t.name) === mappedGenre);
        if (hit) hitId = hit.id;
    }`;

content = content.replace(targetFunc, replacementFunc);

const targetQuery = `    if (want === 'ecchi') {
        // Ecchi doesn't have a direct tag on MangaDex, it relies on contentRating
        query.append('contentRating[]', 'suggestive');
        query.append('contentRating[]', 'erotica');
        // Optionally add Romance or Harem to narrow it down, but let's just show top suggestive/erotica
    } else {
        if (hit) query.append('includedTags[]', hit.id);
        else query.set('title', genre);`;

const replaceQuery = `    if (want === 'ecchi') {
        // Ecchi doesn't have a direct tag on MangaDex, it relies on contentRating
        query.append('contentRating[]', 'suggestive');
        query.append('contentRating[]', 'erotica');
    } else {
        if (hitId) query.append('includedTags[]', hitId);
        else query.set('title', genre);`;

content = content.replace(targetQuery, replaceQuery);

fs.writeFileSync('src/lib/types.ts', content);
console.log('Patched genre loading speed');
