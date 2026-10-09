"use client";

import { useEffect, useRef, useState, useCallback, type ReactNode, type Ref } from "react";
import gsap from "gsap";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface CardRackProps {
  children: ReactNode;
  variant?: "cards" | "wide" | "chips";
  className?: string;
  arrows?: boolean;
  label?: string;
  /** Optional ref registration so the parent can reveal children inside the rail. */
  containerRef?: Ref<HTMLDivElement>;
  /** Space between items (px). Defaults to 16. */
  gap?: number;
}

/**
 * Horizontal shelf.
 * - Mobile/tablet: native swipe scroll (unchanged from before).
 * - Desktop: fixed even column count (set via `--rack-cols` in CSS) with
 *   floating prev/next arrows that page one full row at a time via GSAP.
 */
export default function CardRack({
  children,
  variant = "cards",
  className = "",
  arrows = false,
  label,
  containerRef,
  gap = 16,
}: CardRackProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(true);

  const update = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanPrev(el.scrollLeft > 4);
    setCanNext(el.scrollLeft < max - 4);
  }, []);

  useEffect(() => {
    const el = railRef.current;
    if (!el || !arrows) return;
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
  }, [arrows, update]);

  const page = useCallback(
    (dir: 1 | -1) => {
      const el = railRef.current;
      if (!el) return;
      const max = el.scrollWidth - el.clientWidth;
      const target = Math.max(0, Math.min(el.scrollLeft + dir * el.clientWidth, max));
      gsap.to(el, {
        scrollLeft: target,
        duration: 0.45,
        ease: "power2.out",
        onComplete: update,
      });
    },
    [update]
  );

  const setRail = (node: HTMLDivElement | null) => {
    railRef.current = node;
    if (typeof containerRef === "function") containerRef(node);
    else if (containerRef) containerRef.current = node;
  };

  return (
    <div className="yomi-rack-wrap" style={{ ["--rack-gap" as string]: `${gap}px` }}>
      <div
        ref={setRail}
        className={`yomi-rail-x yomi-rack-${variant} ${className}`}
        aria-label={label}
      >
        {children}
      </div>
      {arrows && (
        <>
          <button
            className="rack-arrow left"
            onClick={() => page(-1)}
            disabled={!canPrev}
            aria-label="Scroll back"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="rack-arrow right"
            onClick={() => page(1)}
            disabled={!canNext}
            aria-label="Scroll forward"
          >
            <ChevronRight size={18} />
          </button>
        </>
      )}
    </div>
  );
}