"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(err => console.error('SW registration failed:', err));
    }
    const stored = localStorage.getItem("yomi.theme") as Theme | null;
    if (stored === "paper" || stored === "night") {
      setThemeState(stored);
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("yomi.theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (meta) meta.content = theme === "night" ? "#0d1017" : "#f5f1e8";
  }, [theme, mounted]);

  const toggleTheme = () => {
    // Force a single atomic paint: disable every element transition for one
    // frame so the whole UI swaps simultaneously (no per-component stagger).
    const root = document.documentElement;
    root.classList.add("yomi-theme-swap");
    requestAnimationFrame(() => {
      setThemeState((t) => (t === "night" ? "paper" : "night"));
      requestAnimationFrame(() => root.classList.remove("yomi-theme-swap"));
    });
  };
  const setTheme = (t: Theme) => {
    setThemeState(t);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
