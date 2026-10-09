const sanitizeTitle = (title) => title.toLowerCase().replace(/\\(.*?\\)/g, '').replace(/\\[.*?\\]/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\\s+/g, ' ').trim();
const getSimilarity = (str1, str2) => {
    const set1 = new Set(str1.split(' ').filter(Boolean));
    const set2 = new Set(str2.split(' ').filter(Boolean));
    if (set1.size === 0 || set2.size === 0) return 0;
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    return intersection.size / Math.max(set1.size, set2.size);
};

const titles = [
  "The Academy's Sashimi Sword Master",
  'The Academy’s Sashimi Sword Master [AsuraScans]',
  'The Academy’s Sashimi Sword Master [KaynScans]',
  'The Academy’sSashimi Sword Master'
];

const groups = [];
titles.forEach(title => {
    const titleLower = sanitizeTitle(title);
    let group = groups.find(g => {
        const gTitle = sanitizeTitle(g[0]);
        return gTitle === titleLower || getSimilarity(gTitle, titleLower) > 0.85;
    });
    if (group) group.push(title);
    else groups.push([title]);
});

console.log(groups);
