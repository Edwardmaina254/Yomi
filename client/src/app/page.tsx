"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "@/contexts/ThemeContext";
import gsap from "gsap";
import {
  API_URL,
  fetchHomeData,
  searchAllSources,
  extractString,
  getProxyUrl,
  getGreeting,
  getMangaType,
  getMangaTitle,
  looksLikeId,
  findChapterById,
  gradientStyle,
  glyphFromTitle,
  timeAgo,
  providerLabel,
  GENRES,
  MangaResult,
  rememberTypes,
  guessPrimaryProvider,
} from "@/lib/types";
import { findContinue, findContinueByTitle, chapterLabel } from "@/lib/continue";
import { Search, Moon, Sun, ChevronRight, ChevronLeft, Bookmark } from "lucide-react";
import { AccountButton } from "@/components/AccountBar";
import { useAuth } from "@/contexts/AuthContext";

interface ContinueItem {
  id: string;
  mangaId?: string;
  title: string;
  coverUrl: string | null;
  provider: string;
  chapter: string;
  type?: string;
  page?: number;
  progress: number;
  updatedAt: number;
}

const CONT_KEY = "yomi.continue";
const CONT_LIMIT = 10;
/* Formats the reader understands. Anything else is treated as unverified and
   left alone rather than guessed at. */
const KNOWN_TYPES = ["manga", "manhwa", "manhua", "comic"];

/* A label is unusable if it's empty, an "Unknown" placeholder, or a raw id. */
function badLabel(v: unknown): boolean {
  const s = String(v ?? "").trim();
  return !s || s === "Unknown" || s === "Unknown Title" || looksLikeId(s);
}

/**
 * Read + repair `yomi.continue` in one deterministic pass.
 *
 * The old version had three destructive behaviours, all of which made the
 * shelf look broken:
 *  1. it blanked a perfectly good `type: "manga"` whenever the type registry
 *     had no entry yet, so the reader lost its auto-detect;
 *  2. it never de-duplicated, so one title could occupy several cards;
 *  3. it never clamped the list length, so the shelf grew to the 20 the
 *     reader writes while the async healer truncated to 10.
 *
 * Repairs are conservative: a known-good stored value is never thrown away in
 * favour of a guess. Backend-provided types are deliberately NOT trusted —
 * the API currently reports Japanese manga as `manhwa`, and re-reading that
 * here is what re-poisoned the registry on every timeframe toggle.
 */
function loadContinueReading(): ContinueItem[] {
  let parsed: any[];
  try {
    const raw = localStorage.getItem(CONT_KEY);
    if (!raw) return [];
    parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
  } catch {
    return [];
  }

  let dirty = false;
  const byKey = new Map<string, ContinueItem>();

  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") { dirty = true; continue; }
    const id = String(entry.id ?? "").trim();
    if (!id) { dirty = true; continue; } // unusable — no way back to a chapter

    // One card per title. Prefer the mangaId key so a re-save of the same
    // series under a different chapter id updates the card instead of
    // appending a duplicate.
    const mangaId = String(entry.mangaId ?? "").trim();
    const key = mangaId || id;

    const prev = byKey.get(key);
    if (prev && (prev.updatedAt ?? 0) >= (entry.updatedAt ?? 0)) { dirty = true; continue; }

    const item: ContinueItem = {
      id,
      mangaId: mangaId || undefined,
      title: String(entry.title ?? "").trim(),
      coverUrl: entry.coverUrl ?? null,
      provider: String(entry.provider ?? "weebcentral").trim() || "weebcentral",
      chapter: String(entry.chapter ?? "").trim(),
      page: Number.isFinite(entry.page) ? Number(entry.page) : undefined,
      progress: Math.max(0, Math.min(100, Math.round(Number(entry.progress) || 0))),
      updatedAt: Number(entry.updatedAt) || 0,
      type: KNOWN_TYPES.includes(String(entry.type ?? "").toLowerCase())
        ? String(entry.type).toLowerCase()
        : undefined,
    };

    // Title: repair only from the persisted registry, never from the id.
    if (badLabel(item.title)) {
      const real = getMangaTitle(mangaId || id, item.provider, item.title);
      if (real && !badLabel(real)) { item.title = real; dirty = true; }
    }
    // Chapter: an id-shaped label means the chapter list had not loaded when
    // this was saved. Leave it empty — the card renders "Ch ?" and the
    // library/reader healer fills it in on the next visit.
    if (badLabel(item.chapter)) {
      if (item.chapter) dirty = true;
      item.chapter = "";
    }
    // Type: keep a verified stored value; only fill a gap from the registry.
    if (!item.type) {
      const known = getMangaType(mangaId || id, item.provider, item.title);
      if (known && KNOWN_TYPES.includes(known)) { item.type = known; dirty = true; }
    }

    byKey.set(key, item);
  }

  const list = [...byKey.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, CONT_LIMIT);

  if (dirty || list.length !== parsed.length) {
    try { localStorage.setItem(CONT_KEY, JSON.stringify(list)); } catch { /* noop */ }
  }
  return list;
}

