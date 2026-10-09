const fs = require('fs');
let content = fs.readFileSync('src/app/search/page.tsx', 'utf8');

const target = `        Thriller: "thriller",
        School: "school",
        Adventure: "adventure",
      };`;
const replace = `        Thriller: "thriller",
        School: "school",
        Adventure: "adventure",
        Ecchi: "ecchi",
        BL: "bl",
        Yaoi: "yaoi",
      };`;

content = content.replace(target, replace);
fs.writeFileSync('src/app/search/page.tsx', content);
console.log('Patched genreQueries');
