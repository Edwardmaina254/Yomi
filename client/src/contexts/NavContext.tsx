"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { currentPath, recordNav, resolveBack, syncNav } from "@/lib/navHistory";
import { restoreScroll, saveCurrentScroll } from "@/lib/scrollMemory";

type BackState = { canGoBack: boolean; label: string };

type NavApi = BackState & {
  /** Return to the previous in-app screen, or to `fallback` when there is none. */
  goBack: (fallback?: string) => void;
};

const SERVER_STATE: BackState = { canGoBack: false, label: "Home" };
const NOOP = () => () => {};

/* The ledger is written by the history stack, not by a render, so it belongs
   outside React. useSyncExternalStore is the honest way to read it: popstate
   only has to notify, and the snapshot is recomputed on demand rather than
   mirrored into state that could drift from the thing it describes. */
let cached: BackState | null = null;
let cachedPath = "";
/* Set when the browser moved history by itself, so the scroll handler knows to
   restore a position instead of starting at the top. Module scope because the
   subscriber below is a module-level function. */
let fromPop = false;

function subscribe(onChange: () => void): () => void {
  const onHistory = () => {
    /* Rewind to the matching entry rather than blindly popping — popstate also
       fires for forward taps, and popping there would erase the trail the next
       back needs. */
    syncNav(currentPath());
    fromPop = true;
    onChange();
  };
  window.addEventListener("popstate", onHistory);
  /* A bfcache restore replays no popstate at all, and a stale back target after
     one is exactly the dead button this exists to prevent. */
  window.addEventListener("pageshow", onHistory);
  return () => {
    window.removeEventListener("popstate", onHistory);
    window.removeEventListener("pageshow", onHistory);
  };
}

function getSnapshot(): BackState {
  const path = currentPath();
  /* Referentially stable while the route holds, which is what keeps
     useSyncExternalStore from re-rendering in a loop. */
  if (cached && cachedPath === path) return cached;
  const r = resolveBack(path, "/");
  cached = { canGoBack: r.action === "back", label: r.label };
  cachedPath = path;
  return cached;
}

const NavContext = createContext<NavApi>({ ...SERVER_STATE, goBack: () => {} });

export function useNav(): NavApi {
  return useContext(NavContext);
}

export function NavProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const state = useSyncExternalStore(
    typeof window === "undefined" ? NOOP : subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  /* Ledger upkeep and scroll memory. Deliberately no setState here: the store
     above already tells React when the answer changed. */
  useEffect(() => {
    const path = currentPath();
    recordNav(path);

    const wasPop = fromPop;
    fromPop = false;
    if (wasPop) restoreScroll(path);

    /* Keep this screen's position fresh while it is on-screen. Scroll does not
       bubble, so the capture phase on document is what observes it. The path
       check matters: between the new DOM committing and this effect re-running,
       the listener still holds the previous page's path while `.yomi-main`
       already belongs to the new one. */
    let raf = 0;
    const onScroll = () => {
      if (raf || currentPath() !== path) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        saveCurrentScroll(path);
      });
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });

    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      if (raf) cancelAnimationFrame(raf);
    };
  }, [pathname]);

  const goBack = useCallback(
    (fallback = "/") => {
      const r = resolveBack(currentPath(), fallback);
      /* The ledger can outlive a bfcache restore or a manual history prune, so
         never ask the browser to go back to nothing — that is what drops a
         visitor off the site. */
      if (r.action === "back" && history.length > 1) router.back();
      else router.replace(r.target);
    },
    [router],
  );

  const value = useMemo<NavApi>(() => ({ ...state, goBack }), [state, goBack]);

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

function getServerSnapshot(): BackState {
  return SERVER_STATE;
}