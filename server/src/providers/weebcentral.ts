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

export interface WeebCentralCatalogItem {
    id: string;
    title: string;
    coverUrl: string;
    synopsis: string;
    provider: 'weebcentral';
    status?: string;
    score?: number;
    type?: string;
    genres?: string[];
    author?: string;
    updatedAt?: string;
}

export interface WeebCentralChapter {
    id: string;
    chapterNumber: string;
    title: string;
    pages: number;
    createdAt: string;
    provider: string;
}

function isCloudflareChallenge(status: number, text: string): boolean {
    if (status === 403 || status === 503) return true;
    if (!text || text.length < 20) return false;
    const lower = text.toLowerCase();
    return lower.includes('just a moment') || lower.includes('cf-mitigated') || lower.includes('challenges.cloudflare.com') || lower.includes('cf-turnstile');
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
            let rawType = $(el).find('strong:contains("Type")').parent().text().trim().toLowerCase();
            if (!rawType) {
                rawType = $(el).find('a[href*="included_type="]').text().trim().toLowerCase() || $(el).text().toLowerCase();
            }
            let type = 'manga';
            if (rawType.includes('manhwa')) type = 'manhwa';
            else if (rawType.includes('manhua')) type = 'manhua';
            else if (rawType.includes('comic') || rawType.includes('oel')) type = 'comic';
            return { id, title, image: image || '', type };
        }).get().filter(Boolean);
    }

    public async search(q: string): Promise<{ results: WeebCentralSearchResult[] }> {
        const cleanQ = q.replace(/[^a-zA-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
        const searchUrl = (term: string) => `https://weebcentral.com/search/data?text=${encodeURIComponent(term)}&limit=32&offset=0&display_mode=Full+Display`;

        const fetchTerm = async (term: string): Promise<{ blocked: boolean; results: WeebCentralSearchResult[] }> => {
            const url = searchUrl(term);
            const headers: Record<string, string> = {
                'HX-Request': 'true',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://weebcentral.com/search'
            };

            // 1. Try fast direct Node fetch
            try {
                const directRes = await fetch(url, { headers });
                const text = await directRes.text();
                if (directRes.ok && !isCloudflareChallenge(directRes.status, text)) {
                    return { blocked: false, results: this.parseSearchResults(text) };
                }
            } catch {}

            // 2. Direct fetch blocked (Cloudflare 403 or challenge) -> route through Stealth Puppeteer
            try {
                const stealthRes = await this.evaluateFetch(url, headers);
                if (stealthRes.status === 200 && !isCloudflareChallenge(stealthRes.status, stealthRes.text)) {
                    return { blocked: false, results: this.parseSearchResults(stealthRes.text) };
                }
            } catch (err: any) {
                console.error('[WeebCentral] Stealth search error:', err.message);
            }

            return { blocked: true, results: [] };
        };

        let { blocked, results } = await fetchTerm(cleanQ);
        if (results.length === 0 && cleanQ !== q && !blocked) {
            const res2 = await fetchTerm(q);
            results = res2.results;
        }
        if (results.length === 0 && !blocked) {
            const words = cleanQ.split(' ').filter(w => w.length > 2);
            if (words.length > 1) {
                const shortQ = words.slice(0, 2).join(' ');
                const res3 = await fetchTerm(shortQ);
                results = res3.results;
            }
        }
        return { results };
    }

    public async getCatalog(options: {
        sort?: 'Popularity' | 'Latest Updates' | 'Subscribers' | 'Recently Added' | 'Alphabet' | 'Best Match';
        order?: 'Descending' | 'Ascending';
        type?: 'Manga' | 'Manhwa' | 'Manhua' | 'OEL';
        limit?: number;
        offset?: number;
    }): Promise<WeebCentralCatalogItem[]> {
        const sort = options.sort || 'Popularity';
        const order = options.order || 'Descending';
        const limit = options.limit || 32;
        const offset = options.offset || 0;
        let url = `https://weebcentral.com/search/data?sort=${encodeURIComponent(sort)}&order=${encodeURIComponent(order)}&display_mode=Full+Display&limit=${limit}&offset=${offset}&adult=False`;
        if (options.type) {
            url += `&included_type=${encodeURIComponent(options.type)}`;
        }

        const headers: Record<string, string> = {
            'HX-Request': 'true',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://weebcentral.com/search'
        };

        const parseCatalogItems = (html: string): WeebCentralCatalogItem[] => {
            const $ = loadCheerio(html);
            const items: WeebCentralCatalogItem[] = [];
            $('article.bg-base-300').each((_: any, el: any) => {
                const link = $(el).find('a[href*="/series/"]').first();
                const href = link.attr('href') || '';
                const idMatch = href.match(/\/series\/([^\/\s]+(?:\/[^\/\s]+)?)/);
                const id = idMatch ? idMatch[1] : href.split('/series/')[1];
                if (!id) return;

                const realId = id.split('/')[0];
                const title = $(el).find('section.hidden.lg\\:block .tooltip a').text().trim() 
                           || $(el).find('section a .text-ellipsis').text().trim()
                           || $(el).find('.text-ellipsis').text().trim()
                           || $(el).find('a[href*="/series/"]').last().text().trim();

                const coverUrl = `https://temp.compsci88.com/cover/normal/${realId}.webp`;

                let rawType = $(el).find('strong:contains("Type")').parent().text().trim().toLowerCase();
                if (!rawType) {
                    rawType = $(el).find('a[href*="included_type="]').text().trim().toLowerCase() || $(el).find('[data-tip]').attr('data-tip')?.toLowerCase() || '';
                }
                let type = 'manga';
                if (rawType.includes('manhwa')) type = 'manhwa';
                else if (rawType.includes('manhua')) type = 'manhua';
                else if (rawType.includes('comic') || rawType.includes('oel')) type = 'comic';

                const status = $(el).find('strong:contains("Status")').parent().find('span, a').first().text().trim() || $(el).find('strong:contains("Status")').next().text().trim() || 'Ongoing';

                const genres: string[] = [];
                $(el).find('strong:contains("Tag(s):")').parent().find('span').each((_: any, span: any) => {
                    const tag = $(span).text().replace(/,/g, '').trim();
                    if (tag && tag !== 'Tag(s):') genres.push(tag);
                });

                const author = $(el).find('strong:contains("Author(s):")').parent().find('a').text().trim();

                items.push({
                    id,
                    title,
                    coverUrl,
                    synopsis: '',
                    provider: 'weebcentral',
                    status,
                    type,
                    genres: Array.from(new Set(genres)),
                    author,
                    updatedAt: new Date().toISOString()
                });
            });
            return items;
        };

        // 1. Direct Node fetch
        try {
            const directRes = await fetch(url, { headers });
            const text = await directRes.text();
            if (directRes.ok && !isCloudflareChallenge(directRes.status, text)) {
                return parseCatalogItems(text);
            }
        } catch {}

        // 2. Direct fetch blocked -> Stealth Puppeteer
        try {
            const stealthRes = await this.evaluateFetch(url, headers);
            if (stealthRes.status === 200 && !isCloudflareChallenge(stealthRes.status, stealthRes.text)) {
                return parseCatalogItems(stealthRes.text);
            }
        } catch (err: any) {
            console.error('[WeebCentral] Stealth catalog error:', err.message);
        }

        return [];
    }

    public async fetchMangaInfo(mangaId: string): Promise<{
        id: string;
        title: string;
        image: string;
        description: string;
        type: string;
        status?: string;
        genres?: string[];
        chapters: WeebCentralChapter[];
    }> {
        const realId = mangaId.split('/')[0];
        const chapterListUrl = `https://weebcentral.com/series/${realId}/full-chapter-list`;
        const seriesUrl = `https://weebcentral.com/series/${realId}`;
        const headers: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': `https://weebcentral.com/series/${realId}`
        };

        const extractChapterNumber = (str: string): string => {
            const sMatch = str.match(/S(?:eason)?\s*(\d+)\s*[-:]\s*(?:Episode|Ep|Chapter|Ch)?\.?\s*([\d.]+)/i);
            if (sMatch) {
                return `S${sMatch[1]}-${sMatch[2]}`;
            }
            const partMatch = str.match(/Part\s*(\d+)\s*[-:]\s*(?:Episode|Ep|Chapter|Ch)?\.?\s*([\d.]+)/i);
            if (partMatch) {
                return `P${partMatch[1]}-${partMatch[2]}`;
            }
            const chMatch = str.match(/(?:Chapter|Ch|Episode|Ep|Punch|Act|Round|Lesson|Stage)\.?\s*([\d.]+)/i);
            if (chMatch) {
                return chMatch[1];
            }
            const numEndMatch = str.match(/(?:^|\s|#)([\d]+(?:\.[\d]+)?)\s*$/);
            if (numEndMatch) {
                return numEndMatch[1];
            }
            const anyNumMatch = str.match(/([\d]+(?:\.[\d]+)?)/);
            if (anyNumMatch) {
                return anyNumMatch[1];
            }
            return str.trim();
        };

        const parseChapters = (html: string): WeebCentralChapter[] => {
            const chapters: WeebCentralChapter[] = [];
            const regex = /<a href="\/chapters\/([^"]+)"[^>]*>[\s\S]*?<span class="">([\s\S]*?)<\/span>[\s\S]*?<time[^>]*datetime="([^"]+)"/g;
            let match;
            while ((match = regex.exec(html)) !== null) {
                const title = match[2].trim();
                chapters.push({
                    id: match[1],
                    chapterNumber: extractChapterNumber(title),
                    title,
                    pages: 1,
                    createdAt: match[3] || new Date().toISOString(),
                    provider: 'weebcentral'
                });
            }
            return chapters;
        };

        const parseSeriesMeta = (html: string) => {
            const $ = loadCheerio(html);
            const ogTitle = $('meta[property="og:title"]').attr('content')?.replace(/\s*\|\s*Weeb\s*Central/i, '').trim();
            const h1Title = $('h1').first().text().trim();
            const title = ogTitle || h1Title || '';
            const image = `https://temp.compsci88.com/cover/normal/${realId}.webp`;

            let description = '';
            $('strong:contains("Description")').each((_: any, el: any) => {
                const parent = $(el).parent();
                const p = parent.find('p').text().trim() || parent.next('p').text().trim() || parent.next().text().trim();
                if (p) description = p;
            });
            if (!description) {
                $('p').each((_: any, el: any) => {
                    const t = $(el).text().trim();
                    if (t.length > 50 && !t.includes('Weeb Central') && !description) {
                        description = t;
                    }
                });
            }

            let note = '';
            $('strong:contains("Note")').each((_: any, el: any) => {
                const p = $(el).parent().text().replace(/\s+/g, ' ').trim();
                if (p && p.length > 5) note = p;
            });
            if (note && description) {
                description = `${description}\n\n[${note}]`;
            } else if (note) {
                description = `[${note}]`;
            }

            let status = 'Ongoing';
            $('strong:contains("Status")').each((_: any, el: any) => {
                const s = $(el).next().text().trim() || $(el).parent().find('span').text().trim();
                if (s) status = s;
            });

            const genres: string[] = [];
            $('strong:contains("Tags(s)")').parent().find('span, a').each((_: any, el: any) => {
                const t = $(el).text().replace(/,/g, '').trim();
                if (t && t !== 'Tags(s):') genres.push(t);
            });

            const typeParent = $('strong:contains("Type")').parent().text().trim().toLowerCase();
            const typeLink = $('a[href*="included_type="]').text().trim().toLowerCase();
            const typeTip = $('section [data-tip]').attr('data-tip')?.toLowerCase();
            let rawType = typeParent || typeLink || typeTip || '';
            let type = 'manga';
            if (rawType.includes('manhwa')) type = 'manhwa';
            else if (rawType.includes('manhua')) type = 'manhua';
            else if (rawType.includes('comic') || rawType.includes('oel')) type = 'comic';

            return { title, image, description, type, status, genres: Array.from(new Set(genres)) };
        };

        let chapters: WeebCentralChapter[] = [];
        let meta = {
            title: '',
            image: `https://temp.compsci88.com/cover/normal/${realId}.webp`,
            description: '',
            type: 'manga',
            status: 'Ongoing',
            genres: [] as string[]
        };

        let needStealth = false;

        // 1. Try direct fetch in parallel
        try {
            const [chRes, metaRes] = await Promise.all([
                fetch(chapterListUrl, { headers }),
                fetch(seriesUrl, { headers })
            ]);
            const chText = await chRes.text();
            const metaText = await metaRes.text();

            if (chRes.ok && !isCloudflareChallenge(chRes.status, chText)) {
                chapters = parseChapters(chText);
            } else {
                needStealth = true;
            }

            if (metaRes.ok && !isCloudflareChallenge(metaRes.status, metaText)) {
                meta = parseSeriesMeta(metaText);
            } else {
                needStealth = true;
            }
        } catch {
            needStealth = true;
        }

        // 2. Only if direct fetch was blocked by Cloudflare -> Stealth Puppeteer in parallel
        if (needStealth) {
            try {
                const [chStealth, metaStealth] = await Promise.all([
                    this.evaluateFetch(chapterListUrl, headers),
                    this.evaluateFetch(seriesUrl, headers)
                ]);
                if (chStealth.status === 200 && !isCloudflareChallenge(chStealth.status, chStealth.text)) {
                    chapters = parseChapters(chStealth.text);
                }
                if (metaStealth.status === 200 && !isCloudflareChallenge(metaStealth.status, metaStealth.text)) {
                    meta = parseSeriesMeta(metaStealth.text);
                }
            } catch (err: any) {
                console.error('[WeebCentral] Stealth chapters/meta error:', err.message);
            }
        }

        return {
            id: mangaId,
            title: meta.title,
            image: meta.image || `https://temp.compsci88.com/cover/normal/${realId}.webp`,
            description: meta.description,
            type: meta.type,
            status: meta.status,
            genres: meta.genres,
            chapters
        };
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
