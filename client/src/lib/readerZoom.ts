"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** Floor / ceiling for reader pinch-zoom. 1 = fit; 4 covers tiny panel text. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
/** Double-tap lands here — enough to read dialogue without overshooting. */
export const ZOOM_DOUBLE_TAP = 2.6;

type Mode = "vertical" | "paginated";

type ZoomRefs = {
  viewportRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
};

type Options = ZoomRefs & {
  enabled?: boolean;
  mode: Mode;
  /** Bumps reset zoom (chapter change, mode switch). */
  resetKey: string;
  /** Fire when a pinch starts so page-flip can abandon an in-flight turn. */
  onPinchStart?: () => void;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function dist(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function mid(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) {
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  };
}

/**
 * Pinch + pan zoom for the manga/manhwa reader.
 *
 * Transform is applied as `translate3d(x,y,0) scale(s)` with origin `0 0`,
 * so focal-point math stays exact under the fingers. At scale 1 in vertical
 * mode we hand scrolling back to the native scroller (momentum intact); above
 * 1 we lock overflow and pan in JS.
 */
export function useReaderZoom({
  viewportRef,
  contentRef,
  mode,
  resetKey,
  enabled = true,
  onPinchStart,
}: Options) {
  const [scale, setScale] = useState(1);
  const [zoomed, setZoomed] = useState(false);
  /** Blocks chrome/page-turn taps right after a double-tap zoom commits. */
  const suppressTapUntil = useRef(0);

  /** Manual zoom controls - step-based zoom for button controls */
  const zoomIn = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const nextScale = Math.min(st.current.s + 0.5, ZOOM_MAX);
    setZoomAt(nextScale, centerX, centerY);
  }, [viewportRef, setZoomAt]);

  const zoomOut = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const nextScale = Math.max(st.current.s - 0.5, ZOOM_MIN);
    setZoomAt(nextScale, centerX, centerY);
  }, [viewportRef, setZoomAt]);

  /** Preset zoom levels for common reading scenarios */
  const setZoomPreset = useCallback((preset: 1.5 | 2 | 2.5 | 3) => {
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    setZoomAt(preset, centerX, centerY);
  }, [viewportRef, setZoomAt]);

  const st = useRef({
    x: 0,
    y: 0,
    s: 1,
    /* Native scroll baked into translate while zoom-locked (vertical only). */
    locked: false,
    pinch: null as null | {
      startDist: number;
      startS: number;
      originX: number;
      originY: number;
    },
    pan: null as null | { x: number; y: number; ox: number; oy: number },
    lastTap: 0,
    lastTapX: 0,
    lastTapY: 0,
    moved: false,
  });

  const onPinchStartRef = useRef(onPinchStart);
  onPinchStartRef.current = onPinchStart;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const paint = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const { x, y, s } = st.current;
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;
  }, [contentRef]);

  const syncUi = useCallback(() => {
    const s = st.current.s;
    setScale(s);
    setZoomed(s > 1.02);
    const vp = viewportRef.current;
    if (vp) vp.classList.toggle("yomi-zoomed", s > 1.02);
  }, [viewportRef]);

  /** Keep some artwork on-screen; center when content is smaller than the viewport. */
  const clampPan = useCallback(() => {
    const vp = viewportRef.current;
    const content = contentRef.current;
    if (!vp || !content) return;
    const { s } = st.current;
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    const cw = content.scrollWidth;
    const ch = content.scrollHeight;
    const sw = cw * s;
    const sh = ch * s;

    if (sw <= vw) {
      st.current.x = (vw - sw) / 2;
    } else {
      st.current.x = clamp(st.current.x, vw - sw, 0);
    }
    if (sh <= vh) {
      st.current.y = (vh - sh) / 2;
    } else {
      st.current.y = clamp(st.current.y, vh - sh, 0);
    }
  }, [viewportRef, contentRef]);

  /** Vertical @1×: convert scrollTop into translate so pinch can own the view. */
  const lockScroll = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || st.current.locked) return;
    if (modeRef.current !== "vertical") {
      st.current.locked = true;
      vp.classList.add("yomi-zoom-lock");
      return;
    }
    const top = vp.scrollTop;
    const left = vp.scrollLeft;
    st.current.y = -top * st.current.s + st.current.y;
    st.current.x = -left * st.current.s + st.current.x;
    vp.scrollTop = 0;
    vp.scrollLeft = 0;
    st.current.locked = true;
    vp.classList.add("yomi-zoom-lock");
    paint();
  }, [viewportRef, paint]);

  /** Hand control back to the native scroller once we're at 1×. */
  const unlockScroll = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || !st.current.locked) return;
    vp.classList.remove("yomi-zoom-lock");
    if (modeRef.current === "vertical") {
      const top = Math.max(0, -st.current.y);
      const left = Math.max(0, -st.current.x);
      st.current.x = 0;
      st.current.y = 0;
      st.current.s = 1;
      paint();
      vp.scrollTop = top;
      vp.scrollLeft = left;
    } else {
      st.current.x = 0;
      st.current.y = 0;
      st.current.s = 1;
      paint();
    }
    st.current.locked = false;
  }, [viewportRef, paint]);

  const setZoomAt = useCallback(
    (nextS: number, focalClientX: number, focalClientY: number) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const rect = vp.getBoundingClientRect();
      const s0 = st.current.s;
      const s1 = clamp(nextS, ZOOM_MIN, ZOOM_MAX);

      if (s0 <= 1.02 && s1 > 1.02) lockScroll();

      /* Content point under the focal screen point (origin 0 0). */
      const px = (focalClientX - rect.left - st.current.x) / s0;
      const py = (focalClientY - rect.top - st.current.y) / s0;

      st.current.s = s1;
      st.current.x = focalClientX - rect.left - px * s1;
      st.current.y = focalClientY - rect.top - py * s1;

      if (s1 <= 1.02) {
        st.current.s = 1;
        unlockScroll();
      } else {
        clampPan();
        paint();
      }
      suppressTapUntil.current = Date.now() + 400;
      syncUi();
    },
    [viewportRef, lockScroll, unlockScroll, clampPan, paint, syncUi]
  );

  const shouldSuppressTap = useCallback(
    () => Date.now() < suppressTapUntil.current,
    []
  );

  const reset = useCallback(() => {
    st.current.pinch = null;
    st.current.pan = null;
    st.current.s = 1;
    st.current.x = 0;
    st.current.y = 0;
    const vp = viewportRef.current;
    if (vp) {
      vp.classList.remove("yomi-zoom-lock");
      vp.classList.remove("yomi-zoomed");
    }
    st.current.locked = false;
    paint();
    setScale(1);
    setZoomed(false);
  }, [viewportRef, paint]);

  /* Full reset when chapter / mode changes. */
  useEffect(() => {
    reset();
  }, [resetKey, mode, reset]);

  useEffect(() => {
    if (!enabled) return;
    const vp = viewportRef.current;
    const content = contentRef.current;
    if (!vp || !content) return;

    content.style.transformOrigin = "0 0";
    content.style.willChange = "transform";
    paint();

    const beginPinch = (t: TouchList) => {
      if (t.length < 2) return;
      onPinchStartRef.current?.();
      lockScroll();
      const a = t[0];
      const b = t[1];
      const m = mid(a, b);
      const rect = vp.getBoundingClientRect();
      const s = st.current.s;
      st.current.pinch = {
        startDist: Math.max(1, dist(a, b)),
        startS: s,
        originX: (m.x - rect.left - st.current.x) / s,
        originY: (m.y - rect.top - st.current.y) / s,
      };
      st.current.pan = null;
      st.current.moved = true;
    };

    const movePinch = (t: TouchList) => {
      const p = st.current.pinch;
      if (!p || t.length < 2) return;
      const a = t[0];
      const b = t[1];
      const m = mid(a, b);
      const rect = vp.getBoundingClientRect();
      const next = clamp(p.startS * (dist(a, b) / p.startDist), ZOOM_MIN, ZOOM_MAX);
      st.current.s = next;
      st.current.x = m.x - rect.left - p.originX * next;
      st.current.y = m.y - rect.top - p.originY * next;
      clampPan();
      paint();
    };

    const endPinch = () => {
      st.current.pinch = null;
      if (st.current.s < 1.05) {
        st.current.s = 1;
        unlockScroll();
      } else {
        clampPan();
        paint();
      }
      syncUi();
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        e.preventDefault();
        beginPinch(e.touches);
        return;
      }
      if (e.touches.length === 1 && st.current.s > 1.02) {
        const t = e.touches[0];
        st.current.pan = {
          x: t.clientX,
          y: t.clientY,
          ox: st.current.x,
          oy: st.current.y,
        };
        st.current.moved = false;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        e.preventDefault();
        if (!st.current.pinch) beginPinch(e.touches);
        else movePinch(e.touches);
        return;
      }
      if (e.touches.length === 1 && st.current.s > 1.02 && st.current.pan) {
        e.preventDefault();
        const t = e.touches[0];
        const dx = t.clientX - st.current.pan.x;
        const dy = t.clientY - st.current.pan.y;
        if (Math.hypot(dx, dy) > 8) st.current.moved = true;
        st.current.x = st.current.pan.ox + dx;
        st.current.y = st.current.pan.oy + dy;
        clampPan();
        paint();
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (st.current.pinch) {
        if (e.touches.length >= 2) {
          beginPinch(e.touches);
          return;
        }
        endPinch();
      }
      st.current.pan = null;

      /* Double-tap zoom — only when the gesture wasn't a pan/pinch. */
      if (e.touches.length === 0 && e.changedTouches.length === 1 && !st.current.pinch) {
        const t = e.changedTouches[0];
        const now = Date.now();
        const dt = now - st.current.lastTap;
        const dTap = Math.hypot(t.clientX - st.current.lastTapX, t.clientY - st.current.lastTapY);
        if (dt > 0 && dt < 300 && dTap < 28 && !st.current.moved) {
          e.preventDefault();
          if (st.current.s > 1.05) {
            setZoomAt(1, t.clientX, t.clientY);
          } else {
            setZoomAt(ZOOM_DOUBLE_TAP, t.clientX, t.clientY);
          }
          st.current.lastTap = 0;
          return;
        }
        st.current.lastTap = now;
        st.current.lastTapX = t.clientX;
        st.current.lastTapY = t.clientY;
      }
    };

    const opts: AddEventListenerOptions = { passive: false };
    vp.addEventListener("touchstart", onTouchStart, opts);
    vp.addEventListener("touchmove", onTouchMove, opts);
    vp.addEventListener("touchend", onTouchEnd, opts);
    vp.addEventListener("touchcancel", onTouchEnd, opts);

    return () => {
      vp.removeEventListener("touchstart", onTouchStart);
      vp.removeEventListener("touchmove", onTouchMove);
      vp.removeEventListener("touchend", onTouchEnd);
      vp.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [
    enabled,
    resetKey,
    mode,
    viewportRef,
    contentRef,
    paint,
    lockScroll,
    unlockScroll,
    clampPan,
    syncUi,
    setZoomAt,
  ]);

  return {
    scale,
    zoomed,
    reset,
    zoomIn,
    zoomOut,
    setZoomPreset,
    /** True when page-turn / chrome-tap should yield to zoom pan. */
    isZoomed: zoomed,
    shouldSuppressTap,
  };
}
