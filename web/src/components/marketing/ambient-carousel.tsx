"use client";

import { useEffect, useRef } from "react";
import { ArrowDownLeft, ArrowUpRight, Bot, Check, ShieldCheck, Wallet } from "lucide-react";
import { useCopy } from "./preferences";
import "./ambient-carousel.css";

type Variant = "closing" | "stack";

function FlowCards() {
  const t = useCopy();

  return <>
    <div className="ambient-card ambient-card-pool">
      <span className="ambient-card-heading"><Wallet size={13} />{t("Shared pool", "Fondo común")}</span>
      <span className="ambient-card-value">1,000 <small>USDC</small></span>
      <span className="ambient-card-rule"><i /><i /><i /></span>
    </div>
    <div className="ambient-card ambient-card-agent">
      <span className="ambient-card-heading"><Bot size={13} />{t("Agent budget", "Presupuesto")}</span>
      <span className="ambient-card-agent-row"><span className="ambient-card-avatar">A</span><span>Agent 01<small>125 USDC</small></span></span>
      <span className="ambient-card-meter"><i /></span>
    </div>
    <div className="ambient-card ambient-card-policy">
      <span className="ambient-card-heading"><ShieldCheck size={13} />{t("Policy check", "Regla verificada")}</span>
      <span className="ambient-card-check"><Check size={13} />{t("Within limit", "Dentro del límite")}</span>
      <span className="ambient-card-rule"><i /><i /></span>
    </div>
    <div className="ambient-card ambient-card-payment">
      <span className="ambient-card-heading"><ArrowUpRight size={13} />x402</span>
      <span className="ambient-card-value">0.05 <small>USDC</small></span>
      <span className="ambient-card-status"><span />{t("Approved", "Aprobado")}</span>
    </div>
    <div className="ambient-card ambient-card-return">
      <span className="ambient-card-heading"><ArrowDownLeft size={13} />{t("Unspent funds", "Fondos sin usar")}</span>
      <span className="ambient-card-value">875 <small>USDC</small></span>
      <span className="ambient-card-rule"><i /><i /><i /></span>
    </div>
  </>;
}

const stackMarks = ["Stellar", "USDC", "OpenZeppelin", "Soroban", "Kovan"];

export function AmbientCarousel({ variant }: { variant: Variant }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    if (!window.IntersectionObserver) {
      element.dataset.visible = "true";
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      element.dataset.visible = String(entry.isIntersecting);
    }, { threshold: 0.02 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (variant === "stack") {
    return <div ref={root} className="ambient-carousel ambient-carousel-stack" data-visible="false" aria-hidden="true">
      <div className="ambient-stack-track">
        {[0, 1].map((copy) => <div className="ambient-stack-set" key={copy}>{stackMarks.map((mark) => <span className="ambient-stack-mark" key={mark}>{mark}</span>)}</div>)}
      </div>
    </div>;
  }

  return <div ref={root} className="ambient-carousel ambient-carousel-closing" data-visible="false" aria-hidden="true">
    <div className="ambient-flow-track ambient-flow-track-top">
      <div className="ambient-flow-set"><FlowCards /></div>
      <div className="ambient-flow-set"><FlowCards /></div>
    </div>
    <div className="ambient-flow-track ambient-flow-track-bottom">
      <div className="ambient-flow-set"><FlowCards /></div>
      <div className="ambient-flow-set"><FlowCards /></div>
    </div>
  </div>;
}
