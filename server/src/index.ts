import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { supabase } from './config/supabase';

dotenv.config();

// Type definitions for MangaDex API response
interface MangaDexChapterData {
    baseUrl: string;
    chapter: {
        hash: string;
        data: string[];
    };
}

interface MangaDexSearchResponse {
    data: Array<{
        id: string;
        attributes: {
            title: { [key: string]: string };
            description: { en?: string };
            year?: number;
            status: string;
        };
        relationships: Array<{
            type: string;
            attributes?: { fileName?: string };
        }>;
    }>;
}

interface MangaDexChaptersResponse {
    data: Array<{
        id: string;
        attributes: {
            chapter: string;
            title?: string;
            pages: number;
            createdAt: string;
        };
    }>;
}

interface MangaDexMangaResponse {
    data: Array<{
        id: string;
        attributes: {
            title: { [key: string]: string };
            description: { en?: string };
            status: string;
            contentRating?: string;
            originalLanguage?: string;
            altTitles?: Array<{ [key: string]: string }>;
        };
        relationships: Array<{
            type: string;
            attributes?: { fileName?: string };
        }>;
    }>;
}

const app = express();
const PORT = process.env.PORT || 5000;

// Allow all origins in development so testing on mobile (local IP) works without CORS errors
app.use(cors({
    origin: '*'
}));
app.use(express.json());

// Proxy endpoint to bypass CORS and hotlinking restrictions
app.get('/health', (req, res) => res.status(200).send('OK'));

app.get('/api/proxy', async (req, res) => {
    let targetUrl = req.query.url as string;
    
    if (!targetUrl) {
        return res.status(400).send('URL is required');
    }

    // Normalize protocol-relative URLs (//example.com/...) to https
    if (targetUrl.startsWith('//')) {
        targetUrl = 'https:' + targetUrl;
    }

    // MangaHere cover CDN uses plain HTTP — upgrade to HTTPS
    if (targetUrl.startsWith('http://fmcdn.mangahere')) {
        targetUrl = targetUrl.replace('http://', 'https://');
    }

    try {

        const parsedUrl = new URL(targetUrl);
        const host = parsedUrl.hostname.toLowerCase();
        const allowedKeywords = [
            'mangadex', 'mangapill', 'readdetectiveconan', 'weebcentral', 'compsci88', 'lastation', 'lowee', 'planeptune', 'leanbox',
            'comick', 'mangahere', 'zjcdn', 'fmcdn', 'webtoon', 'pstatic', 'myanimelist'
        ];
        if (!allowedKeywords.some(keyword => host.includes(keyword))) {
            return res.status(403).send('Forbidden: Domain not in proxy allowlist');
        }

        // Build the correct Referer header per CDN
        let referer = 'https://mangadex.org/';

        if (targetUrl.includes('readdetectiveconan.com') || targetUrl.includes('mangapill.com')) {
            referer = 'https://mangapill.com/';
        } else if (targetUrl.includes('weebcentral.com') || targetUrl.includes('compsci88') || targetUrl.includes('lastation') || targetUrl.includes('lowee') || targetUrl.includes('planeptune') || targetUrl.includes('leanbox')) {
            referer = 'https://weebcentral.com/';
        } else if (targetUrl.includes('comicknew.pictures') || targetUrl.includes('comick')) {
            referer = 'https://comick.io/';
        } else if (targetUrl.includes('mangahere') || targetUrl.includes('zjcdn') || targetUrl.includes('fmcdn')) {
            referer = 'https://www.mangahere.cc/';
        } else if (targetUrl.includes('webtoon') || targetUrl.includes('pstatic.net')) {
            referer = 'https://www.webtoons.com/';
        }

        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': referer,
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            }
        });

        if (!response.ok) {
            console.error(`Proxy upstream error: ${response.status} ${response.statusText} for ${targetUrl} (referer: ${referer})`);
            throw new Error(`Upstream returned ${response.status}`);
        }

        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }
        
        // Cache images heavily
        res.setHeader('Cache-Control', 'public, max-age=31536000');

        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));
    } catch (error: any) {
        console.error(`Proxy error for ${targetUrl}:`, error.message);
        res.status(500).send('Error proxying image');
    }
});

import { MANGA } from '@consumet/extensions';

const getProvider = (name?: string) => {
    switch(name?.toLowerCase()) {
        case 'mangadex': return new MANGA.MangaDex();
        case 'mangapill': return new MANGA.MangaPill();
        case 'mangahere': return new MANGA.MangaHere();
        case 'comick': return new MANGA.ComicK();
        case 'weebcentral': return new MANGA.WeebCentral();
        default: return new MANGA.WeebCentral();
    }
};

