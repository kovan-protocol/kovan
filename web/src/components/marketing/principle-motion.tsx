"use client";

import { useEffect, useId, useRef } from "react";
import "./principle-motion.css";

type Kind = "pool" | "rules" | "control";
type Locale = "en" | "es";

const labels = {
  en: {
    example: "EXAMPLE",
    pool: "Shared pool",
    agent: "Agent",
    allocated: "3.00 USDC allocated",
    rules: "Payment policy",
    request: "Payment request",
    recipient: "Approved recipient",
    budget: "Within payment limit",
    validity: "Covenant is active",
    approved: "Payment approved",
    owner: "Owner",
    active: "Active",
    revoked: "Revoked",
    access: "Agent access",
    returned: "0.30 USDC returned",
    descriptions: {
      pool: "Illustration: a shared pool of 5 USDC allocates budgets of 1.50, 1.00 and 0.50 USDC to three agents.",
      rules: "Illustration: a 0.05 USDC payment is checked against its approved recipient, amount limit and active covenant, then approved.",
      control: "Illustration: the owner revokes an agent’s access and recovers 0.30 USDC in unspent funds.",
    },
  },
  es: {
    example: "EJEMPLO",
    pool: "Fondo común",
    agent: "Agente",
    allocated: "3,00 USDC asignados",
    rules: "Reglas de pago",
    request: "Solicitud de pago",
    recipient: "Destinatario autorizado",
    budget: "Dentro del límite de pago",
    validity: "Acuerdo vigente",
    approved: "Pago aprobado",
    owner: "Propietario",
    active: "Activo",
    revoked: "Revocado",
    access: "Acceso del agente",
    returned: "0,30 USDC devueltos",
    descriptions: {
      pool: "Ilustración: un fondo común de 5 USDC asigna presupuestos de 1,50, 1,00 y 0,50 USDC a tres agentes.",
      rules: "Ilustración: un pago de 0,05 USDC verifica el destinatario, el límite de importe y la vigencia del acuerdo antes de aprobarse.",
      control: "Ilustración: el propietario revoca el acceso de un agente y recupera 0,30 USDC de fondos no utilizados.",
    },
  },
};

