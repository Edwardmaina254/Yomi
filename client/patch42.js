const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.scripts.dev = "NODE_OPTIONS='--dns-result-order=ipv4first' next dev --webpack";
pkg.scripts.start = "NODE_OPTIONS='--dns-result-order=ipv4first' next start";
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
console.log('Patched client package.json');
