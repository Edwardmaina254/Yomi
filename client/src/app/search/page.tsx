"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTheme } from "@/contexts/ThemeContext";
import { useDebounce } from "@/hooks/useDebounce";
import {
  API_URL,
  extractString,
  getProxyUrl,
  gradientStyle,
  glyphFromTitle,
  searchJikan,
  searchJikanByGenre,
  searchMangaDexByGenre,
  rememberResults,
  getMangaTitle,
  looksLikeId,
  GENRES,
  MangaResult,
} from "@/lib/types";
import {
  ContinueEntry,
  loadContinueEntries,
  findContinue,
  findContinueByTitle,
  chapterLabel,
  continueReaderHref,
} from "@/lib/continue";
import { Search as SearchIcon, Moon, Sun, X, Bookmark } from "lucide-react";
import { AccountButton } from "@/components/AccountBar";

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchFallback />}>
      <SearchPageContent />
    </Suspense>
  );
}

function SearchFallback() {
  return (
    <div className="yomi-shell" style={{ placeItems: "center", display: "grid" }}>
      <div className="yomi-spinner" />
    </div>
  );
}

function SearchPageContent() {
  const searchParams = useSearchParams();
  const { theme, toggleTheme } = useTheme();

  const genreFromUrl = searchParams.get("genre");
  const queryFromUrl = searchParams.get("q");
  const [activeGenre, setActiveGenre] = useState<string | null>(genreFromUrl);
  const [query, setQuery] = useState(queryFromUrl || "");
  const [results, setResults] = useState<MangaResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  /* Saved resume points, so a title you already opened shows "Continue"
     right in the results instead of making you open the detail page first.
     Read once up front (SSR-safe: the helper returns [] without storage) and
     refreshed from the cross-tab listener below. */
  const [contEntries, setContEntries] = useState<ContinueEntry[]>(() => loadContinueEntries());

  const debouncedQuery = useDebounce(query, 100);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "yomi.continue") setContEntries(loadContinueEntries());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    try {
      setRecent(JSON.parse(localStorage.getItem("yomi.recent") || "[]"));
    } catch {}
  }, []);

  useEffect(() => {
    if (genreFromUrl) {
      setActiveGenre(genreFromUrl);
      if (!queryFromUrl) setQuery("");
    }
  }, [genreFromUrl, queryFromUrl]);

  useEffect(() => {
    if (queryFromUrl) setQuery(queryFromUrl);
  }, [queryFromUrl]);

  // Reset page when query or genre changes
  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, activeGenre]);

  const runSearch = useCallback(
    async (term: string, genre: string | null, pageNum: number = 1): Promise<MangaResult[]> => {
      if (!term && !genre) {
        return [];
      }

      const genreQueries: Record<string, string> = {
        Action: "action",
        Romance: "romance",
        Fantasy: "fantasy",
        Drama: "drama",
        Comedy: "comedy",
        Horror: "horror",
        "Sci-Fi": "science fiction",
        Isekai: "isekai",
        Seinen: "seinen",
        Thriller: "thriller",
        School: "school",
        Adventure: "adventure",
        Ecchi: "ecchi",
        BL: "bl",
        Yaoi: "yaoi",
      };

      // Genre-only searches (genre chip, "Find similar titles"). MangaDex is
      // reached directly from the browser (CORS-open) so this works today even
      // while Jikan is down and Antigravity's genre route is still building.
      if (genre && !term) {
        const offset = (pageNum - 1) * 24;
        const md = await searchMangaDexByGenre(genre, 24, offset);
        if (md.length) {
          rememberResults(md);
          return md;
        }
        const genreList = await searchJikanByGenre(genre);
        rememberResults(genreList);
        return genreList;
      }

      const queryTerm = term || genreQueries[genre as string] || (genre as string);
      let list: MangaResult[] = [];

      // Catch the backend results, but only consume Jikan's when backend is unreachable
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(`${API_URL}/api/search?q=${encodeURIComponent(queryTerm)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        list = ((data.results || []) as MangaResult[]).map((m) => ({
          ...m,
          title: looksLikeId(m.title) ? getMangaTitle(m.id, m.provider, m.title) : m.title,
        }));
        rememberResults(list);
      } catch {
        list = [];
      } finally {
        clearTimeout(timer);
      }

      // Backend unreachable or empty → fall back to Jikan live search so the
      // results grid always has content.
      if (list.length === 0) {
        list = await searchJikan(queryTerm);
      }

      // A genre applied to a term-based search keeps only matching titles.
      if (genre && term) {
        const gl = genre.toLowerCase();
        list = list.filter(
          (m) =>
            m.title.toLowerCase().includes(gl) ||
            (m.genres || []).some((g) => g.toLowerCase().includes(gl))
        );
      }

      rememberResults(list);
      return list;
    },
    []
  );

  useEffect(() => {
    let active = true;
    const hasText = query.trim().length > 0;

    // Genre-only mode: immediate search, no debounce delay.
    if (!hasText && activeGenre) {
      setLoading(true);
      runSearch("", activeGenre).then((list) => {
        if (active) { setResults(list); setLoading(false); }
      });
      return () => { active = false; };
    }

    // Text +/- genre mode: debounced search (only fire when debounce has caught up).
    if (hasText) {
      const term = debouncedQuery.trim();
      if (term !== query.trim()) return; // still debouncing
      setLoading(true);
      runSearch(term, activeGenre).then((list) => {
        if (active) { setResults(list); setLoading(false); }
      });
      return () => { active = false; };
    }

    // Nothing active: clear results.
    if (!activeGenre) {
      setResults([]);
      setLoading(false);
    }
  }, [query, debouncedQuery, activeGenre, runSearch]);

  const loadMore = async () => {
    if (loading || (!activeGenre && !debouncedQuery.trim())) return;
    const nextPage = page + 1;
    setLoading(true);
    const newResults = await runSearch(debouncedQuery.trim(), activeGenre, nextPage);
    setResults(prev => {
      const next = [...prev];
      const seen = new Set(prev.map(p => p.id));
      for (const r of newResults) {
        if (!seen.has(r.id)) next.push(r);
      }
      return next;
    });
    setPage(nextPage);
    setLoading(false);
  };

  const saveRecent = (term: string) => {
    if (!term.trim()) return;
    const next = [term.trim(), ...recent.filter((r) => r.toLowerCase() !== term.toLowerCase())].slice(0, 6);
    setRecent(next);
    localStorage.setItem("yomi.recent", JSON.stringify(next));
  };

  const handleSubmit = () => {
    saveRecent(query);
  };

  const chipClick = (g: string) => {
    setActiveGenre(activeGenre === g ? null : g);
    setQuery("");
  };

  const clearAll = () => {
    setQuery("");
    setActiveGenre(null);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      saveRecent(query);
      inputRef.current?.blur();
    }
  };

  const activeFilter = !!query.trim() || !!activeGenre;

  return (
    <div className="yomi-shell">
      <aside className="yomi-rail">
        <div className="mark">読</div>
        <div style={{ height: 10 }} />
        <Link href="/" title="Home">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
          </svg>
        </Link>
        <Link href="/library" title="Library">
          <BookmarkShape />
        </Link>
        <div className="spacer" />
        <AccountButton />
      </aside>

      <div className="yomi-main">
        <div className="yomi-view">
          <header className="yomi-topbar">
            <div className="yomi-brand">
              <span className="mark">読</span>
              <div className="yomi-brand-text">
                <span className="name">YOMI</span>
                <small>READ INTO THE NIGHT</small>
              </div>
            </div>
            <div className="yomi-topbar-actions">
              <AccountButton variant="bar" />
              <button className="yomi-iconbtn" onClick={toggleTheme} aria-label="Toggle theme">
                {theme === "night" ? <Moon size={21} /> : <Sun size={21} />}
              </button>
            </div>
          </header>

          <div className="yomi-s-input">
            <SearchIcon size={18} />
            <input
              suppressHydrationWarning
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Series, author, genre…"
              autoComplete="off"
            />
            {activeFilter && (
              <button className="yomi-iconbtn" onClick={clearAll} style={{ width: 36, height: 36 }}>
                <X size={18} />
              </button>
            )}
          </div>

          {/* Recent searches */}
          {recent.length > 0 && !activeFilter && (
            <section className="yomi-section">
              <div className="yomi-sec-head">
                <h2>Recent</h2>
                <button
                  className="more"
                  onClick={() => {
                    setRecent([]);
                    localStorage.removeItem("yomi.recent");
                  }}
                >
                  Clear <X size={14} />
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {recent.map((r) => (
                  <button key={r} className="yomi-rchip" onClick={() => { setQuery(r); saveRecent(r); }}>
                    {r}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Genres */}
          <section className="yomi-section">
            <div className="yomi-sec-head"><h2>Genres</h2></div>
            <div className="yomi-rail-x yomi-rack-chips">
              {GENRES.map((g) => (
                <button
                  key={g}
                  className={`yomi-chip ${activeGenre === g ? "active" : ""}`}
                  onClick={() => chipClick(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </section>

          {/* Results */}
          <section className="yomi-section">
            <div className="yomi-sec-head">
              <h2>Results</h2>
              <span className="yomi-mono" style={{ color: "var(--muted)", fontSize: 13 }}>
                {results.length}
              </span>
            </div>

            {loading && results.length === 0 ? (
              <div className="yomi-results" style={{ opacity: 0.5 }}>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i}>
                    <div className="yomi-cover" style={{ background: "var(--border)", aspectRatio: "3/4.15" }} />
                    <div style={{ height: 12, background: "var(--border)", borderRadius: 4, marginTop: 8, width: "80%" }} />
                  </div>
                ))}
              </div>
            ) : results.length > 0 ? (
              <div className="yomi-results">
                {results.map((manga) => {
                  const resultTitle = extractString(manga.title);
                  const cont =
                    findContinue(contEntries, manga.id) || findContinueByTitle(contEntries, resultTitle);
                  const contLabel = cont ? chapterLabel(cont) : "";
                  return (
                    <div key={`${manga.provider}-${manga.id}`} className="yomi-mcard">
                      <Link href={`/manga/${encodeURIComponent(manga.id)}?provider=${manga.provider}&t=${encodeURIComponent(manga.title)}`} style={{ display: "block", borderRadius: "var(--radius)" }}>
                        <div className="yomi-cover" style={gradientStyle(`${manga.provider}-${manga.id}`)}>
                          {manga.coverUrl ? (
                            <img src={getProxyUrl(manga.coverUrl)} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; e.currentTarget.parentElement?.classList.add("no-img"); }} />
                          ) : (
                            <span className="placeholder-glyph">{glyphFromTitle(manga.title)}</span>
                          )}
                          {manga.score && <span className="c-rate">★ {manga.score.toFixed(1)}</span>}
                        </div>
                      </Link>
                      <div className="card-text">
                        <h3>{resultTitle}</h3>
                        {cont && (
                          <Link
                            href={continueReaderHref(cont, {
                              title: resultTitle,
                              coverUrl: manga.coverUrl,
                              type: manga.type,
                              primaryProvider: manga.provider,
                            })}
                            className="yomi-cont-pill"
                          >
                            ▶ Continue{contLabel ? ` · Ch ${contLabel}` : ""}
                          </Link>
                        )}
                        <div className="meta">
                          {manga.type && (
                            <span className="yomi-type-badge">{manga.type[0].toUpperCase() + manga.type.slice(1)}</span>
                          )}
                          {manga.genres && manga.genres.length > 0 ? manga.genres.slice(0, 2).join(" · ") : manga.status || (manga.provider || "weebcentral")}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {results.length >= 24 && (
                  <button 
                    className="yomi-btn yomi-btn-primary" 
                    style={{ gridColumn: "1 / -1", margin: "20px auto" }}
                    onClick={loadMore}
                    disabled={loading}
                  >
                    {loading ? "Loading..." : "Load More"}
                  </button>
                )}
              </div>
            ) : (
              <div className="yomi-empty" style={{ gridColumn: "1 / -1" }}>
                <span className="big">読</span>
                {query || activeGenre ? (
                  <>
                    No hits{query ? ` for “${query}”` : ""}.
                    <br />
                    <small style={{ color: "var(--fg)" }}>Try another title, or clear the genre filter.</small>
                  </>
                ) : (
                  <>
                    Start typing to search across every source.
                    <br />
                    <small style={{ color: "var(--fg)" }}>Try “one piece”, “solo leveling”, “frieren”…</small>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      <nav className="yomi-tabbar">
        <Link href="/" className="yomi-tab">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
          </svg>
          Home
          <span className="dot" />
        </Link>
        <Link href="/library" className="yomi-tab">
          <BookmarkShape />
          Library
          <span className="dot" />
        </Link>
      </nav>
    </div>
  );
}

function BookmarkShape() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-3.5L5 21V4a1 1 0 0 1 1-1Z" />
    </svg>
  );
}