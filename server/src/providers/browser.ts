import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import fs from 'fs';

puppeteer.use(StealthPlugin());

let sharedBrowser: any = null;
let launchPromise: Promise<any> | null = null;

export function getLocalChromeExecutable(): string | undefined {
    const localDir = path.resolve(process.cwd(), '.cache', 'puppeteer', 'chrome');
    if (!fs.existsSync(localDir)) return undefined;
    
    const findChrome = (dir: string): string | undefined => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                const found = findChrome(fullPath);
                if (found) return found;
            } else if (file === 'chrome' || file === 'chrome.exe' || file === 'chromium' || file === 'chromium.exe') {
                return fullPath;
            }
        }
        return undefined;
    };

    return findChrome(localDir);
}

export async function getSharedBrowser(): Promise<any> {
    if (sharedBrowser && sharedBrowser.isConnected()) {
        return sharedBrowser;
    }
    if (launchPromise) {
        return launchPromise;
    }

    launchPromise = (async () => {
        try {
            const localExe = getLocalChromeExecutable();
            if (localExe) {
                console.log('[BrowserPool] Launching shared Chrome executable:', localExe);
            } else {
                console.log('[BrowserPool] Launching Puppeteer bundled Chrome.');
            }

            const browser = await puppeteer.launch({
                headless: 'new' as any,
                executablePath: localExe,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process'
                ]
            });

            browser.on('disconnected', () => {
                console.log('[BrowserPool] Shared browser disconnected.');
                sharedBrowser = null;
                launchPromise = null;
            });

            sharedBrowser = browser;
            launchPromise = null;
            return browser;
        } catch (err: any) {
            console.error('[BrowserPool] Failed to launch shared browser:', err.message);
            sharedBrowser = null;
            launchPromise = null;
            throw err;
        }
    })();

    return launchPromise;
}
