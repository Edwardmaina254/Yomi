/* Shared read-only view of the `yomi.continue` shelf.
   The reader owns the data (savePosition de-dupes by mangaId); these helpers
   exist so search, the detail page and the home suggestions all resolve the
   same entry and build the same resume URL. Nothing here writes storage. */

import { looksLikeId } from "./types";

export interface ContinueEntry {
  /* chapter id — the reader's lookup key */
  id: string;
  mangaId?: string;
  title?: string;
  coverUrl?: string | null;
  provider?: string;
  /* chapter NUMBER as a label ("" when the list had not loaded at save time) */
  chapter?: string;
  page?: number;
  progress?: number;
  type?: string;
  updatedAt?: number;
}

const CONT_KEY = "yomi.continue";

export function loadContinueEntries(): ContinueEntry[] {
  try {
    /* Guarded: this also runs during SSR prerender, where localStorage does
       not exist — the ReferenceError is what the catch is for. */
    const raw = JSON.parse(localStorage.getItem(CONT_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return (raw as unknown[]).filter(
      (e): e is ContinueEntry =>
        !!e &&
        typeof e === "object" &&
        typeof (e as ContinueEntry).id === "string" &&
        (e as ContinueEntry).id.trim().length > 0 &&
        !isDeletedFromShelf(e as ContinueEntry)
    );
  } catch {
    return [];
  }
}

/* One entry per title. The reader keys on mangaId, but older saves can carry
   an empty mangaId — those are only reachable through the chapter id. */
export function findContinue(
  entries: ContinueEntry[],
  mangaId?: string | null
): ContinueEntry | null {
  if (!mangaId) return null;
  return entries.find((e) => e.mangaId === mangaId || e.id === mangaId) || null;
}

export function isBadLabel(v: unknown): boolean {
  const s = String(v ?? "").trim();
  return !s || s === "Unknown" || s === "Unknown Title" || looksLikeId(s);
}

/* "" when the label is unusable — callers fall back to the chapter list. */
export function chapterLabel(entry?: ContinueEntry | null): string {
  if (!entry || isBadLabel(entry.chapter)) return "";
  return String(entry.chapter).trim();
}

/* Chapter ids are provider-scoped, so a title is the only thing that can join
   an entry saved on one source to a result coming from another. Deliberately
   exact (normalised) equality: a fuzzy match would pin "Continue" onto a
   different work. */
export function normTitle(v?: unknown): string {
  return String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function findContinueByTitle(
  entries: ContinueEntry[],
  title?: string | null
): ContinueEntry | null {
  const key = normTitle(title);
  if (key.length < 3) return null;
  return entries.find((e) => normTitle(e.title) === key) || null;
}

/* Resume URL. `page` is passed explicitly because a cross-provider resume
   targets a chapter id the entry has never seen — the reader's own
   localStorage restore would then start at page 1. */
export function continueReaderHref(
  entry: ContinueEntry,
  opts: {
    title: string;
    coverUrl?: string | null;
    type?: string;
    primaryProvider?: string;
    /* override when resuming into a different chapter than the saved one */
    chapterId?: string;
    page?: number;
  }
): string {
  const params = new URLSearchParams({
    provider: entry.provider || "weebcentral",
    manga: entry.mangaId || "",
    t: opts.title,
  });
  if (opts.primaryProvider) params.set("pp", opts.primaryProvider);
  const cover = opts.coverUrl || entry.coverUrl;
  if (cover) params.set("cover", String(cover));
  const type = opts.type || entry.type;
  if (type) params.set("mt", String(type));
  const page = Math.round(Number(opts.page ?? entry.page) || 0);
  if (page > 1) params.set("p", String(page));
  return `/read/${encodeURIComponent(opts.chapterId || entry.id)}?${params.toString()}`;
}

export const LIB_KEY = "yomi.lib";
export const DELETED_KEY = "yomi.deleted";

export interface ShelfItem {
  id?: string;
  mangaId?: string;
  title?: string;
  [key: string]: any;
}

export interface DeletedEntry {
  id?: string;
  mangaId?: string;
  title?: string;
  deletedAt: number;
}

/**
 * Checks whether an item matches a removal target or deleted tombstone by
 * chapter ID, manga ID, or normalized title.
 */
export function matchesTarget(
  item: ShelfItem,
  target: ShelfItem
): boolean {
  if (!item || !target) return false;

  const itemId = item.id ? String(item.id).trim() : "";
  const itemMangaId = item.mangaId ? String(item.mangaId).trim() : "";
  const targetId = target.id ? String(target.id).trim() : "";
  const targetMangaId = target.mangaId ? String(target.mangaId).trim() : "";

  // 1. Direct or cross ID match
  if (targetId && (itemId === targetId || itemMangaId === targetId)) return true;
  if (targetMangaId && (itemMangaId === targetMangaId || itemId === targetMangaId)) return true;
  if (itemId && targetMangaId && itemId === targetMangaId) return true;
  if (itemMangaId && targetId && itemMangaId === targetId) return true;

  // 2. Exact normalized title match (minimum 3 characters to avoid empty/generic strings)
  const itemTitle = normTitle(item.title);
  const targetTitle = normTitle(target.title);
  if (itemTitle.length >= 3 && targetTitle.length >= 3 && itemTitle === targetTitle) {
    return true;
  }

  return false;
}

/**
 * Loads all active deleted tombstones from localStorage.
 */
export function loadDeletedEntries(): DeletedEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(DELETED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DeletedEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Checks if an item has been explicitly deleted from the user's shelf.
 */
export function isDeletedFromShelf(item: ShelfItem): boolean {
  if (typeof window === "undefined" || !item) return false;
  const deleted = loadDeletedEntries();
  return deleted.some((d) => matchesTarget(item, d));
}

/**
 * Permanently removes a manga/manhwa from both Continue Reading (`yomi.continue`)
 * and Library (`yomi.lib`), and records a persistent tombstone in `yomi.deleted`
 * so cloud merges and background syncs never resurrect it.
 */
export function removeFromShelf(target: ShelfItem) {
  if (typeof window === "undefined" || !target) return;

  // 1. Record tombstone in yomi.deleted
  try {
    const deleted = loadDeletedEntries();
    const norm = target.title ? normTitle(target.title) : undefined;
    const exists = deleted.some((d) => matchesTarget(d, target));
    if (!exists) {
      deleted.unshift({
        id: target.id ? String(target.id).trim() : undefined,
        mangaId: target.mangaId ? String(target.mangaId).trim() : undefined,
        title: norm && norm.length >= 3 ? norm : undefined,
        deletedAt: Date.now(),
      });
      localStorage.setItem(DELETED_KEY, JSON.stringify(deleted.slice(0, 300)));
    }
  } catch { /* noop */ }

  // 2. Remove from yomi.continue
  try {
    const contRaw = localStorage.getItem(CONT_KEY);
    if (contRaw) {
      const cont: any[] = JSON.parse(contRaw);
      if (Array.isArray(cont)) {
        const remaining = cont.filter((item) => !matchesTarget(item, target));
        localStorage.setItem(CONT_KEY, JSON.stringify(remaining));
      }
    }
  } catch { /* noop */ }

  // 3. Remove from yomi.lib
  try {
    const libRaw = localStorage.getItem(LIB_KEY);
    if (libRaw) {
      const lib: any[] = JSON.parse(libRaw);
      if (Array.isArray(lib)) {
        const remaining = lib.filter((item) => !matchesTarget(item, target));
        localStorage.setItem(LIB_KEY, JSON.stringify(remaining));
      }
    }
  } catch { /* noop */ }

  // 4. Notify open pages and tabs to re-render immediately
  try {
    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new CustomEvent("yomi:shelf-change", { detail: target }));
  } catch { /* noop */ }
}

/**
 * Clears an item's tombstone when the user explicitly chooses to read or bookmark it again.
 */
export function unmarkDeleted(target: ShelfItem) {
  if (typeof window === "undefined" || !target) return;
  try {
    const deleted = loadDeletedEntries();
    if (!deleted.length) return;
    const filtered = deleted.filter((d) => !matchesTarget(d, target));
    localStorage.setItem(DELETED_KEY, JSON.stringify(filtered));
  } catch { /* noop */ }
}
