const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.scripts.dev = "node --dns-result-order=ipv4first ./node_modules/next/dist/bin/next dev --webpack";
pkg.scripts.start = "node --dns-result-order=ipv4first ./node_modules/next/dist/bin/next start";
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
console.log('Patched client package.json');
