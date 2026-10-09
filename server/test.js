const { MANGA } = require('@consumet/extensions');
new MANGA.WeebCentral().search('Frieren Beyond Journey s End').then(searchResults=>{
    const searchTitleLower = "Frieren: Beyond Journey's End".toLowerCase();
    const best = searchResults.results.find(r => {
        const t = typeof r.title === 'string' ? r.title : r.title?.en;
        const cleanT = t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
        const cleanSearch = searchTitleLower.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
        console.log('cleanT:', cleanT, 'cleanSearch:', cleanSearch);
        return cleanT.includes(cleanSearch) || cleanSearch.includes(cleanT);
    });
    console.log('BEST:', best);
});
