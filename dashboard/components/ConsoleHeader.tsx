"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { ArrowUpRight, Moon, Sun } from "lucide-react";

const themeEvent = "kovan-theme-change";

function subscribe(callback: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  function sync() {
    try {
      const saved = localStorage.getItem("kovan-theme");
      document.documentElement.dataset.theme = saved === "light" || saved === "dark" ? saved : media.matches ? "dark" : "light";
    } catch { /* Keep the in-memory choice when storage is unavailable. */ }
    callback();
  }
  window.addEventListener(themeEvent, callback);
  window.addEventListener("storage", sync);
  media.addEventListener("change", sync);
  return () => {
    window.removeEventListener(themeEvent, callback);
    window.removeEventListener("storage", sync);
    media.removeEventListener("change", sync);
  };
}

export function ConsoleHeader({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme ?? "light", () => "light");
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("kovan-theme", next); } catch { /* This tab still updates. */ }
    window.dispatchEvent(new Event(themeEvent));
  }

  return (
    <header className="console-header">
      <a href="#main" className="skip-link">Skip to dashboard</a>
      <div className="console-container console-header-inner">
        <a href="https://kovan-indol.vercel.app" className="console-brand" aria-label="Kovan home">
          <svg viewBox="0 0 401 505" aria-hidden="true"><polygon points="0,183 401,0 401,153 0,336" /><polygon points="62,350 330,229 330,505" /></svg>
          <span>kovan</span>
        </a>
        <span className="console-product">Demo console</span>
        <div className="console-header-actions">
          <a href="https://kovan-indol.vercel.app/docs" className="console-docs">Docs <ArrowUpRight size={15} aria-hidden="true" /></a>
          <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
            {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
          </button>
          {children}
        </div>
      </div>
    </header>
  );
}
