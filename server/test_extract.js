fetch('https://weebcentral.com/search/data?text=sashimi&limit=32&offset=0&display_mode=Full+Display', { headers: { 'HX-Request': 'true' } }).then(r=>r.text()).then(t => { 
  const cheerio = require('cheerio'); 
  const $ = cheerio.load(t); 
  const results = $('article.bg-base-300').map((i, el) => { 
    const link = $(el).find('a').first(); 
    const href = link.attr('href');
    const id = href ? href.split('/series/')[1] : '';
    const title = $(el).find('section.hidden.lg\\:block .tooltip a').text().trim() || $(el).find('section a .text-ellipsis').text().trim();
    const image = $(el).find('picture source').first().attr('srcset') || $(el).find('picture img').attr('src');
    return { id, href, title, image }; 
  }).get(); 
  console.log(results); 
}).catch(console.error);
