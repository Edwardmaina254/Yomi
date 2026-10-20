"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useTheme } from "@/contexts/ThemeContext";
import {
  API_URL,
  detectTypeFromTitle,
  detectKnownManga,
  detectKnownWebtoon,
  detectTypeFromHeuristics,
  extractString,
  getMangaTitle,
  getProxyUrl,
  getMangaType,
  glyphFromTitle,
  gradientStyle,
  looksLikeId,
  rememberTitle,
  rememberType,
  guessPrimaryProvider,
  findChapterById,
} from "@/lib/types";
import { Moon, Sun, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { AccountBar, AccountButton } from "@/components/AccountBar";
import { removeFromShelf, isDeletedFromShelf } from "@/lib/continue";

interface LibItem {
  id: string;
  title: string;
  coverUrl: string | null;
  provider: string;
  type?: string;
  mangaId?: string;
  chapter?: string;
  progress?: number;
  updatedAt: number;
}

function loadLib(): LibItem[] {
  const items: LibItem[] = [];
  const pushWithTitle = (x: any, lookupId: string) => {
    let title = x.title;
    if (looksLikeId(title) || !title || title === "Unknown Title") {
      title = getMangaTitle(lookupId, x.provider) || title;
    }
    // Trust known manga/webtoon facts & heuristics first!
    const km = detectKnownManga(title);
    const kw = detectKnownWebtoon(title);
    const h = detectTypeFromHeuristics(title);
    let resolvedType = km || kw || h || getMangaType(lookupId, x.provider, title);
    if (!resolvedType) {
      resolvedType = (x.type || "").trim().toLowerCase();
    }
    return {
      id: x.id,
      mangaId: x.mangaId,
      chapter: x.chapter,
      progress: x.progress,
      title,
      coverUrl: x.coverUrl,
      provider: x.provider || "unknown",
      type: resolvedType,
      updatedAt: x.updatedAt || 0,
    };
  };
  try {
    const lib = JSON.parse(localStorage.getItem("yomi.lib") || "[]");
    if (Array.isArray(lib)) {
      lib.forEach((x) => {
        if (!isDeletedFromShelf(x)) items.push(pushWithTitle(x, x.id));
      });
    }
  } catch {}
  try {
    const cont = JSON.parse(localStorage.getItem("yomi.continue") || "[]");
    if (Array.isArray(cont)) {
      cont.forEach((x) => {
        const isCorruptHash = !x.mangaId && /^[0-9A-Z]{26}$/.test(x.chapter);
        if (!items.some((i) => i.id === x.id) && !isCorruptHash && !isDeletedFromShelf(x)) {
          items.push(pushWithTitle(x, x.mangaId || x.id));
        }
      });
    }
  } catch {}
  return items;
}

/* Rewrite healed titles back into localStorage so the fix survives refreshes
   without re-resolving every visit. */
async function healStoredTitles() {
  try {
    for (const store of ["yomi.lib", "yomi.continue"]) {
      try {
        const arr = JSON.parse(localStorage.getItem(store) || "[]");
        let dirty = false;
        for (const x of arr) {
          const lookupId = store === "yomi.continue" && x.mangaId ? x.mangaId : x.id;
          if (!lookupId) continue;
          
          let needsHeal = false;
          if (looksLikeId(x.title) || !x.title || x.title === "Unknown Title") {
            const t = getMangaTitle(lookupId, x.provider);
            if (t) {
              x.title = t;
              dirty = true;
            } else {
              needsHeal = true;
            }
          }
          
          if (store === "yomi.continue" && (!x.chapter || looksLikeId(x.chapter))) {
            needsHeal = true;
          }

          // Heal misclassified manga/manhwa types (e.g. Bleach, One Piece, Solo Leveling, Lookism)
          const km = detectKnownManga(x.title);
          const kw = detectKnownWebtoon(x.title);
          const h = detectTypeFromHeuristics(x.title);
          const correctType = km || kw || h || getMangaType(lookupId, x.provider, x.title);
          if (correctType && x.type !== correctType) {
            x.type = correctType;
            rememberType(lookupId, correctType, x.title);
            dirty = true;
          }

          if (needsHeal) {
            try {
              const res = await fetch(`${API_URL}/api/manga/${encodeURIComponent(lookupId)}/chapters?provider=${x.provider}`);
              if (res.ok) {
                const data = await res.json();
                const realTitle = data?.manga?.title ? extractString(data.manga.title) : "";
                if (realTitle && !looksLikeId(realTitle)) {
                  x.title = realTitle;
                  rememberTitle(lookupId, realTitle);
                  dirty = true;
                }
                
                if (store === "yomi.continue" && data.chapters) {
                  const currentChapter = findChapterById(data.chapters as any[], x.id);
                  if (currentChapter?.chapterNumber) {
                    x.chapter = String(currentChapter.chapterNumber);
                    dirty = true;
                  }
                }
              }
            } catch {}
          }
        }
        const filteredArr = arr.filter((x: any) => !isDeletedFromShelf(x));
        if (filteredArr.length !== arr.length) dirty = true;
        if (dirty) localStorage.setItem(store, JSON.stringify(filteredArr));
      } catch {}
    }
  } catch {}
}

export default function LibraryPage() {
  const { theme, toggleTheme } = useTheme();
  const { user, signIn, signOut, syncData, pushData } = useAuth();
  const [items, setItems] = useState<LibItem[]>([]);
  const [tab, setTab] = useState<string>("all");
  const [sort, setSort] = useState<string>("recent");

  useEffect(() => {
    const initial = loadLib();
    setItems(initial);

    /* Heal id-shaped titles in the persisted stores using whatever real titles
       the registry/type-probe has learned, then reflect the healed result. */
    healStoredTitles().then(() => {
        const healedItems = loadLib();
        setItems(healedItems);
        if (user) pushData();
    });

    /* Re-probe unclassified titles AND titles suspiciously marked as manga */
    const missing = initial.filter((i) => {
      const raw = (i.type || "").trim().toLowerCase();
      const km = detectKnownManga(i.title);
      const kw = detectKnownWebtoon(i.title);
      const h = detectTypeFromHeuristics(i.title);
      if (km || kw || h) return false;
      return (!raw || raw === "manga") && !!i.title;
    });

    if (!missing.length) return;

    let cancelled = false;
    (async () => {
      for (const i of missing) {
        if (cancelled) break;
        const t = await detectTypeFromTitle(i.title);
        if (t && t !== i.type) {
          rememberType(i.id, t, i.title);
          for (const storeKey of ["yomi.lib", "yomi.continue"]) {
            try {
              const arr = JSON.parse(localStorage.getItem(storeKey) || "[]");
              let updated = false;
              for (const entry of arr) {
                const targetId = storeKey === "yomi.continue" && entry.mangaId ? entry.mangaId : entry.id;
                if (targetId === i.id || entry.id === i.id || (entry.title && entry.title === i.title)) {
                  entry.type = t;
                  updated = true;
                }
              }
              if (updated) localStorage.setItem(storeKey, JSON.stringify(arr));
            } catch {}
          }
          setItems((prev) =>
            prev.map((it) => (it.id === i.id ? { ...it, type: t } : it))
          );
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const tabs = [
    { id: "all", label: "All" },
    { id: "manga", label: "Manga" },
    { id: "manhwa", label: "Manhwa" },
    { id: "comic", label: "Comic" },
  ];

  const tabForItem = (i: LibItem): string => {
    // 1. Authoritative known manga / webtoons (settled facts overrule corrupted local storage)
    const km = detectKnownManga(i.title);
    if (km) return "manga";
    const kw = detectKnownWebtoon(i.title);
    if (kw) return "manhwa";
    const h = detectTypeFromHeuristics(i.title);
    if (h === "manhwa" || h === "manhua") return "manhwa";
    if (h === "manga") return "manga";

    const t = (i.type || "").toLowerCase();
    if (t === "manga") return "manga";
    if (t === "manhwa" || t === "manhua" || t === "webtoon") return "manhwa";
    if (t === "comic") return "comic";
    /* No stored type. We refuse to guess an aggregator's format: weebcentral,
       mangahere and mangadex all host manga AND manhwa/manhua, so a provider
       fallback misfiles titles (e.g. Vagabond → manhwa). Only trust a source
       that guarantees the format; otherwise leave it unclassified (All tab
       only) and let the MangaDex title probe resolve it in the load effect. */
    const pn = (i.provider || "").toLowerCase();
    if (pn.includes("comick")) return "comic";
    if (pn.includes("jikan")) return "manga";
    return "";
  };

  const filtered = useMemo(() => {
    let list = [...items];
    if (tab !== "all") list = list.filter((i) => tabForItem(i) === tab);
    if (sort === "az") list.sort((a, b) => a.title.localeCompare(b.title));
    else list.sort((a, b) => b.updatedAt - a.updatedAt);
    return list;
  }, [items, tab, sort]);

  useEffect(() => {
    const onShelfChange = () => {
      setItems(loadLib());
    };
    window.addEventListener("storage", onShelfChange);
    window.addEventListener("yomi:shelf-change", onShelfChange);
    return () => {
      window.removeEventListener("storage", onShelfChange);
      window.removeEventListener("yomi:shelf-change", onShelfChange);
    };
  }, []);

  const removeItem = (id: string) => {
    const target = items.find((i) => i.id === id);
    removeFromShelf({
      id,
      mangaId: target?.mangaId,
      title: target?.title,
    });
    setItems(loadLib());
    if (user) pushData();
  };

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
        <Link href="/library" className="active" title="Library">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-3.5L5 21V4a1 1 0 0 1 1-1Z" />
          </svg>
        </Link>
        <div className="spacer" />
        {/* <AccountButton /> removed per request */}
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

          <div className="yomi-greeting">
            <p className="eyebrow">Your shelf</p>
            <h1>Library.</h1>
          </div>

          <AccountBar />

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              marginTop: 18,
            }}
          >
            <div className="yomi-seg">
              {tabs.map((t) => (
                <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            <select className="yomi-sort-select" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="recent">Recently read</option>
              <option value="az">Title A–Z</option>
            </select>
          </div>

          <section className="yomi-section">
            {filtered.length > 0 ? (
              <div className="yomi-results">
                {filtered.map((item) => (
                  <div key={item.id} className="yomi-mcard" style={{ position: "relative" }}>
                    <Link
                      href={item.chapter
                        ? `/read/${encodeURIComponent(item.id)}?provider=${item.provider}&pp=${guessPrimaryProvider(item.mangaId || "", item.provider)}&manga=${item.mangaId || ""}&t=${encodeURIComponent(item.title || "")}${item.type ? `&mt=${encodeURIComponent(item.type)}` : ""}`
                        : `/manga/${encodeURIComponent(item.id)}?provider=${item.provider}`}
                      style={{ display: "block", borderRadius: "var(--radius)" }}
                    >
                      <div className="yomi-cover" style={gradientStyle(`${item.provider}-${item.id}`)}>
                        {item.coverUrl ? (
                          <img src={getProxyUrl(item.coverUrl)} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; e.currentTarget.parentElement?.classList.add("no-img"); }} />
                        ) : (
                          <span className="placeholder-glyph">{glyphFromTitle(item.title)}</span>
                        )}
                      </div>
                    </Link>
                    <button
                      onClick={() => removeItem(item.id)}
                      aria-label="Remove from library"
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        zIndex: 3,
                        width: 28,
                        height: 28,
                        borderRadius: 99,
                        display: "grid",
                        placeItems: "center",
                        background: "oklch(10% 0 0 / 0.55)",
                        color: "#fff",
                        backdropFilter: "blur(6px)",
                      }}
                    >
                      <X size={14} />
                    </button>
                    <div className="card-text">
                      {item.progress !== undefined && (
                        <div className="yomi-bar" style={{ marginBottom: 6 }}>
                          <div className="yomi-bar-fill" style={{ width: `${item.progress}%` }} />
                        </div>
                      )}
                      <h3>{item.title}</h3>
                      <div className="meta">
                        {item.progress !== undefined ? `Ch ${looksLikeId(item.chapter) || !item.chapter ? "?" : item.chapter} · ${item.progress}%` : "Not started"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="yomi-empty">
                <span className="big">読</span>
                Your shelf is waiting for its first story.
                <br />
                <small style={{ color: "var(--fg)" }}>
                  Save a title from any detail page, or{" "}
                  <Link href="/search" style={{ color: "var(--accent)", fontWeight: 600 }}>
                    find something new
                  </Link>
                  .
                </small>
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
        <Link href="/library" className="yomi-tab active">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-3.5L5 21V4a1 1 0 0 1 1-1Z" />
          </svg>
          Library
          <span className="dot" />
        </Link>
      </nav>
    </div>
  );
}