// Scrape endpoint (now fetches pages via specified provider)
app.post('/api/scrape', async (req, res) => {
    const { url, provider: providerName, mangaId } = req.body; 
    console.log(`Scrape requested for: ${url} using ${providerName}`);

    try {
        let decodedUrl = url;
        let prevUrl;
        do {
            prevUrl = decodedUrl;
            decodedUrl = decodeURIComponent(decodedUrl);
        } while (decodedUrl !== prevUrl);
        let images: string[] = [];

        if (providerName === 'mangahere') {
            const axios = require('axios');
            const { safeUnpack } = require('@consumet/extensions/dist/utils');
            
            // Build the absolute URL if it doesn't have one
            const target = decodedUrl.startsWith('http') ? decodedUrl : `https://www.mangahere.cc/manga/${decodedUrl}/1.html`;
            
            const response = await axios.get(target, {
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    'Cookie': 'isAdult=1;'
                }
            });
            const html = response.data;
            
            const ss = html.indexOf('eval(function(p,a,c,k,e,d)');
            const se = html.indexOf('</script>', ss);
            if (ss !== -1 && se !== -1) {
                const s = html.substring(ss, se);
                const ds = safeUnpack(s);
                const start = ds.indexOf('var newImgs=') + 12;
                const end = ds.indexOf(';', start);
                const arrStr = ds.substring(start, end);
                
                // Clean the array string: strip brackets, slashes, and quotes
                const rawUrls = arrStr.replace(/[\[\]\\'"]/g, '').split(',');
                images = Array.from(new Set(rawUrls.map((u: string) => {
                    const cleanU = u.trim();
                    if (cleanU.startsWith('//')) return 'https:' + cleanU;
                    if (cleanU.startsWith('http')) return cleanU;
                    return 'https://' + cleanU;
                })));
            }
            if (images.length === 0) {
                throw new Error('Failed to unpack MangaHere images');
            }
        } else if (providerName === 'mangadex') {
            const mdexRes = await fetch(`https://api.mangadex.org/at-home/server/${decodedUrl}`);
            const mdexJson: any = await mdexRes.json();
            if (mdexJson.result === 'ok') {
                images = mdexJson.chapter.data.map((f: string) => `${mdexJson.baseUrl}/data/${mdexJson.chapter.hash}/${f}`);
            } else {
                throw new Error('MangaDex returned error: ' + JSON.stringify(mdexJson.errors));
            }
        } else if (providerName === 'weebcentral') {
            const wcRes = await fetch(`https://weebcentral.com/chapters/${decodedUrl}/images?is_prev=False&current_page=1&reading_style=long_strip`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': `https://weebcentral.com/chapters/${decodedUrl}`
                }
            });
            const html = await wcRes.text();
            const regex = /<img[^>]+src="([^">]+)"/g;
            let match;
            while ((match = regex.exec(html)) !== null) {
                const url = match[1];
                if (!url.includes('brand.png') && !url.includes('404.png')) {
                    images.push(url);
                }
            }
        } else {
            const provider = getProvider(providerName);
            const pages = await provider.fetchChapterPages(decodedUrl);
            images = Array.from(new Set(pages.map(page => page.img)));
        }

        if (images.some(img => img.includes('404.png') || img.includes('brand.png'))) {
            throw new Error('Chapter not found on this provider. The chapter ID may be invalid or outdated.');
        }
        
        return res.json({ images });
    } catch (error: any) {
        console.error('Scraping error:', error.message);
        res.status(500).json({ error: 'Failed to scrape chapter' });
    }
});

const detectType = (manga: any): string => {
    // 1. Direct explicit original language (e.g. MangaDex, AniList, AL/MAL)
    const lang = manga.originalLanguage || manga.attributes?.originalLanguage;
    if (lang === 'ja') return 'manga';
    if (lang === 'ko') return 'manhwa';
    if (lang === 'zh' || lang === 'zh-hk') return 'manhua';
    if (lang === 'en') return 'comic';

    // 2. WeebCentral data-tip or tag
    if (manga.type && typeof manga.type === 'string') {
        const t = manga.type.toLowerCase();
        if (t === 'manhwa' || t === 'manhua' || t === 'comic' || t === 'manga') return t;
    }

    // 3. Scan native Japanese text (Hiragana/Katakana) — Japanese manga ALWAYS have Kana!
    const textToScan = [
        typeof manga.title === 'string' ? manga.title : '',
        manga.title?.native || '',
        manga.title?.ja || '',
        manga.title?.romaji || '',
        ...(manga.altTitles || []).flatMap((t: any) => Object.values(t))
    ].join(' ');

    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(textToScan)) return 'manga';

    // 4. Korean Hangul in the primary title ONLY if there is no Japanese
    const titleOnly = typeof manga.title === 'string' ? manga.title : (manga.title?.en || '');
    if (/[\uAC00-\uD7AF]/.test(titleOnly)) return 'manhwa';
    if (/[\u4E00-\u9FFF]/.test(titleOnly)) return 'manhua';

    // 5. Check if tags specify format
    if (manga.tags && Array.isArray(manga.tags)) {
        if (manga.tags.some((t: any) => t?.attributes?.name?.en === 'Web Comic' || t?.attributes?.name?.en === 'Long Strip')) {
            if (lang !== 'ja') return 'manhwa';
        }
    }

    return 'manga';
};

// Helper: normalize a consumet result to our standard shape
const normalizeResult = (manga: any, providerName: string) => {
    let title = 'Unknown';
    if (typeof manga.title === 'string') {
        title = manga.title;
    } else if (manga.title && typeof manga.title === 'object') {
        title = manga.title.en || manga.title.romaji || manga.title.english || manga.title[Object.keys(manga.title)[0]] || 'Unknown';
    }
    
    if (typeof title !== 'string') {
        title = String(title);
    }

    return {
        id: manga.id,
        title: title,
        coverUrl: manga.image,
        synopsis: extractString(manga.description),
        status: manga.status,
        contentRating: manga.contentRating || (manga.isAdult ? 'adult' : 'safe'),
        provider: providerName,
        type: detectType(manga),
        score: manga.score || manga.rating || undefined,
    };
};

const isNSFW = (m: any) => {
    const r = (m.contentRating || '').toLowerCase();
    if (r === 'erotica' || r === 'pornographic' || r === 'adult') return true;
    const t = (m.title || '').toLowerCase();
    if (t.includes('sex') || t.includes('porn') || t.includes('hentai') || t.includes('smut')) return true;
    return false;
};

