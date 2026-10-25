"use client";

import { useEffect, useRef, type ReactNode } from "react";

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

    let x = 0;
    let y = 0;
    let tx = 0;
    let ty = 0;
    let raf = 0;
    let running = false;
    const loop = () => {
      x += (tx - x) * 0.2;
      y += (ty - y) * 0.2;
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (Math.abs(tx - x) > 0.2 || Math.abs(ty - y) > 0.2) {
        raf = requestAnimationFrame(loop);
      } else {
        running = false;
      }
    };
    const kick = () => {
      if (!running) {
        running = true;
        raf = requestAnimationFrame(loop);
      }
    };
    const move = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      tx = (event.clientX - rect.left - rect.width / 2) * strength;
      ty = (event.clientY - rect.top - rect.height / 2) * strength * 1.4;
      el.style.transition = "";
      kick();
    };
    const leave = () => {
      tx = 0;
      ty = 0;
      el.style.transition = "transform .9s cubic-bezier(.2, 1.4, .3, 1)";
      el.style.transform = "translate3d(0, 0, 0)";
      running = false;
      cancelAnimationFrame(raf);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(raf);
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
