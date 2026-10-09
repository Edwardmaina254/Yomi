const fs = require('fs'); 
const lines = fs.readFileSync('src/index.ts', 'utf8').split('\\n'); 
lines.forEach((l, i) => { 
  if (l.includes('name: \\'comick\\'')) console.log(i, l); 
});