// Helper to extract string from multi-language title/description objects
// Helper for blazing fast native WeebCentral search to prevent 6s cold starts
async function nativeSearchWeebCentral(q: string) {
    const cleanQ = q.replace(/[^a-zA-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    const searchUrl = (term: string) => `https://weebcentral.com/search/data?text=${encodeURIComponent(term)}&limit=32&offset=0&display_mode=Full+Display`;
    
    const fetchTerm = async (term: string) => {
        try {
            const res = await fetch(searchUrl(term), {
                headers: {
                    'HX-Request': 'true',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://weebcentral.com/search'
                }
            });
            if (!res.ok) return [];
            const t = await res.text();
            const cheerio = require('cheerio');
            const $ = cheerio.load(t);
            return $('article.bg-base-300').map((i: any, el: any) => {
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
                return { id, title, image, type };
            }).get().filter(Boolean);
        } catch (e: any) {
            console.error('WeebCentral search error:', e.message);
            return [];
        }
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

async function nativeFetchWeebCentralChapters(mangaId: string) {
    const realId = mangaId.split('/')[0];
    const res = await fetch(`https://weebcentral.com/series/${realId}/full-chapter-list`, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': `https://weebcentral.com/series/${realId}`
        }
    });
    if (!res.ok) return { chapters: [] };
    const html = await res.text();
    const chapters = [];
    const regex = /<a href="\/chapters\/([^"]+)"[^>]*>[\s\S]*?<span class="">(.*?)<\/span>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
        chapters.push({
            id: match[1],
            chapterNumber: match[2].replace('Chapter ', '').trim(),
            title: match[2].trim(),
            pages: 1,
            createdAt: new Date().toISOString(),
            provider: 'weebcentral'
        });
    }
    return { chapters };
}

const extractString = (val: any): string => {
    if (!val) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'object') {
        return val.en || val.ko || val[Object.keys(val)[0]] || '';
    }
    return String(val);
};

const extractMangaDex = (d: any) => {
    const attr = d.attributes;
    const getEn = (obj: any, arr?: any[]) => {
        if (arr) {
            const enObj = arr.find((x: any) => x.en);
            if (enObj) return enObj.en;
        }
        if (obj) {
            if (typeof obj === 'string') return obj;
            return obj.en || obj[Object.keys(obj)[0]] || '';
        }
        return '';
    };

    const title = getEn(attr.title, attr.altTitles);
    const desc = getEn(attr.description);
    
    const coverRel = d.relationships?.find((r: any) => r.type === 'cover_art');
    const coverFile = coverRel?.attributes?.fileName;
    const coverUrl = coverFile ? `https://uploads.mangadex.org/covers/${d.id}/${coverFile}.256.jpg` : null;

    return {
        id: d.id,
        title: title,
        coverUrl: coverUrl,
        synopsis: desc,
        status: attr.status,
        contentRating: attr.contentRating || 'safe',
        provider: 'mangadex',
        type: attr.originalLanguage === 'ko' ? 'manhwa' : attr.originalLanguage === 'zh' ? 'manhua' : 'manga',
        score: undefined,
        updatedAt: attr.updatedAt,
    };
};

import NodeCache from 'node-cache';


const cache = new NodeCache({ stdTTL: 300 }); // 5 minutes cache

// Helper to safely fetch from MangaDex API with retry logic for 429 Rate Limits
const fetchMangaDex = async (url: string, retries = 3): Promise<any> => {
    for (let i = 0; i < retries; i++) {
        const resp = await fetch(url);
        if (resp.status === 429) {
            console.log(`[Rate Limit] MangaDex 429, retrying in ${1500 * (i + 1)}ms...`);
            await new Promise(r => setTimeout(r, 1500 * (i + 1)));
            continue;
        }
        if (!resp.ok) throw new Error(`MangaDex returned ${resp.status}`);
        return resp.json();
    }
    throw new Error('MangaDex rate limit exceeded after retries');
};

// Trending / Popular titles
app.get('/api/trending', async (req, res) => {
    const type = req.query.type as string || 'manga';
    const timeframe = req.query.timeframe as string || 'month';
    const cacheKey = `trending-${type}-${timeframe}`;
    if (cache.has(cacheKey) && !req.query.nocache) {
        return res.json(cache.get(cacheKey));
    }

    try {
        let langQuery = 'originalLanguage[]=ja';
        if (type === 'manhwa') langQuery = 'originalLanguage[]=ko&originalLanguage[]=zh';
        if (type === 'comic') langQuery = 'originalLanguage[]=en';

        // Trending timeframe: filter to titles created within the window
        // (week / month / year) so the shelf reflects what's blowing up now.
        const date = new Date();
        if (timeframe === 'day') date.setDate(date.getDate() - 1);
        else if (timeframe === 'week') date.setDate(date.getDate() - 7);
        else if (timeframe === 'year') date.setFullYear(date.getFullYear() - 1);
        else date.setMonth(date.getMonth() - 1);
        const sinceStr = date.toISOString().split('.')[0]; // YYYY-MM-DDTHH:mm:ss
        
        // For "day", there are rarely any brand new safe manga added that have chapters yet.
        // So we use updatedAtSince to show the most popular manga that updated today.
        const dateParam = timeframe === 'day' ? 'updatedAtSince' : 'createdAtSince';

        // STRICT NSFW FILTER: MangaDex returns 'suggestive' and 'erotica' by default unless we strictly specify 'safe'
        const data = await fetchMangaDex(`https://api.mangadex.org/manga?includes[]=cover_art&order[followedCount]=desc&limit=30&hasAvailableChapters=true&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&${dateParam}=${encodeURIComponent(sinceStr)}&${langQuery}`);
        const results = data.data.map(extractMangaDex).filter((m: any) => !isNSFW(m));
        
        const payload = { results: results.slice(0, 30) };
        cache.set(cacheKey, payload);
        res.json(payload);
    } catch (e: any) {
        console.error('Trending error:', e.message);
        res.status(500).json({ error: 'Failed to fetch trending' });
    }
});

