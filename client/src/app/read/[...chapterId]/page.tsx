"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { API_URL, getProxyUrl, getMangaType, getMangaTitle, extractString, looksLikeId, modeForType, detectTypeFromTitle, detectTypeFromGeometry, detectKnownWebtoon, rememberType, rememberTitle, findChapterById, getModeOverride, rememberModeOverride, type Chapter } from "@/lib/types";
import { navReplace } from "@/lib/navHistory";
import { useNav } from "@/contexts/NavContext";
import gsap from "gsap";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Moon,
  Sun,
  Lamp,
  Menu,
  X,
  BookOpen,
  PanelsTopLeft,
  ArrowLeft,
  Home,
  Maximize,
  Minimize,
} from "lucide-react";

type Mode = "vertical" | "paginated";

/* One in-flight page-turn gesture. `id` pins the turn to the pointer that
   started it so a resting second finger can't hijack the rotation, `dir` is
   locked once the axis is decided so the page never reverses mid-drag, and
   `samples` drives flick velocity from the last ~90ms of travel. */
type DragState = {
  active: boolean;
  id: number;
  type: "mouse" | "touch" | "pen";
  x: number;
  y: number;
  t: number;
  moved: boolean;
  dir: 0 | 1 | -1;
  originSet: boolean;
  samples: { x: number; t: number }[];
  rot: ((v: number) => void) | null;
  shade: ((v: number) => void) | null;
  /* Last rotation progress actually painted (0..1). playFlip() resumes from
     here instead of snapping back to flat, which is what made a swipe read as
     a glitch while a tap (progress always 0) looked perfect. */
  u: number;
  /* Direction the back layer was pre-pointed at for this gesture; 0 = not yet.
     Loading starts the moment the axis locks so the image is usually decoded by
     the time the finger lifts. */
  prepared: 0 | 1 | -1;
};

/* Total pivot range for a single page turn, in degrees.
   90° is the meaningful limit: that's where the turning face is fully edge-on
   (backface-visibility drops it) and the incoming page is completely revealed
   underneath. The old ±172° spent the second half of every turn rotating
   something nobody could see, which stretched the timeline and kept the flip
   lock held after the page had already visually changed — the single biggest
   reason a turn felt like it hung before handing over. A shared constant keeps
   the drag-follow and the release animation on one identical curve. */
const FLIP_DEG = 96;

/* Peak fold-shadow opacity, shared so the shadow the finger builds while
   dragging is exactly the shadow the release continues from. */
const FLIP_SHADE = 0.6;

/* Locate the active chapter in a chapter list. We match by id first, but ids
   can be re-encoded by the router (%2F etc.) and stop matching byte-for-byte
   — so fall back to a numeric comparison on the chapter number. This is what
   keeps prev/next chapter working regardless of how the id round-tripped. */
function resolveChapterIndex(list: Chapter[], id: string): number {
  const cleaned = (s: string) => s.toLowerCase().replace(/\/+$/g, "");
  const byId = list.findIndex((c) => cleaned(c.id) === cleaned(id));
  if (byId !== -1) return byId;
  const decoded = decodeURIComponent(id);
  const byDecoded = list.findIndex((c) => cleaned(c.id) === cleaned(decoded));
  if (byDecoded !== -1) return byDecoded;
  const byNum = list.findIndex((c) => String(c.chapterNumber || "") === String(decoded));
  if (byNum !== -1) return byNum;
  const n = parseFloat(String(id).match(/(\d+(?:\.\d+)?)/)?.[1] || "");
  if (!Number.isNaN(n)) {
    let best = -1;
    let bestDiff = Infinity;
    list.forEach((c, i) => {
      const cn = parseFloat(
        String(c.chapterNumber || "").match(/(\d+(?:\.\d+)?)/)?.[1] || ""
      );
      if (!Number.isNaN(cn)) {
        const diff = Math.abs(cn - n);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = i;
        }
      }
    });
    return best;
  }
  return -1;
}

/* Chapters and their manga are different ids — if the reader was opened with
   only the chapter id (e.g. an old continue-reading entry), recover the manga
   id from the chapter id itself. WeebCentral chapter ids are shaped
   `series/<slug>/chapters/<id>`, so the manga id is everything before the
   `/chapters/` marker. */
function recoverMangaId(chapterId: string, provider?: string): string {
  if (String(provider).toLowerCase() === "weebcentral") {
    const i = chapterId.indexOf("/chapters/");
    if (i !== -1) return chapterId.slice(0, i);
    const m = chapterId.match(/^(series\/[^/]+)/);
    if (m) return m[1];
  }
  return "";
}

