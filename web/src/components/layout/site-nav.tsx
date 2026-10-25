"use client";

import { DOCS_URL } from "@/config/site";
import { PrimaryLink } from "@/components/primary-link";
import { Magnetic } from "@/components/motion/magnetic";
import { useEffect, useState } from "react";

const links = [
  { href: "#how", label: "How it works" },
  { href: "#different", label: "Why Kovan" },
  { href: "#attack", label: "Security" },
  { href: "#simulator", label: "Playground" },
  { href: "#developers", label: "Developers" },
  { href: "#faq", label: "FAQ" },
];

export function SiteNav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const nav = document.getElementById("nav");
    if (!nav) return;
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      nav.classList.toggle("scrolled", y > 40);
      if (Math.abs(y - lastY) < 8) return;
      const hide = y > lastY && y > 760 && !nav.matches(":focus-within") && !nav.classList.contains("open");
      nav.classList.toggle("hide", hide);
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.getElementById("nav")?.classList.toggle("open", open);
  }, [open]);

  return (
    <header className="nav" id="nav">
      <a className="logo" href="#top" aria-label="Kovan home" onClick={() => setOpen(false)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/lockup-dark.svg" alt="" height={24} />
      </a>
      <ul>
        {links.map((link) => (
          <li key={link.href}>
            <a href={link.href}>{link.label}</a>
          </li>
        ))}
      </ul>
      <a className="navdocs" href={DOCS_URL} target="_blank" rel="noopener noreferrer">
        Docs
      </a>
      <Magnetic>
        <PrimaryLink className="btn btn-primary magnet" />
      </Magnetic>
      <button
        type="button"
        className="menu-btn"
        aria-expanded={open}
        aria-controls="nav-panel"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Close" : "Menu"}
      </button>
      {open ? (
        <div className="nav-panel" id="nav-panel">
          {links.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </a>
          ))}
          <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
            Docs
          </a>
        </div>
      ) : null}
    </header>
  );
}
