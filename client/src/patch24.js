const fs = require('fs');
let content = fs.readFileSync('app/page.tsx', 'utf8');

// Add import
content = content.replace('import { AccountButton } from "@/components/AccountBar";', 'import { AccountButton } from "@/components/AccountBar";\nimport { useAuth } from "@/contexts/AuthContext";');

// Add hook inside HomePage
content = content.replace("export default function HomePage() {", "export default function HomePage() {\n  const { user, pushData } = useAuth();");

// Add pushData to onRemove
const onRemoveTarget = `                      setContinueReading(updated);
                      saveContinueReading(updated);
                    }}`;
const onRemoveReplacement = `                      setContinueReading(updated);
                      saveContinueReading(updated);
                      if (user) pushData();
                    }}`;
content = content.replace(onRemoveTarget, onRemoveReplacement);

fs.writeFileSync('app/page.tsx', content);
console.log('Patched page.tsx');
