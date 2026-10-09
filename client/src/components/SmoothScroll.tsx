"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

/*
 * Inertia smooth-scroll for the inner shell scroller.
 *
 * The app scrolls `.yomi-main`, not the document, so Lenis is bound to that
 * element as its `wrapper` (with `.yomi-view` as the observed content). It only
 * smooths wheel input — `syncTouch: false` leaves native touch scrolling (and
 * therefore the reader) completely untouched, and `allowNestedScroll` hands any
 * gesture back to a nested scroller (the horizontal title racks) the moment
 * that element can actually scroll in the gesture's direction.
 *
 * Native `scrollTop` is preserved the whole time, so `scrollMemory` and the
 * nav ledger keep working without knowing Lenis exists. Reduced-motion users
 * get no instance at all — native scrolling stays in charge.
 */

let instance: Lenis | null = null;

/** The live Lenis controller, or null on the reader / reduced-motion. */
export function getLenis(): Lenis | null {
  return instance;
}

export default function SmoothScroll() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const wrapper = document.querySelector<HTMLElement>(".yomi-main");
    if (!wrapper) return;
    const content = wrapper.querySelector<HTMLElement>(".yomi-view") ?? wrapper;

    const lenis = new Lenis({
      wrapper,
      content,
      autoRaf: true,
      lerp: 0.11,
      smoothWheel: true,
      syncTouch: false,
      gestureOrientation: "vertical",
      allowNestedScroll: true,
      respectReducedMotion: true,
      stopInertiaOnNavigate: true,
    });

    instance = lenis;

    return () => {
      lenis.destroy();
      if (instance === lenis) instance = null;
    };
  }, [pathname]);

  return null;
}
