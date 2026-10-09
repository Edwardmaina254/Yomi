/**
 * Internal navigation ledger.
 *
 * `router.back()` is only meaningful when the app itself put something on the
 * history stack. A deep link, a refresh, or a shared URL leaves nothing to go
 * back to, and the browser answers by leaving the site entirely. The ledger
 * records the app paths visited in this tab so back navigation can always pick
 * a real destination — a recorded parent when one exists, a supplied fallback
 * when it does not.
 *
 * It lives in sessionStorage rather than a module variable so the knowledge
 * survives a refresh: reloading a chapter page still knows which screen sent
 * you there.
 */

const KEY = "yomi.navstack";
const MAX = 80;

/* What kind of commit the next route change will be. Navigation helpers declare
   their intent before calling the router; the provider consumes it when the
   pathname actually changes. Without this the ledger would accumulate entries
   that the real history stack never had, and back would walk into a screen the
   user can no longer reach. */
let intent: "push" | "replace" = "push";

/* `i` is a monotonic session index. popstate fires for forward navigation too,
   so the ledger cannot simply pop on every event — it has to know which way
   the browser moved and rewind or replay to match. */
type Entry = { path: string; i: number };

function read(): Entry[] {
  try {
    const v = sessionStorage.getItem(KEY);
    if (!v) return [];
    const parsed = JSON.parse(v);
    if (!Array.isArray(parsed)) return [];
    return parsed.every((e) => e && typeof e.path === "string") ? (parsed as Entry[]) : [];
  } catch {
    return [];
  }
}

function write(v: Entry[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(v.slice(-MAX)));
  } catch {
    /* private mode / quota — the fallback path still works without it */
  }
}

export function currentPath(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname + window.location.search;
}

/** Mark the next route change as a replace instead of a push. */
export function navReplace(path?: string): void {
  intent = "replace";
  if (path) recordNav(path);
}

function nextIndex(s: Entry[]): number {
  return s.length ? s[s.length - 1].i + 1 : 0;
}

/** Record a committed route, honouring the declared intent. */
export function recordNav(path: string): void {
  const s = read();
  const top = s[s.length - 1];
  if (top && top.path === path) {
    intent = "push";
    return;
  }
  if (intent === "replace" && top) top.path = path;
  else s.push({ path, i: nextIndex(s) });
  intent = "push";
  write(s);
}

/**
 * Resync after the browser moved on its own (back or forward button, swipe).
 * Rewinding to the matching entry handles both directions: popping blindly
 * would delete the forward trail and strand the next back.
 */
export function syncNav(path: string): void {
  const s = read();
  const bare = path.split("?")[0];
  let idx = -1;
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i].path === path) {
      idx = i;
      break;
    }
  }
  if (idx < 0) {
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i].path.split("?")[0] === bare) {
        idx = i;
        break;
      }
    }
  }
  if (idx >= 0) {
    write(s.slice(0, idx + 1));
    return;
  }
  /* A destination this tab never recorded — pruned history, or an entry that
     predates the ledger. Append so it still has a parent worth offering. */
  s.push({ path, i: nextIndex(s) });
  write(s);
}

/**
 * The screen that most plausibly sent the user to where they are now.
 *
 * `current` is passed in rather than read from the DOM because the ledger is
 * consulted during render, before the provider has committed this route. When
 * the top entry is not yet the current path it *is* the parent — reading it as
 * `length - 2` there would name a grandparent and send back navigation to the
 * wrong screen.
 */
export function navParentFor(current: string): string | null {
  const s = read();
  if (!s.length) return null;
  const top = s[s.length - 1];
  if (top.path === current) return s.length > 1 ? s[s.length - 2].path : null;
  return top.path;
}

/**
 * Two paths are the same screen when a back between them would be a no-op.
 *
 * Chapter stepping rewrites the reader URL, so `/read/…?manga=A` and
 * `/read/…?manga=A` are one screen — backing out of chapter 2 must leave the
 * reader, not replay chapter 1. Two *different* titles are genuinely different
 * screens, so this deliberately does not collapse all of `/manga/…`: hopping
 * through the similar-titles row has to keep its trail.
 */
export function sameFamily(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const [pa, qa] = [a.split("?")[0].replace(/\/+$/, "") || "/", a.split("?")[1] ?? ""];
  const [pb, qb] = [b.split("?")[0].replace(/\/+$/, "") || "/", b.split("?")[1] ?? ""];
  if (pa === pb) return true;
  if (!pa.startsWith("/read/") || !pb.startsWith("/read/")) return false;
  const mangaOf = (q: string) => (q.split("&").find((x) => x.startsWith("manga=")) || "").slice(6);
  const ma = mangaOf(qa);
  return ma !== "" && ma === mangaOf(qb);
}

/** Is this URL one of ours? Guards against naming an external referrer. */
export function isInternal(path: string | null): boolean {
  if (!path) return false;
  const p = path.split("?")[0];
  return p === "/" || p.startsWith("/manga/") || p.startsWith("/read/") || p.startsWith("/library") || p.startsWith("/search");
}

/** Human label for a destination, so the back button can name where it goes. */
export function parentLabel(path: string | null): string {
  if (!path) return "Home";
  const p = path.split("?")[0];
  if (p.startsWith("/search")) return "Search";
  if (p.startsWith("/library")) return "Library";
  if (p.startsWith("/manga/")) return "Title";
  if (p.startsWith("/read/")) return "Reader";
  return "Home";
}

/**
 * Pick the destination for "back".
 *
 * A recorded parent is honoured even when it is a root route: pressing back on
 * a title you reached from search must return those results, not jump to home
 * on the theory that roots are off limits. The fallback only applies when there
 * is genuinely nothing behind us — a deep link, a cold tab, or a history entry
 * the ledger never saw.
 */
export function resolveBack(current: string, fallback: string): { action: "back" | "replace"; target: string; label: string } {
  const parent = navParentFor(current);
  if (parent && isInternal(parent) && !sameFamily(parent, current)) {
    return { action: "back", target: parent, label: parentLabel(parent) };
  }
  return { action: "replace", target: fallback, label: parentLabel(fallback) };
}
