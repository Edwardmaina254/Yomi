const { execSync } = require('child_process');
const path = require('path');

const cacheDir = path.resolve(__dirname, '.cache', 'puppeteer');
process.env.PUPPETEER_CACHE_DIR = cacheDir;

console.log('Installing Chrome into local project cache:', cacheDir);
try {
  execSync(`npx puppeteer browsers install chrome --path "${cacheDir}"`, {
    stdio: 'inherit',
    env: process.env
  });
  console.log('Chrome installed successfully into local cache!');
} catch (e) {
  console.error('Failed to install Chrome:', e.message);
}
