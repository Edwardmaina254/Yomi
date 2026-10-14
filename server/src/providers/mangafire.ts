import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

export interface MangaFireSearchResult {
    id: string;
    title: string;
    image: string;
    description: string;
    type: string;
    status: string;
}

export interface MangaFireChapter {
    id: string;
    title: string;
    chapterNumber: string;
    releaseDate: string;
    lang: string;
}

export interface MangaFireMangaInfo {
    id: string;
    title: string;
    altTitles: string[];
    description: string;
    genres: string[];
    status: string;
    image: string;
    type: string;
    chapters: MangaFireChapter[];
}

export class MangaFireService {
    private browser: any = null;
    private page: any = null;
    private initPromise: Promise<void> | null = null;
    private queue: Promise<any> = Promise.resolve();

    private async ensureInitialized(): Promise<void> {
        if (this.browser && this.page && !this.page.isClosed()) {
            return;
        }

        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = (async () => {
            try {
                console.log('[MangaFire] Initializing headless signer engine...');
                this.browser = await puppeteer.launch({
                    headless: 'new' as any,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage'
                    ]
                });

                this.browser.on('disconnected', () => {
                    console.log('[MangaFire] Browser disconnected, clearing instance.');
                    this.browser = null;
                    this.page = null;
                    this.initPromise = null;
                });

                this.page = await this.browser.newPage();
                await this.page.goto('https://mangafire.to', {
                    waitUntil: 'networkidle2',
                    timeout: 30000
                });

                // Attach fake axios and request signer into browser context
                await this.page.evaluate(async () => {
                    const importModule = new Function('u', 'return import(u)');
                    const poly = await importModule('https://s.mfcdn.nl/build/mf/assets/polyfill-tlfroa-Bq-bHCd3.js');
                    (window as any)._fakeAxios = {
                        interceptors: {
                            request: {
                                use(fn: any) {
                                    (window as any)._fakeAxios.interceptor = fn;
                                }
                            }
                        }
                    };
                    poly.a((window as any)._fakeAxios);

                    (window as any).__apiGet = async (path: string, params: Record<string, any> = {}) => {
                        const config = {
                            url: path,
                            params: { ...params },
                            headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
                        };
                        const signed = await (window as any)._fakeAxios.interceptor(config);
                        const url = new URL(signed.url.startsWith('http') ? signed.url : 'https://mangafire.to' + signed.url);
                        if (signed.params) {
                            Object.entries(signed.params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
                        }
                        const res = await fetch(url.toString(), { headers: signed.headers });
                        if (!res.ok) {
                            const errBody = await res.text();
                            throw new Error(`MangaFire API status ${res.status}: ${errBody}`);
                        }
                        return await res.json();
                    };
                });

                console.log('[MangaFire] Signer engine ready!');
            } catch (err: any) {
                console.error('[MangaFire] Failed to initialize signer engine:', err.message);
                if (this.browser) {
                    try { await this.browser.close(); } catch {}
                }
                this.browser = null;
                this.page = null;
                this.initPromise = null;
                throw err;
            }
        })();

        return this.initPromise;
    }

    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        const next = this.queue.then(async () => {
            await this.ensureInitialized();
            return await task();
        });
        this.queue = next.catch(() => {});
        return next;
    }

    public async search(query: string): Promise<{ results: MangaFireSearchResult[] }> {
        return this.enqueue(async () => {
            try {
                const res = await this.page.evaluate(async (q: string) => {
                    return await (window as any).__apiGet('/api/titles', { keyword: q, limit: 20 });
                }, query);

                const items = res?.items || [];
                const results: MangaFireSearchResult[] = items.map((item: any) => ({
                    id: item.hid,
                    title: item.title,
                    image: item.poster?.large || item.poster?.medium || item.poster?.small || '',
                    description: '',
                    type: item.type || 'manga',
                    status: item.status === 'finished' ? 'Completed' : 'Ongoing'
                }));

                return { results };
            } catch (e: any) {
                console.error('[MangaFire] search error:', e.message);
                return { results: [] };
            }
        });
    }

    public async fetchMangaInfo(mangaId: string): Promise<MangaFireMangaInfo> {
        return this.enqueue(async () => {
            const cleanHid = mangaId.includes('/') ? mangaId.split('/')[0] : (mangaId.includes('.') ? mangaId.split('.').pop()! : mangaId);

            const details = await this.page.evaluate(async (hid: string) => {
                const titleRes = await (window as any).__apiGet(`/api/titles/${hid}`);
                const data = titleRes.data || titleRes;

                // Fetch first page of chapters (limit 200)
                const firstPageRes = await (window as any).__apiGet(`/api/titles/${hid}/chapters`, {
                    language: 'en',
                    limit: 200,
                    page: 1,
                    sort: 'number',
                    order: 'desc'
                });

                let allChapters = [...(firstPageRes.items || [])];
                const lastPage = firstPageRes.meta?.lastPage || 1;

                if (lastPage > 1) {
                    const remainingPages = Array.from({ length: Math.min(lastPage - 1, 15) }, (_, i) => i + 2);
                    const batchResults = await Promise.allSettled(
                        remainingPages.map(p => (window as any).__apiGet(`/api/titles/${hid}/chapters`, {
                            language: 'en',
                            limit: 200,
                            page: p,
                            sort: 'number',
                            order: 'desc'
                        }))
                    );

                    for (const r of batchResults) {
                        if (r.status === 'fulfilled' && r.value?.items) {
                            allChapters = [...allChapters, ...r.value.items];
                        }
                    }
                }

                return { data, chapters: allChapters };
            }, cleanHid);

            const mangaData = details.data || {};
            const chapters: MangaFireChapter[] = (details.chapters || []).map((ch: any) => ({
                id: `${cleanHid}/${ch.id}`,
                title: ch.name ? `Chapter ${ch.number} - ${ch.name}` : `Chapter ${ch.number}`,
                chapterNumber: String(ch.number ?? '0'),
                releaseDate: ch.createdAt ? new Date(ch.createdAt * 1000).toISOString() : new Date().toISOString(),
                lang: ch.language || 'en'
            }));

            return {
                id: cleanHid,
                title: mangaData.title || mangaData.name || cleanHid,
                altTitles: mangaData.altTitles || [],
                description: mangaData.description || mangaData.synopsis || '',
                genres: mangaData.genres?.map((g: any) => g.name || g) || [],
                status: mangaData.status === 'finished' ? 'Completed' : 'Ongoing',
                image: mangaData.poster?.large || mangaData.poster?.medium || mangaData.poster?.small || '',
                type: mangaData.type || 'manga',
                chapters
            };
        });
    }

    public async fetchChapterPages(chapterId: string): Promise<string[]> {
        return this.enqueue(async () => {
            const cleanId = chapterId.includes('/') ? chapterId.split('/').pop()! : chapterId;
            const res = await this.page.evaluate(async (id: string) => {
                return await (window as any).__apiGet(`/api/chapters/${id}`);
            }, cleanId);

            const pages = res?.data?.pages || res?.pages || [];
            return pages.map((p: any) => p.url).filter(Boolean);
        });
    }
}

export const mangaFireService = new MangaFireService();
