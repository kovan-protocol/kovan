"use client";

import { useId, useState, type FormEvent } from "react";
import { ArrowRight, Check, ChevronDown, RotateCcw, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { DRAW, PER, TOTAL, evaluatePayment, type Payee } from "@/lib/simulator";
import "./playground.css";

type Locale = "en" | "es";
type Result = { reason: string | null; amount: number; sequence: number };

const copy = {
  en: {
    title: "Your agent’s next payment",
    simulation: "Interactive simulation",
    presets: "Start with a scenario",
    scenarios: ["An approved payment", "An unknown recipient", "Above the limit"],
    amount: "Payment amount",
    range: "Adjust payment amount",
    recipient: "Recipient",
    recipients: ["Approved data provider", "Unapproved recipient", "The agent’s own account"],
    conditions: "Agent conditions",
    revoked: "Agent revoked",
    expired: "Rules expired",
    submit: "Run payment",
    reset: "Reset demo",
    policy: "The spending rules",
    draw: "Agent budget",
    per: "Per payment",
    total: "Total to this provider",
    spent: "Spent in this session",
    ready: "Your rules are in place.",
    readyDetail: "Choose a scenario or adjust the payment. Then see what the account allows.",
    accepted: "Payment approved.",
    acceptedDetail: "The recipient and amount are within the rules.",
    denied: "Funds stay protected.",
    noChange: "No funds moved. Your remaining budget is unchanged.",
    invalid: "Choose an amount from 0.01 to 0.60 USDC, in steps of 0.01.",
    amountSent: "Simulated payment",
    amountStopped: "Payment not sent",
    attempt: "Attempt",
    note: "Simulation only. No wallet, real funds or on-chain transactions.",
    reasons: {
      revoked: "This agent has been revoked by its owner.",
      expired: "The spending rules have expired.",
      "over limit": "This payment would exceed the agent’s remaining budget.",
      "not listed": "This recipient is not on the approved list.",
      blocked: "The agent cannot call its own account to change its rules.",
      "over cap": "This amount exceeds the 0.10 USDC per-payment limit.",
      "total cap": "Payments to this provider would exceed the 0.40 USDC total limit.",
    } as Record<string, string>,
  },
  es: {
    title: "El próximo pago de tu agente",
    simulation: "Simulación interactiva",
    presets: "Empieza con un escenario",
    scenarios: ["Un pago permitido", "Un destinatario desconocido", "Por encima del límite"],
    amount: "Importe del pago",
    range: "Ajustar el importe del pago",
    recipient: "Destinatario",
    recipients: ["Proveedor de datos autorizado", "Destinatario no autorizado", "La propia cuenta del agente"],
    conditions: "Condiciones del agente",
    revoked: "Agente revocado",
    expired: "Reglas vencidas",
    submit: "Ejecutar pago",
    reset: "Reiniciar demo",
    policy: "Las reglas de gasto",
    draw: "Presupuesto del agente",
    per: "Por pago",
    total: "Total para este proveedor",
    spent: "Gastado en esta sesión",
    ready: "Tus reglas están definidas.",
    readyDetail: "Elige un escenario o ajusta el pago. Descubre qué permite la cuenta.",
    accepted: "Pago aprobado.",
    acceptedDetail: "El destinatario y el importe cumplen las reglas.",
    denied: "Los fondos siguen protegidos.",
    noChange: "No se movieron fondos. Tu presupuesto disponible no cambia.",
    invalid: "Elige un importe de 0,01 a 0,60 USDC, en pasos de 0,01.",
    amountSent: "Pago simulado",
    amountStopped: "Pago no enviado",
    attempt: "Intento",
    note: "Solo una simulación. Sin wallet, fondos reales ni transacciones en la red.",
    reasons: {
      revoked: "El propietario revocó a este agente.",
      expired: "Las reglas de gasto ya vencieron.",
      "over limit": "Este pago superaría el presupuesto disponible del agente.",
      "not listed": "El destinatario no está en la lista de autorizados.",
      blocked: "El agente no puede llamar a su propia cuenta para cambiar sus reglas.",
      "over cap": "El importe supera el límite de 0,10 USDC por pago.",
      "total cap": "Los pagos a este proveedor superarían el límite total de 0,40 USDC.",
    } as Record<string, string>,
  },
};

export function Playground({ locale }: { locale: Locale }) {
  const t = copy[locale];
  const id = useId();
  const [amount, setAmount] = useState("0.05");
  const [payee, setPayee] = useState<Payee>("provider");
  const [revoked, setRevoked] = useState(false);
  const [expired, setExpired] = useState(false);
  const [balance, setBalance] = useState({ drawn: 0, spent: 0 });
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const fmt = (value: number) => value.toFixed(2);

  function clearResult() {
    setResult(null);
    setInvalid(false);
  }

  function selectScenario(index: number) {
    setAmount(index === 2 ? "0.15" : "0.05");
    setPayee(index === 1 ? "unlisted" : "provider");
    setRevoked(false);
    setExpired(false);
    clearResult();
  }

  function runPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(amount);
    if (!amount.trim() || !Number.isFinite(value) || value < 0.01 || value > 0.6 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) {
      setInvalid(true);
      setResult(null);
      return;
    }
    setInvalid(false);
    const failure = evaluatePayment({ amount: value, payee, ...balance, revoked, expired });
    const sequence = attempt + 1;
    setAttempt(sequence);
    setResult({ reason: failure?.short ?? null, amount: value, sequence });
    if (!failure) {
      setBalance((previous) => ({
        drawn: Math.round((previous.drawn + value) * 100) / 100,
        spent: Math.round((previous.spent + value) * 100) / 100,
      }));
    }
  }

  function reset() {
    setAmount("0.05");
    setPayee("provider");
    setRevoked(false);
    setExpired(false);
    setBalance({ drawn: 0, spent: 0 });
    setAttempt(0);
    clearResult();
  }

  const success = result !== null && result.reason === null;

  return (
    <div className="pg-demo">
      <div className="pg-heading">
        <h2>{t.title}</h2>
        <span className="pg-simulation"><span aria-hidden="true" />{t.simulation}</span>
      </div>

      <div className="pg-workspace">
        <form className="pg-form" onSubmit={runPayment} noValidate>
          <fieldset className="pg-scenarios">
            <legend>{t.presets}</legend>
            <div className="pg-scenario-list">
              {t.scenarios.map((scenario, index) => (
                <button key={index} type="button" onClick={() => selectScenario(index)}>
                  <span className="pg-scenario-number" aria-hidden="true">0{index + 1}</span>
                  {scenario}
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              ))}
            </div>
          </fieldset>

          <div className="pg-field">
            <label htmlFor={`${id}-amount`}>{t.amount}</label>
            <div className={`pg-amount${invalid ? " pg-invalid" : ""}`}>
              <input
                id={`${id}-amount`}
                type="number"
                min="0.01"
                max="0.60"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(event) => { setAmount(event.target.value); clearResult(); }}
                aria-invalid={invalid}
                aria-describedby={invalid ? `${id}-error` : undefined}
              />
              <span>USDC</span>
            </div>
            <input
              className="pg-range"
              type="range"
              min="0.01"
              max="0.60"
              step="0.01"
              value={Math.min(0.6, Math.max(0.01, Number(amount) || 0.01))}
              onChange={(event) => { setAmount(Number(event.target.value).toFixed(2)); clearResult(); }}
              aria-label={t.range}
              aria-valuetext={`${fmt(Number(amount) || 0)} USDC`}
            />
            <p id={`${id}-error`} className="pg-error" role="alert">{invalid ? t.invalid : null}</p>
          </div>

          <div className="pg-field">
            <label htmlFor={`${id}-recipient`}>{t.recipient}</label>
            <div className="pg-select">
              <select
                id={`${id}-recipient`}
                value={payee}
                onChange={(event) => { setPayee(event.target.value as Payee); clearResult(); }}
              >
                {(["provider", "unlisted", "self"] as const).map((value, index) => (
                  <option key={value} value={value}>{t.recipients[index]}</option>
                ))}
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </div>
          </div>

          <fieldset className="pg-conditions">
            <legend>{t.conditions}</legend>
            <label className="pg-toggle">
              <input type="checkbox" checked={revoked} onChange={(event) => { setRevoked(event.target.checked); clearResult(); }} />
              <span className="pg-toggle-track" aria-hidden="true"><span /></span>
              <span>{t.revoked}</span>
            </label>
            <label className="pg-toggle">
              <input type="checkbox" checked={expired} onChange={(event) => { setExpired(event.target.checked); clearResult(); }} />
              <span className="pg-toggle-track" aria-hidden="true"><span /></span>
              <span>{t.expired}</span>
            </label>
          </fieldset>

          <div className="pg-actions">
            <button type="submit" className="pg-run">{t.submit}<ArrowRight size={17} aria-hidden="true" /></button>
            <button type="button" className="pg-reset" onClick={reset}><RotateCcw size={15} aria-hidden="true" />{t.reset}</button>
          </div>
        </form>

        <div className="pg-preview">
          <div className="pg-rules">
            <div className="pg-rules-title"><SlidersHorizontal size={16} aria-hidden="true" /><h3>{t.policy}</h3></div>
            <dl>
              <div><dt>{t.draw}</dt><dd>{fmt(DRAW)} <span>USDC</span></dd></div>
              <div><dt>{t.per}</dt><dd>{fmt(PER)} <span>USDC</span></dd></div>
              <div><dt>{t.total}</dt><dd>{fmt(TOTAL)} <span>USDC</span></dd></div>
            </dl>
          </div>

          <div className="pg-result-region" aria-live="polite" aria-atomic="true">
            <div className={`pg-result${result ? success ? " pg-approved" : " pg-stopped" : ""}`} key={result?.sequence ?? "ready"}>
              <span className="pg-result-icon" aria-hidden="true">{success ? <Check size={25} strokeWidth={1.7} /> : <ShieldCheck size={27} strokeWidth={1.4} />}</span>
              <h3>{result ? success ? t.accepted : t.denied : t.ready}</h3>
              <p>{result ? success ? t.acceptedDetail : t.reasons[result.reason ?? ""] : t.readyDetail}</p>
              {result && (
                <>
                  <div className="pg-result-value"><span>{success ? t.amountSent : t.amountStopped}</span><strong>{fmt(result.amount)} <small>USDC</small></strong></div>
                  {!success && <p className="pg-result-note">{t.noChange}</p>}
                  <span className="pg-attempt">{t.attempt} {result.sequence}</span>
                </>
              )}
            </div>
          </div>

          <div className="pg-budget">
            <div><span>{t.spent}</span><strong>{fmt(balance.spent)} <span>/ {fmt(DRAW)} USDC</span></strong></div>
            <progress value={balance.spent} max={DRAW} aria-label={t.spent}>{fmt(balance.spent)} / {fmt(DRAW)}</progress>
          </div>
        </div>
      </div>
      <p className="pg-footnote">{t.note}</p>
    </div>
  );
}
