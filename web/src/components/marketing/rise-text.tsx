"use client";

import gsap from "gsap";
import { useLayoutEffect, useRef } from "react";

/** Word rise with an explicit rest pose, so a mask never records a clipped end state. */
export function RiseText({ text, className = "" }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const words = text.split(/\s+/).filter(Boolean);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const targets = root.querySelectorAll<HTMLElement>(".splitw > span");
    if (!targets.length || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const tween = gsap.fromTo(
      targets,
      { yPercent: 115, rotate: 3 },
      { yPercent: 0, rotate: 0, duration: 0.9, ease: "expo.out", stagger: 0.045 },
    );
    return () => {
      tween.kill();
      gsap.set(targets, { clearProps: "transform" });
    };
  }, [text]);

  return (
    <span ref={ref} className={className}>
      {words.map((word, index) => (
        <span key={`${word}-${index}`}>
          {index > 0 ? " " : null}
          <span className="splitw">
            <span>{word}</span>
          </span>
        </span>
      ))}
    </span>
  );
}
