let _apiUrl = process.env.NEXT_PUBLIC_API_URL || "";
if (typeof window !== 'undefined') {
  // In the browser: if the env var is localhost but we are on a phone (local IP), or if it's the default, use empty string to trigger Next.js rewrites.
  if (_apiUrl.includes("localhost") || !_apiUrl) {
    _apiUrl = "";
  }
} else {
  // In SSR: use 127.0.0.1 to avoid Node fetch IPv6 ECONNREFUSED bugs
  if (!_apiUrl || _apiUrl.includes("localhost")) {
    _apiUrl = "http://127.0.0.1:5000";
  }
}
export const API_URL = _apiUrl;

export interface MangaResult {
  id: string;
  title: string;
  coverUrl: string | null;
  synopsis: string;
  provider: string;
  status?: string;
  score?: number;
  type?: string;
  genres?: string[];
  updatedAt?: string;
}

export interface Chapter {
  id: string;
  chapterNumber: string;
  title: string;
  pages: number;
  createdAt: string;
  provider?: string;
}

export interface MangaDetails {
  id: string;
  title: string | { [key: string]: string };
  coverUrl: string | null;
  synopsis: string | { [key: string]: string };
  resolvedProvider?: string;
  type?: string;
}

/* Match a chapter by its id across the ways it can round-trip through the
   router, localStorage and URL params: exact id, URL-decoded id (Next hands
   `%2F` path segments back encoded), or a numeric fallback on the chapter
   number (some providers return the number as the id). Returns the chapter
   so callers never guess the label from an id-shaped string. */
export function findChapterById(
  list: Chapter[],
  id: string
): Chapter | undefined {
  const cleaned = (s: string) => s.toLowerCase().replace(/\/+$/g, "");
  let found = list.find((c) => cleaned(c.id) === cleaned(id));
  if (found) return found;
  const decoded = decodeURIComponent(id);
  found = list.find((c) => cleaned(c.id) === cleaned(decoded));
  if (found) return found;
  const byNum = list.find((c) => String(c.chapterNumber || "") === String(decoded));
  if (byNum) return byNum;
  const n = parseFloat(String(id).match(/(\d+(?:\.\d+)?)/)?.[1] || "");
  if (!Number.isNaN(n)) {
    let best: Chapter | undefined;
    let bestDiff = Infinity;
    list.forEach((c) => {
      const cn = parseFloat(
        String(c.chapterNumber || "").match(/(\d+(?:\.\d+)?)/)?.[1] || ""
      );
      if (!Number.isNaN(cn)) {
        const diff = Math.abs(cn - n);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = c;
        }
      }
    });
    if (best) return best;
  }
  return undefined;
}

/* Type registry (id -> manga/manhwa/manhua/comic). Home/search know the type
   of each title they return; the detail page and reader don't get it from the
   chapters endpoint, so we stash the mapping here as results pass through.
   Persisting to localStorage means the type survives refreshes and cross-page
   navigation, so the reader's auto mode (manhwa → scroll, manga → flip) still
   kicks in even when the reader is entered without an `mt=` param — direct
   links, refresh, or continue-reading cards. */
const typeStore = loadTypeStore();

function loadTypeStore(): Record<string, string> {
  try {
    const raw = localStorage.getItem("yomi.types");
    if (raw) return JSON.parse(raw) || {};
  } catch {}
  return {};
}

function persistTypeStore() {
  try {
    localStorage.setItem("yomi.types", JSON.stringify(typeStore));
  } catch {}
}

export function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faff\uac00-\ud7af]+/g, "").slice(0, 64);
}

export function rememberType(id: string | null | undefined, type?: string | null, title?: string | null) {
  if (!id || !type) return;
  const t = String(type).toLowerCase();
  const keys = [id];
  if (title) {
    const tk = "t:" + normalizeKey(title);
    keys.push(tk);
  }
  let dirty = false;
  for (const k of keys) {
    if (typeStore[k] !== t) {
      typeStore[k] = t;
      dirty = true;
    }
  }
  if (dirty) persistTypeStore();
  if (title) rememberTitle(id, title);
}

/* ── Title registry (id -> real title) ─────────────────────────────────────
   Mirrors the type store: whenever a page learns a title's real name (detail
   fetch, chapter-list fetch, search results) we persist it keyed by id AND by
   slug, so library/continue cards can self-heal entries that were saved with
   an id-shaped placeholder ("t=" missing, UUID slug, raw numeric id). */
const titleStore = loadTitleStore();

function loadTitleStore(): Record<string, string> {
  try {
    const raw = localStorage.getItem("yomi.titles");
    if (raw) return JSON.parse(raw) || {};
  } catch {}
  return {};
}

function persistTitleStore() {
  try {
    localStorage.setItem("yomi.titles", JSON.stringify(titleStore));
  } catch {}
}

/* An "id" mask rather than a readable title: ULIDs, UUIDs, long numeric ids. */
export function looksLikeId(t?: string | null): boolean {
  if (!t) return true;
  const s = String(t).trim();
  if (!s) return true;
  if (/^[0-9A-Z]{26}$/.test(s)) return true; // ULID (chapter/manga hash)
  if (/^[0-9a-f]{8}[ -][0-9a-f]{4}[ -][0-9a-f]{4}[ -][0-9a-f]{4}[ -][0-9a-f]{12}$/i.test(s)) return true; // UUID
  if (/^\d{6,}$/.test(s)) return true; // long numeric id
  if (s.length > 48 && s === s.toUpperCase()) return true; // base64-ish hash
  return false;
}

