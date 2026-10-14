import * as cheerio from 'cheerio';
import { getSharedBrowser } from './browser';

function loadCheerio(html: string) {
    const fn = (cheerio as any).load || (cheerio as any).default?.load || cheerio;
    return fn(html);
}

export interface WeebCentralSearchResult {
    id: string;
    title: string;
    image: string;
    type: string;
}

export interface WeebCentralChapter {
    id: string;
    chapterNumber: string;
    title: string;
    pages: number;
    createdAt: string;
    provider: string;
}

export class WeebCentralService {
    private page: any = null;
    private initPromise: Promise<void> | null = null;
    private queue: Promise<any> = Promise.resolve();
    public lastInitError: string | null = null;

    private async handleCloudflareChallenge(page: any, maxWaitMs = 15000): Promise<boolean> {
        const start = Date.now();
        while (Date.now() - start < maxWaitMs) {
            const title = await page.title().catch(() => '');
            if (!title.toLowerCase().includes('just a moment') && !title.toLowerCase().includes('cloudflare')) {
                return true; // Challenge passed!
            }

            // Attempt to click Turnstile checkbox if visible in an iframe
            try {
                for (const frame of page.frames()) {
                    if (frame.url().includes('challenges.cloudflare.com') || frame.url().includes('turnstile')) {
                        const box = await frame.$('input[type="checkbox"], #challenge-stage, .ctp-checkbox-label');
                        if (box) {
                            console.log('[WeebCentral] Clicking Turnstile checkbox inside frame...');
                            await box.click().catch(() => {});
                        }
                    }
                }
            } catch {}

            await new Promise(r => setTimeout(r, 1000));
        }
        return false;
    }

