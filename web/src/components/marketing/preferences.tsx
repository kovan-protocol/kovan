"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

export type Locale = "en" | "es";
type Theme = "light" | "dark";
const eventName = "kovan-preferences";

// Set the saved theme before paint to avoid a light flash on dark pages.
export const preferenceScript = `(function(){var d=document.documentElement;try{var t=localStorage.getItem('kovan-theme');d.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';d.lang=localStorage.getItem('kovan-locale')==='es'?'es':'en'}catch(e){d.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}})()`;

function snapshot() {
  return `${document.documentElement.lang}:${document.documentElement.dataset.theme}`;
}

function syncBrowserColor() {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", document.documentElement.dataset.theme === "dark" ? "#0B0E14" : "#FBFBFA");
}

function subscribe(callback: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  function sync() {
    try {
      const saved = localStorage.getItem("kovan-theme");
      document.documentElement.dataset.theme = saved === "light" || saved === "dark" ? saved : media.matches ? "dark" : "light";
      document.documentElement.lang = localStorage.getItem("kovan-locale") === "es" ? "es" : "en";
    } catch { /* Preferences still work for this tab if storage is unavailable. */ }
    syncBrowserColor();
    callback();
  }
  window.addEventListener(eventName, callback);
  window.addEventListener("storage", sync);
  media.addEventListener("change", sync);
  syncBrowserColor();
  return () => {
    window.removeEventListener(eventName, callback);
    window.removeEventListener("storage", sync);
    media.removeEventListener("change", sync);
  };
}

function save(key: "theme" | "locale", value: string) {
  if (key === "theme") document.documentElement.dataset.theme = value;
  else document.documentElement.lang = value;
  syncBrowserColor();
  try { localStorage.setItem(`kovan-${key}`, value); } catch { /* In-memory preference remains available. */ }
  window.dispatchEvent(new Event(eventName));
}

const Preferences = createContext<{
  locale: Locale;
  theme: Theme;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: Theme) => void;
}>({ locale: "en", theme: "light", setLocale: () => {}, setTheme: () => {} });

export function PreferenceProvider({ children }: { children: ReactNode }) {
  const value = useSyncExternalStore(subscribe, snapshot, () => "en:light");
  const [language, appearance] = value.split(":");
  const preferences = useMemo(() => ({
    locale: language === "es" ? "es" as const : "en" as const,
    theme: appearance === "dark" ? "dark" as const : "light" as const,
    setLocale: (locale: Locale) => save("locale", locale),
    setTheme: (theme: Theme) => save("theme", theme),
  }), [language, appearance]);
  return <Preferences.Provider value={preferences}>{children}</Preferences.Provider>;
}

export function usePreferences() { return useContext(Preferences); }
export function useCopy() {
  const { locale } = usePreferences();
  return (en: string, es: string) => locale === "es" ? es : en;
}