export function prettifySlug(s?: string | null): string {
  const v = String(s || "");
  return v
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function rememberTitle(id: string | null | undefined, title?: string | null) {
  if (!id || !title) return;
  const t = extractString(title).trim();
  if (!t || looksLikeId(t)) return; // never persist a placeholder as a real title
  const keys = [id, String(id).split("/").pop() || ""].filter(Boolean);
  let dirty = false;
  for (const k of keys) {
    if (titleStore[k] !== t) {
      titleStore[k] = t;
      dirty = true;
    }
  }
  if (dirty) persistTitleStore();
}

/* Best known title for an id. Prefers the registry (id, then slug segment),
   falling back to a prettified slug only when it isn't an id mask. */
export function getMangaTitle(id: string, provider?: string, fallbackTitle?: string | null): string {
  if (titleStore[id]) return titleStore[id];
  const slug = String(id).split("/").pop() || "";
  if (slug && titleStore[slug]) return titleStore[slug];
  if (fallbackTitle && !looksLikeId(fallbackTitle)) return extractString(fallbackTitle);
  if (provider === "mangadex" || looksLikeId(slug)) return "";
  return prettifySlug(slug);
}

/* Convenience: persist type + title for a batch of results in one pass. */
export function rememberResults(
  items: Array<{ id: string; title?: any; type?: string } | null | undefined>
) {
  rememberTypes(items as Array<{ id: string; type?: string; title?: string }>);
  for (const it of items) {
    if (it?.id && it.title) rememberTitle(it.id, extractString(it.title));
  }
}

export function rememberTypes(
  items: Array<{ id: string; type?: string; title?: string } | null | undefined>
) {
  let dirty = false;
  for (const it of items) {
    if (it?.id && it.type) {
      const t = String(it.type).toLowerCase();
      const keys = [it.id];
      if (it.title) keys.push("t:" + normalizeKey(it.title));
      for (const k of keys) {
        if (typeStore[k] !== t) {
          typeStore[k] = t;
          dirty = true;
        }
      }
    }
  }
  if (dirty) persistTypeStore();
}

export function getMangaType(id: string, provider?: string, title?: string | null): string {
  if (typeStore[id]) return typeStore[id];
  /* ids from different providers for the same series never match, but the
     title is stable — so we key the registry on the normalized title too and
     fall back to that whenever the id lookup misses (old continue entries,
     direct links, refreshes). */
  if (title) {
    const tk = "t:" + normalizeKey(title);
    if (typeStore[tk]) return typeStore[tk];
  }
  const slug = String(id).split("/").pop() || "";
  if (slug && typeStore[slug]) return typeStore[slug];
  if (provider === "jikan") return "manga"; /* Jikan is manga-only */
  /* weebcentral series slugs occasionally embed the format in the path */
  if (provider === "weebcentral") {
    const low = String(id).toLowerCase();
    if (low.includes("manhwa")) return "manhwa";
    if (low.includes("manhua")) return "manhua";
    if (low.includes("comic")) return "comic";
  }
  /* Last resort — synchronous title heuristic.
     Korean-language titles are explicitly manhwa. Everything else is left unclassified ("")
     so that the async MangaDex probes and reader visual probes can actually kick in 
     and correctly resolve the type. */
  if (title && hasKoreanChars(String(title))) return "manhwa";
  return "";
}

/** Returns true if `s` contains any Hangul (Korean) syllable or Jamo.
 *  Hangul lives in U+AC00–U+D7AF (syllables) and U+1100–U+11FF (Jamo);
 *  CJK ideographs (U+4E00–U+9FFF) used by Japanese/Chinese titles are
 *  intentionally NOT matched, so a Japanese manga title doesn't get
 *  misclassified as manhwa. */
function hasKoreanChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c >= 0xAC00 && c <= 0xD7AF) || (c >= 0x1100 && c <= 0x11FF)) return true;
  }
  return false;
}

/* Reading mode matched from a manga's type. Manhwa reads better as a scroll;
   manga/manhua/comic mimic an actual book with the page flip. */
export function modeForType(type?: string): "vertical" | "paginated" | null {
  if (!type) return null;
  const t = type.toLowerCase();
  if (t === "manhwa" || t === "manhua" || t === "webtoon") return "vertical";
  return "paginated";
}

/* ── Reader mode overrides (how the user wants to read, NOT what the title is) ──
   The type registry above records what a title *is* (manga/manhwa/manhua), and
   only the canonical probe is allowed to write it. This store records how *this
   user* chose to read a title. They must never be merged: if a manual "read
   this vertically" tap were written into the type registry, the next auto-detect
   run would overwrite it and yank the reader back to the other mode mid-chapter
   — which is exactly the "my reader settings keep resetting" symptom. */
const MODE_OVERRIDE_KEY = "yomi.modeOverrides";

/* Read fresh on every call rather than caching at module scope, so a value
   written earlier in this session (drawer toggle, other reader tab) is always
   seen — and it degrades to an empty map during SSR where localStorage is
   absent. */
function readModeOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(MODE_OVERRIDE_KEY);
    if (raw) return JSON.parse(raw) || {};
  } catch {}
  return {};
}

export function modeOverrideKey(
  id: string | null | undefined,
  provider?: string,
  title?: string | null
): string {
  if (id) return `${provider || "?"}:${id}`;
  if (title) return "t:" + normalizeKey(title);
  return "";
}

