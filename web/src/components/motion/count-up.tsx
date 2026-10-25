"use client";

import { useEffect, useRef } from "react";

export function CountUp({ value }: { value: number }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / 1800);
          const eased = 1 - Math.pow(1 - t, 3);
          el.textContent = String(Math.round(eased * value));
          if (t < 1) raf = requestAnimationFrame(tick);
        };
        el.textContent = "0";
        raf = requestAnimationFrame(tick);
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [value]);

  return <b ref={ref}>{value}</b>;
}
