const getNormalizedTitle = (title) => title.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\\s+/g, ' ').trim(); 
console.log(getNormalizedTitle('The Academy’s Sashimi Sword Master')); 
console.log(getNormalizedTitle("The Academy's Sashimi Sword Master"));
