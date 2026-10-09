const fs = require('fs');
let content = fs.readFileSync('src/app/library/page.tsx', 'utf8');

content = content.replace("const { user, signIn, signOut, syncData } = useAuth();", "const { user, signIn, signOut, syncData, pushData } = useAuth();");

fs.writeFileSync('src/app/library/page.tsx', content);
console.log('Fixed library pushData');