// Latest updated titles
app.get('/api/latest', async (req, res) => {
    const type = req.query.type as string || 'manga';
    const cacheKey = `latest-${type}`;
    if (cache.has(cacheKey) && !req.query.nocache) {
        return res.json(cache.get(cacheKey));
    }

    try {
        let langQuery = 'originalLanguage[]=ja';
        if (type === 'manhwa') langQuery = 'originalLanguage[]=ko&originalLanguage[]=zh';
        if (type === 'comic') langQuery = 'originalLanguage[]=en';

        const data = await fetchMangaDex(`https://api.mangadex.org/manga?includes[]=cover_art&order[updatedAt]=desc&limit=30&hasAvailableChapters=true&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&${langQuery}`);
        const results = data.data.map(extractMangaDex).filter((m: any) => !isNSFW(m));
        
        const payload = { results: results.slice(0, 30) };
        cache.set(cacheKey, payload);
        res.json(payload);
    } catch (e: any) {
        console.error('Latest error:', e.message);
        res.status(500).json({ error: 'Failed to fetch latest' });
    }
});

// Search endpoint (now searches all providers in parallel!)
app.get('/api/similar', async (req, res) => {
    const title = req.query.title as string;
    if (!title) {
        return res.status(400).json({ error: 'Title is required' });
    }
    
    const cacheKey = `similar-${title.toLowerCase()}`;
    if (cache.has(cacheKey)) {
        return res.json(cache.get(cacheKey));
    }

    try {
        const { META } = require('@consumet/extensions');
        const anilist = new META.Anilist.Manga();
        
        const searchResp = await anilist.search(title);
        if (!searchResp.results || searchResp.results.length === 0) {
            return res.json({ results: [] });
        }
        
        const mangaInfo = await anilist.fetchMangaInfo(searchResp.results[0].id);
        const recommendations = mangaInfo.recommendations || [];
        
        const results = recommendations.map((r: any) => ({
            id: r.id.toString(),
            title: typeof r.title === 'string' ? r.title : (r.title.en || r.title.english || r.title.romaji || r.title.userPreferred || 'Unknown'),
            coverUrl: r.cover || r.image,
            provider: 'anilist',
            type: r.type?.toLowerCase() || 'manga'
        })).slice(0, 20);

        cache.set(cacheKey, { results });
        res.json({ results });
    } catch (e: any) {
        console.error('Similar error:', e.message);
        res.status(500).json({ error: 'Failed to fetch similar titles' });
    }
});