/** The mode this user explicitly chose for a title, or null if they never chose. */
export function getModeOverride(
  id: string | null | undefined,
  provider?: string,
  title?: string | null
): "vertical" | "paginated" | null {
  const store = readModeOverrides();
  const key = modeOverrideKey(id, provider, title);
  const direct = key ? store[key] : undefined;
  if (direct === "vertical" || direct === "paginated") return direct;
  /* A title keyed override still resolves when the reader is entered from a
     different provider id (same series, re-scraped slug). */
  if (title) {
    const byTitle = store["t:" + normalizeKey(title)];
    if (byTitle === "vertical" || byTitle === "paginated") return byTitle;
  }
  return null;
}

/** Persist the user's explicit reading choice for a title. Purely a preference —
    it deliberately never calls rememberType(). */
export function rememberModeOverride(
  id: string | null | undefined,
  mode: "vertical" | "paginated",
  provider?: string,
  title?: string | null
) {
  const key = modeOverrideKey(id, provider, title);
  if (!key) return;
  const store = readModeOverrides();
  /* Write both the id key and the title key: ids change when a title is
     re-scraped or opened from another provider, but the title is stable. */
  const keys = [key];
  if (id && title) keys.push("t:" + normalizeKey(title));
  let dirty = false;
  for (const k of keys) {
    if (store[k] !== mode) {
      store[k] = mode;
      dirty = true;
    }
  }
  if (dirty) {
    try {
      localStorage.setItem(MODE_OVERRIDE_KEY, JSON.stringify(store));
    } catch {}
  }
}

/** Drop the user's explicit choice so auto-detection governs that title again. */
export function clearModeOverride(
  id: string | null | undefined,
  provider?: string,
  title?: string | null
) {
  const key = modeOverrideKey(id, provider, title);
  if (!key) return;
  const store = readModeOverrides();
  let dirty = false;
  const drop = (k: string) => {
    if (store[k]) {
      delete store[k];
      dirty = true;
    }
  };
  drop(key);
  if (title) drop("t:" + normalizeKey(title));
  if (dirty) {
    try {
      localStorage.setItem(MODE_OVERRIDE_KEY, JSON.stringify(store));
    } catch {}
  }
}

export function extractString(val: string | { [key: string]: string } | undefined): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  if (typeof val === "object") {
    return val.en || val.ko || val.ja || val[Object.keys(val)[0]] || "";
  }
  return String(val);
}

export function getProxyUrl(url: string): string {
  if (!url) return "";
  // Public reader CDNs hotlink fine cross-origin — no proxy needed to display.
  const directHosts = [
    "cdn.myanimelist.net",
    "comick",
    "comicknew.pictures",
    "uploads.mangadex.org",
    "mangadex.org",
    "weebcentral.com",
    "meo.comick",
  ];
  if (directHosts.some((h) => url.includes(h))) return url;
  // Always use a relative path for proxy so it hits Next.js port 3000 (and is rewritten)
  // This prevents SSR from hardcoding 127.0.0.1 in <img src> tags sent to phones.
  return `/api/proxy?url=${encodeURIComponent(url)}`;
}

/* ── Home data: Yomi backend routes first, Jikan/ComicK direct fallback ── */

function mapBackendResult(m: any): MangaResult {
  return {
    id: m.id,
    title: m.title,
    coverUrl: m.coverUrl || m.image || null,
    synopsis: m.synopsis || "",
    provider: m.provider,
    status: m.status,
    score: m.score,
    type: m.type,
    genres: m.genres,
    updatedAt: m.updatedAt,
  };
}

async function fetchJikanTop(type: string, limit: number): Promise<MangaResult[]> {
  try {
    const res = await fetch(
      `https://api.jikan.moe/v4/top/manga?limit=${limit}&sfw=true&type=${type}`
    );
    if (!res.ok) return [];
    const j = await res.json();
    const list = (j.data || []).map((m: any): MangaResult => ({
      id: `jikan-${m.mal_id}`,
      title: extractString(m.title_english || m.title || m.title_japanese),
      coverUrl: m.images?.webp?.large_image_url || m.images?.jpg?.image_url || null,
      synopsis: extractString(m.synopsis),
      provider: "jikan",
      status: m.status || "",
      score: m.score || undefined,
      genres: (m.genres || []).map((g: any) => g.name),
      type,
    }));
    rememberResults(list);
    return list;
  } catch {
    return [];
  }
}

async function fetchComickTop(limit: number): Promise<MangaResult[]> {
  try {
    const res = await fetch(`https://api.comick.io/top?limit=${limit}&nsfw=false`);
    if (!res.ok) return [];
    const arr = await res.json();
    const raw = Array.isArray(arr) ? arr : arr.data || [];
    const list = raw
      .map((c: any): MangaResult | null => {
        const comic = c.comic || c;
        if (!comic?.slug) return null;
        const coverB2 = comic.md_covers?.[0]?.b2key;
        return {
          id: comic.slug,
          title: extractString(comic.title || comic.slug),
          coverUrl: coverB2 ? `https://meo.comick.io/${coverB2}` : null,
          synopsis: extractString(comic.desc),
          provider: "comick",
          status: comic.status || "",
          score: comic.rating ?? undefined,
          genres: (comic.genres || [])
            .map((g: any) => (typeof g === "string" ? g : g.name))
            .filter(Boolean),
          type: "",
        };
      })
      .filter((m: MangaResult | null): m is MangaResult => m !== null);
    rememberResults(list);
    return list;
  } catch {
    return [];
  }
}

