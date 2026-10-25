"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Magnetic } from "@/components/motion/magnetic";
import { primaryCta } from "@/config/site";
import { useCopy } from "./preferences";

export function Brand({ symbol = false }: { symbol?: boolean }) {
  return <span className="brand"><svg viewBox="0 0 401 505" aria-hidden="true"><polygon points="0,183 401,0 401,153 0,336" /><polygon points="62,350 330,229 330,505" /></svg>{!symbol && <span>kovan</span>}</span>;
}

export function PrimaryAction({ className = "", small = false, label: customLabel, href: customHref }: { className?: string; small?: boolean; label?: string; href?: string }) {
  const t = useCopy();
  const cta = primaryCta();
  const label = customLabel ?? (cta.label === "Launch app" ? t("Launch app", "Abrir app") : t("Explore the demo", "Explorar la demo"));
  const href = customHref ?? cta.href;
  const external = customHref ? /^https?:\/\//.test(customHref) : cta.external;
  const content = <>{label}<ArrowUpRight size={17} aria-hidden="true" /></>;
  const classes = `button button-primary ${small ? "button-small" : ""} ${className}`;
  const control = external
    ? <a href={href} className={classes} target="_blank" rel="noopener noreferrer">{content}</a>
    : <Link href={href} className={classes}>{content}</Link>;
  return <Magnetic>{control}</Magnetic>;
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="text-link">{children}<ArrowRight size={17} aria-hidden="true" /></Link>;
}

export function Reveal({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !window.IntersectionObserver || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let animation: Animation | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      animation = element.animate([{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "translateY(0)" }], {
        duration: 750, easing: "cubic-bezier(.22,.68,0,1)", fill: "none",
      });
      observer.disconnect();
    }, { threshold: 0.08 });
    observer.observe(element);
    return () => { observer.disconnect(); animation?.cancel(); };
  }, []);
  return <div ref={ref} className={className}>{children}</div>;
}

export function ClosingNote() {
  const t = useCopy();
  return <Reveal className="closing-wrap container"><section className="closing"><div><p className="eyebrow">{t("AUTONOMY, WITH BOUNDARIES", "AUTONOMÍA, CON LÍMITES")}</p><h2>{t("Let your agents work.", "Deja actuar a tus agentes.")}<br /><span>{t("Keep the control.", "Conserva el control.")}</span></h2></div><PrimaryAction /></section></Reveal>;
}
