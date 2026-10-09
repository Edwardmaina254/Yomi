const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.scripts.dev = "tsx watch --dns-result-order=ipv4first src/index.ts";
pkg.scripts.start = "node --dns-result-order=ipv4first dist/index.js";
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
console.log('Patched package.json');
