"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useLenis } from "lenis/react";
import { useLayoutEffect, useRef } from "react";

gsap.registerPlugin(ScrollTrigger);

/** Real figures only. Tween matches the prototype: 1.8s, power3.out, once at top 92%. */
export function CountUp({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const ref = useRef<HTMLElement>(null);
  const lenis = useLenis();
  const format = (n: number) => (decimals > 0 ? n.toFixed(decimals) : String(Math.round(n)));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !lenis) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const paint = (n: number) => (decimals > 0 ? n.toFixed(decimals) : String(Math.round(n)));
    const state = { v: 0 };
    el.textContent = paint(0);
    const tween = gsap.to(state, {
      v: value,
      duration: 1.8,
      ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 92%", once: true },
      onUpdate: () => {
        el.textContent = paint(state.v);
      },
    });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [decimals, lenis, value]);

  return (
    <span ref={ref} data-count={value}>
      {format(value)}
    </span>
  );
}
