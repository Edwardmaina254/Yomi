const fs = require('fs');
const files = ['src/app/page.tsx', 'src/app/library/page.tsx', 'src/app/search/page.tsx'];

files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  content = content.replace('<AccountButton />\n      </aside>', '{/* <AccountButton /> removed per request */}\n      </aside>');
  if (f === 'src/app/page.tsx') {
    content = content.replace('<h1>{greeting}.</h1>', '<h1 suppressHydrationWarning>{greeting}.</h1>');
  }
  fs.writeFileSync(f, content);
  console.log('Patched', f);
});

let typesContent = fs.readFileSync('src/lib/types.ts', 'utf8');
typesContent = typesContent.replace('const timeoutId = setTimeout(() => controller.abort(), 15000);', 'const timeoutId = setTimeout(() => controller.abort(), 60000);');
typesContent = typesContent.replace('const timeoutId = setTimeout(() => controller.abort(), 7000);', 'const timeoutId = setTimeout(() => controller.abort(), 60000);');
fs.writeFileSync('src/lib/types.ts', typesContent);
console.log('Patched src/lib/types.ts timeout to 60000ms');