export default function ReaderPage() {
  return (
    <Suspense
      fallback={
        <div style={{ height: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
          <div className="yomi-spinner" />
        </div>
      }
    >
      <ReaderContent />
    </Suspense>
  );
}

function ReaderContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { goBack, canGoBack, label: backLabel } = useNav();
  const { user, syncData } = useAuth();
  const syncTimerRef = useRef<NodeJS.Timeout | null>(null);
  const provider = searchParams.get("provider") || "weebcentral";
  
  const sourceMangaId =
    searchParams.get("manga") ||
    recoverMangaId(
      ((params?.chapterId as string[]) || []).join("/"),
      provider
    ) ||
    "";

  /* Where "back" lands when this chapter was opened directly — a shared link,
     a refresh, or a cold tab. With no real parent behind us there is nothing to
     pop, so the control has to name a destination instead of relying on one. */
  const detailHref = sourceMangaId
    ? `/manga/${encodeURIComponent(sourceMangaId)}?provider=${provider}`
    : "/";

  const [title, setResolvedTitle] = useState<string>(() => {
    let t = searchParams.get("t");
    if (!t || looksLikeId(t) || t === "Unknown Title" || t === "Unknown") {
      const slug = sourceMangaId?.split("/").pop() || "";
      if (looksLikeId(slug)) {
          t = getMangaTitle(sourceMangaId || "", provider) || "Unknown Title";
      } else {
          t = slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      }
    }
    return t || "Unknown Title";
  });
  
  const destParam = searchParams.get("p");
  /* Auto mode comes from the URL `mt=` first; when it's missing (direct link,
     refresh, continue-card) we fall back to the persisted type registry so a
     manhwa still opens in scroll and a manga in page-flip. */
  const [typeParam, setTypeParam] = useState<string | undefined>(
    () => {
      const mt = searchParams.get("mt");
      if (mt) return mt;
      return getMangaType(sourceMangaId, provider, title || undefined);
    }
  );

  const chapterIdArray = (params?.chapterId as string[]) || [];
  const chapterId = chapterIdArray.join("/");

  const { theme, toggleTheme } = useTheme();
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  /* Which chapter the currently-mounted `images` actually belong to. While a
     chapter turn is in flight the old array is still on screen; this lets the
     boundary nav (end panel / edge pills) stay hidden until the *new* chapter's
     pages land, instead of lingering over the outgoing chapter. */
  const [readyChapterId, setReadyChapterId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);

  /* ── Reading mode resolution ────────────────────────────────────────────────
     Four inputs, in strict priority order:

       1. a saved user override — "I always read THIS title vertically"
       2. `mt=` in the URL        — an explicit "open this as webtoon/manga"
       3. the detected type       — manhwa → scroll, manga → page flip
       4. `yomi.mode`              — the last global default the user left behind

     The override outranks even the URL param on purpose. The reader round-trips
     its own detected type back through `mt=` on chapter navigation, so if the
     param won, a user who forced a title vertical would be snapped back to page
     flip the moment they turned to the next chapter.

     Detection has to yield to an explicit choice in general: the MangaDex probe
     lands a second after the chapter opens, and without this ordering it would
     overwrite the mode the reader is mid-way through. Detection data and user
     preference live in separate stores precisely so neither clobbers the other. */
  const autoMode = modeForType(typeParam);
  const modeOverride = getModeOverride(sourceMangaId, provider, title || undefined);
  /* Mirrors modeOverride for the sync effect. Reading the store during render
     alone is not enough: tapping the mode you are already in produces no state
     change, so React skips the re-render and the freshly saved override would
     stay invisible — letting the next probe result yank the mode anyway. The
     ref is written synchronously by the toggle, so it is always current. */
  const modeOverrideRef = useRef<Mode | null>(modeOverride);
  modeOverrideRef.current = modeOverride;
  /* Set once a verdict is KNOWN rather than guessed. The provider's `manga.type`
     and the persisted registry are only hints — they arrive pre-filled with
     "manga" for series that are really manhwa. An authoritative verdict comes
     from an exact-title catalogue match or from page geometry, and it outranks
     the `mt=` hint baked into the URL by the search/detail pages. */
  const authoritativeRef = useRef<string>("");
  const [mode, setMode] = useState<Mode>(() => {
    if (modeOverride) return modeOverride;
    /* A settled webtoon answer is known before the first paint, so it can be
       applied immediately instead of flashing the provider's "manga" hint and
       correcting a beat later. */
    const settled = modeForType(detectKnownWebtoon(title || ""));
    if (settled) return settled;
    const fromUrl = modeForType(searchParams.get("mt") || undefined);
    if (fromUrl) return fromUrl;
    if (autoMode) return autoMode;
    try {
      const saved = localStorage.getItem("yomi.mode");
      if (saved === "vertical" || saved === "paginated") return saved as Mode;
    } catch {}
    // Sensible default: paginated (page flip) experience. Untyped titles get
    // corrected below once the MangaDex probe resolves.
    return "paginated";
  });
  const [lampOn, setLampOn] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("yomi.lamp") === "1";
    }
    return false;
  });
  const [fitMode, setFitMode] = useState<"contain" | "width">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("yomi.fit") as "contain" | "width") || "contain";
    }
    return "contain";
  });
  const [page, setPage] = useState(1);
  const [chromeVisible, setChromeVisible] = useState(true);
  /* Immersive / focus mode: every bar, hairline and affordance is stripped so
     only the artwork remains. A tap in the middle enters or leaves it. It is a
     deliberate user choice, so it is remembered like any other reader setting —
     but it never touches detection state. */
  const [immersive, setImmersive] = useState<boolean>(() => {
    try {
      return localStorage.getItem("yomi.immersive") === "1";
    } catch {}
    return false;
  });
  /* Read inside pointer/scroll handlers, which must not re-subscribe to state. */
  const immersiveRef = useRef(immersive);
  immersiveRef.current = immersive;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuOpen;

  /* Keep the reader in step with auto-detection when it moves between titles
     (route params change but the component stays mounted) — but never over a
     standing user choice for this title, and never over an explicit `mt=` link. */
  useEffect(() => {
    if (modeOverrideRef.current) return;
    /* An authoritative verdict wins over the `mt=` hint: that param is whatever
       the provider's `type` field said, which is frequently "manga" for a
       manhwa, and letting it reassert on every render would undo the fix. */
    const fromUrl = authoritativeRef.current
      ? modeForType(typeParam)
      : modeForType(searchParams.get("mt") || undefined);
    const next = fromUrl || modeForType(typeParam);
    if (next) setMode(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeParam, modeOverride, searchParams]);

  /* ── Type auto-detection (authoritative source of truth for manga vs manhwa) ──
   * Uses the single canonical MangaDex probe from types.ts (exact-title-primary
   * match first, per-case normalization, limit=24). It is NOT gated on the
   * persisted registry: cached guesses — backend `manga.type`, weebcentral path
   * heuristics, or old inline scans that flipped manga with a Korean scanlation
   * name (e.g. Vagabond → "Bulmyeollangin") — may be wrong, and the probe result
   * OVERWRITES them so the registry heals permanently across sessions.
   *
   * The probe deliberately returns "" when MangaDex has no exact match instead of
   * reading a language off the nearest unrelated hit. That honest "unknown" is
   * what hands off to the geometry pass below. */
  const probeKeyRef = useRef<string | null>(null);
  /* The chapter-list payload's synopsis, which is where scanlation backends
     state the format outright ("...covering in Action, Webtoons genres ... at
     MangaBuddy") while reporting `type: "manga"`. It arrives with the chapter
     list, i.e. after the first probe already ran, so it is a separate input
     rather than something the first probe could have seen. */
  const [synopsis, setSynopsis] = useState<string>("");
  /* State, not a ref: the pages can finish downloading before the probe answers,
     and a ref flip would not re-run the geometry effect that is waiting on it. */
  const [probeDone, setProbeDone] = useState(false);
  useEffect(() => {
    if (!title || title === "Unknown Title" || !sourceMangaId) return;
    /* The synopsis is part of the key: it arrives after the first probe has
       already cached its "unknown", and without it the genre verdict would never
       be re-read. */
    const probeKey = sourceMangaId + "|" + title + "|" + (synopsis ? "syn" : "");
    if (probeKeyRef.current === probeKey) return;
    probeKeyRef.current = probeKey;
    setProbeDone(false);

    /* The synopsis landing re-keys this effect, so a slow first probe can still
       be in flight when the second one starts. Without a guard the older reply
       can land last and overwrite the verdict we now trust more. */
    let cancelled = false;
    (async () => {
      try {
        const resolved = await detectTypeFromTitle(extractString(title), synopsis);
        if (cancelled || !resolved) return;

        authoritativeRef.current = resolved;
        rememberType(sourceMangaId, resolved, extractString(title));
        if (resolved !== typeParam) setTypeParam(resolved);
        try {
          const cont = JSON.parse(localStorage.getItem("yomi.continue") || "[]");
          const idx = cont.findIndex(
            (x: any) => x.id === chapterId || (sourceMangaId && x.mangaId === sourceMangaId)
          );
          if (idx > -1 && cont[idx].type !== resolved) {
            cont[idx].type = resolved;
            localStorage.setItem("yomi.continue", JSON.stringify(cont));
          }
        } catch {}
      } catch {} finally {
        if (!cancelled) setProbeDone(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [title, sourceMangaId, chapterId, typeParam, synopsis]);

  /* ── Geometry pass: the backstop for anything a title lookup cannot resolve ────
   * MangaDex is not a complete catalogue, and its ranked result window can push
   * the correct record out of reach for some titles. The probe reports that as
   * an honest "unknown" rather than guessing, and the artwork the reader is
   * already downloading is the remaining evidence: a webtoon strip is several
   * times taller than it is wide.
   *
   * This is deliberately ONE-WAY. A decisive strip proves a webtoon, but a
   * low ratio proves nothing — plenty of webtoon uploads are re-cut into
   * near-square pages (the GoHS mirror ships 690x1280, ratio 1.86), so inferring
   * "manga" from the shape would confidently mislabel them. It never demotes.
   *
   * Runs only after the probe reports back and only while nothing authoritative
   * is known, so it corrects a wrong provider hint without ever overruling a
   * real title match or a standing user choice. */
  const geometryKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!images.length || !sourceMangaId) return;
    if (!probeDone || authoritativeRef.current) return;
    if (modeOverrideRef.current) return;
    const geomKey = sourceMangaId + "|" + images.length;
    if (geometryKeyRef.current === geomKey) return;
    geometryKeyRef.current = geomKey;

    let cancelled = false;
    type GeometryVerdict = "manhwa" | "";
    (async () => {
      const sample = images.slice(0, 3);
      /* Any strip evidence is enough — a single decisive page settles it, since
         the alternative reading (a manga page) can never be *proven* by shape. */
      const votes: ("manhwa")[] = [];
      for (const src of sample) {
        const verdict = await new Promise<GeometryVerdict>((resolve) => {
          const probe = new Image();
          probe.onload = () => resolve(detectTypeFromGeometry(probe.naturalWidth, probe.naturalHeight));
          probe.onerror = () => resolve("");
          probe.src = getProxyUrl(src);
        });
        if (verdict) votes.push(verdict);
      }
      if (cancelled || !votes.length) return;
      const verdict = "manhwa" as const;

      authoritativeRef.current = verdict;
      rememberType(sourceMangaId, verdict, title);
      if (verdict !== typeParam) setTypeParam(verdict);
      setMode(modeForType(verdict) || "paginated");
      try {
        const cont = JSON.parse(localStorage.getItem("yomi.continue") || "[]");
        const idx = cont.findIndex(
          (x: any) => x.id === chapterId || (sourceMangaId && x.mangaId === sourceMangaId)
        );
        if (idx > -1 && cont[idx].type !== verdict) {
          cont[idx].type = verdict;
          localStorage.setItem("yomi.continue", JSON.stringify(cont));
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, sourceMangaId, probeDone]);

  /* auto-scroll the chapter list to the current chapter when the drawer opens */
  useEffect(() => {
    if (!menuOpen) return;
    const timer = setTimeout(() => {
      const list = chapterListRef.current;
      if (!list) return;
      const current = list.querySelector(".yomi-dchrow.current");
      if (current) {
        const listRect = list.getBoundingClientRect();
        const itemRect = current.getBoundingClientRect();
        const offset = itemRect.top - listRect.top - listRect.height / 2 + itemRect.height / 2;
        list.scrollTo({ top: list.scrollTop + offset, behavior: "smooth" });
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [menuOpen]);

  const pageRef = useRef(1);
  pageRef.current = page;
  const flipping = useRef(false);
  /* Identifies the turn that currently owns the scene. A timeline whose token
     is stale (superseded or already committed) must never promote a layer —
     that double-promotion is what stacked a second copy of a page on screen. */
  const flipToken = useRef(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const chapterListRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveOnScrollEnd = useRef(() => {});

  /* paginated flip layers — front always sits on top and pivots away to
     reveal the back, which is always mounted underneath so it never pops */
  const sheetRef = useRef<HTMLDivElement>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const frontImgRef = useRef<HTMLImageElement>(null);
  const backRef = useRef<HTMLDivElement>(null);
  const backImgRef = useRef<HTMLImageElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState>({
    active: false,
    id: -1,
    type: "mouse",
    x: 0,
    y: 0,
    t: 0,
    moved: false,
    dir: 0,
    originSet: false,
    samples: [],
    rot: null,
    shade: null,
    u: 0,
    prepared: 0,
  });
  /* pointermove on a 120Hz digitizer fires 2–3× per frame; coalesce the paint
     so the rotating layer is written exactly once per frame. */
  const dragFrame = useRef(0);
  const dragPending = useRef<{ u: number; dir: 1 | -1 } | null>(null);
  const lastChrome = useRef(0);

  useEffect(() => {
    if (!chapterId) return;
    let cancelled = false;
    const fetchChapter = async () => {
      try {
        const res = await fetch(`${API_URL}/api/scrape`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: chapterId, provider, mangaId: sourceMangaId }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!data.images || data.images.length === 0) {
          setError("This chapter returned no pages.");
          return;
        }
        setImages(data.images);
        const total = data.images.length;

        // destination: explicit ?p= overrides the saved position
        let desired: number | null = null;
        if (destParam === "last") desired = total;
        else if (destParam && /^\d+$/.test(destParam))
          desired = Math.max(1, Math.min(parseInt(destParam, 10), total));
        if (desired == null) {
          try {
            const cont = JSON.parse(localStorage.getItem("yomi.continue") || "[]");
            const found = cont.find((x: any) => x.id === chapterId);
            if (found && found.page && found.page <= total) desired = found.page;
          } catch {}
        }
        /* Always land on a concrete page. Without a fallback a chapter opened
           with no saved position inherited the *outgoing* chapter's page number,
           so the fresh chapter booted mid-way down (usually at its own tail). */
        const target = desired ?? 1;
        setPage(target);
        pageRef.current = target;
        /* Pages are in — the boundary nav for THIS chapter may show now. */
        setReadyChapterId(chapterId);
      } catch (e: any) {
        if (!cancelled) setError(e.message || "Failed to load chapter.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchChapter();
    return () => {
      cancelled = true;
    };
  }, [chapterId, provider, destParam]);

  /* chapter list for the drawer + prev/next chapter nav */
  useEffect(() => {
    if (!sourceMangaId || provider === "jikan") return;
    let cancelled = false;
    
    // We use a tiny 50ms deferral just to push it to the next tick so React paints the shell first
    const tmr = setTimeout(async () => {
      try {
        const primaryProvider = searchParams.get("pp") || provider;
        const res = await fetch(
          `${API_URL}/api/manga/${encodeURIComponent(sourceMangaId)}/chapters?provider=${primaryProvider}`
        );
        let data: any = {};
        if (res.ok) {
          data = await res.json();
        }
        if (cancelled) return;
        /* Capture the authoritative title from the chapter-list payload so the
           registry learns it even when the reader was entered without `t=`. */
        const realTitle = data?.manga?.title ? extractString(data.manga.title) : "";
        if (realTitle && !looksLikeId(realTitle)) {
          rememberTitle(sourceMangaId, realTitle);
          /* NOTE: we deliberately do NOT persist the backend-provided type here.
             The MangaDex exact-title probe in the effect above is the single
             authoritative classifier and always overrides cached values;
             backend `manga.type` guesses have proven unreliable (a manga slug
             resolved through MangaDex can come back typed "manhwa"). */
          setResolvedTitle(realTitle);
        }
        /* Keep the blurb: it is the only place these backends say what format
           the upload actually is. */
        setSynopsis(extractString(data?.manga?.synopsis || ""));
        const sorted = (data.chapters || [])
          .slice()
          .sort(
            (a: Chapter, b: Chapter) =>
              parseFloat(b.chapterNumber || "0") - parseFloat(a.chapterNumber || "0")
          );
        setChapters(sorted);
      } catch {}
    }, 50);
    
    return () => {
      cancelled = true;
      clearTimeout(tmr);
    };
  }, [sourceMangaId, provider]);

  useEffect(() => {
    if (error) {
      try {
        const cont = JSON.parse(localStorage.getItem("yomi.continue") || "[]");
        const filtered = cont.filter((x: any) => x.id !== chapterId);
        localStorage.setItem("yomi.continue", JSON.stringify(filtered));
      } catch {}
    }
  }, [error, chapterId]);

  const savePosition = useCallback(
    (p: number, total: number) => {
      try {
        const progress = Math.round((p / total) * 100);
        const cont = JSON.parse(localStorage.getItem("yomi.continue") || "[]");
        
        // Find existing entry by mangaId first to prevent duplicate chapter entries for the same manga
        let idx = -1;
        if (sourceMangaId) {
          idx = cont.findIndex((x: any) => x.mangaId === sourceMangaId);
        }
        if (idx === -1) {
          idx = cont.findIndex((x: any) => x.id === chapterId);
        }

        const existingItem = idx > -1 ? cont[idx] : null;
        
        // If title is missing or 'Unknown Title'/'Unknown', preserve the previous valid title if it exists
        let finalTitle = title;
        if ((!finalTitle || finalTitle === "Unknown Title" || finalTitle === "Unknown") && existingItem && existingItem.title && existingItem.title !== "Unknown Title" && existingItem.title !== "Unknown") {
            finalTitle = existingItem.title;
        }
        /* Never save an id-shaped placeholder as the title — resolve through
           the persisted title registry (learned from detail/chapter fetches)
           and keep the best name we have. */
        if (looksLikeId(finalTitle) || finalTitle === "Unknown Title" || finalTitle === "Unknown") {
            finalTitle =
              existingItem && !looksLikeId(existingItem.title) ? existingItem.title
              : getMangaTitle(sourceMangaId || "", provider) || "";
        }
        if (finalTitle && !looksLikeId(finalTitle)) rememberTitle(sourceMangaId || chapterId, finalTitle);

        const currentChapter = findChapterById(chapters, chapterId);
        /* Prefer the real chapter number from the list; never persist an
           id-shaped fallback (UUID/ULID) as the chapter label. */
        let resolvedChapter = currentChapter?.chapterNumber ? String(currentChapter.chapterNumber) : "";
        if (!resolvedChapter) {
          if (provider === "mangahere") {
            resolvedChapter = chapterId.split("/").pop() || "";
          } else {
            resolvedChapter = chapterId.split("-chapter-")[1] || "";
          }
          if (looksLikeId(resolvedChapter)) resolvedChapter = "";
        }

        const item = {
          id: chapterId,
          mangaId: sourceMangaId || (existingItem ? existingItem.mangaId : ""),
          title: finalTitle,
          coverUrl: searchParams.get("cover") || (existingItem ? existingItem.coverUrl : undefined),
          provider,
          chapter: resolvedChapter,
          page: p,
          progress,
          type: typeParam || getMangaType(sourceMangaId || "", provider) || (existingItem ? existingItem.type : undefined),
          updatedAt: Date.now(),
        };
        
        if (idx > -1) cont[idx] = item;
        else cont.unshift(item);
        
        // Sort by updatedAt descending
        cont.sort((a: any, b: any) => b.updatedAt - a.updatedAt);
        
        localStorage.setItem("yomi.continue", JSON.stringify(cont.slice(0, 20)));

        if (user) {
          if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
          syncTimerRef.current = setTimeout(() => {
            syncData();
          }, 3000); // 3 second debounce to avoid spamming the backend while scrolling
        }
      } catch {}
    },
    [chapterId, title, provider, sourceMangaId, searchParams, typeParam, chapters, user, syncData]
  );

  /* Heal continue entries already stored with an id-shaped chapter label
     (saved before the chapter list had loaded), or with missing/broken titles. */
  useEffect(() => {
    if (!chapters.length || !images.length) return;
    const cur = findChapterById(chapters, chapterId);
    if (!cur?.chapterNumber) return;
    try {
      const cont = JSON.parse(localStorage.getItem("yomi.continue") || "[]");
      const i = cont.findIndex(
        (x: any) => x.id === chapterId || (sourceMangaId && x.mangaId === sourceMangaId)
      );
      if (i > -1) {
        const needsHeal =
          looksLikeId(cont[i].chapter) ||
          !cont[i].chapter ||
          !cont[i].title ||
          cont[i].title === "Unknown Title" ||
          looksLikeId(cont[i].title);
        
        if (needsHeal) {
          savePosition(pageRef.current, images.length);
        }
      }
    } catch {}
  }, [chapters, images.length, chapterId, sourceMangaId, savePosition]);

  const updateProgressUI = useCallback((p: number, total: number) => {
    if (progressRef.current) {
      progressRef.current.style.width = `${((p - 1) / Math.max(total - 1, 1)) * 100}%`;
    }
  }, []);

  // Vertical scroll progress tracking
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || mode !== "vertical" || images.length === 0) return;

    const total = images.length;
    /* While the reader is actively scrolling, the chrome is dismissed instead
       of flashing on every flick. Inline (not a callback) so this effect keeps
       a stable dependency list. */
    let restoring = false;
    const dismissChrome = () => {
      if (restoring) return;
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      setChromeVisible(false);
    };

    const updateFromScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      const ratio = max > 0 ? el.scrollTop / max : 0;
      const cur = Math.max(1, Math.min(total, Math.round(ratio * (total - 1)) + 1));
      if (cur !== pageRef.current) {
        pageRef.current = cur;
        setPage(cur);
        savePosition(cur, total);
      }
      updateProgressUI(cur, total);
      dismissChrome();
    };

    const autoPlayPos = () => {
      if (pageRef.current > 1) {
        const el2 = scrollRef.current;
        if (!el2) return;
        restoring = true;
        const ratio = (pageRef.current - 1) / Math.max(total - 1, 1);
        el2.scrollTop = ratio * (el2.scrollHeight - el2.clientHeight);
        window.setTimeout(() => {
          updateFromScroll();
          window.setTimeout(() => {
            restoring = false;
          }, 200);
        }, 50);
      }
    };

    updateFromScroll();
    autoPlayPos();
    saveOnScrollEnd.current = () => savePosition(pageRef.current, total);
    el.addEventListener("scroll", updateFromScroll, { passive: true });
    el.addEventListener("scrollend", saveOnScrollEnd.current as EventListener, { passive: true });
    return () => {
      el.removeEventListener("scroll", updateFromScroll);
      el.removeEventListener("scrollend", saveOnScrollEnd.current as EventListener);
    };
  }, [images, mode, savePosition, updateProgressUI]);

  /* ── Paginated flip engine (rebuilt) ──
     Two layers always mounted: `.front` (current page, z-top) and `.back`
     (incoming page, beneath). Turning NEXT pivots the front over its LEFT
     edge until it's past 90° and backface-hidden, exposing the back; turning
     PREV pivots over its RIGHT edge. The flip only starts once the incoming
     image is decoded, so nothing pops in after the turn. */

  const total = images.length;
  const currentIdx = resolveChapterIndex(chapters, chapterId);
  /* chapters are sorted DESC (latest first): the next story chapter is an
     EARLIER array index, the previous story chapter a LATER one. */
  const prevCh =
    currentIdx >= 0 && currentIdx < chapters.length - 1
      ? chapters[currentIdx + 1]
      : null;
  const nextCh = currentIdx > 0 ? chapters[currentIdx - 1] : null;
  const hasPrev = !!prevCh;
  const hasNext = !!nextCh;
  /* Boundary nav is only trustworthy once the mounted pages belong to the
     chapter in the URL — otherwise it describes the chapter we just left. */
  const chapterReady = readyChapterId === chapterId && images.length > 0;

  /* ── Paginated flip engine (imperative — React never owns the scene imgs) ──
     Creating the page <img> elements by hand means a page change can never
     force a fresh network load of the image we're already looking at (that
     reload was the "repeat of the page I was on" flash). Two containers hold
     one image each: .flip-front is the visible top layer, .flip-back sits
     beneath. After a turn their roles swap IN PLACE — the image just revealed
     becomes the new front without being re-fetched. */
  const imgIn = (wrap: HTMLElement): HTMLImageElement => {
    let im = wrap.querySelector("img");
    if (!im) {
      im = document.createElement("img");
      im.draggable = false;
      im.referrerPolicy = "no-referrer";
      im.alt = "";
      wrap.appendChild(im);
    }
    return im;
  };

  const loadDecoded = (im: HTMLImageElement, src: string): Promise<void> =>
    new Promise((resolve) => {
      if (im.getAttribute("src") === src && im.complete && im.naturalWidth > 0) {
        resolve();
        return;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        im.removeEventListener("load", finish);
        im.removeEventListener("error", finish);
        resolve();
      };
      im.addEventListener("load", finish);
      im.addEventListener("error", finish);
      im.src = src;
      if (im.complete && im.naturalWidth > 0) resolve();
    });

  const fitSheet = useCallback(() => {
    const sc = sheetRef.current;
    const img = frontImgRef.current;
    if (!sc || !img || !img.naturalWidth) return;
    /* The flip sheet must ALWAYS fit entirely on screen — a 3D page-turn can
       only pivot correctly when the whole sheet is inside the viewport. So
       both modes scale to fit both axes; "fit to width" is simply the greedier
       one (fills more of the viewport with tighter margins), never an overflow. */
    const maxW = window.innerWidth - (fitMode === "width" ? 16 : 48);
    const maxH = Math.max(320, window.innerHeight - (fitMode === "width" ? 40 : 140));
    const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
    sc.style.width = `${Math.round(img.naturalWidth * scale)}px`;
    sc.style.height = `${Math.round(img.naturalHeight * scale)}px`;
  }, [fitMode]);

  useEffect(() => {
    fitSheet();
    const onR = () => fitSheet();
    window.addEventListener("resize", onR);
    const t = setTimeout(fitSheet, 60);
    return () => {
      window.removeEventListener("resize", onR);
      clearTimeout(t);
    };
  }, [fitSheet, page, mode, images]);

  /* ── Single source of truth for what each layer displays ───────────────────
     The front/back pair is rotated *in place* after every turn (CSS classes and
     refs swap, so the revealed page becomes the new front without another
     network load). That in-place swap is what makes the turn seamless — but it
     also means the layers can drift out of agreement with reality after an
     interrupted tween, and the symptom is exactly what was reported: two copies
     of a page stacked on the sheet, or a page that simply never appears.
     Recording the page each layer holds in `data-page` and reconciling both
     layers against the committed page number at every single commit makes that
     impossible — whatever the animation left behind, the next frame is
     authoritative and cannot duplicate. */
  const paintLayer = useCallback(
    (layer: HTMLElement, im: HTMLImageElement, n: number) => {
      if (n < 1 || n > images.length) {
        /* Nothing to show (past either end): clear it so a stale page can never
           linger under the sheet and peek out as a duplicate. */
        layer.dataset.page = "";
        im.removeAttribute("src");
        return;
      }
      layer.dataset.page = String(n);
      const src = getProxyUrl(images[n - 1]);
      /* Only touch src when it differs. Re-assigning an identical value drops
         the element back out of `complete` and forces a redundant decode. */
      if (im.getAttribute("src") !== src) im.src = src;
    },
    [images]
  );

  const syncLayers = useCallback(
    (cur: number) => {
      const f = frontRef.current;
      const b = backRef.current;
      if (!f || !b || !images.length) return;
      const now = Math.max(1, Math.min(cur, images.length));
      /* Re-assert the classes: they are what CSS keys z-index and
         backface-visibility off, so a drifted pair would render wrong. */
      f.classList.remove("yomi-flip-back");
      f.classList.add("yomi-flip-front");
      b.classList.remove("yomi-flip-front");
      b.classList.add("yomi-flip-back");
      const fi = imgIn(f);
      const bi = imgIn(b);
      frontImgRef.current = fi;
      backImgRef.current = bi;
      /* Front = the page being read, back = the one the next turn reveals. */
      paintLayer(f, fi, now);
      paintLayer(b, bi, now + 1);
      /* Both layers flat and opaque. A layer abandoned edge-on by an
         interrupted turn is invisible under backface-visibility, which reads as
         a page that failed to load. */
      gsap.killTweensOf([f, b]);
      gsap.set(f, { rotationY: 0, autoAlpha: 1, zIndex: 2, transformOrigin: "0% 50%" });
      gsap.set(b, { rotationY: 0, autoAlpha: 1, zIndex: 1 });
      /* The sheet is measured off the front image, so a differently-shaped
         incoming page has to re-fit the moment it becomes the front. */
      const fit = () => {
        if (fi.complete && fi.naturalWidth > 0) fitSheet();
      };
      fit();
      fi.onload = fit;
      bi.onload = fit;
    },
    [images.length, paintLayer, fitSheet]
  );

  /* bootstrap the two layers once pages are known (paginated) */
  useEffect(() => {
    if (mode !== "paginated" || !images.length) return;
    if (!frontRef.current || !backRef.current) return;
    syncLayers(pageRef.current);
  }, [mode, images, syncLayers]);

  /* after a flip the revealed back layer becomes the new front in place */
  const commitSwap = useCallback(
    (next: number) => {
      const f = frontRef.current;
      const b = backRef.current;
      if (f && b) {
        f.classList.remove("yomi-flip-front");
        f.classList.add("yomi-flip-back");
        b.classList.remove("yomi-flip-back");
        b.classList.add("yomi-flip-front");
        frontRef.current = b;
        backRef.current = f;
      }
      /* Clear the lock *before* reconciling: syncLayers resets the layers the
         turn just finished animating, and it must not be skipped because a turn
         still believes it owns the scene. */
      flipping.current = false;
      pageRef.current = next;
      setPage(next);
      /* The animation decides how the new page arrives; syncLayers decides what
         the reader is actually looking at. Running it here — rather than the
         hand-rolled parking the old turn needed — is what guarantees front === the
         committed page and back === the next one, with no third stale copy able
         to show through. */
      syncLayers(next);
      updateProgressUI(next, total);
      savePosition(next, total);
    },
    [total, syncLayers, savePosition, updateProgressUI]
  );

  /* How far the finger must travel to fully rotate the sheet. Scaled to the
     sheet so a swipe feels identical on a 390px phone and a 1440px desktop —
     a hardcoded pixel distance slams the page fully open on mobile. */
  const travelPx = useCallback(() => {
    const w = sheetRef.current?.offsetWidth || 0;
    return Math.max(88, (w || window.innerWidth) * 0.55);
  }, []);

  /* Point the back layer at the incoming page the moment the drag direction is
     known — not when the finger lifts. Only the *next* page was ever pre-pointed
     (during bootstrap / commit), so a backwards swipe hit playFlip with an
     unloaded layer and had to await a full network fetch while the page sat
     frozen at a half turn. That stall is invisible on a tap (the page is still
     flat) but glaring mid-swipe. Loading during the drag usually means the image
     is already decoded by the time the gesture commits. */
  const prepareTarget = useCallback(
    (dir: 1 | -1) => {
      const d = drag.current;
      if (d.prepared === dir) return;
      const target = pageRef.current + dir;
      if (target < 1 || target > images.length) return;
      const b = backRef.current;
      if (!b) return;
      d.prepared = dir;
      const bim = imgIn(b);
      backImgRef.current = bim;
      /* Whatever the previous turn left on this layer (rotated fully over, and
         therefore invisible under backface-visibility) has to be undone *before*
         the drag starts, not when the turn does — otherwise the incoming page is
         missing for the whole drag-follow and only appears on release. */
      gsap.killTweensOf(b);
      gsap.set(b, { rotationY: 0, autoAlpha: 1, zIndex: 1 });
      paintLayer(b, bim, target);
    },
    [paintLayer]
  );

  const cancelDragPaint = useCallback(() => {
    if (dragFrame.current) {
      cancelAnimationFrame(dragFrame.current);
      dragFrame.current = 0;
    }
    dragPending.current = null;
  }, []);

  /* Abandon the turn without advancing — used when a gesture is cancelled or
     released short of the threshold. */
  const springBack = useCallback(() => {
    const front = frontRef.current;
    const shade = shadeRef.current;
    if (!front || !shade) return;
    gsap.to(front, { rotationY: 0, duration: 0.34, ease: "power2.out", overwrite: "auto" });
    gsap.to(shade, { autoAlpha: 0, duration: 0.3, overwrite: "auto" });
  }, []);

  /* QuickSetters are bound to the element that is front *for this gesture*.
     Rebuilt on every pointerdown so a swap mid-turn can never leave the paint
     writing to a stale layer. */
  const beginDragPaint = useCallback((d: DragState) => {
    const front = frontRef.current;
    const shade = shadeRef.current;
    /* A spring-back from the previous gesture is still tweening; let it go or
       it fights the new drag-follow writes. */
    if (front) gsap.killTweensOf(front);
    d.rot = front ? (gsap.quickSetter(front, "rotationY", "deg") as (v: number) => void) : null;
    d.shade = shade ? (gsap.quickSetter(shade, "autoAlpha") as (v: number) => void) : null;
  }, []);

  /* Drag-follow — rotation tracks the finger, coalesced to one write per frame
     so a high-rate touch digitizer can't outrun the compositor. */
  const dragStep = useCallback((u: number, dir: 1 | -1) => {
    /* Recorded synchronously, before the rAF: on release cancelDragPaint()
       drops any frame still in flight, so the last value written here is the
       only one playFlip() can trust as the starting rotation. */
    drag.current.u = u;
    dragPending.current = { u, dir };
    if (dragFrame.current) return;
    dragFrame.current = requestAnimationFrame(() => {
      dragFrame.current = 0;
      const p = dragPending.current;
      const d = drag.current;
      if (!p || !d.rot) return;
      if (!d.originSet) {
        d.originSet = true;
        const front = frontRef.current;
        if (front) gsap.set(front, { transformOrigin: p.dir === 1 ? "0% 50%" : "100% 50%" });
      }
      d.rot(p.dir === 1 ? -FLIP_DEG * p.u : FLIP_DEG * p.u);
      if (d.shade) d.shade(p.u * FLIP_SHADE);
    });
  }, []);

  const playFlip = useCallback(
    (dir: 1 | -1, target: number, startU = 0) => {
      const f = frontRef.current;
      const b = backRef.current;
      const shade = shadeRef.current;
      if (!f || !b || !shade || flipping.current || !images.length) return;
      if (target < 1 || target > images.length) return;

      /* Drop any queued drag-follow write first — otherwise a late rAF frame
         stomps the rotation the turn is resuming from. */
      cancelDragPaint();
      flipping.current = true;
      /* This turn now owns the scene. Anything that finishes late and finds a
         newer token must leave the DOM to the current owner instead of
         promoting layers a second time — two promotions is precisely how a
         duplicated page ends up on screen. */
      const token = ++flipToken.current;
      const origin = dir === 1 ? "0% 50%" : "100% 50%";
      const end = dir === 1 ? -FLIP_DEG : FLIP_DEG;
      const foldSide = dir === 1 ? "left" : "right";

      /* How far the finger already took the page. A tap is always 0 (the reset
         below is then invisible, which is why taps always looked right), but a
         swipe left the sheet at e.g. -60° — and yanking that back to flat before
         re-animating is the visible "snap" that read as a broken turn. Resume
         from the real rotation instead. */
      const u = Math.min(1, Math.max(0, startU));

      /* Under a power2.out sweep a ±96° turn crosses 90° at ~75% of its
         duration, so this is sized for the part of the turn that is actually
         visible: a tap completes its visible fold in ~0.31s and a page released
         near the end of a drag in ~0.21s. Scaling by remaining travel is what
         makes a flick feel like it was already mostly done. */
      const dur = 0.28 + 0.14 * (1 - u);
      const startRot = dir === 1 ? -FLIP_DEG * u : FLIP_DEG * u;
      const peak = FLIP_SHADE;

      const bim = imgIn(b);
      backImgRef.current = bim;
      /* Edge taps never run prepareTarget(), so the incoming page is pointed at
         here too — through the same path, so a layer can never be left showing
         whatever it happened to hold from an earlier turn. */
      paintLayer(b, bim, target);

      const commit = () => {
        if (token !== flipToken.current) return;
        commitSwap(target);
      };
      /* An abandoned turn still has to hand back a consistent scene: flattening
         only the front left the back wherever the kill caught it, which showed
         up as a page that was already half turned when the next one started. */
      const abandon = () => {
        if (token !== flipToken.current) return;
        flipping.current = false;
        syncLayers(pageRef.current);
      };

      const begin = () => {
        /* The turn may have been superseded while its page was decoding. */
        if (token !== flipToken.current) return;
        gsap.killTweensOf([f, b, shade]);
        gsap.set(f, { transformOrigin: origin, rotationY: startRot, autoAlpha: 1, zIndex: 2 });
        gsap.set(b, { rotationY: 0, autoAlpha: 1, zIndex: 1 });
        gsap.set(shade, {
          autoAlpha: Math.min(u * FLIP_SHADE, peak),
          background:
            foldSide === "left"
              ? "linear-gradient(to right, oklch(0% 0 0 / 0.5) 0%, oklch(0% 0 0 / 0.1) 24%, transparent 48%)"
              : "linear-gradient(to left, oklch(0% 0 0 / 0.5) 0%, oklch(0% 0 0 / 0.1) 24%, transparent 48%)",
        });

        /* Motion-sensitive readers still get a page change, just without the
           3D pivot — the incoming page is already decoded and mounted beneath. */
        let reduced = false;
        try {
          reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        } catch {}
        if (reduced) {
          gsap.set(f, { rotationY: 0 });
          gsap
            .timeline({
              onComplete: commit,
              onInterrupt: () => {
                gsap.set(f, { autoAlpha: 1 });
                abandon();
              },
            })
            .to(f, { autoAlpha: 0, duration: 0.16, ease: "none" }, 0);
          return;
        }

        const tl = gsap.timeline({
          onComplete: commit,
          onInterrupt: () => {
            gsap.set(f, { rotationY: 0, autoAlpha: 1 });
            gsap.set(shade, { autoAlpha: 0 });
            abandon();
          },
        });
        /* fromTo, not to: the sheet must keep turning from the angle the finger
           left it at. */
        tl.fromTo(
            f,
            { rotationY: startRot },
            /* power2.out, not power3.inOut. An in-out curve spends its opening
               ~150ms barely moving at all, so a tapped page sat flat, then
               lurched — the transition never felt like it *started*. power2.out
               leaves the hand immediately and decelerates into the fold, which is
               also exactly what a swipe needs: the finger already supplied the
               momentum, so the turn should coast to a stop, not re-accelerate. */
            { rotationY: end, duration: dur, ease: "power2.out" },
            0
          )
          /* Soften the handover. Crossing 90° flips the turning face's
             backface-visibility in a single frame, which pops the old page out
             hard at the exact instant the page changes. Blending that face away
             across the crossing is a true cross-fade — the incoming page is
             already opaque and mounted underneath — so the turn stays
             continuous. The window is wide and linear on purpose: it must
             straddle 90° no matter how the rotation above is eased. */
          .to(f, { autoAlpha: 0, duration: dur * 0.5, ease: "none" }, dur * 0.16)
          /* Fold shadow: builds as the page lifts, holds through the fold, then
             releases just after the turning face goes edge-on (~75% of a
             power2.out sweep). Keyed to the rotation's own timing rather than
             arbitrary offsets, so the shading stays locked to the geometry. */
          .to(shade, { autoAlpha: peak, duration: dur * 0.25, ease: "power1.out" }, 0)
          .to(shade, { autoAlpha: 0, duration: dur * 0.34, ease: "power2.in" }, dur * 0.6);
      };

      /* Fast path. prepareTarget() normally has the incoming page decoded and
         painted before the finger even lifts, so in the common case the turn
         starts on the *same frame* as the release. Awaiting even an
         already-resolved promise parked the sheet at its dragged angle for a
         frame or more — a hitch at the very start of every swipe. Only pay for
         the wait when the page genuinely isn't there yet. */
      if (bim.complete && bim.naturalWidth > 0) begin();
      else loadDecoded(bim, (bim.getAttribute("src") || "")).then(begin, begin);
    },
    [images.length, commitSwap, cancelDragPaint, paintLayer, syncLayers]
  );

  const turn = useCallback(
    (dir: 1 | -1): boolean => {
      if (mode !== "paginated" || flipping.current || images.length === 0) return false;
      const cur = pageRef.current;
      const target = cur + dir;
      if (target < 1 || target > images.length) return false;
      playFlip(dir, target);
      return true;
    },
    [mode, images.length, playFlip]
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== "paginated" || flipping.current) return;
    const d = drag.current;
    /* A second finger (pinch attempt, resting thumb) must never take over a
       turn already in flight. */
    if (d.active) return;
    d.active = true;
    d.id = e.pointerId;
    d.type = e.pointerType === "touch" ? "touch" : e.pointerType === "pen" ? "pen" : "mouse";
    d.x = e.clientX;
    d.y = e.clientY;
    d.t = Date.now();
    d.moved = false;
    d.dir = 0;
    d.originSet = false;
    d.u = 0;
    d.prepared = 0;
    d.samples = [{ x: e.clientX, t: d.t }];
    beginDragPaint(d);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    showChrome();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d.active || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;

    /* A fingertip wobbles 8–15px on a plain tap. With too small a gate every
       tap registers as a micro-drag: the page tilts a few degrees and snaps
       back — which reads as a stutter on every touch. */
    const gate = d.type === "mouse" ? 5 : 12;
    if (!d.moved) {
      if (Math.abs(dx) < gate && Math.abs(dy) < gate) return;
      d.moved = true;
    }

    /* Decide (or re-decide) the axis until a turn is genuinely under way.
       This test used to run exactly once, behind `if (!d.moved)`, so an opening
       move with even a slight vertical bias latched dir = 0 and killed the whole
       gesture — the finger then settled into a perfectly horizontal swipe and
       nothing happened. Retesting while the direction is still undecided lets
       that gesture recover. Once dir is non-zero it stays locked, so the page
       never reverses mid-drag. */
    if (d.dir === 0) {
      if (Math.abs(dx) < gate || Math.abs(dx) < Math.abs(dy)) return;
      d.dir = dx < 0 ? 1 : -1;
      if (d.dir === 1 ? pageRef.current >= total : pageRef.current <= 1) {
        d.dir = 0; /* already at the end — don't let the page follow the finger */
        return;
      }
      /* Start fetching the incoming page now, while the finger is still down. */
      prepareTarget(d.dir);
    }

    const now = Date.now();
    d.samples.push({ x: e.clientX, t: now });
    if (d.samples.length > 8) d.samples.shift();
    dragStep(Math.min(Math.abs(dx) / travelPx(), 1), d.dir);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d.active || e.pointerId !== d.id) return;
    d.active = false;
    cancelDragPaint();
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}

    const dx = e.clientX - d.x;

    /* tap, or a swipe that never resolved into a turn */
    if (!d.moved || d.dir === 0) {
      if (!d.moved) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = e.clientX - rect.left;
        const w = rect.width;
        if (x < w * 0.3) turn(-1);
        else if (x > w * 0.7) turn(1);
        /* Middle tap is the immersive toggle, not a chrome nudge — it strips the
           chrome entirely (and brings it back from immersive), which is the
           behaviour the reader is supposed to have. */
        else {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const x = e.clientX - rect.left;
          const w = rect.width;
          if (x < w * 0.3) turn(-1);
          else if (x > w * 0.7) turn(1);
          else toggleImmersive();
        }
      } else {
        springBack();
      }
      d.u = 0;
      d.prepared = 0;
      return;
    }

    /* Flick velocity from the last ~90ms, so a fast short swipe still commits
       while a slow deliberate drag still needs real distance. */
    const now = Date.now();
    const recent = d.samples.filter((p) => now - p.t <= 90);
    const from = recent.length >= 2 ? recent[0] : d.samples[0];
    const to = d.samples[d.samples.length - 1];
    const dt = to.t - from.t;
    const vel = dt > 0 ? Math.abs(to.x - from.x) / dt : 0;

    const travel = travelPx();
    const should = Math.abs(dx) > travel * 0.34 || vel > 0.45;
    const target = pageRef.current + d.dir;
    const u = d.u;
    d.u = 0;
    d.prepared = 0;
    /* Hand the live rotation to playFlip so the turn continues from where the
       finger let go instead of resetting to flat first. */
    if (should && target >= 1 && target <= total) playFlip(d.dir, target, u);
    else springBack();
  };

  /* The UA took the gesture (system edge-swipe, browser pinch, orientation
     change). This used to run the tap/commit path on a *cancelled* event and
     fire phantom page turns — now it only flattens the page. */
  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d.active || (e.pointerId != null && e.pointerId !== d.id)) return;
    d.active = false;
    cancelDragPaint();
    springBack();
  };

  /* ── Chapter-jump teardown ──────────────────────────────────────────────────
     Stepping to another chapter tears the reader away from whatever turn it
     was running. If a fold tween is still in flight (or one is queued awaiting
     the incoming page's decode) its completion callback would otherwise
     promote a layer against the *new* chapter and leave the sheet half-turned —
     exactly the "broken animation" that showed up after the boundary
     Next / Previous buttons were added. Invalidate the owner, unlock the
     gesture, and flatten both layers the instant the chapter id changes, so
     the bootstrap sync (once the new pages land) starts from a clean scene. */
  useEffect(() => {
    flipToken.current += 1;
    flipping.current = false;
    cancelDragPaint();
    const d = drag.current;
    d.active = false;
    d.dir = 0;
    d.moved = false;
    d.u = 0;
    d.prepared = 0;
    /* Fresh chapter, fresh head: drop the outgoing chapter's scroll offset so
       the new pages open at the top (or the saved resume target) instead of
       inheriting wherever the previous chapter was left. */
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    const f = frontRef.current;
    const b = backRef.current;
    const shade = shadeRef.current;
    if (f && b) {
      gsap.killTweensOf([f, b, shade].filter(Boolean));
      f.classList.remove("yomi-flip-back");
      f.classList.add("yomi-flip-front");
      b.classList.remove("yomi-flip-front");
      b.classList.add("yomi-flip-back");
      frontRef.current = f;
      backRef.current = b;
      frontImgRef.current = imgIn(f);
      backImgRef.current = imgIn(b);
      gsap.set(f, { rotationY: 0, autoAlpha: 1, zIndex: 2, transformOrigin: "0% 50%" });
      gsap.set(b, { rotationY: 0, autoAlpha: 1, zIndex: 1 });
      if (shade) gsap.set(shade, { autoAlpha: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId]);

  const showChrome = useCallback(() => {
    /* Immersive mode is a hard lock: nothing about the gesture — scrolling,
       dragging, a flick — is allowed to bring the bars back. Only an explicit
       middle tap leaves it. */
    if (immersiveRef.current) return;
    setChromeVisible(true);
    /* Re-arming the auto-hide timer on every pointermove meant ~8 timer
       allocations a second while dragging; throttle it to a steady cadence. */
    const now = Date.now();
    if (now - lastChrome.current < 500) return;
    lastChrome.current = now;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (immersiveRef.current) return;
      setChromeVisible(false);
    }, 2600);
  }, []);

  /* Enter or leave immersive mode. Leaving restores the chrome immediately so
     the reader never has to hunt for it. */
  const toggleImmersive = useCallback(() => {
    const next = !immersiveRef.current;
    immersiveRef.current = next;
    setImmersive(next);
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    try {
      localStorage.setItem("yomi.immersive", next ? "1" : "0");
    } catch {}
    if (next) {
      /* An open drawer would sit on top of the "chrome-free" reader. */
      setMenuOpen(false);
      setChromeVisible(false);
    } else {
      lastChrome.current = 0;
      setChromeVisible(true);
      showChrome();
    }
  }, [showChrome]);

  const goChapter = useCallback(
    (dir: 1 | -1) => {
      const idx = resolveChapterIndex(chapters, chapterId);
      if (idx < 0) return;
      // desc order: next story chapter sits at idx-1, previous at idx+1
      const target = chapters[idx - dir];
      if (!target) return;
      const base = `/read/${encodeURIComponent(target.id)}?provider=${target.provider || provider}&manga=${sourceMangaId}&t=${encodeURIComponent(title)}&p=${dir === -1 ? "last" : "1"}`;
      const coverParam = searchParams.get("cover") ? `&cover=${encodeURIComponent(searchParams.get("cover") as string)}` : "";
      const mtParam = typeParam ? `&mt=${encodeURIComponent(typeParam)}` : "";
      const next = base + coverParam + mtParam;
      /* Chapter stepping rewrites the same screen, so it must not stack history.
         Pushing here meant backing out of chapter 40 replayed chapters 39…1
         before the reader finally let go of the title page. */
      navReplace(next);
      router.replace(next);
    },
    [chapters, chapterId, provider, sourceMangaId, title, router, typeParam, searchParams]
  );

  /* page-level navigation with chapter rollover at the edges */
  const tryPage = useCallback(
    (dir: 1 | -1) => {
      if (mode === "paginated") {
        if (images.length === 0) return;
        const cur = pageRef.current;
        if (dir === -1 && cur <= 1) {
          goChapter(-1);
          return;
        }
        if (dir === 1 && cur >= images.length) {
          goChapter(1);
          return;
        }
        turn(dir);
      } else if (mode === "vertical") {
        const el = scrollRef.current;
        if (!el) return;
        if (dir === -1) {
          if (el.scrollTop <= 4) goChapter(-1);
          else
            gsap.to(el, {
              scrollTop: Math.max(0, el.scrollTop - el.clientHeight * 0.92),
              duration: 0.45,
              ease: "power2.out",
            });
        } else {
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) goChapter(1);
          else
            gsap.to(el, {
              scrollTop: Math.min(el.scrollHeight, el.scrollTop + el.clientHeight * 0.92),
              duration: 0.45,
              ease: "power2.out",
            });
        }
      }
    },
    [mode, images.length, turn, goChapter]
  );

  // Keyboard nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        tryPage(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        tryPage(-1);
      } else if (e.key === "Escape") {
        if (menuOpenRef.current) {
          setMenuOpen(false);
          return;
        }
        /* Escape peels off one layer at a time — immersive first, so a stray
           Escape never throws the reader out of the chapter. */
        if (immersiveRef.current) {
          toggleImmersive();
          return;
        }
        /* detailHref already collapses to "/" when the chapter has no title behind
           it, so there is only one way out and one dependency to track. */
        goBack(detailHref);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tryPage, goBack, detailHref, toggleImmersive]);

  useEffect(() => {
    if (loading) return;
    showChrome();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [loading, showChrome]);

  /* preload neighbours so flips are instant */
  useEffect(() => {
    if (!images.length) return;
    [page + 1, page + 2, page - 1, page - 2].forEach((i) => {
      if (i >= 1 && i <= images.length) {
        const im = new Image();
        im.src = getProxyUrl(images[i - 1]);
      }
    });
  }, [page, images]);

  const toggleMode = (targetMode?: Mode) => {
    const next = targetMode || (mode === "vertical" ? "paginated" : "vertical");
    setMode(next);

    /* Two stores, two jobs. The global default is the fallback for titles we
       know nothing about; the per-title override is what actually sticks for
       this series. Neither writes to the type registry — doing that was what
       made the mode feel broken, because the next auto-detect pass would
       "correct" the type and flip the reader back mid-chapter. */
    try {
      localStorage.setItem("yomi.mode", next);
    } catch {}
    if (sourceMangaId) {
      rememberModeOverride(sourceMangaId, next, provider, title);
    }
    /* Publish synchronously — see modeOverrideRef. */
    modeOverrideRef.current = next;

    if (next === "vertical") {
      const el = scrollRef.current;
      if (el) {
        const ratio = (pageRef.current - 1) / Math.max(total - 1, 1);
        el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
      }
    }
  };

  /* ── Vertical-mode immersive toggle ───────────────────────────────────────
     The scroll container owns native scrolling here, so a turn is impossible
     and a plain pointerup is ambiguous — a flick ends on the page too. Only a
     genuine tap (short, and barely moved) counts; anything that travelled is
     treated as a scroll and left alone. */
  const vTap = useRef<{ x: number; y: number; t: number } | null>(null);

  const onVerticalTapDown = (e: React.PointerEvent<HTMLDivElement>) => {
    vTap.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  };

  const onVerticalTapUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = vTap.current;
    vTap.current = null;
    if (!start) return;
    if (Date.now() - start.t > 600) return; // long press
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 12) return; // a scroll
    /* Vertical mode's tap is intentionally ambiguous: if chrome is hidden but
       the reader isn't immersive yet, a single center tap must show it. If it's
       immersive, a single tap must exit. The toggleImmersive path already does
       the right thing (showing chrome when leaving). */
    if (immersiveRef.current || chromeVisible) {
      toggleImmersive();
    } else {
      showChrome();
    }
  };

  if (loading) {
    return (
      <div style={{ height: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "var(--bg)" }}>
        <div className="yomi-spinner" />
        <p style={{ color: "var(--muted)", fontSize: 14 }}>Loading chapter…</p>
      </div>
    );
  }

  if (error || images.length === 0) {
    return (
      <div style={{ height: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--bg)", textAlign: "center", gap: 6 }}>
        <span style={{ fontFamily: "var(--font-jp)", fontSize: 64, color: "var(--border)" }}>読</span>
        <p style={{ fontWeight: 600 }}>{error || "No pages to show."}</p>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>This provider may not have readable pages.</p>
        <button className="yomi-btn yomi-btn-ghost" style={{ marginTop: 18 }} onClick={() => goBack(detailHref)}>
          Go back
        </button>
      </div>
    );
  }

  /* The reader itself is no longer subscribed to pointer activity. It used to
     carry onPointerMove/onPointerDown that fired showChrome() on every single
     movement — so a vertical scroll fought the scroll handler over the chrome
     and the bars strobed back in for a frame on each flick. Chrome is now shown
     by deliberate interactions only: the paginated gesture handlers, and the tap
     that enters/leaves immersive mode. */
  const chromeShown = chromeVisible && !immersive;

  return (
    <div className={`yomi-reader ${immersive ? "immersive" : ""}`}>
      {/* Top chrome */}
      <div className={`yomi-r-chrome ${chromeShown ? "" : "hidden"}`}>
        <div className="yomi-r-top">
          <button className="yomi-iconbtn" onClick={() => router.push("/")} title="Back to home">
            <Home size={19} />
          </button>
          <button
            className="yomi-iconbtn"
            onClick={() => goBack(detailHref)}
            title={canGoBack ? `Back to ${backLabel}` : `Go to ${backLabel}`}
            aria-label={canGoBack ? `Back to ${backLabel}` : `Go to ${backLabel}`}
          >
            <ArrowLeft size={20} />
          </button>
          <div className="ttl">
            <b>{title}</b>
            <span>
              {currentIdx >= 0 ? `Chapter ${chapters[currentIdx].chapterNumber}` : `Chapter ${page}`} ·{" "}
              {/* Describe the mode actually in use. Labelling it from the
                  detected type used to contradict the screen whenever a saved
                  user override was winning. */}
              {mode === "vertical" ? "webtoon — scroll to advance" : "manga — tap or drag to turn"}
            </span>
          </div>
          <button className="yomi-iconbtn yomi-menu-btn" onClick={() => setMenuOpen(true)} title="Reader menu">
            <Menu size={20} />
          </button>
        </div>
        <div className="yomi-r-hair">
          <div className="yomi-r-hair-fill" ref={progressRef} />
        </div>
      </div>

      {/* Reader drawer (menu) */}
      <div className={`yomi-drawer-backdrop ${menuOpen ? "open" : ""}`} onClick={() => setMenuOpen(false)} />
      <div className={`yomi-drawer ${menuOpen ? "open" : ""}`}>
        <div className="yomi-drawer-head">
          <b>Reader menu</b>
          <button className="yomi-iconbtn" onClick={() => setMenuOpen(false)} title="Close" aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <div className="yomi-drawer-tools">
          <button
            className={`yomi-mini ${mode === "vertical" ? "active" : ""}`}
            onClick={() => {
              toggleMode("vertical");
              setMenuOpen(false);
            }}
            title="Vertical (scroll)"
          >
            <PanelsTopLeft size={17} />
            <span>Vertical</span>
          </button>
          <button
            className={`yomi-mini ${mode === "paginated" ? "active" : ""}`}
            onClick={() => {
              toggleMode("paginated");
              setMenuOpen(false);
            }}
            title="Page flip"
          >
            <BookOpen size={17} />
            <span>Page flip</span>
          </button>
          <button
            className={`yomi-mini ${lampOn ? "active" : ""}`}
            onClick={() => {
              setLampOn((v) => {
                localStorage.setItem("yomi.lamp", v ? "0" : "1");
                return !v;
              });
            }}
            title="Reading lamp"
          >
            <Lamp size={17} />
            <span>Lamp</span>
          </button>
          
          <button
            className={`yomi-mini ${mode === "paginated" && fitMode === "width" ? "active" : ""}`}
            onClick={() => {
              setFitMode((f) => {
                const next = f === "contain" ? "width" : "contain";
                localStorage.setItem("yomi.fit", next);
                return next;
              });
              setMenuOpen(false);
            }}
            title={fitMode === "width" ? "Fit to Screen" : "Fit to Width"}
            disabled={mode === "vertical"}
            style={{ opacity: mode === "vertical" ? 0.5 : 1 }}
          >
            {fitMode === "width" ? <Minimize size={17} /> : <Maximize size={17} />}
            <span>{fitMode === "width" ? "Fit Screen" : "Fit Width"}</span>
          </button>

          <button className="yomi-mini" onClick={() => { toggleTheme(); setMenuOpen(false); }} title="Toggle theme">
            {theme === "night" ? <Sun size={17} /> : <Moon size={17} />}
            <span>{theme === "night" ? "Paper" : "Night"}</span>
          </button>
        </div>

        <div className="yomi-drawer-label">
          Chapters <span className="mono">{chapters.length}</span>
        </div>
        {chapters.length === 0 ? (
          <div className="yomi-drawer-empty">
            <span className="big">読</span>
            Chapter list is unavailable here.
            <small>Open this title from its series page to browse chapters.</small>
          </div>
        ) : (
          <div className="yomi-drawer-list" ref={chapterListRef}>
          {chapters.map((c) => {
            const isCur = c.id === chapterId;
            return (
              <button
                key={c.id}
                className={`yomi-dchrow ${isCur ? "current" : ""}`}
                onClick={() => {
                  setMenuOpen(false);
                  const coverParam = searchParams.get("cover") ? `&cover=${encodeURIComponent(searchParams.get("cover") as string)}` : "";
                  const mtParam = typeParam ? `&mt=${encodeURIComponent(typeParam)}` : "";
                  const target = `/read/${encodeURIComponent(c.id)}?provider=${c.provider || provider}&manga=${sourceMangaId}&t=${encodeURIComponent(title)}${coverParam}${mtParam}`;
                  /* Same screen, different chapter — replace so the drawer is
                     not a one-way tunnel that browser Back has to unwind. */
                  navReplace(target);
                  router.replace(target);
                }}
              >
                <span className="cn">#{c.chapterNumber}</span>
                <span className="ct">Chapter {c.chapterNumber}</span>
                {isCur && <span className="cvh">READING</span>}
              </button>
            );
          })}
          </div>
        )}
      </div>

      {/* Pages */}
      <div
        ref={scrollRef}
        className={`yomi-pages ${mode === "vertical" ? "vertical" : "paginated"} ${mode === "paginated" && fitMode === "width" ? "fit-width" : ""} ${lampOn ? "lamp" : ""}`}
        onPointerDown={mode === "paginated" ? onPointerDown : onVerticalTapDown}
        onPointerMove={mode === "paginated" ? onPointerMove : undefined}
        onPointerUp={mode === "paginated" ? onPointerUp : onVerticalTapUp}
        onPointerCancel={mode === "paginated" ? onPointerCancel : undefined}
        style={lampOn ? { filter: "sepia(0.28) saturate(0.9)" } : undefined}
      >
        {mode === "vertical" ? (
          <div className="yomi-vpages">
            {images.map((src, i) => (
              <div key={`${chapterId}-${i}`} className="yomi-vpage">
                <img
                  src={getProxyUrl(src)}
                  alt={`Page ${i + 1}`}
                  referrerPolicy="no-referrer"
                  /* The opening slice must never show a blank gap while the
                     lazy loader warms up. */
                  loading={i < 2 ? "eager" : "lazy"}
                  decoding="async"
                  className="yomi-vpage-img"
                />
              </div>
            ))}
            {images.length === 0 && (
              <div className="yomi-empty-pages">No pages available for this chapter.</div>
            )}

            {/* End-of-chapter navigation — lives in the scroll flow so it is
                always visible when the reader reaches the last panel. It is
                intentionally NOT part of the auto-hiding chrome: a reader can
                advance without tapping to summon the bars, which keeps the
                immersive feel intact. The pointer handlers stop the panel's
                taps bubbling to .yomi-pages, whose vertical tap logic would
                otherwise read a button press as a center tap and toggle
                immersive mode out from under the navigation. */}
            {chapterReady && (
              <div
                className="yomi-chapend"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
              >
                <span className="yomi-chapend-mark" aria-hidden="true">読</span>
                <p className="yomi-chapend-kicker">End of Chapter</p>
                <h3 className="yomi-chapend-title">
                  {currentIdx >= 0 ? `Chapter ${chapters[currentIdx].chapterNumber}` : title}
                </h3>

                <div className="yomi-chapend-actions">
                  <button
                    className="yomi-chapend-btn prev"
                    onClick={() => goChapter(-1)}
                    disabled={!hasPrev}
                    title={hasPrev ? `Previous chapter · Ch ${prevCh?.chapterNumber}` : "No previous chapter"}
                  >
                    <ChevronsLeft size={18} />
                    <span className="lbl">
                      <small>Previous</small>
                      <b>{hasPrev ? `Ch ${prevCh?.chapterNumber}` : "No previous"}</b>
                    </span>
                  </button>
                  <button
                    className="yomi-chapend-btn next"
                    onClick={() => goChapter(1)}
                    disabled={!hasNext}
                    title={hasNext ? `Next chapter · Ch ${nextCh?.chapterNumber}` : "No next chapter"}
                  >
                    <span className="lbl">
                      <small>Next</small>
                      <b>{hasNext ? `Ch ${nextCh?.chapterNumber}` : "No next"}</b>
                    </span>
                    <ChevronsRight size={18} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="yomi-flip-scene">
            <div className="yomi-flip-sheet" ref={sheetRef}>
              <div className="yomi-flip-stack" />
              <div className="yomi-flip-back" ref={backRef} />
              <div className="yomi-flip-front" ref={frontRef} />
              <div className="yomi-flip-shade" ref={shadeRef} />
            </div>
          </div>
        )}
      </div>

      {/* Vertical tip */}
      {mode === "vertical" && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: "calc(20px + var(--sab))",
            transform: "translateX(-50%)",
            zIndex: 35,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--muted)",
            background: "color-mix(in oklch, var(--elevated) 90%, transparent)",
            padding: "6px 12px",
            borderRadius: 99,
            border: "1px solid var(--border)",
            backdropFilter: "blur(10px)",
            pointerEvents: "none",
            opacity: chromeShown ? 1 : 0,
            transition: "opacity 0.3s",
          }}
        >
          Tap center to toggle · Scroll to advance
        </div>
      )}

      {/* Page-flip chapter boundary — the same "always there" chapter step as
          the scroll-flow panel, surfaced on the first / last page so flippers
          never have to leave the immersive canvas to change chapters. */}
      {mode === "paginated" && (
        <>
          {chapterReady && page <= 1 && hasPrev && (
            <button
              className="yomi-chapedge prev"
              onClick={() => goChapter(-1)}
              title={`Previous chapter · Ch ${prevCh?.chapterNumber}`}
            >
              <ChevronsLeft size={16} /> Ch {prevCh?.chapterNumber}
            </button>
          )}
          {chapterReady && page >= total && hasNext && (
            <button
              className="yomi-chapedge next"
              onClick={() => goChapter(1)}
              title={`Next chapter · Ch ${nextCh?.chapterNumber}`}
            >
              Ch {nextCh?.chapterNumber} <ChevronsRight size={16} />
            </button>
          )}
        </>
      )}

      {/* Paginated tap-zone affordances (pointer-events none — the scene handles taps) */}
      {mode === "paginated" && (
        <>
          <div className={`yomi-tapz left ${page > 1 ? "" : "off"}`} aria-hidden="true">
            <span className="zf"><ChevronLeft size={22} /></span>
          </div>
          <div className={`yomi-tapz right ${page < total ? "" : "off"}`} aria-hidden="true">
            <span className="zf"><ChevronRight size={22} /></span>
          </div>
        </>
      )}
    </div>
  );
}