fetch('https://graphql.anilist.co', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'query ($q: String) { Page(page: 1, perPage: 3) { media(search: $q, type: MANGA) { title { english romaji } } } }',
    variables: { q: 'ramparts of ice' }
  })
}).then(r=>r.json()).then(r=>console.log(r.data.Page.media)).catch(console.error);
