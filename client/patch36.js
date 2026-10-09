const fs = require('fs');
let content = fs.readFileSync('src/lib/types.ts', 'utf8');

const target1 = `    let hit = tags.find(
      (t) => norm(t.name) === want || norm(t.name).includes(want) || want.includes(norm(t.name))
    );`;
const replace1 = `    let hit = tags.find((t) => norm(t.name) === want);`;

content = content.replace(target1, replace1);
fs.writeFileSync('src/lib/types.ts', content);
console.log('Patched genre matching logic');
