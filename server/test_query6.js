fetch('https://weebcentral.com/search/data?text=the+academy%E2%80%99s+sashimi&limit=32&offset=0&display_mode=Full+Display', { headers: { 'HX-Request': 'true' } }).then(r=>r.text()).then(t => { 
  const cheerio = require('cheerio'); 
  const $ = cheerio.load(t); 
  const results = $('article.bg-base-300').map((i, el) => {
    return $(el).find('section.hidden.lg\\:block .tooltip a').text().trim() || $(el).find('section a .text-ellipsis').text().trim();
  }).get(); 
  console.log('Weeb results:', results.length, results); 
}).catch(console.error);
