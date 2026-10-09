const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  const svg = fs.readFileSync('../client/public/favicon.svg', 'utf8');
  const html = `
    <html>
      <body style="margin:0; padding:0; background:#121212; display:flex; justify-content:center; align-items:center; width:512px; height:512px;">
        <div style="width: 300px; height: 300px; color: #EAB308;">
          \${svg}
        </div>
      </body>
    </html>
  `;
  
  await page.setContent(html);
  await page.setViewport({ width: 512, height: 512 });
  
  await page.screenshot({ path: '../client/public/icon-512x512.png' });
  
  await page.setViewport({ width: 192, height: 192 });
  const html192 = `
    <html>
      <body style="margin:0; padding:0; background:#121212; display:flex; justify-content:center; align-items:center; width:192px; height:192px;">
        <div style="width: 120px; height: 120px; color: #EAB308;">
          \${svg}
        </div>
      </body>
    </html>
  `;
  await page.setContent(html192);
  await page.screenshot({ path: '../client/public/icon-192x192.png' });
  
  await browser.close();
  console.log('Icons generated!');
})();