function saveContinueReading(list: ContinueItem[]) {
  try { localStorage.setItem(CONT_KEY, JSON.stringify(list.slice(0, CONT_LIMIT))); } catch { /* noop */ }
}

/* One shelf card. Resolves its labels once (the previous inline version
   recomputed the title expression four times per card) and keeps the whole
   card tappable while letting the remove button sit above it. */
function ContinueCard({ item, onRemove }: { item: ContinueItem; onRemove: () => void }) {
  const title = badLabel(item.title)
    ? getMangaTitle(item.mangaId || item.id, item.provider, item.title) || "Untitled"
    : item.title;
  const chapter = badLabel(item.chapter) ? "?" : item.chapter;
  const progress = Math.max(0, Math.min(100, Math.round(item.progress || 0)));
  const mangaId = item.mangaId || "";

  const params = new URLSearchParams({
    provider: item.provider || "weebcentral",
    manga: mangaId,
    t: title,
  });
  const pp = guessPrimaryProvider(mangaId, item.provider);
  if (pp) params.set("pp", pp);
  if (item.coverUrl) params.set("cover", item.coverUrl);
  if (item.type) params.set("mt", item.type);
  if (item.page && item.page > 1) params.set("p", String(item.page));

  return (
    <div className="yomi-ccard">
      <button className="ccard-remove" onClick={onRemove} aria-label={`Remove ${title} from continue reading`}>
        ×
      </button>
      <Link
        href={`/read/${encodeURIComponent(item.id)}?${params.toString()}`}
        style={{ display: "contents", textDecoration: "none", color: "inherit" }}
      >
        <CoverArt title={title} id={item.id} coverUrl={item.coverUrl} />
        <div className="card-text">
          <h3>{title}</h3>
          <div className="prog">
            <span className="lbl">Ch {chapter}</span>
            <span className="pct">{progress}%</span>
          </div>
          <div className="yomi-bar">
            <div className="yomi-bar-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </Link>
    </div>
  );
}

function CoverArt({
  title,
  id,
  coverUrl,
  className = "",
  style,
  type,
  score,
}: {
  title: string;
  id: string;
  coverUrl: string | null;
  className?: string;
  style?: React.CSSProperties;
  type?: string;
  score?: number;
}) {
  return (
    <div className={`yomi-cover ${className}`} style={{ ...gradientStyle(id), ...style }}>
      {coverUrl ? (
        <img
          src={getProxyUrl(coverUrl)}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={(e) => {
            const t = e.currentTarget;
            t.style.display = "none";
            t.parentElement?.classList.add("no-img");
          }}
        />
      ) : (
        <span className="placeholder-glyph">{glyphFromTitle(title)}</span>
      )}
      {score && <span className="c-rate">★ {score.toFixed(1)}</span>}
    </div>
  );
}