app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    if (!q) {
        return res.json({ results: [] });
    }

    // EXTREME SPEED ARCHITECTURE: Only search MangaDex and ComicK for metadata.
    // The backend gracefully falls back to WeebCentral/MangaHere internally when chapters are requested!
    const providers = [
        { name: 'weebcentral', instance: new MANGA.WeebCentral() },
        { name: 'comick', instance: createComicK() },
        { name: 'mangadex', instance: new MANGA.MangaDex() },
        { name: 'mangapill', instance: new MANGA.MangaPill() }
    ];

    try {
        const promises = providers.map(p => {
            let searchPromise;
            if (p.name === 'mangadex') {
                searchPromise = fetch(`https://api.mangadex.org/manga?title=${encodeURIComponent(q as string)}&limit=24&includes[]=cover_art`)
                    .then(r => r.json())
                    .then((r: any) => {
                        return {
                            providerName: 'mangadex',
                            data: {
                                results: (r.data || []).map((m: any) => {
                                    const titleObj = m.attributes.title || {};
                                    const titleStr = titleObj.en || titleObj['ja-ro'] || Object.values(titleObj)[0] || '';
                                    const coverRel = m.relationships.find((rel: any) => rel.type === 'cover_art');
                                    const coverFile = coverRel?.attributes?.fileName;
                                    const coverUrl = coverFile ? `https://uploads.mangadex.org/covers/${m.id}/${coverFile}.256.jpg` : '';
                                    
                                    return {
                                        id: m.id,
                                        title: titleStr,
                                        image: coverUrl,
                                        description: m.attributes.description?.en || Object.values(m.attributes.description || {})[0] || '',
                                        status: m.attributes.status,
                                        contentRating: m.attributes.contentRating,
                                        altTitles: m.attributes.altTitles || []
                                    };
                                })
                            }
                        };
                    });
            } else if (p.name === 'weebcentral') {
                searchPromise = nativeSearchWeebCentral(q as string).then(data => ({ providerName: 'weebcentral', data }));
            } else {
                searchPromise = p.instance.search(q as string).then(data => ({ providerName: p.name, data }));
            }
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Provider timeout')), 7000));
            return Promise.race([searchPromise, timeoutPromise]);
        });

        const settled = await Promise.allSettled(promises);
        
        let allResults: any[] = [];

        settled.forEach(result => {
            if (result.status === 'fulfilled' && (result.value as any).data?.results) {
                const mapped = (result.value as any).data.results.map((manga: any) => ({
                    id: manga.id,
                    title: extractString(manga.title),
                    coverUrl: manga.image,
                    synopsis: extractString(manga.description),
                    status: manga.status,
                    contentRating: manga.contentRating || (manga.isAdult ? 'adult' : 'safe'),
                    provider: (result.value as any).providerName,
                    type: detectType(manga)
                }));
                allResults = [...allResults, ...mapped];
            }
        });

        const groups: any[][] = [];
                const sanitizeTitle = (title: string) => title.toLowerCase().replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').replace(/['’]s/g, ' ').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();

        allResults.forEach(manga => {
            const titleLower = sanitizeTitle(manga.title);
            // Find an existing group for this exact title. 
            // We ignore provider uniqueness to aggressively deduplicate exact matches (e.g. ComicK returning multiple Ordeals)
            let group = groups.find(g => sanitizeTitle(g[0].title) === titleLower);

            if (group) {
                group.push(manga);
            } else {
                groups.push([manga]);
            }
        });

        let finalResults = groups.map(group => {
            const order: Record<string, number> = { 'weebcentral': 5, 'comick': 4, 'mangadex': 3, 'mangapill': 2, 'mangahere': 1 };
            group.sort((a, b) => (order[b.provider] || 0) - (order[a.provider] || 0));
            
            const best = group[0];
            const bestType = group.find(m => m.type && m.type !== 'manga' && m.type !== 'comic')?.type || best.type;
            best.type = bestType;
            return best;
        });

        // 1. NSFW Filter
        finalResults = finalResults.filter(m => {
            const rating = m.contentRating?.toLowerCase() || '';
            const status = m.status?.toLowerCase() || '';
            if (rating === 'pornographic' || status === 'pornographic') return false;
            
            const titleLower = m.title.toLowerCase();
            if (titleLower.includes('sex') || titleLower.includes('porn') || titleLower.includes('hentai')) return false;
            
            return true;
        });

        // 2. Keyword Filter (Permissive)
        // Split the search query into words (ignoring punctuation) and ensure every word is in the title.
        // This allows searches like "jojo bizarre" to match "JoJo's Bizarre Adventure".
        const searchTerms = (q as string).toLowerCase().replace(/[:\-’']/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
        finalResults = finalResults.filter(m => {
            const titleRaw = m.title.toLowerCase().replace(/[:\-’']/g, ' ').replace(/\s+/g, ' ').trim();
            return searchTerms.every(term => titleRaw.includes(term));
        });

        // 3. Relevance Sort
        const qLower = (q as string).toLowerCase();
        finalResults.sort((a, b) => {
            const aTitle = a.title.toLowerCase();
            const bTitle = b.title.toLowerCase();
            
            // Exact match gets highest priority
            if (aTitle === qLower && bTitle !== qLower) return -1;
            if (aTitle !== qLower && bTitle === qLower) return 1;
            
            // Starts with gets second priority
            const aStarts = aTitle.startsWith(qLower);
            const bStarts = bTitle.startsWith(qLower);
            if (aStarts && !bStarts) return -1;
            if (!aStarts && bStarts) return 1;
            
            return 0;
        });

        res.json({ results: finalResults });
    } catch (error: any) {
        console.error('Search fetch error:', error.message);
        res.status(500).json({ error: 'Failed to search across providers' });
    }
});

const createComicK = () => {
    const i = new MANGA.ComicK();
    (i as any).fetchMangaInfo = async (mangaId: string) => {
        const cleanId = mangaId.split('/')[0];
        let data: any;
        try {
            data = await (i as any).getComicData(cleanId);
        } catch {
            const res = await fetch(`https://comick.art/comic/${cleanId}`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
            });
            const html = await res.text();
            const cheerio = require('cheerio');
            const $ = cheerio.load(html);
            data = JSON.parse($("script[id='comic-data']").text());
        }
        
        const slug = data?.comic?.slug || data?.slug || cleanId;
        const comicObj = data?.comic || data || {};
        const mangaInfo = {
            id: slug,
            title: comicObj.title || cleanId,
            altTitles: comicObj.md_titles || [],
            description: comicObj.desc || '',
            genres: comicObj.md_comic_md_genres?.map((g: any) => g.md_genres?.name).filter(Boolean) || [],
            status: comicObj.status === 1 ? 'Ongoing' : 'Completed',
            image: comicObj.default_thumbnail || `https://cdn2.comicknew.pictures/${slug}/covers/${comicObj.md_covers?.[0]?.bkey || ''}.webp`,
            malId: comicObj.links?.mal,
            chapters: [] as any[],
        };

        // Fetch all chapter pages in parallel batches (up to 40 pages = 2400 chapters!)
        const pageBatches = [
            Array.from({ length: 15 }, (_, idx) => idx + 1),
            Array.from({ length: 15 }, (_, idx) => idx + 16),
            Array.from({ length: 15 }, (_, idx) => idx + 31)
        ];

        const seenHids = new Set<string>();
        const seenChapters = new Set<string>();

        for (const batch of pageBatches) {
            let foundInBatch = 0;
            const batchResults = await Promise.allSettled(
                batch.map(p => fetch(`https://comick.art/api/comics/${slug}/chapter-list?page=${p}`, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
                }).then(r => r.json()).then((j: any) => j.data || []))
            );

            for (const res of batchResults) {
                if (res.status === 'fulfilled' && Array.isArray(res.value)) {
                    for (const ch of res.value) {
                        if (ch.lang === 'en' && !seenHids.has(ch.hid)) {
                            seenHids.add(ch.hid);
                            const chapNum = String(ch.chap ?? '0');
                            if (!seenChapters.has(chapNum)) {
                                seenChapters.add(chapNum);
                                foundInBatch++;
                                mangaInfo.chapters.push({
                                    id: `${slug}/${ch.hid}-chapter-${ch.chap}-en`,
                                    title: ch.title ? `Chapter ${ch.chap} - ${ch.title}` : `Chapter ${ch.chap}`,
                                    chapterNumber: chapNum,
                                    volumeNumber: ch.vol,
                                    releaseDate: ch.created_at,
                                    lang: ch.lang,
                                });
                            }
                        }
                    }
                }
            }

            if (foundInBatch === 0) break;
        }

        mangaInfo.chapters.sort((a, b) => parseFloat(b.chapterNumber || '0') - parseFloat(a.chapterNumber || '0'));
        return mangaInfo;
    };
    return i;
};

