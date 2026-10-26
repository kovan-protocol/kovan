"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Globe2, Menu, Moon, Sun, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Brand, PrimaryAction } from "@/components/marketing/primitives";
import { useCopy, usePreferences } from "@/components/marketing/preferences";

const links = [
  { href: "/how-it-works", en: "How it works", es: "Cómo funciona" },
  { href: "/why-kovan", en: "Why Kovan", es: "Por qué Kovan" },
  { href: "/security", en: "Security", es: "Seguridad" },
  { href: "/developers", en: "Developers", es: "Desarrolladores" },
  { href: "/docs", en: "Docs", es: "Docs" },
];

export function SiteNav() {
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;
  const setOpen = (value: boolean) => setOpenPath(value ? pathname : null);
  const toggle = useRef<HTMLButtonElement>(null);
  const nav = useRef<HTMLElement>(null);
  const { locale, theme, setLocale, setTheme } = usePreferences();
  const t = useCopy();

  useEffect(() => {
    const header = nav.current;
    if (!header) return;
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce || open) {
        header.classList.remove("nav-hidden");
        last = y;
        return;
      }
      const delta = y - last;
      if (Math.abs(delta) < 8) return;
      if (delta > 0 && y > 64) header.classList.add("nav-hidden");
      else header.classList.remove("nav-hidden");
      last = y;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function dismiss(event: KeyboardEvent) {
      if (event.key === "Escape") { setOpenPath(null); toggle.current?.focus(); }
    }
    function outside(event: PointerEvent) {
      if (!nav.current?.contains(event.target as Node)) setOpenPath(null);
    }
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", dismiss); document.removeEventListener("pointerdown", outside); };
  }, [open]);

  return <>
    <a className="skip" href="#main">{t("Skip to content", "Saltar al contenido")}</a>
    <header className="site-header" ref={nav}>
      <div className="nav-inner container">
        <Link href="/" className="brand-link" aria-label={t("Kovan home", "Kovan inicio")} onClick={() => setOpen(false)}><Brand /></Link>
        <nav className="desktop-nav" aria-label={t("Main navigation", "Navegación principal")}>
          {links.map(link => <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined}>{t(link.en, link.es)}</Link>)}
        </nav>
        <div className="nav-controls">
          <button type="button" className="locale-control" aria-label={t("Cambiar a español", "Switch to English")} onClick={() => setLocale(locale === "en" ? "es" : "en")}><Globe2 size={15} aria-hidden="true" /><span>{locale.toUpperCase()}</span></button>
          <button type="button" className="icon-button" aria-label={theme === "light" ? t("Switch to dark theme", "Cambiar a tema oscuro") : t("Switch to light theme", "Cambiar a tema claro")} onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
            {theme === "light" ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}
          </button>
          <div className="nav-cta"><PrimaryAction small /></div>
          <button type="button" ref={toggle} className="icon-button mobile-toggle" aria-expanded={open} aria-controls="mobile-navigation" aria-label={open ? t("Close menu", "Cerrar menú") : t("Open menu", "Abrir menú")} onClick={() => setOpen(!open)}>{open ? <X size={21} /> : <Menu size={21} />}</button>
        </div>
      </div>
      {open && <nav className="mobile-navigation" id="mobile-navigation" aria-label={t("Mobile navigation", "Navegación móvil")}>
        {links.map(link => <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined} onClick={() => setOpen(false)}>{t(link.en, link.es)}</Link>)}
        <Link href="/playground" onClick={() => setOpen(false)}>{t("Interactive demo", "Demo interactiva")}</Link>
      </nav>}
    </header>
  </>;
}