    private async ensurePage(): Promise<any> {
        if (this.page && !this.page.isClosed()) {
            return this.page;
        }

        if (this.initPromise) {
            await this.initPromise;
            return this.page;
        }

        this.initPromise = (async () => {
            try {
                const browser = await getSharedBrowser();
                this.page = await browser.newPage();
                await this.page.setBypassCSP(true);
                await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

                console.log('[WeebCentral] Navigating to WeebCentral search to acquire CF clearance...');
                await this.page.goto('https://weebcentral.com/search', {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000
                });

                await this.handleCloudflareChallenge(this.page);
                console.log('[WeebCentral] Page ready! Title:', await this.page.title());
                this.lastInitError = null;
            } catch (err: any) {
                console.error('[WeebCentral] Failed to initialize page:', err.message);
                this.lastInitError = err.message || String(err);
                if (this.page && !this.page.isClosed()) {
                    try { await this.page.close(); } catch {}
                }
                this.page = null;
                throw err;
            } finally {
                this.initPromise = null;
            }
        })();

        await this.initPromise;
        return this.page;
    }

    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        const next = this.queue.then(async () => {
            return await task();
        });
        this.queue = next.catch(() => {});
        return next;
    }

    /**
     * Executes an in-page fetch using the active Stealth Puppeteer session.
     */
    public async evaluateFetch(url: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
        return this.enqueue(async () => {
            const page = await this.ensurePage();
            return await page.evaluate(async (targetUrl: string, reqHeaders: Record<string, string>) => {
                const res = await fetch(targetUrl, { headers: reqHeaders });
                const text = await res.text();
                return { status: res.status, text };
            }, url, headers);
        });
    }

    private parseSearchResults(html: string): WeebCentralSearchResult[] {
        const $ = loadCheerio(html);
        return $('article.bg-base-300').map((_: any, el: any) => {
            const link = $(el).find('a[href*="/series/"]').first();
            const href = link.attr('href');
            if (!href) return null;
            const id = href.split('/series/')[1];
            const title = $(el).find('section.hidden.lg\\:block .tooltip a').text().trim() 
                       || $(el).find('section a .text-ellipsis').text().trim()
                       || $(el).find('.text-ellipsis').text().trim()
                       || $(el).find('a[href*="/series/"]').last().text().trim();
            const image = $(el).find('picture source').first().attr('srcset') || $(el).find('picture img').attr('src');
            const typeTip = $(el).find('[data-tip]').attr('data-tip')?.toLowerCase();
            const type = typeTip === 'manhwa' ? 'manhwa' : (typeTip === 'manhua' ? 'manhua' : 'manga');
            return { id, title, image: image || '', type };
        }).get().filter(Boolean);
    }

    public async search(q: string): Promise<{ results: WeebCentralSearchResult[] }> {
        const cleanQ = q.replace(/[^a-zA-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
        const searchUrl = (term: string) => `https://weebcentral.com/search/data?text=${encodeURIComponent(term)}&limit=32&offset=0&display_mode=Full+Display`;

        const fetchTerm = async (term: string): Promise<WeebCentralSearchResult[]> => {
            const url = searchUrl(term);
            const headers: Record<string, string> = {
                'HX-Request': 'true',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://weebcentral.com/search'
            };

            // 1. Try fast direct Node fetch
            try {
                const directRes = await fetch(url, { headers });
                if (directRes.ok) {
                    const text = await directRes.text();
                    const results = this.parseSearchResults(text);
                    if (results.length > 0) return results;
                }
            } catch {}

            // 2. Direct fetch blocked (Cloudflare 403) -> route through Stealth Puppeteer
            try {
                const stealthRes = await this.evaluateFetch(url, headers);
                if (stealthRes.status === 200) {
                    return this.parseSearchResults(stealthRes.text);
                }
            } catch (err: any) {
                console.error('[WeebCentral] Stealth search error:', err.message);
            }

            return [];
        };

        let results = await fetchTerm(cleanQ);
        if (results.length === 0 && cleanQ !== q) {
            results = await fetchTerm(q);
        }
        if (results.length === 0) {
            const words = cleanQ.split(' ').filter(w => w.length > 2);
            if (words.length > 1) {
                const shortQ = words.slice(0, 2).join(' ');
                results = await fetchTerm(shortQ);
            }
        }
        return { results };
    }

    public async fetchMangaInfo(mangaId: string): Promise<{ chapters: WeebCentralChapter[] }> {
        const realId = mangaId.split('/')[0];
        const url = `https://weebcentral.com/series/${realId}/full-chapter-list`;
        const headers: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': `https://weebcentral.com/series/${realId}`
        };

        const extractChapterNumber = (str: string): string => {
            const clean = str.replace(/Chapter\s*/i, '').trim();
            const numMatch = clean.match(/(\d+(?:\.\d+)?)\s*$/) || clean.match(/(\d+(?:\.\d+)?)/);
            return numMatch ? numMatch[1] : clean;
        };

        const parseChapters = (html: string): WeebCentralChapter[] => {
            const chapters: WeebCentralChapter[] = [];
            const regex = /<a href="\/chapters\/([^"]+)"[^>]*>[\s\S]*?<span class="">(.*?)<\/span>/g;
            let match;
            while ((match = regex.exec(html)) !== null) {
                const title = match[2].trim();
                chapters.push({
                    id: match[1],
                    chapterNumber: extractChapterNumber(title),
                    title,
                    pages: 1,
                    createdAt: new Date().toISOString(),
                    provider: 'weebcentral'
                });
            }
            return chapters;
        };

        // 1. Try direct fetch
        try {
            const directRes = await fetch(url, { headers });
            if (directRes.ok) {
                const html = await directRes.text();
                const chapters = parseChapters(html);
                if (chapters.length > 0) return { chapters };
            }
        } catch {}

        // 2. Direct fetch blocked -> Stealth Puppeteer
        try {
            const stealthRes = await this.evaluateFetch(url, headers);
            if (stealthRes.status === 200) {
                const chapters = parseChapters(stealthRes.text);
                return { chapters };
            }
        } catch (err: any) {
            console.error('[WeebCentral] Stealth chapters error:', err.message);
        }

        return { chapters: [] };
    }

    public async fetchChapterPages(chapterId: string): Promise<string[]> {
        const url = `https://weebcentral.com/chapters/${chapterId}/images?is_prev=False&current_page=1&reading_style=long_strip`;
        const headers: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': `https://weebcentral.com/chapters/${chapterId}`
        };

        const parseImages = (html: string): string[] => {
            const images: string[] = [];
            const regex = /<img[^>]+src="([^">]+)"/g;
            let match;
            while ((match = regex.exec(html)) !== null) {
                const imgUrl = match[1];
                if (!imgUrl.includes('brand.png') && !imgUrl.includes('404.png')) {
                    images.push(imgUrl);
                }
            }
            return images;
        };

        // 1. Try direct fetch
        try {
            const directRes = await fetch(url, { headers });
            if (directRes.ok) {
                const html = await directRes.text();
                const images = parseImages(html);
                if (images.length > 0) return images;
            }
        } catch {}

        // 2. Direct fetch blocked -> Stealth Puppeteer
        try {
            const stealthRes = await this.evaluateFetch(url, headers);
            if (stealthRes.status === 200) {
                return parseImages(stealthRes.text);
            }
        } catch (err: any) {
            console.error('[WeebCentral] Stealth scrape error:', err.message);
        }

        return [];
    }
}

export const weebCentralService = new WeebCentralService();
