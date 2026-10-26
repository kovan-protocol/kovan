"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Clipboard, Code2, Play, ShieldCheck } from "lucide-react";
import { evaluatePayment, type Failure, type Payee } from "@/lib/simulator";
import { useCopy } from "./preferences";
import "./agent-example.css";

/** Matches the console's POST /api/x402 request and response on main. */
export const agentExampleCode = [
  "const consoleUrl = process.env.KOVAN_CONSOLE_URL",
  "  ?? \"http://127.0.0.1:3001\";",
  "",
  "export async function preparePaidResource(url) {",
  "  const agent = process.env.KOVAN_AGENT_ACCOUNT;",
  "  const mandateId = process.env.KOVAN_MANDATE_ID;",
  "  if (!agent) {",
  "    throw Error(\"Set KOVAN_AGENT_ACCOUNT\");",
  "  }",
  "  if (!/^[a-f0-9]{64}$/.test(mandateId ?? \"\") || /^0{64}$/.test(mandateId)) {",
  "    throw Error(\"Set KOVAN_MANDATE_ID to an owner-approved grant\");",
  "  }",
  "  if (!url?.startsWith(\"https://\")) {",
  "    throw Error(\"Use an HTTPS x402 URL\");",
  "  }",
  "",
  "  const endpoint = new URL(\"/api/x402\", consoleUrl);",
  "  endpoint.searchParams.set(\"url\", url);",
  "  const response = await fetch(endpoint);",
  "  const terms = await response.json();",
  "  if (!response.ok) throw Error(terms.error);",
  "  return { agent, mandateId, url: terms.url, terms,",
  "    quoteId: terms.quoteId, requestId: crypto.randomUUID(),",
  "    ...(process.env.KOVAN_POOL_ID",
  "      ? { pool: process.env.KOVAN_POOL_ID } : {}) };",
  "}",
  "",
  "// Review terms and persist this request before paying.",
  "// Retrying must reuse it, NOT call preparePaidResource again.",
  "export async function requestPaidResource(request) {",
  "  const { agent, mandateId, url, pool, quoteId, requestId } = request;",
  "  const endpoint = new URL(\"/api/x402\", consoleUrl);",
  "  const response = await fetch(endpoint, {",
  "    method: \"POST\",",
  "    headers: { \"content-type\": \"application/json\" },",
  "    body: JSON.stringify({ agent, mandateId, url, pool, quoteId, requestId }),",
  "  });",
  "  const result = await response.json();",
  "  if (!response.ok || !result.ok) {",
  "    throw Error(result.error ?? \"Payment refused\");",
  "  }",
  "  return result.body;",
  "}",
].join("\n");

const scenarios: Array<{ amount: number; payee: Payee }> = [
  { amount: 0.05, payee: "provider" },
  { amount: 0.05, payee: "unlisted" },
  { amount: 0.15, payee: "provider" },
];