const FALLBACK_PROVIDERS = [
    { name: 'weebcentral', instance: () => new MANGA.WeebCentral() },
    { name: 'comick', instance: createComicK },
    { name: 'mangapill', instance: () => new MANGA.MangaPill() },
    { name: 'mangadex', instance: () => new MANGA.MangaDex() }
];

const mapChapters = (data: any, resolvedProvider: string) => ({
    manga: {
        id: data.id,
        title: data.title,
        coverUrl: data.image,
        synopsis: data.description || '',
        type: detectType(data),
        resolvedProvider,
    },
    chapters: (() => {
        const mapped = (data.chapters || []).map((chapter: any) => {
            let chapNum = chapter.chapterNumber;
            if (!chapNum && chapter.title) {
                const sMatch = chapter.title.match(/S(\d+)\s*-\s*(?:Episode|Ep|Chapter|Ch)\.?\s*([\d.]+)/i);
                if (sMatch) {
                    chapNum = `S${sMatch[1]}-${sMatch[2]}`;
                } else {
                    const match = chapter.title.match(/(?:Episode|Ep|Chapter|Ch)\.?\s*([\d.]+)/i);
                    if (match) {
                        chapNum = match[1];
                    } else {
                        const fallbackMatch = chapter.title.match(/[\d.]+/);
                        chapNum = fallbackMatch ? fallbackMatch[0] : '0';
                    }
                }
            }
            // Normalize chapter numbers: strip leading dots and zeros (.023 → 23, 001 → 1)
            if (chapNum && typeof chapNum === 'string') {
                if (!chapNum.startsWith('S')) {
                    chapNum = chapNum.replace(/^\./, ''); // strip leading dot
                    chapNum = String(parseFloat(chapNum) || 0); // normalize 023 → 23
                }
            }
            const displayTitle = chapter.title
                ? chapter.title.replace(/^Ch\.0*/, 'Chapter ').replace(/^Chapter (\d)/, 'Chapter $1')
                : `Chapter ${chapNum || '0'}`;
            return {
                id: chapter.id,
                chapterNumber: chapNum || '0',
                title: displayTitle,
                pages: 0,
                createdAt: chapter.releaseDate || new Date().toISOString(),
                provider: resolvedProvider,
            };
        });
        // Deduplicate by chapter number — keep only the first occurrence
        // (providers like ComicK return multiple groups for the same chapter)
        const seen = new Set<string>();
        return mapped.filter((ch: any) => {
            if (seen.has(ch.chapterNumber)) return false;
            seen.add(ch.chapterNumber);
            return true;
        });
    })()
});

