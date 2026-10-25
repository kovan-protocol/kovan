"use client";

import gsap from "gsap";
import { useEffect, useRef } from "react";

export function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduce) return;

    const qx = gsap.quickTo(el, "x", { duration: 0.7, ease: "power3" });
    const qy = gsap.quickTo(el, "y", { duration: 0.7, ease: "power3" });
    const move = (event: PointerEvent) => {
      qx(event.clientX);
      qy(event.clientY);
      el.classList.add("on");
    };
    const leave = () => el.classList.remove("on");
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
    };
  }, []);

  return <div ref={ref} className="cglow" aria-hidden />;
}
