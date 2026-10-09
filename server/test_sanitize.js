const sanitizeTitle = (title) => title.toLowerCase().replace(/\\([^)]+\\)/g, '').replace(/\\[[^\]]+\\]/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\\s+/g, ' ').trim();
console.log(sanitizeTitle("The Academy's Sashimi Sword Master"));
console.log(sanitizeTitle('The Academy’s Sashimi Sword Master [AsuraScans]'));
console.log(sanitizeTitle('The Academy’s Sashimi Sword Master [KaynScans]'));
console.log(sanitizeTitle('The Academy’sSashimi Sword Master'));
