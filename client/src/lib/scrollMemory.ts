/**
 * Scroll memory for the inner scroller.
 *
 * The shell scrolls `.yomi-main`, not the document. Browser scroll restoration
 * only ever touches the document scroller, so every back navigation used to
 * land at the top of the previous screen. This keeps a small per-path map and
 * puts the position back after the incoming content has actually been laid out.
 *
 * The reader is deliberately excluded — it restores its own page from the saved
 * position in `yomi.continue`, and fighting that with a stale scrollTop would
 * drop the reader on the wrong page.
 */

const KEY = "yomi.scrolls";
const MAX = 40;

function readMap(): Record<string, number> {
  try {
    const v = sessionStorage.getItem(KEY);
    return v ? (JSON.parse(v) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function saveScroll(path: string, top: number): void {
  if (top <= 0) return;
  try {
    const m = readMap();
    m[path] = Math.round(top);
    const keys = Object.keys(m);
    if (keys.length > MAX) for (const k of keys.slice(0, keys.length - MAX)) delete m[k];
    sessionStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* private mode — position is lost, navigation still works */
  }
}

export function readScroll(path: string): number {
  const v = readMap()[path];
  return typeof v === "number" && v > 0 ? v : 0;
}

/** Shell pages scroll `.yomi-main`; the reader owns its own position. */
function scroller(): HTMLElement | null {
  if (document.querySelector(".yomi-reader")) return null;
  return document.querySelector<HTMLElement>(".yomi-main");
}

/**
 * Content arrives asynchronously, so the scroller is frequently empty on the
 * frame the route commits. Retry until the height is real, then give up rather
 * than fight whatever rendered later.
 */
export function restoreScroll(path: string): void {
  const top = readScroll(path);
  if (top <= 0) return;
  let tries = 0;
  const attempt = () => {
    const el = scroller();
    if (!el) {
      if (document.querySelector(".yomi-reader")) return;
      if (tries++ < 60) requestAnimationFrame(attempt);
      return;
    }
    const canScroll = el.scrollHeight > el.clientHeight + 4;
    if (!canScroll && tries++ < 60) {
      requestAnimationFrame(attempt);
      return;
    }
    el.scrollTop = Math.min(top, Math.max(0, el.scrollHeight - el.clientHeight));
  };
  requestAnimationFrame(attempt);
}

export function saveCurrentScroll(path: string): void {
  const el = scroller();
  if (el) saveScroll(path, el.scrollTop);
}