const norm = (s) => s.toLowerCase().replace(/[\\s\\-_]+/g, '');
const want = norm("bl");
const alias = {
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
console.log('want:', want);
console.log('near:', near);

fetch('https://api.mangadex.org/manga/tag').then(r=>r.json()).then(r => {
    const tags = r.data;
    let hit = tags.find(
      (t) => norm(t.attributes.name.en) === want || norm(t.attributes.name.en).includes(want) || want.includes(norm(t.attributes.name.en))
    );
    if (!hit) {
      if (near) hit = tags.find((t) => norm(t.attributes.name.en) === norm(near));
    }
    console.log('hit:', hit ? hit.attributes.name.en : null);
});
