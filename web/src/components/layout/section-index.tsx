"use client";

import { useEffect, useState } from "react";

export function SectionIndex() {
  const [sec, setSec] = useState({ n: "00", t: "Kovan" });

  useEffect(() => {
    const nodes = [...document.querySelectorAll<HTMLElement>("[data-sec]")];
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const node = entry.target as HTMLElement;
          setSec({ n: node.dataset.sec || "00", t: node.dataset.title || "" });
          const id = node.id;
          document.querySelectorAll<HTMLAnchorElement>(".nav ul a, .nav-panel a").forEach((link) => {
            link.classList.toggle("active", Boolean(id) && link.getAttribute("href") === `#${id}`);
          });
        });
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    nodes.forEach((node) => io.observe(node));
    return () => io.disconnect();
  }, []);

  return (
    <div className="secidx" aria-hidden>
      <span>§{sec.n}</span>
      <span>{sec.t}</span>
    </div>
  );
}