export async function fetchHomeData(
  timeframe: "day" | "week" | "month" = "month"
): Promise<{
  trending: MangaResult[];
  manhwa: MangaResult[];
  comics: MangaResult[];
  latest: MangaResult[];
  latestManhwa: MangaResult[];
}> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const tf = `&timeframe=${timeframe}`;
    const [trendingRes, manhwaRes, comicsRes, latestRes, latestManhwaRes] = await Promise.all([
      fetch(`${API_URL}/api/trending?type=manga${tf}`, { signal: controller.signal }),
      fetch(`${API_URL}/api/trending?type=manhwa${tf}`, { signal: controller.signal }),
      fetch(`${API_URL}/api/trending?type=comic${tf}`, { signal: controller.signal }),
      fetch(`${API_URL}/api/latest?type=manga`, { signal: controller.signal }),
      fetch(`${API_URL}/api/latest?type=manhwa`, { signal: controller.signal }),
    ]);
    clearTimeout(timer);

    const parse = async (res: Response) => {
      if (!res.ok) return [];
      const data = await res.json().catch(() => ({ results: [] }));
      return (data.results || []).map(mapBackendResult);
    };

    const [trending, manhwa, comics, latest, latestManhwa] = await Promise.all([
      parse(trendingRes),
      parse(manhwaRes),
      parse(comicsRes),
      parse(latestRes),
      parse(latestManhwaRes),
    ]);

    return { trending, manhwa, comics, latest, latestManhwa };
  } catch (error) {
    console.error("Home data fetch failed", error);
    return { trending: [], manhwa: [], comics: [], latest: [], latestManhwa: [] };
  }
}

/* Live suggestions for the home search bar: backend first (it searches
   weebcentral/mangadex/mangahere in parallel), Jikan as fallback. */
