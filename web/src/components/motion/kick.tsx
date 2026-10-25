"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useLenis } from "lenis/react";
import { useEffect, useLayoutEffect, useRef } from "react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

function reduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * v2 prototype motion: split headlines, batch reveals, hero parallax,
 * section drift, cinematic scrubs, and the #034 dashboard timeline.
 * Initial states are applied by GSAP only, so reduced motion leaves content visible.
 */
export function Kick() {
  const lenis = useLenis();
  const started = useRef(false);

  useEffect(() => {
    const spot = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest(".spot") : null;
      if (!(target instanceof HTMLElement)) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      target.style.setProperty("--my", `${event.clientY - rect.top}px`);
    };
    document.addEventListener("pointermove", spot);
    return () => document.removeEventListener("pointermove", spot);
  }, []);

  useLayoutEffect(() => {
    if (!lenis || reduced()) return;
    const stop = lenis.on("scroll", () => ScrollTrigger.update());
    const tick = (time: number) => {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      stop();
      gsap.ticker.remove(tick);
    };
  }, [lenis]);

  useGSAP(() => {
    // Lenis mounts in an effect and re-renders the tree once. Run after that,
    // or React reconciles away the inline styles GSAP just wrote.
    if (!lenis || reduced() || started.current) return;
    started.current = true;

    const h1 = document.querySelector(".hero h1");
    if (h1) {
      // fromTo, not from: a later ScrollTrigger.refresh was recording the
      // masked yPercent as the destination, so the words never rose.
      gsap.fromTo(
        h1.querySelectorAll(".splitw>span"),
        { yPercent: 115, rotate: 3 },
        {
          yPercent: 0,
          rotate: 0,
          duration: 1.15,
          ease: "expo.out",
          stagger: 0.055,
          delay: 0.15,
          overwrite: "auto",
        },
      );
    }

    document.querySelectorAll("h2").forEach((heading) => {
      if (heading.closest(".attack-top") || heading.closest(".hs")) return;
      heading.removeAttribute("data-reveal");
      const words = heading.querySelectorAll(".splitw>span");
      if (words.length === 0) return;
      gsap.fromTo(
        words,
        { yPercent: 115, rotate: 3 },
        {
          yPercent: 0,
          rotate: 0,
          duration: 1.05,
          ease: "expo.out",
          stagger: 0.035,
          overwrite: "auto",
          scrollTrigger: { trigger: heading, start: "top 88%", once: true },
        },
      );
    });

    ScrollTrigger.batch("[data-reveal]", {
      start: "top 88%",
      once: true,
      onEnter: (batch) =>
        gsap.to(batch, {
          opacity: 1,
          y: 0,
          duration: 0.7,
          ease: "power3.out",
          stagger: 0.06,
          overwrite: true,
        }),
    });

    gsap.fromTo(
      ".hero-copy > *:not(h1)",
      { opacity: 0, y: 30 },
      { opacity: 1, y: 0, duration: 1.1, ease: "power3.out", stagger: 0.1, delay: 0.1, overwrite: "auto" },
    );
    gsap.fromTo(
      ".proof",
      { opacity: 0, y: 30 },
      { opacity: 1, y: 0, duration: 1.1, ease: "power3.out", delay: 0.55, overwrite: "auto" },
    );

    if (document.getElementById("rtext")) {
      gsap.to("#rtext .w", {
        opacity: 1,
        ease: "none",
        stagger: 0.1,
        scrollTrigger: { trigger: "#rtext", start: "top 82%", end: "bottom 50%", scrub: 0.6 },
      });
    }

    const heroScrub = { trigger: ".hero", start: "top top", end: "bottom top", scrub: true };
    gsap.to(".hero .aurora", { yPercent: 22, ease: "none", scrollTrigger: heroScrub });
    gsap.to(".hero .bgdots", { yPercent: 10, ease: "none", scrollTrigger: { ...heroScrub } });
    gsap.to(".hero .glow", { yPercent: -18, ease: "none", scrollTrigger: { ...heroScrub } });

    document.querySelectorAll(".sec-head .lede").forEach((lede) => {
      gsap.fromTo(
        lede,
        { y: 36 },
        {
          y: -12,
          ease: "none",
          scrollTrigger: { trigger: lede, start: "top bottom", end: "bottom 35%", scrub: true },
        },
      );
    });

    const simulator = document.getElementById("simulator");
    if (simulator) {
      gsap.fromTo(
        simulator,
        { clipPath: "inset(7% 3.5% 0% 3.5% round 44px)" },
        {
          clipPath: "inset(0% 0% 0% 0% round 0px)",
          ease: "none",
          scrollTrigger: { trigger: simulator, start: "top 100%", end: "top 20%", scrub: true },
        },
      );
    }

    const cta = document.querySelector(".cta");
    if (cta) {
      gsap.fromTo(
        ".cta-box",
        { scale: 0.9 },
        { scale: 1, ease: "none", scrollTrigger: { trigger: cta, start: "top bottom", end: "top 30%", scrub: true } },
      );
      gsap.fromTo(
        ".cta-box .bigmark",
        { yPercent: 25, rotate: -6 },
        {
          yPercent: -10,
          rotate: 0,
          ease: "none",
          scrollTrigger: { trigger: cta, start: "top bottom", end: "bottom top", scrub: true },
        },
      );
    }

    const attack = document.getElementById("attack");
    if (attack) {
      gsap.fromTo(
        ".attack-stage",
        { opacity: 0.35, y: 40 },
        {
          opacity: 1,
          y: 0,
          ease: "none",
          scrollTrigger: { trigger: attack, start: "top 90%", end: "top top", scrub: true },
        },
      );
    }

    const stage = document.getElementById("hs-stage");
    let desktop: ReturnType<typeof gsap.matchMedia> | null = null;
    if (stage) {
      const tl = gsap.timeline({
        defaults: { ease: "power3.out" },
        scrollTrigger: { trigger: stage, start: "top 80%", once: true },
      });
      tl.fromTo(".hs-app", { y: 48, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9 })
        .fromTo(".hs-kpi", { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.07 }, "-=0.45")
        .add(() => {
          stage.querySelectorAll<HTMLElement>("[data-n]").forEach((el) => {
            const state = { v: 0 };
            const target = Number.parseFloat(el.dataset.n || "0");
            gsap.to(state, {
              v: target,
              duration: 1.1,
              ease: "power2.out",
              onUpdate: () => {
                el.textContent = state.v.toFixed(2);
              },
            });
          });
        }, "<")
        .fromTo("[data-grow]", { scaleX: 0 }, { scaleX: 1, duration: 0.8, stagger: 0.08, ease: "power2.out" }, "-=0.2")
        .fromTo(".hs-in", { x: 14, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45, stagger: 0.09 }, "<")
        .fromTo(
          "#hs-blocked",
          { backgroundColor: "rgba(255,92,92,.28)" },
          {
            backgroundColor: "rgba(255,92,92,0)",
            duration: 1.1,
            ease: "power1.out",
            clearProps: "backgroundColor",
          },
          "-=0.05",
        )
        .fromTo(
          "#hs-toast",
          { y: 18, scale: 0.96, opacity: 0 },
          { y: 0, scale: 1, opacity: 1, duration: 0.6, ease: "back.out(1.5)" },
          "<+=0.1",
        )
        .fromTo("#hs-cov", { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, "<+=0.15");

      desktop = gsap.matchMedia();
      desktop.add("(min-width: 861px)", () => {
        gsap.fromTo(
          ".hs-app",
          { rotateX: 9, scale: 0.965 },
          {
            rotateX: 0,
            scale: 1,
            ease: "none",
            scrollTrigger: { trigger: stage, start: "top 95%", end: "top 25%", scrub: 0.6 },
          },
        );
        gsap.to("#hs-toast", {
          y: -28,
          ease: "none",
          scrollTrigger: { trigger: stage, start: "top bottom", end: "bottom top", scrub: 0.6 },
        });
        gsap.to("#hs-cov", {
          y: -14,
          ease: "none",
          scrollTrigger: { trigger: stage, start: "top bottom", end: "bottom top", scrub: 0.6 },
        });
      });
    }

    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener("load", refresh);
    return () => {
      window.removeEventListener("load", refresh);
      desktop?.revert();
    };
  }, [lenis]);

  return null;
}
