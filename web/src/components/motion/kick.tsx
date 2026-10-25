"use client";

import { useEffect } from "react";

function prefersReduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Reveals, word-rise, and card spotlight. Sections stay declarative. */
export function Kick() {
  useEffect(() => {
    if (prefersReduced()) return;
    const cleanups: Array<() => void> = [];

    document.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => {
      const io = new IntersectionObserver(
        ([entry]) => {
          if (!entry?.isIntersecting) return;
          el.classList.add("in");
          io.disconnect();
        },
        { rootMargin: "0px 0px -12% 0px" },
      );
      io.observe(el);
      cleanups.push(() => io.disconnect());
    });

    document.querySelectorAll<HTMLElement>("h1, h2").forEach((head) => {
      if (head.closest(".attack-top")) return;
      const words = [...head.querySelectorAll<HTMLElement>(".splitw > span")];
      if (words.length === 0) return;
      const hero = Boolean(head.closest(".hero"));
      const go = () => {
        words.forEach((el, index) => {
          el.style.transitionDelay = `${(hero ? 150 : 0) + index * (hero ? 55 : 35)}ms`;
          el.classList.add("go");
        });
      };
      if (hero) {
        const id = requestAnimationFrame(go);
        cleanups.push(() => cancelAnimationFrame(id));
        return;
      }
      const io = new IntersectionObserver(
        ([entry]) => {
          if (!entry?.isIntersecting) return;
          go();
          io.disconnect();
        },
        { rootMargin: "0px 0px -12% 0px" },
      );
      io.observe(head);
      cleanups.push(() => io.disconnect());
    });

    const spot = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest(".spot") : null;
      if (!(target instanceof HTMLElement)) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      target.style.setProperty("--my", `${event.clientY - rect.top}px`);
    };
    document.addEventListener("pointermove", spot);
    cleanups.push(() => document.removeEventListener("pointermove", spot));

    const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
    let raf = 0;
    const scrub = () => {
      raf = 0;
      const vh = window.innerHeight;
      const text = document.getElementById("rtext");
      if (text) {
        const words = [...text.querySelectorAll<HTMLElement>(".w")];
        const rect = text.getBoundingClientRect();
        const start = vh * 0.82;
        const distance = start - vh * 0.5 + rect.height;
        const p = clamp((start - rect.top) / Math.max(1, distance), 0, 1);
        words.forEach((word, index) => {
          const local = clamp(p * words.length - index, 0, 1);
          word.style.opacity = String(0.14 + 0.86 * local);
        });
      }

      const hero = document.querySelector<HTMLElement>(".hero");
      if (hero) {
        const rect = hero.getBoundingClientRect();
        const p = clamp(-rect.top / Math.max(1, rect.height), 0, 1);
        const set = (sel: string, value: string) => {
          const el = hero.querySelector<HTMLElement>(sel);
          if (el) el.style.transform = value;
        };
        set(".aurora", `translate3d(0, ${p * 22}%, 0)`);
        set(".bgdots", `translate3d(0, ${p * 10}%, 0)`);
        set(".glow", `translate3d(0, ${p * -18}%, 0)`);
        const flow = document.getElementById("flow");
        if (flow && window.matchMedia("(min-width: 861px)").matches) {
          flow.style.transform = `translate3d(0, ${p * 14}%, 0)`;
          flow.style.opacity = String(1 - p * 0.65);
        } else if (flow) {
          flow.style.transform = "";
          flow.style.opacity = "";
        }
      }

      const sim = document.getElementById("simulator");
      if (sim) {
        const rect = sim.getBoundingClientRect();
        const p = clamp((vh - rect.top) / (vh * 0.8), 0, 1);
        const inset = 1 - p;
        sim.style.clipPath = `inset(${inset * 7}% ${inset * 3.5}% 0% ${inset * 3.5}% round ${inset * 44}px)`;
      }

      const cta = document.querySelector<HTMLElement>(".cta");
      const box = document.querySelector<HTMLElement>(".cta-box");
      if (cta && box) {
        const rect = cta.getBoundingClientRect();
        const p = clamp((vh - rect.top) / (vh * 0.7), 0, 1);
        box.style.transform = `scale(${0.9 + 0.1 * p})`;
        const mark = box.querySelector<HTMLElement>(".bigmark");
        if (mark) {
          const p2 = clamp((vh - rect.top) / (vh + rect.height), 0, 1);
          mark.style.transform = `translate3d(0, ${25 - 35 * p2}%, 0) rotate(${-6 + 6 * p2}deg)`;
        }
      }

      const attack = document.getElementById("attack");
      const stage = attack?.querySelector<HTMLElement>(".attack-stage");
      if (attack && stage) {
        const rect = attack.getBoundingClientRect();
        const p = clamp((vh * 0.9 - rect.top) / (vh * 0.9), 0, 1);
        stage.style.opacity = String(0.35 + 0.65 * p);
        stage.style.transform = `translate3d(0, ${(1 - p) * 40}px, 0)`;
      }
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(scrub);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    cleanups.push(() => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    });

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