export async function searchAllSources(term: string): Promise<MangaResult[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000); // 15s timeout
    const res = await fetch(`${API_URL}/api/search?q=${encodeURIComponent(term)}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json().catch(() => ({ results: [] }));
      const list = (data.results || []).filter(Boolean).map(mapBackendResult);
      if (list.length) {
        rememberResults(list);
        return list;
      }
    }
  } catch {
    /* fall through to Jikan */
  }
  const j = await searchJikan(term);
  rememberResults(j);
  return j;
}

export function providerLabel(p?: string): string {
  switch (p) {
    case "jikan":
      return "MyAnimeList";
    case "comick":
      return "ComicK";
    case "mangadex":
      return "MangaDex";
    case "weebcentral":
      return "Weeb Central";
    default:
      return "Yomi";
  }
}

export function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Late night reader";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Deep night";
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export const GENRES = [
  "Action", "Romance", "Fantasy", "Drama", "Thriller", "Comedy",
  "Horror", "Sci-Fi", "Isekai", "Seinen", "School", "Adventure",
  "Ecchi", "BL", "Yaoi"
];

export function gradientStyle(id: string) {
  const h = hashString(id);
  return {
    "--c1": `oklch(${38 + (h % 20)}% ${0.08 + (h % 10) / 100} ${(h * 37) % 360})`,
    "--c2": `oklch(${24 + (h % 12)}% ${0.06 + (h % 8) / 100} ${(h * 73) % 360})`,
    "--c3": `oklch(${14 + (h % 8)}% ${0.04 + (h % 6) / 100} ${(h * 19) % 360})`,
  } as React.CSSProperties;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 100;
}

export const SFX = ["ドン", "バシ", "ゴゴ", "ザザ", "ドド", "バン", "シュウ", "ギュン", "ドクン", "キン"];

/* ── Direct-MangaDex genre search (CORS-open, fully frontend) ─────────────
   Utilised by "Find similar titles" + genre pills. MangaDex is reachable from
   the browser without the backend, so similar-titles returns real content even
   while Jikan/ComicK are down or Antigravity's genre route is still building. */
let mdTagCache: Array<{ id: string; name: string }> | null = null;

async function loadMangaDexTags(): Promise<Array<{ id: string; name: string }>> {
  if (mdTagCache) return mdTagCache;
  try {
    const res = await fetch("https://api.mangadex.org/manga/tag");
    const j = await res.json();
    mdTagCache = (j.data || []).map((t: any) => ({
      id: t.id,
      name: (t.attributes?.name as any)?.en || "",
    }));
  } catch {
    mdTagCache = [];
  }
  return mdTagCache || [];
}

/* ── Type detection when a source omits it ─────────────────────────────────
   Backend search/chapters payloads often have no `type` (or return a wrong
   guess — e.g. a manga whose Korean scanlation name appears in a fuzzy
   MangaDex search). The probe is the AUTHORITATIVE source of truth:

   1. Query MangaDex by title (limit=24, fuzzy).
   2. Rank by EXACT title match, preferring the PRIMARY title over alt-titles —
      a Korean scanlation record may have the title in its alt-titles, but the
      canonical English-title entry always carries the primary title.
   3. Among primary matches prefer a ko/zh original (the Korean original of a
      manhwa usually lists the English title as primary too).
   4. Fall back to the first canonical result.

   `originalLanguage` on the *matched* record is the ground truth (ja → manga,
   ko → manhwa, zh → manhua). This is why a MangaDex search containing a stray
   `ko` record for a Japanese title (Vagabond → "Bulmyeollangin") must NOT flip
   the verdict — only the matched record counts. */
let detectCache: Record<string, string> = {};
/* Artifact-normalize for exact matching: lowercase, trim, and drop a leading
   determiner ("the"/"a") so "The God of High School" matches a record whose
   canonical title is "God of High School". */
const normTitle = (s: unknown): string =>
  String(s || "")
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
const TITLE_OF = (d: any): string[] => {
  const out: string[] = [];
  const push = (v: any) => {
    const s = normTitle(v);
    if (s) out.push(s);
  };
  push((d.attributes?.title as any)?.en);
  for (const v of Object.values(d.attributes?.title || {})) push(v);
  for (const t of d.attributes?.altTitles || []) push(Object.values(t)[0]);
  for (const t of d.attributes?.altTitles || []) push(t.en);
  return out;
};
const PRIMARY_TITLE_OF = (d: any): string[] => {
  const out: string[] = [];
  const push = (v: any) => {
    const s = normTitle(v);
    if (s) out.push(s);
  };
  for (const v of Object.values(d.attributes?.title || {})) push(v);
  return out;
};
/* A MangaDex record only speaks to the FORMAT when it records where the work
   comes from. `originalLanguage: "en"` means "this record is written in
   English", NOT "this is an English-language work": a scrape-only record is
   never tagged with an origin and simply sits at "en" with an empty altTitles
   array — which is exactly the Korean manhwa "Ordeal" (9417accd…). Genuine
   manga entries always carry `ja` plus native alternate titles (checked across
   Vagabond, Kingdom, Berserk, One Piece, Chainsaw Man, Dandadan, Frieren, and
   no `en`-only record appears for any of them). So `en` with no native
   alt-title is MISSING data, not evidence, and reading it as "manga" is what
   pins a manhwa to page flip. */
const ORIGIN_TYPES: Record<string, string> = { ko: "manhwa", zh: "manhua", ja: "manga" };
function typeFromRecordOrigin(d: any): string {
  const lang = d?.attributes?.originalLanguage;
  if (ORIGIN_TYPES[lang]) return ORIGIN_TYPES[lang];
  /* No usable `originalLanguage`: a native alternate title is the only other
     place the origin can be recorded. */
  for (const t of d?.attributes?.altTitles || []) {
    for (const code of Object.keys(ORIGIN_TYPES)) {
      if (typeof t?.[code] === "string" && t[code].trim()) return ORIGIN_TYPES[code];
    }
  }
  return "";
}

/* Several scanlation sites state the format outright in the blurb the scraper
   stores as the synopsis. For the Korean manhwa "Ordeal" it reads:

     "...one of the most popular manga covering in Action, Webtoons genres,
      written by  at MangaBuddy"

   That is a claim about the FORMAT, and it is far more trustworthy than the
   `type` field returned next to it, which these backends hardcode to "manga".
   Only the scraper's own genre sentence and the site it credits are read —
   the word "webtoon" turning up in a story blurb is not a format statement. */
const VERTICAL_SITES = /\bat\s+(mangabuddy|manhwabuddy|manhwaclan)\b/i;
export function detectTypeFromSynopsis(
  synopsis?: string | { [key: string]: string } | null
): "manhwa" | "manhua" | "" {
  const s = extractString(synopsis || "");
  if (!s) return "";
  /* "covering in Action, Webtoons genres" — the genre list the scraper wrote. */
  const genres = s.match(/covering\s+in\s+(?:[\w'&.\-]+,?\s*)+?genres?\b/i)?.[0] || "";
  if (/\bmanhua\b/i.test(genres)) return "manhua";
  if (/\bwebtoons?\b|\bmanhwa\b/i.test(genres)) return "manhwa";
  /* Scanners whose catalogue is vertical strips only. */
  if (VERTICAL_SITES.test(s)) return "manhwa";
  return "";
}

export async function detectTypeFromTitle(
  title: string,
  synopsis?: string | { [key: string]: string } | null
): Promise<string> {
  const key = normalizeKey(title);
  if (!key) return "";
  /* Provider metadata is checked BEFORE the cache: the chapter-list payload that
     carries the synopsis arrives after the first probe has already run and
     cached its honest "unknown", and that negative result must not shadow the
     genre list we have not read yet. */
  const fromSynopsis = detectTypeFromSynopsis(synopsis);
  if (fromSynopsis) {
    detectCache[key] = fromSynopsis;
    return fromSynopsis;
  }
  if (detectCache[key]) return detectCache[key];
  const cleanQuery = normTitle(extractString(title));
  /* Settled facts beat every network probe and cost nothing: no catalogue and no
     provider reports "The God of High School" as a webtoon, yet it plainly is one.
     Resolving it here also means the reader can pick the right mode immediately
     instead of flipping a moment after the chapter opens. */
  const known = detectKnownWebtoon(title);
  if (known) {
    detectCache[key] = known;
    return known;
  }
  try {
    const res = await fetch(
      `https://api.mangadex.org/manga?title=${encodeURIComponent(extractString(title))}&limit=24`
    );
    if (!res.ok) return "";
    const j: any = await res.json();
    const results = j.data || [];
    if (!results.length) return "";

    /* Primary-title exact matches first (the canonical entry of the series). */
    const primary = results.filter((d: any) => PRIMARY_TITLE_OF(d).includes(cleanQuery));
    /* Alt-title exact matches only when no primary matched. */
    const exact = primary.length
      ? primary
      : results.filter((d: any) => TITLE_OF(d).includes(cleanQuery));

    /* Last title-based chance: a fuzzy result that lists our title among its
       known alternate titles (a Korean edition of an English-named manhwa often
       does) AND is a ko/zh original. Still anchored on a real title match, so it
       cannot invent a format out of an unrelated neighbour. */
    const viaAltLang =
      exact.length
        ? []
        : results.filter(
            (d: any) =>
              (d.attributes?.originalLanguage === "ko" || d.attributes?.originalLanguage === "zh") &&
              TITLE_OF(d).includes(cleanQuery)
          );

    /* Nothing actually matched, so MangaDex did not surface a record for this name
       inside the requested window — its ranking is not stable enough to treat the
       absence as proof, and reading a language off the nearest unrelated result
       yields a confident WRONG answer. That is precisely how a webtoon gets
       labelled "manga": the real record can fall outside the window while the
       fuzzy tail is entirely `ja`. Stay unknown instead of guessing; the reader's
       geometry backstop settles it from the artwork. */
    if (!exact.length && !viaAltLang.length) {
      detectCache[key] = "";
      return "";
    }

    /* Prefer a ko/zh original among the matched pool — the Korean original of
       a manhwa usually carries the English title as its primary title too. */
    const pool = exact.length ? exact : viaAltLang;
    const koOrZh =
      pool.find((d: any) => {
        const l = d.attributes?.originalLanguage;
        return l === "ko" || l === "zh";
      }) || null;
    const bestMatch = koOrZh || pool[0];
    const resolved = typeFromRecordOrigin(bestMatch);
    /* Only a record that actually names an origin may write to the cache — an
       origin-less match is not a verdict, and caching a fabricated "manga" here
       is how Ordeal stayed stuck on page flip. */
    if (!resolved) return "";
    detectCache[key] = resolved;

    const values = Object.values((bestMatch.attributes?.title as any) || {});
    const foundTitle =
      ((bestMatch.attributes?.title as any)?.en as string) ||
      (values.length ? String(values[0]) : "") ||
      extractString(title);

    if (!looksLikeId(foundTitle)) rememberTitle(bestMatch.id, foundTitle);
    return resolved;
  } catch {
    return "";
  }
}

