"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useLayoutEffect, useRef } from "react";

gsap.registerPlugin(ScrollTrigger);

/** Real figures only. Tween matches the prototype: 1.8s, power3.out, once at top 92%. */
export function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const state = { v: 0 };
    el.textContent = "0";
    const tween = gsap.to(state, {
      v: value,
      duration: 1.8,
      ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 92%", once: true },
      onUpdate: () => {
        el.textContent = String(Math.round(state.v));
      },
    });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [value]);

  return (
    <b ref={ref} data-count={value}>
      {value}
    </b>
  );
}
