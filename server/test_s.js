const sanitizeTitle = (title) => title.toLowerCase().replace(/\\(.*?\\)/g, '').replace(/\\[.*?\\]/g, '').replace(/['’]s/g, ' ').replace(/[^a-z0-9]/g, ' ').replace(/\\s+/g, ' ').trim();

const titles = [
  "The Academy's Sashimi Sword Master",
  'The Academy’s Sashimi Sword Master [AsuraScans]',
  'The Academy’s Sashimi Sword Master [KaynScans]',
  'The Academy’sSashimi Sword Master'
];

titles.forEach(t => console.log(sanitizeTitle(t)));