/* Page geometry is a ONE-WAY signal: a long strip proves a webtoon, but the
   absence of one proves nothing. Plenty of webtoon uploads are re-cut into
   near-square pages — "The God of High School" ships as 690x1280, ratio 1.86 —
   so asserting "manga" from a low ratio would confidently mislabel them. Only a
   decisive strip is evidence, and only about being a strip. */
export function detectTypeFromGeometry(w: number, h: number): "manhwa" | "" {
  if (!w || !h) return "";
  return h / w >= 2.4 ? "manhwa" : "";
}

/* Popular webtoons whose format the providers actively get wrong. These uploads
   are labelled by page shape rather than by origin, so WeebCentral's own series
   path reports "manga" for Korean series that are plainly webtoons — and the GoHS
   mirror ships near-square pages, so artwork cannot arbitrate either. A small
   curated map is the honest fix for a handful of well-known titles: these are
   settled facts, not guesses. Checking it is synchronous, so the reader picks the
   right mode on first paint instead of depending on a third-party API's ranking,
   its availability, or a round-trip that can fail. */
const KNOWN_WEBTOONS: Record<string, "manhwa" | "manhua"> = {
  godofhighschool: "manhwa",
  highschoolgod: "manhwa",
  sololeveling: "manhwa",
  lookism: "manhwa",
  eleceed: "manhwa",
  overgeared: "manhwa",
  towerofgod: "manhwa",
  onmyoji: "manhua",
  beginningaftertheend: "manhwa",
  nanochess: "manhwa",
  murimlogin: "manhwa",
  noblesse: "manhwa",
  manhwaacademy: "manhwa",
  /* MangaDex lists this one with originalLanguage "en" and an empty altTitles
     array (a scrape-only record, no origin recorded), so neither the catalogue
     nor the artwork can arbitrate it. It is Korean — published by YC, listed
     under Action/Webtoons — so the settled answer belongs with the rest. */
  ordeal: "manhwa",
};

/* Strips the query's separators before comparing, so "Solo Leveling",
   "SOLO LEVELING" and "Solo-Leveling" all collapse onto one key. Bracketed
   qualifiers and store labels go too: providers append them freely, and
   "God of High School [Official]" is the same series as the bare title. */
function webtoonAliasKey(s: string): string {
  return extractString(s)
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(
      /\b(official|digital|raw|scan|scans|unscanned|complete|full|webtoon|manhwa|manhua|manga|comic|comics|version|ed)\b/g,
      " "
    )
    .replace(/[^a-z0-9]+/g, "");
}

/* Known-webtoon lookup, used before any network work. Returns "" when the title
   is not one we have a settled answer for. */
export function detectKnownWebtoon(title: string): "manhwa" | "manhua" | "" {
  const key = webtoonAliasKey(extractString(title));
  if (!key) return "";
  const direct = KNOWN_WEBTOONS[key];
  if (direct) return direct;
  /* English titles routinely carry a leading article the entry does not, so
     "The God of High School" has to land on the same answer as the bare title.
     Only a LEADING article is dropped — "The Beginning After the End" keeps its
     internal "the" because its own entry is keyed without one either way. */
  const stripped = key.replace(/^(the|a|an)/, "");
  return (stripped && KNOWN_WEBTOONS[stripped]) || "";
}