// Chapters endpoint — with cross-provider fallback for maximum chapter coverage
app.get(['/api/manga/:id/chapters', '/api/manga/:id/:sub/chapters', '/api/manga/*/chapters'], async (req, res) => {
    const { provider: providerName, title: reqTitle } = req.query;
    const fullId = req.originalUrl.split('/api/manga/')[1].split('/chapters')[0];
    const decodedId = decodeURIComponent(fullId);

    const cacheKey = `chapters-${providerName}-${decodedId}`;
    if (cache.has(cacheKey)) {
        return res.json(cache.get(cacheKey));
    }

    const provider = getProvider(providerName as string);

    try {

        let searchTitle = (reqTitle as string) || decodedId;
        const providerSearchQuery = searchTitle.replace(/[:\-’']/g, ' ').replace(/\s+/g, ' ').trim();

        const getSimilarity = (str1: string, str2: string) => {
            const set1 = new Set(str1.split(' ').filter(Boolean));
            const set2 = new Set(str2.split(' ').filter(Boolean));
            if (set1.size === 0 || set2.size === 0) return 0;
            const intersection = new Set([...set1].filter(x => set2.has(x)));
            return intersection.size / Math.max(set1.size, set2.size);
        };


        // PARALLEL EXECUTION: Start the primary provider and fallbacks at the EXACT SAME TIME!
        let dataPromise = providerName === 'weebcentral' 
            ? nativeFetchWeebCentralChapters(decodedId).catch((e: any) => {
                console.error(`Primary provider WeebCentral failed:`, e.message);
                return { title: decodedId, chapters: [] } as any;
            })
            : provider.fetchMangaInfo(decodedId).catch((e: any) => {
                console.error(`Primary provider ${providerName} failed:`, e.message);
                return { title: decodedId, chapters: [] } as any;
            });

        let externalIdsPromise = Promise.resolve(new Set());
        let mdexInfoPromise: Promise<any> = Promise.resolve(null);
        if (providerName === 'mangadex') {
            mdexInfoPromise = fetch(`https://api.mangadex.org/manga/${decodedId}`).then(r => r.json()).catch(() => null);
            externalIdsPromise = (async () => {
                const ext = new Set();
                try {
                    let offset = 0;
                    const limit = 500;
                    // Limit to 2 pages (1000 chapters) to save time
                    for (let i = 0; i < 2; i++) {
                        const feedRes = await fetchMangaDex(`https://api.mangadex.org/manga/${decodedId}/feed?limit=${limit}&offset=${offset}&translatedLanguage[]=en`);
                        const items = feedRes.data || [];
                        for (const c of items) {
                            if (c.attributes && c.attributes.externalUrl) ext.add(c.id);
                        }
                        if (items.length < limit) break;
                        offset += limit;
                    }
                } catch (e: any) {
                    console.error('Failed to filter mangadex external chapters:', e.message);
                }
                return ext;
            })();
        }

        // We can only pre-fetch fallbacks in parallel if we ACTUALLY KNOW the title!
        // If reqTitle is undefined, searchTitle is just the UUID. Searching providers for a UUID will always fail.
        let fallbackPromises: Promise<any>[] = [];
        let fallbackResultsRaw: any[] = [];
        const canParallelizeFallbacks = providerName === 'mangadex' && !!reqTitle;

        if (canParallelizeFallbacks) {
            console.log(`[Chapters] Primary is mangadex AND we have title. Pre-fetching fallbacks in parallel for "${searchTitle}"...`);
            fallbackPromises = FALLBACK_PROVIDERS.map(async (p) => {
                try {
                    let searchResults = p.name === 'weebcentral' ? await nativeSearchWeebCentral(providerSearchQuery) : await p.instance().search(providerSearchQuery);
                    if (!searchResults.results?.length) {
                        const shortQuery = searchTitle.split(/[^\w]/).filter(Boolean).slice(0, 4).join(' ');
                        if (shortQuery.length > 3) searchResults = p.name === 'weebcentral' ? await nativeSearchWeebCentral(shortQuery) : await p.instance().search(shortQuery);
                    }
                    if (!searchResults.results?.length) return null;
                    
                    const searchTitleLower = searchTitle.toLowerCase();
                    const cleanSearch = searchTitleLower.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

                    const best = searchResults.results.find((r: any) => {
                        const titlesToCheck = [r.title];
                        if (r.altTitles && Array.isArray(r.altTitles)) {
                            titlesToCheck.push(...r.altTitles.map((at: any) => typeof at === 'string' ? at : at.en || at.ko || at.ja || Object.values(at)[0]));
                        }
                        
                        for (let raw of titlesToCheck) {
                            if (!raw) continue;
                            const t = typeof raw === 'string' ? raw : (raw.en || '');
                            const cleanT = t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
                            if (cleanT.includes(cleanSearch) || cleanSearch.includes(cleanT)) return true;
                            
                            const sim = getSimilarity(cleanT, cleanSearch);
                            if (sim > 0.6) return true;
                        }
                        return false;
                    });
                    
                    if (!best) return null;
                    const mangaData = p.name === 'weebcentral' ? await nativeFetchWeebCentralChapters(best.id) : await p.instance().search(providerSearchQuery).then(() => p.instance().fetchMangaInfo(best.id));
                    return { provider: p.name, data: mangaData };
                } catch (e: any) {
                    return null;
                }
            });
        }

        // Wait for whatever parallel tasks we launched
        let primaryData, extSet, mdexInfo: any;
        if (canParallelizeFallbacks) {
            [primaryData, extSet, fallbackResultsRaw, mdexInfo] = await Promise.all([
                dataPromise,
                externalIdsPromise,
                Promise.all(fallbackPromises),
                mdexInfoPromise
            ]);
        } else {
            [primaryData, extSet, mdexInfo] = await Promise.all([
                dataPromise,
                externalIdsPromise,
                mdexInfoPromise
            ]);
        }

        let data = primaryData;
        if (mdexInfo?.data?.attributes) {
            const attrs = mdexInfo.data.attributes;
            if (attrs.originalLanguage === 'ko') data.type = 'manhwa';
            else if (attrs.originalLanguage === 'zh') data.type = 'manhua';
            else if (attrs.originalLanguage === 'ja') data.type = 'manga';
            else if (attrs.tags?.some((t: any) => t.attributes?.name?.en === 'Long Strip' || t.attributes?.name?.en === 'Web Comic')) data.type = 'manhwa';
            else data.type = 'comic';
        }
        if (extSet.size > 0) {
            data.chapters = (data.chapters || []).filter((c: any) => !extSet.has(c.id));
        }

        let chapters = (data.chapters || []).filter((c: any) => c.pages !== 0);
        
        // NOW we can update searchTitle using the freshly fetched data if we didn't have it!
        if (!reqTitle) {
            if (data.title && typeof data.title === 'string') {
                searchTitle = data.title;
            } else if (data.title && (data.title as any).en) {
                searchTitle = (data.title as any).en;
            } else if (data.altTitles && Array.isArray(data.altTitles)) {
                const enObj = data.altTitles.find((t: any) => t.en);
                if (enObj) searchTitle = enObj.en;
                else if (data.altTitles.length > 0) {
                    const first = data.altTitles[0];
                    searchTitle = first.en || first.ko || first[Object.keys(first)[0]] || searchTitle;
                }
            }
        }
        if (!searchTitle || searchTitle === decodedId) searchTitle = reqTitle as string || decodedId;

        // Fast path ONLY for WeebCentral since it has reliable images (Comick images are blocked by Cloudflare)
        if (providerName === 'weebcentral' && chapters.length > 0) {
            console.log(`[Chapters] FAST PATH: WeebCentral returned ${chapters.length} chapters.`);
            const payload = mapChapters(data, providerName as string);
            cache.set(cacheKey, payload);
            return res.json(payload);
        }

        // Run sequential fallbacks for MangaDex and Comick (to fetch WeebCentral's working images)
        if (fallbackPromises.length === 0) {
            console.log(`[Chapters] Running sequential fallbacks for "${searchTitle}"...`);
            
            // Recompute the providerSearchQuery using the freshly extracted searchTitle
            const seqProviderSearchQuery = searchTitle.replace(/[:\-’']/g, ' ').replace(/\s+/g, ' ').trim();
            
            const seqFallbackPromises = FALLBACK_PROVIDERS.map(async (p) => {
                try {
                    let searchResults = p.name === 'weebcentral' ? await nativeSearchWeebCentral(seqProviderSearchQuery) : await p.instance().search(seqProviderSearchQuery);
                    if (!searchResults.results?.length) {
                        const shortQuery = searchTitle.split(/[^\w]/).filter(Boolean).slice(0, 4).join(' ');
                        if (shortQuery.length > 3) searchResults = p.name === 'weebcentral' ? await nativeSearchWeebCentral(shortQuery) : await p.instance().search(shortQuery);
                    }
                    if (!searchResults.results?.length) return null;
                    
                    const searchTitleLower = searchTitle.toLowerCase();
                    const cleanSearch = searchTitleLower.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

                    const best = searchResults.results.find((r: any) => {
                        const titlesToCheck = [r.title];
                        if (r.altTitles && Array.isArray(r.altTitles)) {
                            titlesToCheck.push(...r.altTitles.map((at: any) => typeof at === 'string' ? at : at.en || at.ko || at.ja || Object.values(at)[0]));
                        }
                        
                        for (let raw of titlesToCheck) {
                            if (!raw) continue;
                            const t = typeof raw === 'string' ? raw : (raw.en || '');
                            const cleanT = t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
                            if (cleanT.includes(cleanSearch) || cleanSearch.includes(cleanT)) return true;
                            
                            const sim = getSimilarity(cleanT, cleanSearch);
                            if (sim > 0.6) return true;
                        }
                        return false;
                    });
                    
                    if (!best) return null;
                    const mangaData = p.name === 'weebcentral' ? await nativeFetchWeebCentralChapters(best.id) : await p.instance().fetchMangaInfo(best.id);
                    return { provider: p.name, data: mangaData };
                } catch (e: any) {
                    return null;
                }
            });
            fallbackResultsRaw = await Promise.all(seqFallbackPromises);
        }


        const fallbackResults = fallbackResultsRaw
            .filter(r => r !== null)
            .map(r => {
                const enrichedData = {
                    ...r!.data,
                    id: decodedId,
                    title: (typeof data?.title === 'string' ? data.title : data?.title?.en) || searchTitle,
                    image: data?.image || r!.data.image,
                    altTitles: r!.data.altTitles?.length ? r!.data.altTitles : data?.altTitles,
                    type: r!.data.type && r!.data.type !== 'manga' ? r!.data.type : data?.type,
                    resolvedProvider: r!.provider
                };
                const validChapters = (enrichedData.chapters || []).filter((c: any) => c.pages !== 0);
                return { provider: r!.provider, data: { ...enrichedData, chapters: validChapters }, count: validChapters.length };
            });

        fallbackResults.push({ provider: providerName as string, data: { ...data, chapters, resolvedProvider: providerName }, count: chapters.length });
        
        // Prioritize providers using a robust scoring system
        // WEEBCENTRAL IS KING: WeebCentral is always preferred if it has chapters
        const getScore = (r: any) => {
            if (r.count === 0) return 0; // Never reward a provider that has 0 chapters
            let score = r.count * 10;
            if (r.provider === 'weebcentral') score += 1000000; // King of chapters, completeness & reliability
            if (r.provider === 'comick') score += 50000; // Complete chapter coverage across all pages!
            if (r.provider === 'mangapill') score += 5000;
            if (r.provider === 'mangadex') score += 100;
            if (r.provider === providerName && providerName !== 'mangadex' && providerName !== 'weebcentral') score += 10000;
            return score;
        };

        let bestResult = fallbackResults.sort((a, b) => getScore(b) - getScore(a))[0];

        console.log(`[Chapters] Winner is ${bestResult.provider} with ${bestResult.count} chapters.`);



        if (bestResult.count === 0) {
            const emptyPayload = { manga: { id: decodedId, title: searchTitle, resolvedProvider: providerName }, chapters: [] };
            cache.set(cacheKey, emptyPayload);
            return res.json(emptyPayload);
        }

        if (!bestResult.data.title) bestResult.data.title = searchTitle;

        const payload = mapChapters(bestResult.data, bestResult.provider);
        cache.set(cacheKey, payload);
        return res.json(payload);
    } catch (error: any) {
        console.error('Chapter fetch error:', error.stack);
        res.status(500).json({ error: 'Failed to fetch chapters' });
    }
});

// --- SUPABASE ENDPOINTS ---

// Save or update reading progress
app.post('/api/progress', async (req, res) => {
    const { userId, chapterId, pageNumber, completed } = req.body;

    if (!userId || !chapterId) {
        return res.status(400).json({ error: 'userId and chapterId are required' });
    }

    try {
        const { data, error } = await supabase
            .from('reading_progress')
            .upsert({
                user_id: userId,
                chapter_id: chapterId,
                page_number: pageNumber,
                completed: completed || false,
                updated_at: new Date().toISOString()
            }, {
                onConflict: 'user_id, chapter_id'
            })
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (error: any) {
        console.error('Error saving progress:', error.message);
        res.status(500).json({ error: 'Failed to save progress' });
    }
});

// Fetch reading progress for a specific chapter
app.get('/api/progress/:userId/:chapterId', async (req, res) => {
    const { userId, chapterId } = req.params;

    try {
        const { data, error } = await supabase
            .from('reading_progress')
            .select('*')
            .eq('user_id', userId)
            .eq('chapter_id', chapterId)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 is the "no rows found" error
            throw error;
        }
        
        res.json(data || { page_number: 1, completed: false });
    } catch (error: any) {
        console.error('Error fetching progress:', error.message);
        res.status(500).json({ error: 'Failed to fetch progress' });
    }
});

// Fetch all reading history for a user
app.get('/api/history/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const { data, error } = await supabase
            .from('reading_progress')
            .select(`
                *,
                chapters (
                    chapter_number,
                    title,
                    mangas ( title, cover_url )
                )
            `)
            .eq('user_id', userId)
            .order('updated_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (error: any) {
        console.error('Error fetching history:', error.message);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

app.listen(PORT, () => {
    console.log(`Yomi backend engine running on port ${PORT}`);
});