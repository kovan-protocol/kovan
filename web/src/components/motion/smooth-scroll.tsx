"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ReactLenis, useLenis } from "lenis/react";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";

gsap.registerPlugin(ScrollTrigger);

function subscribeReduced(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useSmoothWheel() {
  return useSyncExternalStore(
    subscribeReduced,
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

export function SmoothScroll({ children }: { children: ReactNode }) {
  const smooth = useSmoothWheel();

  return (
    <ReactLenis
      root
      options={{
        lerp: smooth ? 0.1 : 1,
        smoothWheel: smooth,
        anchors: false,
      }}
    >
      <LenisBridge />
      <HashLinks />
      {children}
    </ReactLenis>
  );
}

function LenisBridge() {
  const lenis = useLenis(() => {
    ScrollTrigger.update();
  });

  useEffect(() => {
    if (!lenis) return;
    ScrollTrigger.refresh();
  }, [lenis]);

  return null;
}

function HashLinks() {
  const lenis = useLenis();

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("#") || href.length < 2) return;
      const el = document.querySelector(href);
      if (!(el instanceof HTMLElement)) return;
      event.preventDefault();
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (lenis && !reduce) {
        lenis.scrollTo(el, { offset: href === "#top" ? 0 : -10 });
      } else {
        el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      }
      if (href === "#main") el.focus();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [lenis]);

  return null;
}
