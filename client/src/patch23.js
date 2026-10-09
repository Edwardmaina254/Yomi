const fs = require('fs');
let content = fs.readFileSync('app/library/page.tsx', 'utf8');

// Find syncData and replace with pushData
content = content.replace(/const \{ user, syncData \} = useAuth\(\);/, "const { user, pushData } = useAuth();");
content = content.replace(/if \(user\) syncData\(\);/g, "if (user) pushData();");

fs.writeFileSync('app/library/page.tsx', content);
console.log('Patched library page');