export const MD_TAGS_MAP: Record<string, string> = {
  thriller: '07251805-a27e-4d59-b488-f0bfbec15168',
  scifi: '256c8bd9-4904-4360-bf4f-508a76d67183',
  action: '391b0423-d847-456f-aff0-8b0cfc03066b',
  psychological: '3b60b75c-a2d7-4860-ab56-05f391bb889c',
  romance: '423e2eae-a7a2-4a8b-ac03-a8351462d71d',
  comedy: '4d32cc48-9f00-4cca-9b5a-a839f0764984',
  "boys'love": '5920b825-4181-4a17-beeb-9918b0ff7a30',
  adventure: '87cc87cd-a395-47af-b27a-93258283bbc6',
  "girls'love": 'a3c67850-4684-404e-9b7f-c69850ee5da6',
  harem: 'aafb99c1-7f60-43fa-b75f-fc9502ce29c7',
  isekai: 'ace04997-f6bd-436e-b261-779182193d3d',
  drama: 'b9af3a63-f058-46de-a9a0-e0c13906197a',
  school: 'caaa44eb-cd40-4177-b930-79d3ef2afe87',
  schoollife: 'caaa44eb-cd40-4177-b930-79d3ef2afe87',
  horror: 'cdad7e68-1419-41dd-bdce-27753074a640',
  fantasy: 'cdc58593-87dd-415e-bbc0-2ec27bf404cc',
  mystery: 'ee968100-4191-4968-93d3-f82d72be7e46',
  sliceoflife: 'e5301a23-ebd9-49dd-a0cb-2add944c7fe9',
  supernatural: 'eabc5b4c-6aff-42f3-b657-3e90cbd00b75',
};

export async function searchMangaDexByGenre(
  genre: string,
  limit = 24,
  offset = 0
): Promise<MangaResult[]> {
  try {
    const norm = (s: string) => s.toLowerCase().replace(/[\s\-_]+/g, '');
    const want = norm(genre);
    
    const alias: Record<string, string> = {
      isekai: 'Fantasy',
      'school life': 'School',
      seinen: 'Drama',
      thriller: 'Mystery',
      horror: 'Horror',
      scifi: 'Sci-Fi',
      bl: "Boys' Love",
      yaoi: "Boys' Love",
      ecchi: 'Harem'
    };
    
    const mappedGenre = alias[want] ? norm(alias[want]) : want;
    
    // FAST PATH: Lookup hardcoded MD tags to prevent extra 1000ms latency from fetching tags list
    let hitId = MD_TAGS_MAP[mappedGenre];
    
    if (!hitId && want !== 'ecchi') {
        const tags = await loadMangaDexTags();
        const hit = tags.find((t) => norm(t.name) === mappedGenre);
        if (hit) hitId = hit.id;
    }
    const query = new URLSearchParams();
    
    if (want === 'ecchi') {
        // Ecchi doesn't have a direct tag on MangaDex, it relies on contentRating
        query.append('contentRating[]', 'suggestive');
        query.append('contentRating[]', 'erotica');
    } else {
        if (hitId) query.append('includedTags[]', hitId);
        else query.set('title', genre);
        
        query.append('contentRating[]', 'safe');
        query.append('contentRating[]', 'suggestive');
        query.append('contentRating[]', 'erotica');
    }

    query.append('includes[]', 'cover_art');
    query.set('limit', String(limit));
    if (offset > 0) query.set('offset', String(offset));
    query.set('order[followedCount]', 'desc');
    query.set('hasAvailableChapters', 'true');

    // Main query: all content (manga + manhwa + manhua), typed by language.
    const mainRes = await fetch('https://api.mangadex.org/manga?' + query);
    const mainList: MangaResult[] = mainRes.ok ? await parseMangaDexList(mainRes) : [];

    // Merge with dedup by MangaDex id, interleaving them.
    const seen = new Set<string>();
    const merged: MangaResult[] = [];
    const push = (m: MangaResult) => {
      if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); }
    };

    let manhwaList: MangaResult[] = [];
    // Second query: explicitly pull Korean-language (manhwa) titles with the
    // same tag so genre results always carry both manga AND manhwa, even when
    // the tag is manga-heavy.
    if (hitId || want === 'ecchi') {
      const manhwaQuery = new URLSearchParams(query);
      manhwaQuery.append('originalLanguage[]', 'ko');
      manhwaQuery.set('limit', String(Math.min(limit, 12)));
      if (offset > 0) manhwaQuery.set('offset', String(offset));
      const manhwaRes = await fetch('https://api.mangadex.org/manga?' + manhwaQuery);
      if (manhwaRes.ok) {
        manhwaList = await parseMangaDexList(manhwaRes);
      }
    }

    // Interleave 2 main results for every 1 manhwa result
    let mainIdx = 0;
    let manhwaIdx = 0;
    while (merged.length < limit && (mainIdx < mainList.length || manhwaIdx < manhwaList.length)) {
      if (mainIdx < mainList.length) push(mainList[mainIdx++]);
      if (merged.length >= limit) break;
      if (mainIdx < mainList.length) push(mainList[mainIdx++]);
      if (merged.length >= limit) break;
      if (manhwaIdx < manhwaList.length) push(manhwaList[manhwaIdx++]);
    }

    const trimmed = merged.slice(0, limit);
    rememberResults(trimmed);
    return trimmed;
  } catch {
    return [];
  }
}