export function PrincipleMotion({ kind, locale }: { kind: Kind; locale: Locale }) {
  const root = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, "");
  const t = labels[locale];
  const number = (value: string) => locale === "es" ? value.replace(".", ",") : value;

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let visible = false;
    const update = () => { element.dataset.running = String(visible && !document.hidden); };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    }, { threshold: 0.15 });
    element.dataset.ready = "true";
    if (observer) observer.observe(element);
    else { visible = true; update(); }
    document.addEventListener("visibilitychange", update);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return (
    <div ref={root} className={`principle-art pm-art pm-${kind}`} data-running="false" role="img" aria-label={t.descriptions[kind]}>
      <svg className="pm-canvas" viewBox="0 0 360 210" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`${id}-scan`} x1="0" y1="0" x2="1" y2="0">
            <stop stopColor="currentColor" stopOpacity="0" />
            <stop offset=".5" stopColor="currentColor" stopOpacity=".11" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          <clipPath id={`${id}-budget`}><rect x="81" y="56" width="84" height="27" /></clipPath>
        </defs>
        <text className="pm-example" x="338" y="18" textAnchor="end">{t.example}</text>

        {kind === "pool" && (
          <>
            <g className="pm-pool-links" fill="none">
              {["M180 82V96Q180 103 173 103H78Q70 103 70 111V132", "M180 82V132", "M180 82V96Q180 103 187 103H282Q290 103 290 111V132"].map((path, index) => (
                <g key={path}>
                  <path d={path} className="pm-link" />
                  <path d={path} pathLength="1" className={`pm-route pm-pool-route pm-pool-route-${index}`} />
                </g>
              ))}
            </g>
            <g className="pm-pool-card">
              <rect className="pm-card" x="112" y="25" width="136" height="58" rx="10" />
              <rect className="pm-icon-bg" x="123" y="36" width="23" height="23" rx="6" />
              <path className="pm-mark" d="m128 43 13-6v5l-13 6zm2 7 9-4v9z" />
              <text className="pm-label" x="154" y="43">{t.pool}</text>
              <text className="pm-value" x="154" y="66">{number("5.00")}<tspan className="pm-unit" dx="5">USDC</tspan></text>
              <rect className="pm-pool-meter-base" x="123" y="72" width="114" height="2" rx="1" />
              <rect className="pm-pool-meter" x="123" y="72" width="68.4" height="2" rx="1" />
            </g>
            {[{ x: 26, amount: "1.50", size: 58 }, { x: 136, amount: "1.00", size: 39 }, { x: 246, amount: "0.50", size: 20 }].map((agent, index) => (
              <g key={index} className={`pm-agent pm-agent-${index}`}>
                <rect className="pm-card" x={agent.x} y="132" width="88" height="50" rx="8" />
                <text className="pm-label" x={agent.x + 11} y="148">{t.agent} 0{index + 1}</text>
                <text className="pm-agent-value" x={agent.x + 11} y="165">{number(agent.amount)}<tspan className="pm-agent-unit" dx="4">USDC</tspan></text>
                <rect className={`pm-agent-meter pm-agent-meter-${index}`} x={agent.x + 11} y="173" width={agent.size} height="2" rx="1" />
              </g>
            ))}
            {[0, 1, 2].map((index) => (
              <g className={`pm-fund-chip pm-fund-chip-${index}`} key={index}>
                <circle r="6" />
                <path d="M-2 0H2M0-2V2" />
              </g>
            ))}
            <g className="pm-allocation-receipt">
              <path className="pm-check" d="m113 198 3 3 5-6" />
              <text className="pm-small pm-accent" x="128" y="201">{t.allocated}</text>
            </g>
          </>
        )}

        {kind === "rules" && (
          <>
            <g className="pm-policy-card">
              <rect className="pm-card" x="42" y="42" width="276" height="137" rx="10" />
              <path className="pm-policy-shield" d="m61 54 7 3v5c0 5-7 8-7 8s-7-3-7-8v-5z" />
              <text className="pm-label pm-policy-title" x="78" y="64">{t.rules}</text>
              <path className="pm-divider" d="M55 77H305" />
              {[t.recipient, t.budget, t.validity].map((label, index) => (
                <g className={`pm-rule-row pm-rule-row-${index}`} key={index}>
                  <rect className={`pm-row-wash pm-row-wash-${index}`} x="52" y={83 + index * 28} width="256" height="25" rx="4" />
                  <text className="pm-rule-text" x="62" y={99 + index * 28}>{label}</text>
                  <circle className="pm-check-ring" cx="291" cy={95 + index * 28} r="7" />
                  <circle className={`pm-rule-disc pm-rule-disc-${index}`} cx="291" cy={95 + index * 28} r="7" />
                  <path className={`pm-rule-check pm-rule-check-${index}`} pathLength="1" d={`m288 ${95 + index * 28} 2 2 4-4`} />
                </g>
              ))}
              <g className="pm-scanner">
                <rect x="53" y="0" width="254" height="24" fill={`url(#${id}-scan)`} />
                <path d="M59 24H301" />
              </g>
            </g>
            <g className="pm-request-chip">
              <rect className="pm-request-card" x="99" y="17" width="162" height="27" rx="7" />
              <path d="m110 31 3-3 3 3m-3-3v8" className="pm-request-arrow" />
              <text x="122" y="34" className="pm-request-label">{t.request}</text>
              <text x="250" y="34" textAnchor="end" className="pm-request-amount">{number("0.05")}</text>
            </g>
            <g className="pm-approved-chip">
              <rect x="101" y="172" width="158" height="27" rx="7" />
              <path className="pm-check" d="m114 185 3 3 5-6" />
              <text x="130" y="189">{t.approved}</text>
            </g>
          </>
        )}

        {kind === "control" && (
          <>
            <path className="pm-link" fill="none" d="M159 62H202" />
            <path className="pm-control-route" pathLength="1" fill="none" d="M159 62H202" />
            <circle className="pm-permission" r="3" />
            <path className="pm-link" fill="none" d="M269 94V151Q269 161 259 161H105Q95 161 95 151V94" />
            <path className="pm-route pm-return-route" pathLength="1" fill="none" d="M269 94V151Q269 161 259 161H105Q95 161 95 151V94" />
            <g className="pm-owner-card">
              <rect className="pm-card" x="29" y="31" width="130" height="63" rx="9" />
              <rect className="pm-icon-bg" x="41" y="44" width="30" height="30" rx="7" />
              <path className="pm-owner-icon" d="M49 53h14m-14 6h14m-14 6h14M53 50v6m6 0v6m-6 0v6" />
              <text className="pm-label" x="81" y="49">{t.owner}</text>
              <g clipPath={`url(#${id}-budget)`}>
                <g className="pm-owner-balance">
                  <text className="pm-value" x="85" y="76">{number("2.00")}</text>
                  <text className="pm-value" x="85" y="102">{number("2.30")}</text>
                </g>
              </g>
            </g>
            <g className="pm-managed-agent">
              <rect className="pm-card" x="202" y="31" width="130" height="63" rx="9" />
              <rect className="pm-agent-symbol" x="214" y="44" width="30" height="30" rx="7" />
              <path className="pm-agent-symbol-icon" d="M221 54h16v12h-16zm5 5h1m4 0h1m-3-5v-4" />
              <text className="pm-label" x="254" y="49">{t.agent}</text>
              <text className="pm-active-label" x="254" y="70">{t.active}</text>
              <text className="pm-revoked-label" x="254" y="70">{t.revoked}</text>
            </g>
            <g className="pm-access-switch">
              <text className="pm-small" x="179" y="120" textAnchor="end">{t.access}</text>
              <rect className="pm-switch-track" x="192" y="107" width="34" height="19" rx="9.5" />
              <circle className="pm-switch-thumb" cx="217" cy="116.5" r="6.5" />
            </g>
            <g className="pm-return-chip">
              <rect x="-23" y="-11" width="46" height="22" rx="6" />
              <text y="3" textAnchor="middle">+{number("0.30")}</text>
            </g>
            <g className="pm-return-receipt">
              <path className="pm-check" d="m107 190 3 3 5-6" />
              <text className="pm-small pm-accent" x="122" y="193">{t.returned}</text>
            </g>
          </>
        )}
      </svg>
    </div>
  );
}
