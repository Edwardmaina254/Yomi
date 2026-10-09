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
        (e as ContinueEntry).id.trim().length > 0
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