async function parseMangaDexList(res: Response): Promise<MangaResult[]> {
  const j = await res.json().catch(() => ({ data: [] }));
  return (j.data || [])
    .map((d: any): MangaResult | null => {
      const attr = d.attributes || {};
      const getEn = (obj: any, arr?: any[]) => {
        if (arr) {
          const enObj = arr.find((x: any) => x.en);
          if (enObj) return enObj.en;
        }
        if (obj) return typeof obj === 'string' ? obj : obj.en || Object.values(obj)[0] || '';
        return '';
      };
      const title = getEn(attr.title, attr.altTitles);
      if (!title) return null;
      const coverRel = (d.relationships || []).find((r: any) => r.type === 'cover_art');
      const coverFile = coverRel?.attributes?.fileName;
      const lang = attr.originalLanguage;
      return {
        id: d.id,
        title,
        coverUrl: coverFile ? 'https://uploads.mangadex.org/covers/' + d.id + '/' + coverFile : null,
        synopsis: getEn(attr.description) || '',
        provider: 'mangadex',
        status: attr.status || '',
        score: undefined,
        genres: (attr.tags || [])
          .map((t: any) => (t.attributes?.name as any)?.en)
          .filter(Boolean),
        type: (lang === 'ko' ? 'manhwa' : lang === 'zh' ? 'manhua' : 'manga'),
      };
    })
    .filter((m: MangaResult | null): m is MangaResult => m !== null);
}

export async function searchJikanByGenre(genre: string): Promise<MangaResult[]> {
  try {
    const norm = (s: string) => s.toLowerCase().replace(/[\s\-_]+/g, "");
    const want = norm(genre);
    const gen = await fetch("https://api.jikan.moe/v4/genres/manga").then((r) => r.json());
    const hit = (gen.data || []).find(
      (g: any) => norm(g.name) === want || norm(g.name).includes(want) || want.includes(norm(g.name))
    );
    /* Jikan genres are anime-oriented; "Thriller"/"School" often live under
       "Mystery"/"School Life". If the exact genre is missing, fall through to
       a themed text search so similar-titles still returns real content. */
    if (!hit) return searchJikan(genre + " manga");
    const res = await fetch(
      `https://api.jikan.moe/v4/manga?genres=${hit.mal_id}&limit=18&sfw=true&order_by=members`
    );
    if (!res.ok) return [];
    const j = await res.json();
    const list = (j.data || []).map((m: any): MangaResult => ({
      id: `jikan-${m.mal_id}`,
      title: extractString(m.title_english || m.title || m.title_japanese),
      coverUrl: m.images?.webp?.large_image_url || m.images?.jpg?.image_url || null,
      synopsis: extractString(m.synopsis),
      provider: "jikan",
      status: m.status || "",
      score: m.score || undefined,
      genres: (m.genres || []).map((g: any) => g.name),
      type: (m.type || "").toLowerCase(),
    }));
    rememberResults(list);
    return list;
  } catch {
    return [];
  }
}

export async function searchJikan(term: string): Promise<MangaResult[]> {
  try {
    const res = await fetch(
      `https://api.jikan.moe/v4/manga?q=${encodeURIComponent(term)}&limit=18&sfw=true&order_by=popularity`
    );
    if (!res.ok) return [];
    const j = await res.json();
    return (j.data || []).map((m: any): MangaResult => ({
      id: `jikan-${m.mal_id}`,
      title: extractString(m.title_english || m.title || m.title_japanese),
      coverUrl: m.images?.webp?.large_image_url || m.images?.jpg?.image_url || null,
      synopsis: extractString(m.synopsis),
      provider: "jikan",
      status: m.status || "",
      score: m.score || undefined,
      genres: (m.genres || []).map((g: any) => g.name),
      type: (m.type || "").toLowerCase(),
    }));
  } catch {
    return [];
  }
}

/**
 * Direct Jikan detail fetch for `jikan-<mal_id>` ids so cards sourced from the
 * Jikan fallback open a fully-populated title page even with the backend down.
 * Jikan is metadata-only, so `chapters` stays empty.
 */
export async function fetchJikanDetails(id: string): Promise<{
  manga: MangaDetails;
  chapters: Chapter[];
  score?: number;
  status?: string;
  genres?: string[];
}> {
  const malId = id.replace(/^jikan-/, "");
  const res = await fetch(`https://api.jikan.moe/v4/manga/${malId}`);
  if (!res.ok) throw new Error("not-found");
  const j = await res.json();
  const m = j.data || {};
  const title =
    extractString(m.title_english || m.title || m.title_japanese) || id;
  return {
    manga: {
      id,
      title,
      coverUrl: m.images?.webp?.large_image_url || m.images?.jpg?.image_url || null,
      synopsis: extractString(m.synopsis),
      type: (m.type || "").toString().toLowerCase(),
    },
    chapters: [],
    score: m.score || undefined,
    status: m.status || "",
    genres: (m.genres || []).map((g: any) => g.name),
  };
}

export function glyphFromTitle(title: string): string {
  const t = extractString(title);
  if (!t) return "読";
  return t[0] || "読";
}

export function seededRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function guessPrimaryProvider(mangaId: string, fallback: string): string {
  if (!mangaId) return fallback;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mangaId)) {
    return "mangadex";
  }
  return fallback;
}
