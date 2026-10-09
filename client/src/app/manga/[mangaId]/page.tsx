"use client";

import { useState, useEffect, useRef, useMemo, Suspense } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import {
  API_URL,
  Chapter,
  MangaDetails,
  MangaResult,
  extractString,
  fetchJikanDetails,
  getProxyUrl,
  getMangaType,
  detectTypeFromTitle,
  rememberType,
  rememberTitle,
  looksLikeId,
  gradientStyle,
  glyphFromTitle,
  providerLabel,
} from "@/lib/types";
import {
  ContinueEntry,
  loadContinueEntries,
  findContinue,
  findContinueByTitle,
  chapterLabel,
} from "@/lib/continue";
import gsap from "gsap";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Bookmark, Play, ChevronRight } from "lucide-react";
import BackButton from "@/components/BackButton";

/* Full-shell centered loader — spans the whole grid (the shell becomes a
   76px + 1fr two-column grid on desktop, so a single child must be given
   `grid-column: 1 / -1` or it lands in the 76px rail column). */
function CenteredLoader({ label }: { label?: string }) {
  return (
    <div className="yomi-shell">
      <div
        style={{
          gridColumn: "1 / -1",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
        }}
      >
        <div className="yomi-spinner" />
        {label && <span style={{ color: "var(--muted)", fontSize: 14 }}>{label}</span>}
      </div>
    </div>
  );
}

export default function MangaDetailsPage() {
  return (
    <Suspense fallback={<CenteredLoader />}>
      <MangaDetailsContent />
    </Suspense>
  );
}

function MangaDetailsContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, syncData } = useAuth();
  const provider = searchParams.get("provider") || "weebcentral";
  const titleParam = searchParams.get("t");
  const mangaId = params?.mangaId as string;


  const [manga, setManga] = useState<MangaDetails | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [inLibrary, setInLibrary] = useState(false);
  /* The saved resume point (chapter id + page), or null when this title has
     never been opened. Resolved by mangaId first, then — because ids are
     provider-scoped — by an exact title join. */
  const [continueEntry, setContinueEntry] = useState<ContinueEntry | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [similarTitles, setSimilarTitles] = useState<MangaResult[]>([]);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarOpen, setSimilarOpen] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [status, setStatus] = useState<string>("");
  const [genres, setGenres] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const synopsisRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchDetails = async () => {
      try {
        if (provider === "jikan") {
          const data = await fetchJikanDetails(mangaId);
          if (cancelled) return;
          setManga(data.manga);
          setChapters(data.chapters);
          setScore(data.score ?? null);
          setStatus(data.status || "");
          setGenres(data.genres || []);
          return;
        }
        let fetchUrl = `${API_URL}/api/manga/${mangaId}/chapters?provider=${provider}`;
        let initialTitle = titleParam || "";
        if (!initialTitle) {
          try {
            const lib = JSON.parse(localStorage.getItem("yomi.lib") || "[]");
            const cached = lib.find((i: any) => i.id === mangaId)?.title;
            if (cached) initialTitle = extractString(cached);
          } catch {}
        }
        if (initialTitle) fetchUrl += `&title=${encodeURIComponent(initialTitle)}`;
        
        const res = await fetch(fetchUrl);
        const data = await res.json();
        if (cancelled) return;
        const backendManga = data.manga;
        const backendTitle = extractString(backendManga?.title) || "";
        if (backendTitle && !looksLikeId(backendTitle)) rememberTitle(mangaId, backendTitle);
        const resolvedType =
          backendManga?.type ||
          getMangaType(mangaId, provider, extractString(backendManga?.title));
        setManga(
          backendManga
            ? { ...backendManga, type: resolvedType }
            : null
        );
        /* Sources (esp. weebcentral search) rarely return a type — probe
           MangaDex by title so Start Reading + similar-titles know whether to
           open in scroll (manhwa) or page-flip (manga). The probe is also run
           when the backend DOES return a type, because backend guesses have
           proven unreliable (e.g. a manga whose slug resolves through MangaDex
           can come back typed "manhwa"). The exact-title probe always wins. */
        if (backendManga?.title) {
          detectTypeFromTitle(extractString(backendManga.title), backendManga.synopsis).then((t) => {
            if (cancelled || !t) return;
            rememberType(mangaId, t, extractString(backendManga.title));
            setManga((prev) => (prev ? { ...prev, type: t } : prev));
          });
        }
        setScore(data.manga?.score ?? null);
        setStatus(data.manga?.status || "");

        const sorted = (data.chapters || []).sort(
          (a: Chapter, b: Chapter) =>
            parseFloat(b.chapterNumber || "0") - parseFloat(a.chapterNumber || "0")
        );
        setChapters(sorted);
      } catch (error) {
        console.error("Failed to fetch manga details:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const restoreContinue = () => {
      // `id` on a saved entry is the CHAPTER id, so the match has to go
      // through mangaId (with the old id-in-place-of-mangaId shape as backup).
      setContinueEntry(findContinue(loadContinueEntries(), mangaId));
      try {
        const lib = JSON.parse(localStorage.getItem("yomi.lib") || "[]");
        setInLibrary((lib as any[]).some((x) => x.id === mangaId));
      } catch {}
    };

    fetchDetails();
    restoreContinue();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mangaId, provider]);

  const toggleLibrary = () => {
    let lib: any[] = [];
    try {
      lib = JSON.parse(localStorage.getItem("yomi.lib") || "[]");
    } catch {}
    const idx = lib.findIndex((x) => x.id === mangaId);

    if (idx > -1) {
      lib.splice(idx, 1);
      setInLibrary(false);
    } else {
      lib.unshift({
        id: mangaId,
        title: extractString(manga?.title),
        coverUrl: manga?.coverUrl || null,
        provider,
        type: manga?.type || "",
        updatedAt: Date.now(),
      });
      setInLibrary(true);
    }
    localStorage.setItem("yomi.lib", JSON.stringify(lib));
    if (user) syncData();
  };

  /* Chapter ids are provider-scoped, so an entry saved from another source
     never matches mangaId. Fall back to an exact title join so "read ch 83 →
     search the title again → Continue" still resolves. Read during render —
     it has no timing requirement, only a value, and the helper is SSR-safe. */
  const resumeEntry = useMemo(() => {
    if (continueEntry) return continueEntry;
    if (!manga || typeof window === "undefined") return null;
    return findContinueByTitle(loadContinueEntries(), extractString(manga.title));
  }, [continueEntry, manga]);

  /* Resolved resume point: the saved chapter id first, then — when that id is
     not in this provider's list (stale id, or a title matched from another
     source) — the saved chapter NUMBER. Only a title with neither falls back
     to the first chapter. */
  const resume = useMemo(() => {
    if (!resumeEntry || chapters.length === 0) return null;
    const label = chapterLabel(resumeEntry);
    const byId = chapters.find((c) => c.id === resumeEntry.id);
    const target =
      byId || (label ? chapters.find((c) => String(c.chapterNumber ?? "").trim() === label) : undefined);
    if (!target) return null;
    const page = Math.round(Number(resumeEntry.page) || 0);
    return {
      id: target.id,
      label: String(target.chapterNumber || label || ""),
      page: page > 1 ? page : 0,
    };
  }, [resumeEntry, chapters]);

  const contProgress =
    resumeEntry?.progress != null && Number.isFinite(Number(resumeEntry.progress))
      ? Math.max(0, Math.min(100, Math.round(Number(resumeEntry.progress))))
      : null;

  const startReading = () => {
    const targetId = resume?.id || findFirstChapter();
    if (!targetId) return;
    const targetChapter = chapters.find((c) => c.id === targetId);
    const resolvedProv = targetChapter?.provider || manga?.resolvedProvider || provider;
    const coverParam = manga?.coverUrl ? `&cover=${encodeURIComponent(manga.coverUrl)}` : "";
    const mtParam = manga?.type ? `&mt=${encodeURIComponent(manga.type)}` : "";
    /* Resume into the shelf's own mangaId when the entry arrived from another
       source — otherwise the reader appends a second card for the same title
       under the current provider's id. */
    const mangaParam = resumeEntry?.mangaId || mangaId;
    const pageParam = resume && resume.page > 1 ? `&p=${resume.page}` : "";
    router.push(
      `/read/${encodeURIComponent(targetId)}?provider=${resolvedProv}&pp=${provider}&manga=${encodeURIComponent(mangaParam)}&t=${encodeURIComponent(title)}${coverParam}${mtParam}${pageParam}`
    );
  };

  const findFirstChapter = (): string | null => {
    if (chapters.length === 0) return null;
    return chapters[chapters.length - 1].id;
  };

  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!manga || !heroRef.current) return;
    gsap.fromTo(
      heroRef.current,
      { autoAlpha: 0, y: 16 },
      { autoAlpha: 1, y: 0, duration: 0.5, ease: "power2.out" }
    );
  }, [manga]);

  const sortedChapters = useMemo(() => {
    if (!chapters.length) return [];
    return sortOrder === "asc"
      ? [...chapters].sort((a, b) => parseFloat(a.chapterNumber || "0") - parseFloat(b.chapterNumber || "0"))
      : chapters;
  }, [chapters, sortOrder]);

  const handleSimilar = async () => {
    setSimilarOpen(!similarOpen);
    if (!similarOpen && similarTitles.length === 0 && !similarLoading) {
      setSimilarLoading(true);
      try {
        const queryTitle = encodeURIComponent(title.split(/[:–—-]/)[0].trim());
        const res = await fetch(`${API_URL}/api/similar?title=${queryTitle}`);
        const data = await res.json();
        setSimilarTitles(data.results || []);
      } catch (err) {
        console.error("Failed to load similar titles:", err);
      } finally {
        setSimilarLoading(false);
      }
    }
  };

  if (loading) {
    return <CenteredLoader label="Loading title…" />;
  }

  if (!manga) {
    return (
      <div className="yomi-shell">
        <div
          style={{
            gridColumn: "1 / -1",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            gap: 8,
          }}
        >
          <span className="big" style={{ fontFamily: "var(--font-jp)", fontSize: 64, color: "var(--border)" }}>読</span>
          <p style={{ fontSize: 18, fontWeight: 600 }}>Title not found.</p>
          <Link href="/search" className="yomi-btn yomi-btn-ghost" style={{ marginTop: 18 }}>
            Search again
          </Link>
        </div>
      </div>
    );
  }

  const title = extractString(manga.title);
  const synopsis = extractString(manga.synopsis);

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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-3.5L5 21V4a1 1 0 0 1 1-1Z" />
          </svg>
        </Link>
        <div className="spacer" />
      </aside>

      <div className="yomi-main">
        <div className="yomi-view">
          {/* Hero header */}
          <div className="yomi-dtop" ref={heroRef} style={gradientStyle(`${provider}-${mangaId}`)}>
            <div className="blur" />
            <div style={{ position: "absolute", top: "calc(12px + var(--sat))", left: 12, zIndex: 3, display: "flex", gap: 8 }}>
              <BackButton
                fallback="/"
                style={{ background: "oklch(10% 0 0 / 0.35)", backdropFilter: "blur(8px)", color: "var(--fg)" }}
              />
            </div>

            <div className="inner">
              <div className="yomi-cover" style={gradientStyle(`${provider}-${mangaId}`)}>
                {manga.coverUrl ? (
                  <img src={getProxyUrl(manga.coverUrl)} alt={title} referrerPolicy="no-referrer" />
                ) : (
                  <span className="placeholder-glyph">{glyphFromTitle(title)}</span>
                )}
              </div>

              <div style={{ minWidth: 0 }}>
                <div className="eyebrow" style={{ color: "color-mix(in oklch, var(--fg) 60%, transparent)" }}>
                  {providerLabel(provider)} · {chapters.length} chapter{chapters.length === 1 ? "" : "s"}
                </div>
                <h1 style={{ marginTop: 6 }}>{title}</h1>

                <div className="yomi-dstats">
                  {score !== null && (
                    <span className="ds"><b>★ {score.toFixed(1)}</b></span>
                  )}
                  {chapters.length > 0 && (
                    <span className="ds"><b>{chapters.length}</b> ch</span>
                  )}
                  {status && (
                    <span className="ds"><b>{status}</b></span>
                  )}
                  {contProgress !== null && (
                    <span className="ds"><b>{contProgress}%</b> read</span>
                  )}
                </div>

                {genres.length > 0 && (
                  <div className="yomi-tags" style={{ marginTop: 14, marginBottom: 0 }}>
                    {genres.slice(0, 5).map((g) => (
                      <span key={g} className="yomi-chip" style={{ cursor: "default", fontSize: "0.7rem", padding: "5px 12px" }}>
                        {g}
                      </span>
                    ))}
                  </div>
                )}

                <div className="yomi-dcta">
                  {chapters.length > 0 ? (
                    <button className="yomi-btn yomi-btn-primary" onClick={startReading}>
                      <Play size={18} fill="currentColor" />
                      {resume
                        ? resume.label
                          ? `Continue · Ch ${resume.label}`
                          : "Continue reading"
                        : "Start Ch 1"}
                    </button>
                  ) : (
                    <span style={{ fontSize: 13, color: "var(--muted)", alignSelf: "center" }}>
                      Chapters read via a connected source.
                    </span>
                  )}
                  <button className={`yomi-btn ${inLibrary ? "" : "yomi-btn-ghost"}`} onClick={toggleLibrary}>
                    <Bookmark size={18} />
                    {inLibrary ? "In your library" : "+ Library"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="yomi-dbody">
            <div className="col1">
              <div className="yomi-dsec">
                <h2>Synopsis</h2>
                <p className="yomi-synop" ref={synopsisRef} style={expanded ? {} : { display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {synopsis || "No synopsis available for this title yet."}
                </p>
                {synopsis.length > 200 && (
                  <button
                    className="more-link"
                    onClick={() => setExpanded(!expanded)}
                    style={{ color: "var(--accent)", fontWeight: 600, fontSize: 13, marginTop: 8 }}
                  >
                    {expanded ? "Show less" : "Show more"}
                  </button>
                )}
              </div>

              <div className="yomi-dsec" style={{ marginTop: 26 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                  <h2 style={{ margin: 0 }}>
                    Chapters{" "}
                    <span className="yomi-mono" style={{ color: "var(--muted)", fontSize: 12 }}>
                      {chapters.length}
                    </span>
                  </h2>
                  <button
                    className="yomi-sort-select"
                    onClick={() => setSortOrder((o) => (o === "desc" ? "asc" : "desc"))}
                    style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                    title="Toggle chapter order"
                  >
                    {sortOrder === "desc" ? "Newest first" : "Oldest first"}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
                    </svg>
                  </button>
                </div>
                {chapters.length === 0 ? (
                  <div className="yomi-empty">No chapters translated yet.</div>
                ) : (
                  <div className="yomi-chlist">
                    {sortedChapters.map((chapter) => {
                      const num = chapter.chapterNumber;
                      const isContinue = resume?.id === chapter.id;
                      const resolvedProv = chapter.provider || manga?.resolvedProvider || provider;
                      const coverParam = manga?.coverUrl ? `&cover=${encodeURIComponent(manga.coverUrl)}` : '';
                      return (
                        <Link
                          key={chapter.id}
                          href={`/read/${encodeURIComponent(chapter.id)}?provider=${resolvedProv}&pp=${provider}&manga=${mangaId}&t=${encodeURIComponent(title)}${coverParam}${manga?.type ? `&mt=${encodeURIComponent(manga.type)}` : ""}`}
                          className={`yomi-chrow ${isContinue ? "current" : ""}`}
                        >
                          <span className="cn">
                            <b>#{num}</b>
                          </span>
                          <span className="ct">{chapter.title || `Chapter ${num}`}</span>
                          {isContinue && (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: "var(--accent-ink)",
                                background: "var(--accent)",
                                borderRadius: 7,
                                padding: "2px 8px",
                                fontFamily: "var(--font-mono)",
                              }}
                            >
                              CONTINUE
                            </span>
                          )}
                          <span className="cd">
                            {chapter.createdAt
                              ? new Date(chapter.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                              : ""}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="col2">
              <div className="yomi-dsec">
                <h2>About</h2>
                <div className="yomi-tags">
                  {[
                    { k: "Provider", v: provider },
                    { k: "Chapters", v: String(chapters.length) },
                  ].map((stat) => (
                    <span key={stat.k} className="yomi-chip" style={{ cursor: "default" }}>
                      {stat.k}: <b style={{ color: "var(--fg)", fontWeight: 600 }}>{stat.v}</b>
                    </span>
                  ))}
                </div>
                <div style={{ marginTop: 16 }}>
                  <button
                    className="yomi-btn yomi-btn-ghost"
                    style={{ width: "100%", justifyContent: "space-between" }}
                    onClick={handleSimilar}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      Find similar titles
                    </span>
                    <ChevronRight size={16} style={{ transform: similarOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s" }} />
                  </button>
                  {similarOpen && (
                    <div className="yomi-similar-list" style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                      {similarLoading ? (
                        <div style={{ padding: "12px", textAlign: "center", fontSize: "14px", color: "var(--muted)" }}>
                          Loading...
                        </div>
                      ) : similarTitles.length === 0 ? (
                        <div style={{ padding: "12px", textAlign: "center", fontSize: "14px", color: "var(--muted)" }}>
                          No similar titles found.
                        </div>
                      ) : (
                        similarTitles.map((st) => (
                          <Link
                            key={st.id}
                            href={`/manga/${encodeURIComponent(st.id)}?provider=${st.provider}`}
                            className="yomi-ccard"
                            style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "8px", background: "color-mix(in oklch, var(--elevated) 40%, transparent)", borderRadius: "var(--radius)", textDecoration: "none", color: "inherit" }}
                          >
                            <img src={st.coverUrl || ""} alt={st.title} style={{ width: 40, height: 56, objectFit: "cover", borderRadius: "4px" }} />
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, overflow: "hidden" }}>
                              <span style={{ fontWeight: 600, fontSize: "14px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{st.title}</span>
                              <span style={{ fontSize: "12px", color: "var(--muted)", textTransform: "uppercase" }}>{st.type || "Manga"}</span>
                            </div>
                          </Link>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}