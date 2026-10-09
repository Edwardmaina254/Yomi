const fs = require('fs');
const manifestPath = 'public/manifest.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.background_color = "#0d1017";
manifest.theme_color = "#0d1017";
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

let content = fs.readFileSync('src/app/layout.tsx', 'utf8');

const targetMetadata = `export const metadata: Metadata = {
  title: "YOMI — read into the night",
  description: "Premium manga, manhwa & comic reader",
  referrer: "no-referrer",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/favicon.svg",
  },
};`;

const replaceMetadata = `export const metadata: Metadata = {
  title: "YOMI — read into the night",
  description: "Premium manga, manhwa & comic reader",
  referrer: "no-referrer",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/icon-192x192.png",
  },
};`;

content = content.replace(targetMetadata, replaceMetadata);
fs.writeFileSync('src/app/layout.tsx', content);
console.log('Patched metadata');
