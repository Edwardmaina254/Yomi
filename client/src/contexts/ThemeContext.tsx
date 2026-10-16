"use client";

import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from "react";

type Theme = "night" | "paper";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "night",
  toggleTheme: () => {},
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("night");
  const themeRef = useRef<Theme>("night");

  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(err => console.error('SW registration failed:', err));
    }
    const stored = localStorage.getItem("yomi.theme") as Theme | null;
    if (stored === "paper" || stored === "night") {
      themeRef.current = stored;
      setThemeState(stored);
      document.documentElement.setAttribute("data-theme", stored);
      const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
      if (meta) meta.content = stored === "night" ? "#0d1017" : "#f5f1e8";
    }
  }, []);

  const applyTheme = useCallback((nextThemeOrUpdater: Theme | ((prev: Theme) => Theme)) => {
    const root = document.documentElement;
    const current = (root.getAttribute("data-theme") as Theme) || themeRef.current || "night";
    const next = typeof nextThemeOrUpdater === "function" ? nextThemeOrUpdater(current) : nextThemeOrUpdater;

    // 1. Instantly freeze transitions & animations across the whole DOM
    root.classList.add("yomi-theme-swap");

    // 2. Synchronously set the theme attribute
    root.setAttribute("data-theme", next);
    themeRef.current = next;

    // 3. Force synchronous style recalculation so that all CSS variables & rules
    // switch at the exact same moment with zero transition lag
    void root.offsetHeight;

    // 4. Update React state, theme-color meta, and persistence
    setThemeState(next);
    try {
      localStorage.setItem("yomi.theme", next);
    } catch { /* noop */ }
    const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (meta) meta.content = next === "night" ? "#0d1017" : "#f5f1e8";

    // 5. Restore transitions on the following frame for user interactions/hover
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        root.classList.remove("yomi-theme-swap");
      });
    });
  }, []);

  const toggleTheme = useCallback(() => {
    applyTheme((prev) => (prev === "night" ? "paper" : "night"));
  }, [applyTheme]);

  const setTheme = useCallback((t: Theme) => {
    applyTheme(t);
  }, [applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
