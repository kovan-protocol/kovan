"use client";

import gsap from "gsap";
import { useEffect, useRef, type ReactNode } from "react";

/** Prototype magnetic: gsap.quickTo, elastic return. Strength 0.22 on buttons, 0.06 on CTA cards. */
export function Magnetic({
  children,
  strength = 0.22,
  className,
  block = false,
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
  block?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!fine || reduce) return;

    const qx = gsap.quickTo(el, "x", { duration: 0.5, ease: "power3" });
    const qy = gsap.quickTo(el, "y", { duration: 0.5, ease: "power3" });
    const move = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      qx((event.clientX - rect.left - rect.width / 2) * strength);
      qy((event.clientY - rect.top - rect.height / 2) * strength * 1.4);
    };
    const leave = () => {
      gsap.to(el, { x: 0, y: 0, duration: 0.9, ease: "elastic.out(1, 0.4)" });
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
    };
  }, [strength]);

  return (
    <span ref={ref} className={className} style={{ display: block ? "block" : "inline-flex" }}>
      {children}
    </span>
  );
}
