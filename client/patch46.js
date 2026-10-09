const fs = require('fs');
let content = fs.readFileSync('src/contexts/ThemeContext.tsx', 'utf8');

const target = `  useEffect(() => {
    const stored = localStorage.getItem("yomi.theme") as Theme | null;`;

const replace = `  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(err => console.error('SW registration failed:', err));
    }
    const stored = localStorage.getItem("yomi.theme") as Theme | null;`;

content = content.replace(target, replace);
fs.writeFileSync('src/contexts/ThemeContext.tsx', content);
console.log('Patched ThemeContext to register SW');