export function AgentExample() {
  const t = useCopy();
  const [scenario, setScenario] = useState(0);
  const [phase, setPhase] = useState<"ready" | "checking" | "done">("ready");
  const [failure, setFailure] = useState<Failure | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const timer = useRef<number | null>(null);
  const code = useRef<HTMLElement>(null);

  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  function chooseScenario(index: number) {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setScenario(index);
    setPhase("ready");
    setFailure(undefined);
  }

  function runPreview() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setFailure(undefined);
    setPhase("checking");
    timer.current = window.setTimeout(() => {
      const input = scenarios[scenario];
      setFailure(evaluatePayment({ ...input, drawn: 0, spent: 0, revoked: false, expired: false }));
      setPhase("done");
      timer.current = null;
    }, 720);
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(agentExampleCode);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
      if (code.current) {
        const range = document.createRange();
        range.selectNodeContents(code.current);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
    }
  }

  const selected = scenarios[scenario];
  const output = phase === "done" ? JSON.stringify(failure
    ? { ok: false, stage: "simulate", error: failure.title }
    : { ok: true, status: 200, body: "Resource returned" }, null, 2) : null;

  return <main id="main" tabIndex={-1} className="page-main">
    <div className="container ae-page">
      <header className="ae-intro">
        <p className="eyebrow">{t("FOR YOUR AGENT", "PARA TU AGENTE")}</p>
        <h1>{t("Give your agent access.", "Dale acceso a tu agente.")}<br /><span>{t("Keep the limits yours.", "Conserva tus límites.")}</span></h1>
        <p>{t("Copy this Node.js example into your agent's runtime. It requests an x402 resource through Kovan; the smart account checks the provider and amount against your rules.", "Copia este ejemplo de Node.js en el entorno de tu agente. Solicita un recurso x402 mediante Kovan; la cuenta inteligente comprueba el proveedor y el importe según tus reglas.")}</p>
      </header>

      <div className="ae-workspace">
        <section className="ae-code-panel" aria-label={t("Agent code example", "Ejemplo de código para el agente")}>
          <div className="ae-code-top"><span><Code2 size={17} aria-hidden="true" />agent-x402.js</span><button type="button" onClick={copyCode} aria-label={t("Copy agent code", "Copiar código para el agente")}>{copied ? <Check size={15} /> : <Clipboard size={15} />}{copyFailed ? t("Select and copy", "Selecciona y copia") : copied ? t("Copied", "Copiado") : t("Copy code", "Copiar código")}</button></div>
          <pre tabIndex={0}><code ref={code}>{agentExampleCode}</code></pre>
          <div className="ae-code-foot">{t("Node.js 22+ · Calls your local Kovan console", "Node.js 22+ · Usa tu consola Kovan local")}</div>
        </section>

        <section className="ae-preview" aria-label={t("Payment preview", "Vista previa del pago")}>
          <div className="ae-preview-heading"><p className="eyebrow">{t("PREVIEW THE DECISION", "SIMULA LA DECISIÓN")}</p><h2>{t("See the rule in action.", "Mira cómo actúa la regla.")}</h2><p>{t("Choose an example request. This preview runs locally; it does not call an API or move funds.", "Elige una solicitud de ejemplo. Esta vista funciona localmente; no llama a ninguna API ni mueve fondos.")}</p></div>
          <div className="ae-scenarios" role="group" aria-label={t("Example requests", "Solicitudes de ejemplo")}>
            {[t("Approved provider", "Proveedor autorizado"), t("Unknown provider", "Proveedor desconocido"), t("Above the limit", "Supera el límite")].map((label, index) => <button type="button" key={index} aria-pressed={scenario === index} onClick={() => chooseScenario(index)}>{label}</button>)}
          </div>
          <div className="ae-request"><span>{t("Proposed payment", "Pago solicitado")}</span><strong>{selected.amount.toFixed(2)} USDC</strong><small>{selected.payee === "provider" ? t("Approved provider", "Proveedor autorizado") : t("Unknown provider", "Proveedor desconocido")}</small></div>
          <div className="ae-flow" data-phase={phase}><span>{t("x402 terms", "Condiciones x402")}</span><ArrowRight size={14} aria-hidden="true" /><span>{t("Covenant", "Reglas")}</span><ArrowRight size={14} aria-hidden="true" /><span>{t("Decision", "Decisión")}</span></div>
          <button type="button" className="button button-primary ae-run" onClick={runPreview} disabled={phase === "checking"}><Play size={15} fill="currentColor" aria-hidden="true" />{phase === "checking" ? t("Checking rules…", "Verificando reglas…") : t("Run preview", "Ejecutar simulación")}</button>
          <div className="ae-output" aria-live="polite" aria-atomic="true"><div className="ae-output-label"><ShieldCheck size={15} aria-hidden="true" />{t("Simulated response", "Respuesta simulada")}</div><pre>{output ?? t("Run the preview to see the account's decision.", "Ejecuta la simulación para ver la decisión de la cuenta.")}</pre></div>
        </section>
      </div>

      <aside className="ae-setup"><span className="ae-setup-number">01</span><p>{t("Create and fund a mandate-enabled app-managed agent, allowlist the provider, and approve a payment mandate as the owner.", "Crea y fondea un agente gestionado con mandatos, autoriza al proveedor y aprueba un mandato de pago como propietario.")}</p><span className="ae-setup-number">02</span><p>{t("Run the console locally on port 3001. Set KOVAN_AGENT_ACCOUNT, KOVAN_POOL_ID and KOVAN_MANDATE_ID to that agent, pool and approved grant.", "Ejecuta la consola localmente en el puerto 3001. Define KOVAN_AGENT_ACCOUNT, KOVAN_POOL_ID y KOVAN_MANDATE_ID con ese agente, fondo y mandato aprobado.")}</p><span className="ae-setup-number">03</span><p>{t("Call preparePaidResource(url), review and save its terms, then call requestPaidResource(request). Reuse the saved request for retries; never create a new payment while settlement is unknown.", "Llama a preparePaidResource(url), revisa y guarda sus condiciones, y llama a requestPaidResource(request). Reutiliza la solicitud guardada al reintentar; no crees otro pago mientras la liquidación sea desconocida.")}</p></aside>
      <p className="ae-note">{t("The preview is illustrative. The copied function uses the real console endpoint when you run it, and the console signs with its configured agent key on Stellar testnet.", "La simulación es ilustrativa. La función copiada usa la API real de la consola al ejecutarla, y la consola firma con la clave configurada del agente en la testnet de Stellar.")}</p>
    </div>
  </main>;
}