function MangaCard({
  manga,
  i,
  showRank = false,
  time,
}: {
  manga: MangaResult;
  i?: number;
  showRank?: boolean;
  time?: boolean;
}) {
  return (
    <div key={manga.id} className="yomi-mcard">
      {showRank && i !== undefined && (
        <span className="rank">{String(i + 1).padStart(2, "0")}</span>
      )}
      <Link
        href={`/manga/${encodeURIComponent(manga.id)}?provider=${manga.provider}`}
        style={{ display: "block", borderRadius: "var(--radius)" }}
      >
        <CoverArt
          title={manga.title}
          id={manga.id}
          coverUrl={manga.coverUrl}
          type={manga.type || manga.provider}
          score={manga.score}
        />
      </Link>
      <div className="card-text">
        <h3>{manga.title}</h3>
        <div className="meta">
          {manga.type && (
            <span className="yomi-type-badge">{manga.type[0].toUpperCase() + manga.type.slice(1)}</span>
          )}
          {time && manga.updatedAt ? (
            <>
              <span>{manga.genres && manga.genres.length > 0 ? manga.genres[0] : manga.status || manga.provider}</span>
              <span className="when">{timeAgo(manga.updatedAt)}</span>
            </>
          ) : (
            <span>
              {manga.genres && manga.genres.length > 0
                ? manga.genres.slice(0, 2).join(" · ")
                : manga.status || providerLabel(manga.provider)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* Rack with per-row arrow scrolling (GSAP paging, disabled-at-ends) */
function CardRack({
  title,
  subtitle,
  head,
  rackClass = "",
  children,
}: {
  title?: React.ReactNode;
  subtitle?: string;
  head?: React.ReactNode;
  rackClass?: string;
  children: React.ReactNode;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(true);

  const update = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanPrev(el.scrollLeft > 6);
    setCanNext(el.scrollLeft < max - 6);
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      ro.disconnect();
      mo.disconnect();
    };
  }, [update]);

  const scroll = (dir: number) => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const target = Math.max(0, Math.min(el.scrollLeft + dir * el.clientWidth, max));
    gsap.to(el, {
      scrollLeft: target,
      duration: 0.45,
      ease: "power3.out",
      onComplete: update,
    });
  };

  return (
    <div className="yomi-rack-wrap">
      {head ? (
        head
      ) : (
        <div className="yomi-sec-head">
          <h2>{title}</h2>
          {subtitle && (
            <span className="eyebrow" style={{ fontSize: "0.62rem" }}>
              via {subtitle}
            </span>
          )}
        </div>
      )}
      <div className="yomi-rack-holder">
        <button className="rack-arrow left hide-m" onClick={() => scroll(-1)} disabled={!canPrev} aria-label="Scroll left">
          <ChevronLeft size={18} />
        </button>
        <button className="rack-arrow right hide-m" onClick={() => scroll(1)} disabled={!canNext} aria-label="Scroll right">
          <ChevronRight size={18} />
        </button>
        <div
          className={`yomi-rail-x ${rackClass}`}
          ref={(el) => {
            trackRef.current = el;
            if (el) requestAnimationFrame(update);
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/* Rotating spotlight banner */
function SpotlightCarousel({ pool }: { pool: MangaResult[] }) {
  const [idx, setIdx] = useState(0);
  const [ready, setReady] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const total = pool.length;
  /* Identity of the pool, so the reveal re-runs when load() swaps in a fresh
     set of slides (React gives the new slides no inline styles). */
  const poolKey = pool.map((d) => d.id).join("|");

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = total > 0 ? setInterval(() => setIdx((i) => (i + 1) % total), 6000) : null;
  }, [total]);

  const go = useCallback(
    (next: number, reset = false) => {
      setIdx((((next % total) + total) % total));
      if (reset) startTimer();
    },
    [total, startTimer]
  );

  useEffect(() => {
    startTimer();
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [startTimer]);

  /* Touch swipe — the fastest way to turn slides on a phone. `touch-action:
     pan-y` on the wrap keeps vertical page scrolling native; we only claim
     the gesture once horizontal travel wins the direction lock, and
     pointercancel (browser starting a scroll) just aborts and resumes the
     auto-rotate. The timer is paused for the whole gesture so a slide never
     turns under the finger. */
  const swipeRef = useRef<{
    id: number;
    x: number;
    y: number;
    t0: number;
    axis: "" | "x" | "y";
    fired: boolean;
  } | null>(null);
  /* Set the moment a swipe actually turns a slide, so the click iOS fires on
     release can't fall through to the "Details" link under the finger. */
  const swipedRef = useRef(false);

  const onSwipeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    /* Always clear first: a swipe that never produced a click must not eat
       the next click (pointerdown runs before any swipe can set it again). */
    swipedRef.current = false;
    if (e.pointerType === "mouse" || swipeRef.current) return;
    swipeRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t0: Date.now(), axis: "", fired: false };
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const onSwipeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = swipeRef.current;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (d.axis !== "x" || Math.abs(dx) < 44) return;
    /* Re-arm from the current position so one long drag steps through slides
       instead of racing — the 44px threshold doubles as hysteresis. */
    d.x = e.clientX;
    d.t0 = Date.now();
    d.fired = true;
    swipedRef.current = true;
    /* No reset=true: the timer stays paused until finger-up, so the
       auto-advance can't fire on top of an in-progress drag. */
    go(idx + (dx < 0 ? 1 : -1));
  };

  const onSwipeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = swipeRef.current;
    if (!d || e.pointerId !== d.id) return;
    swipeRef.current = null;
    /* Short flick that never reached the move threshold still counts. */
    const dx = e.clientX - d.x;
    if (d.axis === "x" && !d.fired && Math.abs(dx) >= 24 && Date.now() - d.t0 < 400) {
      swipedRef.current = true;
      go(idx + (dx < 0 ? 1 : -1), true);
    }
    if (timerRef.current === null) startTimer();
  };

  // If the pool shrinks (timeframe refetch), clamp idx so we never point at a
  // slide that no longer exists.
  useEffect(() => {
    setIdx((i) => (total === 0 ? 0 : Math.min(i, total - 1)));
  }, [total]);

  /* Enter the banner as soon as the pool arrives. Without this the first
     paint renders the slide at the CSS default (invisible) and the user sees
     a blank banner until the first auto-advance. */
  useEffect(() => {
    if (total > 0) setReady(true);
  }, [total, poolKey]);

  /* Text entrance only. Visibility is owned by the .active class, so a
     re-render can never leave the spotlight blank. */
  useEffect(() => {
    if (!ready) return;
    const active = wrapRef.current?.querySelectorAll<HTMLElement>(".yomi-spot-slide")[idx];
    if (!active) return;
    const bits = active.querySelectorAll(
      ".yomi-spot-kicker, .yomi-spot-body h1, .yomi-spot-body .sub, .yomi-spot-chips, .yomi-spot-body .yomi-btn"
    );
    if (!bits.length) return;
    gsap.killTweensOf(bits);
    gsap.fromTo(
      bits,
      { y: 18, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: 0.55, stagger: 0.07, delay: 0.08, ease: "power2.out", clearProps: "all" }
    );
  }, [idx, ready, poolKey]);

  /* Warm the neighbouring covers so a turn never reveals an empty frame. */
  useEffect(() => {
    if (!ready || total === 0) return;
    [pool[(idx + 1) % total], pool[(idx + 2) % total]].forEach((d) => {
      if (d?.coverUrl) {
        const img = new Image();
        img.src = getProxyUrl(d.coverUrl);
      }
    });
  }, [idx, ready, poolKey, pool, total]);

  if (total === 0) return null;
  return (
    <section className="yomi-section">
      <div
        className="yomi-spot-wrap"
        ref={wrapRef}
        onPointerDown={onSwipeDown}
        onPointerMove={onSwipeMove}
        onPointerUp={onSwipeEnd}
        onPointerCancel={onSwipeEnd}
        onClickCapture={(e) => {
          if (swipedRef.current) {
            e.preventDefault();
            e.stopPropagation();
            swipedRef.current = false;
          }
        }}
      >
        {pool.map((d, i) => (
          <div
            key={d.id}
            className={`yomi-spot-slide ${i === idx && ready ? "active" : ""}`}
            style={{ ...gradientStyle(d.id) }}
          >
            <span className="yomi-spot-glyph">{glyphFromTitle(d.title)}</span>
            {d.coverUrl && (
              <img
                src={getProxyUrl(d.coverUrl)}
                alt=""
                referrerPolicy="no-referrer"
                loading={i < 2 ? "eager" : "lazy"}
                className="yomi-spot-cover"
                onError={(e) => {
                  const t = e.currentTarget;
                  t.style.display = "none";
                  t.parentElement?.classList.add("no-img");
                }}
              />
            )}
            <div className="yomi-spot-veil" />
            <div className="yomi-spot-body">
              <div className="yomi-spot-kicker">
                Featured · {String(i + 1).padStart(2, "0")} / {String(total).padStart(2, "0")} ·{" "}
                {d.type ? d.type[0].toUpperCase() + d.type.slice(1) : providerLabel(d.provider)}
              </div>
              <h1>{d.title}</h1>
              <div className="sub">{d.status || d.provider}</div>
              {d.genres && d.genres.length > 0 && (
                <div className="yomi-spot-chips">
                  {d.genres.slice(0, 3).map((g) => (
                    <span key={g} className="yomi-chip">{g}</span>
                  ))}
                  {d.score && <span className="yomi-chip">★ {d.score.toFixed(1)}</span>}
                </div>
              )}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Link
                  href={`/manga/${encodeURIComponent(d.id)}?provider=${d.provider}`}
                  className="yomi-btn yomi-btn-primary"
                >
                  <Bookmark size={15} /> Details
                </Link>
              </div>
            </div>
          </div>
        ))}
        <div className="yomi-spot-nav">
          <span className="yomi-spot-idx">{String(idx + 1).padStart(2, "0")}</span>
          <div className="yomi-spot-dots">
            {pool.map((_, i) => (
              <button
                key={i}
                className={`yomi-spot-dot ${i === idx ? "active" : ""}`}
                onClick={() => go(i, true)}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>
          <button className="yomi-spot-arrow" onClick={() => go(idx - 1, true)} aria-label="Previous">
            <ChevronLeft />
          </button>
          <button className="yomi-spot-arrow" onClick={() => go(idx + 1, true)} aria-label="Next">
            <ChevronRight />
          </button>
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  const { user, pushData } = useAuth();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [trending, setTrending] = useState<MangaResult[]>([]);
  const [manhwa, setManhwa] = useState<MangaResult[]>([]);
  const [comics, setComics] = useState<MangaResult[]>([]);
  const [latest, setLatest] = useState<MangaResult[]>([]);
  const [continueReading, setContinueReading] = useState<ContinueItem[]>([]);
  const pool = useRef<MangaResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [trendingTimeframe, setTrendingTimeframe] = useState<"day" | "week" | "month">(() => {
    try {
      const saved = localStorage.getItem("yomi.trendTF");
      return saved === "day" || saved === "week" || saved === "month" ? saved : "month";
    } catch { return "month"; }
  });
  const changeTrendTF = (tf: "day" | "week" | "month") => {
    setTrendingTimeframe(tf);
    try { localStorage.setItem("yomi.trendTF", tf); } catch { /* noop */ }
  };
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<MangaResult[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (tf: "day" | "week" | "month") => {
    try {
      const data = await fetchHomeData(tf);
      
      const shuffle = (arr: MangaResult[]) => [...arr].sort(() => 0.5 - Math.random());
      
      const t = shuffle(data.trending).slice(0, 16);
      const m = shuffle(data.manhwa).slice(0, 16);
      const c = shuffle(data.comics).slice(0, 16);
      const l = shuffle(data.latest).slice(0, 16);
      
      setTrending(t);
      setManhwa(m);
      setComics(c);
      setLatest(l);
      
      // Spotlight pool: fresh drops + trending manga + manhwa, deduped by
      // normalized title (ids differ across providers but titles always match)
      const spotPool = shuffle([
        ...data.latestManhwa,
        ...data.latest,
        ...data.trending,
        ...data.manhwa,
      ]);
      const seenTitles = new Set<string>();
      pool.current = spotPool.filter((v) => {
        const k = "t:" + (v.title || "").toLowerCase().replace(/\s+/g, " ").trim();
        if (!k || k === "t:" || seenTitles.has(k)) return false;
        seenTitles.add(k);
        return true;
      }).slice(0, 18);
      
      rememberTypes([...t, ...m, ...c, ...l, ...pool.current]);
    } catch (e) {
      console.error("Failed to fetch home data:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setContinueReading(loadContinueReading());
    load(trendingTimeframe);
  }, [load, trendingTimeframe]);

  /* Keep the shelf in sync with the library tab (and other tabs) without a
     reload. */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === CONT_KEY) setContinueReading(loadContinueReading());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /* One-shot repair pass for entries that were saved before the chapter list
     had loaded. Deliberately NOT keyed on the trending timeframe — the old
     version re-ran on every timeframe toggle, re-firing a request per card
     and re-writing `manga.type` from the API (which reports Japanese manga
     as `manhwa`), which is what kept flipping readers into the wrong mode. */
  const healedRef = useRef(false);
  useEffect(() => {
    if (healedRef.current) return;
    healedRef.current = true;

    (async () => {
      let cont: ContinueItem[];
      try {
        const raw = localStorage.getItem(CONT_KEY);
        cont = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(cont)) return;
      } catch {
        return;
      }

      let dirty = false;
      for (const x of cont) {
        if (!x?.mangaId) continue;
        // Title first from the registry — cheap, no network.
        if (badLabel(x.title)) {
          const known = getMangaTitle(x.mangaId, x.provider, x.title);
          if (known && !badLabel(known)) { x.title = known; dirty = true; }
        }
        // Only hit the network when the chapter label is genuinely missing.
        if (x.chapter && !badLabel(x.chapter)) continue;

        try {
          const res = await fetch(
            `${API_URL}/api/manga/${encodeURIComponent(x.mangaId)}/chapters?provider=${x.provider}`
          );
          if (!res.ok) continue;
          const data = await res.json();
          if (badLabel(x.title)) {
            const real = data?.manga?.title ? extractString(data.manga.title) : "";
            if (real && !badLabel(real)) { x.title = real; dirty = true; }
          }
          const found = findChapterById((data.chapters || []) as any[], x.id);
          if (found?.chapterNumber != null) {
            x.chapter = String(found.chapterNumber);
            dirty = true;
          }
          // NOTE: `manga.type` from the API is intentionally ignored — the
          // backend currently mislabels Japanese manga as manhwa. The reader
          // and detail page own type resolution via the verified probe.
        } catch { /* offline or provider down — keep what we have */ }
      }

      if (dirty) {
        saveContinueReading(cont as ContinueItem[]);
        setContinueReading(loadContinueReading());
      }
    })();
  }, []);

  /* Debounced live suggestions under the home search bar */
  useEffect(() => {
    let active = true;
    const term = searchQuery.trim();
    if (!term) {
      setSuggestions([]);
      setSuggestOpen(false);
      setSuggestLoading(false);
      return;
    }
    setSuggestOpen(true);
    const t = setTimeout(async () => {
      setSuggestLoading(true);
      const list = await searchAllSources(term);
      if (active) {
        setSuggestions(list.slice(0, 8));
        setSuggestLoading(false);
      }
    }, 100);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [searchQuery]);

  /* Close the suggestion panel on outside tap/click */
  useEffect(() => {
    if (!suggestOpen) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setSuggestOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, [suggestOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/i.test(document.activeElement?.tagName || "")) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const greeting = getGreeting();

  const renderDropRow = (manga: MangaResult) => (
    <Link
      key={manga.id}
      href={`/manga/${encodeURIComponent(manga.id)}?provider=${manga.provider}`}
      className="yomi-drow"
      style={{ width: "100%", display: "flex", textDecoration: "none" }}
    >
      <CoverArt
        title={manga.title}
        id={manga.id}
        coverUrl={manga.coverUrl}
        className="yomi-drow-cover"
        style={{ width: 48, aspectRatio: "3/4.15", borderRadius: 10 }}
      />
      <div className="card-text">
        <h3>{manga.title}</h3>
        <div className="sub">
          {manga.genres && manga.genres.length > 0
            ? manga.genres.slice(0, 2).join(" · ")
            : manga.status || providerLabel(manga.provider)}
        </div>
      </div>
    </Link>
  );

  return (
    <div className="yomi-shell">
      {/* Desktop rail */}
      <aside className="yomi-rail">
        <div className="mark">読</div>
        <div style={{ height: 10 }} />
        <Link href="/" className="active" title="Home">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
          </svg>
        </Link>
        <Link href="/library" title="Library">
          <Bookmark size={22} />
        </Link>
        <div className="spacer" />
        <AccountButton />
      </aside>

      {/* Main content */}
      <div className="yomi-main">
        <div className="yomi-view">
          {/* Mobile topbar */}
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

          {/* Greeting */}
          <div className="yomi-greeting">
            <p className="eyebrow" suppressHydrationWarning>
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
            <h1>{greeting}.</h1>
          </div>

          <div style={{ height: 16 }} />

          {/* Search bar with live suggestions dropdown */}
          <div className="yomi-search-dropdown-wrap" ref={searchWrapRef}>
            <form
              suppressHydrationWarning
              className="yomi-searchbar"
              onSubmit={(e) => {
                e.preventDefault();
                const term = searchQuery.trim();
                if (!term) return;
                setSuggestOpen(false);
                router.push(`/search?q=${encodeURIComponent(term)}`);
              }}
            >
              <Search size={18} />
              <input
                suppressHydrationWarning
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => searchQuery.trim() && setSuggestOpen(true)}
                placeholder="Search titles, genres…"
                aria-label="Search titles and genres"
                autoComplete="off"
              />
              {searchQuery.trim() && (
                <button
                  type="button"
                  className="yomi-iconbtn"
                  onClick={() => { setSearchQuery(""); searchInputRef.current?.focus(); }}
                  aria-label="Clear"
                  style={{ width: 30, height: 30, flex: "none" }}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              )}
            </form>

            {suggestOpen && searchQuery.trim() && (
              <div className="yomi-suggest-panel">
                {suggestLoading && !suggestions.length ? (
                  <div className="yomi-suggest-loading">
                    <div className="yomi-spinner" />
                  </div>
                ) : suggestions.length > 0 ? (
                  <ul className="yomi-suggest-list">
                    {suggestions.map((m) => {
                      /* Already-opened titles flag themselves so re-searching
                         a series shows where you left off before you click. */
                      const cont =
                        findContinue(continueReading, m.id) ||
                        findContinueByTitle(continueReading, m.title);
                      const contLabel = cont ? chapterLabel(cont) : "";
                      return (
                      <li key={m.id}>
                        <Link
                          href={`/manga/${encodeURIComponent(m.id)}?provider=${m.provider}&t=${encodeURIComponent(m.title)}`}
                          className="yomi-suggest-item"
                          onClick={() => { setSuggestOpen(false); setSearchQuery(""); }}
                        >
                          <span className="yomi-suggest-thumb">
                            {m.coverUrl ? (
                              <img src={getProxyUrl(m.coverUrl)} alt="" referrerPolicy="no-referrer" loading="lazy" />
                            ) : (
                              <span className="placeholder-glyph" style={{ fontSize: "1.4rem" }}>{glyphFromTitle(m.title)}</span>
                            )}
                          </span>
                          <span className="yomi-suggest-info">
                            <span className="yomi-suggest-title">{m.title}</span>
                            <span className="yomi-suggest-meta">
                              {cont && (
                                <b className="yomi-suggest-cont">▶ Ch {contLabel || "?"}</b>
                              )}
                              {cont ? " · " : ""}
                              {m.genres?.slice(0, 2).join(" · ") || m.status || m.provider}
                            </span>
                          </span>
                        </Link>
                      </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="yomi-suggest-empty">No suggestions</div>
                )}
                <button
                  className="yomi-suggest-footer"
                  onClick={() => { setSuggestOpen(false); router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`); }}
                >
                  <Search size={14} /> See all results for &ldquo;{searchQuery.trim()}&rdquo;
                </button>
              </div>
            )}
          </div>

          {/* Rotating spotlight */}
          {pool.current.length > 0 && <SpotlightCarousel pool={pool.current} />}

          {/* Continue reading shelf */}
          {continueReading.length > 0 && (
            <section className="yomi-section yomi-enter" style={{ ["--ei" as string]: 0 }}>
              <CardRack
                head={
                  <div className="yomi-sec-head">
                    <h2>Continue reading</h2>
                    <Link href="/library" className="more">
                      Shelf <ChevronRight size={14} />
                    </Link>
                  </div>
                }
                rackClass="yomi-rack-wide"
              >
                {continueReading.map((item) => (
                  <ContinueCard
                    key={item.mangaId || item.id}
                    item={item}
                    onRemove={() => {
                      const updated = continueReading.filter(
                        (x) => (x.mangaId || x.id) !== (item.mangaId || item.id)
                      );
                      setContinueReading(updated);
                      saveContinueReading(updated);
                      if (user) pushData();
                    }}
                  />
                ))}
              </CardRack>
            </section>
          )}

          {/* Loading skeleton */}
          {loading && (
            <section className="yomi-section">
              <div className="yomi-sec-head"><h2>Loading titles…</h2></div>
              <div style={{ display: "flex", gap: 18, overflow: "hidden" }}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <div key={i} className="yomi-mcard" style={{ opacity: 0.4, flex: "0 0 clamp(128px, 40vw, 168px)" }}>
                    <div className="yomi-cover" style={{ background: "var(--border)", aspectRatio: "3/4.2" }} />
                    <div style={{ height: 14, background: "var(--border)", borderRadius: 4, width: "85%" }} />
                    <div style={{ height: 10, background: "var(--border)", borderRadius: 4, width: "55%" }} />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Trending Manga */}
          {!loading && (
            <section className="yomi-section yomi-enter" style={{ ["--ei" as string]: 1 }}>
              <CardRack
                head={
                  <div className="yomi-sec-head yomi-sec-trending">
                    <h2>Trending manga</h2>
                    <div className="timeframe-toggle">
                      {(["day", "week", "month"] as const).map((tf) => (
                        <button
                          key={tf}
                          className={trendingTimeframe === tf ? "active" : ""}
                          onClick={() => changeTrendTF(tf)}
                        >
                          {tf === "day" ? "Day" : tf === "week" ? "Week" : "Month"}
                        </button>
                      ))}
                    </div>
                  </div>
                }
                rackClass="yomi-rack-cards"
              >
                {trending.length > 0 ? (
                  trending.map((m) => MangaCard({ manga: m }))
                ) : (
                  <div className="yomi-empty-state">No trending manga found {trendingTimeframe === "day" ? "today" : trendingTimeframe === "week" ? "this week" : "this month"}.</div>
                )}
              </CardRack>
            </section>
          )}

          {/* Popular Manhwa */}
          {!loading && manhwa.length > 0 && (
            <section className="yomi-section yomi-enter" style={{ ["--ei" as string]: 2 }}>
              <CardRack
                head={
                  <div className="yomi-sec-head yomi-sec-trending">
                    <h2>Trending manhwa</h2>
                    <span className="eyebrow" style={{ fontSize: "0.62rem" }}>
                      {trendingTimeframe === "day" ? "today" : trendingTimeframe === "week" ? "this week" : "this month"}
                    </span>
                  </div>
                }
                rackClass="yomi-rack-cards"
              >
                {manhwa.map((m) => MangaCard({ manga: m }))}
              </CardRack>
            </section>
          )}

          {/* Trending Comics */}
          {!loading && comics.length > 0 && (
            <section className="yomi-section yomi-enter" style={{ ["--ei" as string]: 3 }}>
              <CardRack
                head={
                  <div className="yomi-sec-head yomi-sec-trending">
                    <h2>Trending comics</h2>
                    <span className="eyebrow" style={{ fontSize: "0.62rem" }}>
                      {trendingTimeframe === "day" ? "today" : trendingTimeframe === "week" ? "this week" : "this month"}
                    </span>
                  </div>
                }
                rackClass="yomi-rack-cards"
              >
                {comics.map((m) => MangaCard({ manga: m }))}
              </CardRack>
            </section>
          )}
          
          {/* Latest Releases */}
          {!loading && latest.length > 0 && (
            <section className="yomi-section yomi-enter" style={{ ["--ei" as string]: 4 }}>
              <CardRack
                title="Latest releases"
                rackClass="yomi-rack-cards"
              >
                {latest.map((m) => MangaCard({ manga: m, time: true }))}
              </CardRack>
            </section>
          )}

          {/* Browse by genre */}
          <section className="yomi-section yomi-enter" style={{ ["--ei" as string]: 5 }}>
            <div className="yomi-sec-head"><h2>Browse by genre</h2></div>
            <div className="yomi-rail-x yomi-rack-chips">
              {GENRES.map((g) => (
                <Link
                  key={g}
                  href={`/search?genre=${encodeURIComponent(g)}`}
                  className="yomi-chip"
                >
                  # {g}
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* Mobile tab bar */}
      <nav className="yomi-tabbar">
        <Link href="/" className="yomi-tab active">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
          </svg>
          Home
          <span className="dot" />
        </Link>
        <Link href="/library" className="yomi-tab">
          <Bookmark size={22} />
          Library
          <span className="dot" />
        </Link>
      </nav>
    </div>
  );
}