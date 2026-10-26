"use client";

import { useLayoutEffect, useRef } from "react";
import { ArrowDownLeft, ArrowUpRight, Check, CircleDollarSign, Fingerprint, LockKeyhole, Pause, Play, RotateCcw, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { AgentCharacter } from "./agent-character";
import { useProductFilm } from "./use-product-film";
import "./product-flow.css";

type Locale = "en" | "es";

function Mark() {
  return <svg viewBox="0 0 401 505" fill="currentColor" aria-hidden="true"><path d="M0 183 401 0v153L0 336Zm62 167 268-121v276Z" /></svg>;
}

/** A live-rendered product film: all amounts and actions are illustrative. */
export function ProductFlow({ locale = "en", activeStep }: { locale?: Locale; activeStep?: number }) {
  const root = useRef<HTMLElement>(null);
  const film = useProductFilm(root, { activeStep });
  const t = (en: string, es: string) => locale === "es" ? es : en;
  const phases = [t("Fund", "Fondos"), t("Set rules", "Reglas"), t("Pay", "Pagos"), t("Control", "Control")];
  const phaseTitles = [t("Capital, put to work.", "Capital en movimiento."), t("Your rules, built in.", "Tus reglas, integradas."), t("Every payment, checked.", "Cada pago, verificado."), t("The control stays yours.", "El control sigue contigo.")];

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const resize = () => {
      const width = element.clientWidth;
      element.style.setProperty("--kf-scale", String(width / (width <= 480 ? 440 : 600)));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <figure ref={root} className="kf-film" data-phase={film.phase} data-paused={film.paused} data-reduced={film.reducedMotion}>
      <div className="kf-viewport" role="img" aria-label={t("Product simulation: fund a shared pool with 5 USDC, set a 0.50 USDC budget, approve a 0.05 payment, then block a payment to a recipient that is not allowed. No funds move in the blocked attempt. The owner can revoke the agent and recover the unspent balance.", "Simulación de producto: aporta 5 USDC a un fondo, asigna 0.50 USDC, autoriza un pago de 0.05 y después bloquea un pago a un destinatario no permitido. En el intento bloqueado no se mueven fondos. El propietario puede revocar al agente y recuperar el saldo sin usar.")}>
      <div className="kf-artboard" aria-hidden="true">
        <div className="kf-film-label"><span><i />KOVAN IN MOTION</span><span>{t("PRODUCT SIMULATION", "SIMULACIÓN DE PRODUCTO")}</span></div>
        <div className="kf-camera">
          <div className="kf-orbit kf-orbit-one" /><div className="kf-orbit kf-orbit-two" />
          <div className="kf-core" data-object="agent-account">
            <div className="kf-node-shell">
              <svg className="kf-node-boundary" viewBox="0 0 224 224" fill="none">
                <circle className="kf-node-ring-base" cx="112" cy="112" r="96" />
                <circle className="kf-node-rule-ring" cx="112" cy="112" r="96" pathLength="1" transform="rotate(-90 112 112)" />
                <path className="kf-node-ports" d="M0 112H34M190 112H224M112 0V34M112 190V224" />
                {[ [16,112], [208,112], [112,16], [112,208] ].map(([cx,cy]) => <circle className="kf-node-port" key={`${cx}-${cy}`} cx={cx} cy={cy} r="4" />)}
              </svg>
              <span className="kf-agent-type"><strong>monitor</strong><span>{t("SMART ACCOUNT", "CUENTA INTELIGENTE")}</span></span>
              <div className="kf-agent-portrait"><AgentCharacter /></div>
              <div className="kf-agent-identity"><strong>0.50</strong><span>USDC</span></div>
            </div>
          </div>

          <div className="kf-act kf-act-0">
            <svg className="kf-traces" viewBox="0 0 600 560" preserveAspectRatio="none" fill="none"><path className="kf-trace" pathLength="1" d="M220 166H285Q300 166 300 181V245" /><path className="kf-trace" pathLength="1" d="M320 350V408Q320 427 340 427H410" /></svg>
            <div className="kf-panel kf-funding" data-side="left"><div className="kf-panel-label"><CircleDollarSign size={14} />{t("SHARED POOL", "FONDO COMÚN")}<span className="kf-mini-status">USDC</span></div><div className="kf-large-number"><span className="kf-counter" data-value="5.00">5.00</span><small>USDC</small></div><div className="kf-meter"><span className="kf-meter-fill" /></div><div className="kf-panel-foot"><span>{t("Available to allocate", "Disponible para asignar")}</span><ArrowUpRight size={13} /></div></div>
            <div className="kf-panel kf-assignment" data-enter="1.8" data-side="right"><div className="kf-panel-label">{t("ALLOCATING BUDGET", "ASIGNANDO PRESUPUESTO")}</div><div className="kf-agent-row"><span className="kf-avatar">m</span><div><strong>monitor</strong><small>{t("Smart account", "Cuenta inteligente")}</small></div><span className="kf-check"><Check size={14} /></span></div><div className="kf-assignment-value"><span>0.50 <small>USDC</small></span><span className="kf-mini-pill">{t("Assigned", "Asignado")}</span></div></div>
            <div className="kf-panel kf-funding-note" data-enter="3.2"><ShieldCheck size={14} /><span>{t("One pool. Bounded access.", "Un fondo. Acceso limitado.")}</span></div>
          </div>

          <div className="kf-act kf-act-1">
            <svg className="kf-traces" viewBox="0 0 600 560" preserveAspectRatio="none" fill="none"><path className="kf-trace" pathLength="1" d="M300 215H395Q412 215 412 195V165" /><path className="kf-trace" pathLength="1" d="M280 325H160Q145 325 145 343V385" /></svg>
            <div className="kf-panel kf-permissions" data-enter=".12" data-side="right"><div className="kf-panel-label"><Fingerprint size={14} />{t("APPROVED RECIPIENTS", "DESTINATARIOS PERMITIDOS")}</div><div className="kf-permission-row kf-transaction"><span className="kf-provider-icon">d</span><span>data-provider</span><span className="kf-check"><Check size={12} /></span></div><div className="kf-permission-row kf-transaction"><span className="kf-provider-icon">r</span><span>rpc-provider</span><span className="kf-check"><Check size={12} /></span></div><div className="kf-panel-foot"><LockKeyhole size={11} /><span>{t("Set by the owner", "Define el propietario")}</span></div></div>
            <div className="kf-panel kf-limits-panel" data-enter=".65" data-side="left"><div className="kf-panel-label"><SlidersHorizontal size={14} />{t("SPENDING LIMITS", "LÍMITES DE GASTO")}</div><div className="kf-limit-line"><span>{t("Per payment", "Por pago")}</span><strong>0.10 <small>USDC</small></strong></div><div className="kf-meter"><span className="kf-meter-fill" /></div><div className="kf-limit-line"><span>{t("Agent budget", "Presupuesto")}</span><strong>0.50 <small>USDC</small></strong></div><div className="kf-meter kf-meter-wide"><span className="kf-meter-fill" /></div></div>
            <div className="kf-panel kf-policy-seal" data-enter="3.2"><span className="kf-check"><ShieldCheck size={17} /></span><span>{t("Policy attached", "Reglas integradas")}</span></div>
          </div>

          <div className="kf-act kf-act-2">
            <svg className="kf-traces" viewBox="0 0 600 560" preserveAspectRatio="none" fill="none"><path className="kf-trace" pathLength="1" d="M210 160H300Q320 160 320 180V240H400" /><path className="kf-trace" pathLength="1" d="M476 345V422Q476 439 455 439H330" /></svg>
            <div className="kf-panel kf-request" data-enter=".12" data-side="left"><div className="kf-panel-label">{t("PAYMENT REQUEST", "SOLICITUD DE PAGO")}<ArrowUpRight size={14} /></div><div className="kf-request-line"><span className="kf-provider-icon">d</span><div><strong>data-provider</strong><small>GET /feed</small></div></div><div className="kf-request-amount">0.05 <small>USDC</small><span className="kf-request-tag">x402</span></div><div className="kf-scan" /></div>
            <div className="kf-panel kf-verification" data-enter="1.4" data-side="right"><div className="kf-panel-label"><ShieldCheck size={14} />{t("VERIFYING RULES", "VERIFICANDO REGLAS")}</div>{[t("Recipient allowed", "Destino permitido"), t("Within payment cap", "Dentro del límite"), t("Budget available", "Presupuesto disponible")].map((label, index) => <div className="kf-verify-row kf-transaction" key={index}><span className="kf-check"><Check size={12} /></span><span>{label}</span><span className="kf-verify-line" /></div>)}<div className="kf-meter"><span className="kf-meter-fill" /></div></div>
            <div className="kf-panel kf-receipt" data-enter="2.15"><span className="kf-receipt-icon kf-check"><Check size={19} /></span><div><strong>{t("Payment approved", "Pago autorizado")}</strong><small>{t("Every rule respected.", "Cumple todas las reglas.")}</small></div><span>0.05<small>USDC</small></span></div>
            <div className="kf-panel kf-blocked" data-enter="3.35"><div className="kf-panel-label">{t("PAYMENT REQUEST", "SOLICITUD DE PAGO")}</div><div className="kf-request-line"><span className="kf-provider-icon">?</span><div><strong>unknown-payee</strong><small>{t("Not on the allowlist", "Fuera de la lista")}</small></div></div><div className="kf-verify-row kf-fail kf-transaction"><span className="kf-check kf-x" aria-hidden="true">✕</span><span>{t("Recipient allowed", "Destino permitido")}</span></div><strong className="kf-blocked-chip">{t("Blocked · PayeeNotAllowed", "Bloqueado · PayeeNotAllowed")}</strong><small className="kf-blocked-note">{t("No funds moved.", "No se movieron fondos.")}</small></div>
          </div>

          <div className="kf-act kf-act-3">
            <div className="kf-panel kf-dashboard" data-enter=".12"><div className="kf-dashboard-bar"><i /><i /><i /><span>Kovan / {t("Overview", "Resumen")}</span></div><div className="kf-dashboard-content"><div className="kf-dashboard-side"><Mark /><span /><span /><span /></div><div className="kf-dashboard-main"><div className="kf-dashboard-heading">{t("Your workspace", "Tu espacio")}<span>{t("EXAMPLE", "EJEMPLO")}</span></div><div className="kf-dashboard-stats"><div><small>{t("Shared pool", "Fondo común")}</small><strong>5.00 <em>TESTNET</em></strong></div><div><small>{t("Agent limit", "Límite del agente")}</small><strong>0.50 <em>TESTNET</em></strong></div></div><div className="kf-dashboard-chart" data-example={t("EXAMPLE", "EJEMPLO")}>{[28,43,35,58,48,69,55,78,73,90,80,96].map((height,index)=><i className="kf-meter-fill" style={{height: height + "%"}} key={index} />)}</div><div className="kf-dashboard-row kf-transaction"><span className="kf-avatar">m</span><span>monitor</span><span className="kf-mini-pill">{t("Managed", "Gestionado")}</span></div></div></div></div>
            <div className="kf-panel kf-owner-panel" data-enter="1.2" data-side="right"><div className="kf-owner-heading"><span className="kf-owner-avatar"><SlidersHorizontal size={17} /></span><div><strong>{t("Owner controls", "Control del propietario")}</strong><small>monitor</small></div></div><div className="kf-owner-toggle"><span>{t("Agent access", "Acceso del agente")}</span><i><span /></i></div><div className="kf-owner-return kf-transaction"><ArrowDownLeft size={16} /><div><strong>{t("Recover funds", "Recuperar fondos")}</strong><small>{t("Unspent balance → pool", "Saldo sin usar → fondo")}</small></div><Check className="kf-check" size={14} /></div><div className="kf-owner-note"><LockKeyhole size={12} />{t("The final say is yours.", "La última palabra es tuya.")}</div></div>
          </div>
        </div>
        <div className="kf-scene-description">{phaseTitles.map((title,index)=><span key={index} data-visible={film.phase===index}>{title}</span>)}</div>
      </div>
    </div>
    <figcaption className="kf-controls">
      <div className="kf-chapters" aria-label={t("Animation chapters", "Escenas de la animación")}>
        {phases.slice(0,activeStep === undefined ? 4 : 3).map((label,index)=><button type="button" key={index} disabled={activeStep !== undefined} aria-label={t("Show scene: ", "Mostrar escena: ") + label} aria-current={film.phase===index ? "step" : undefined} onClick={()=>film.seek(index)}><span className="kf-chapter-label"><span>0{index+1}</span>{label}</span><span className="kf-chapter-track"><i style={{transform:"scaleX(" + Math.max(0,Math.min(1,film.progress*4-index)) + ")"}} /></span></button>)}
      </div>
      {activeStep===undefined && <div className="kf-playback"><button type="button" className="kf-play-button" onClick={film.toggle} disabled={film.reducedMotion} aria-label={film.paused ? t("Play animations", "Reproducir animaciones") : t("Pause animations", "Pausar animaciones")} title={film.paused ? t("Play animations", "Reproducir animaciones") : t("Pause animations", "Pausar animaciones")}>{film.paused || film.reducedMotion ? <Play size={14} fill="currentColor" /> : <Pause size={15} />}</button><button type="button" className="kf-play-button" onClick={() => { film.replay(); root.current?.dispatchEvent(new Event("kovan-character-replay")); }} disabled={film.reducedMotion} aria-label={t("Replay film", "Repetir animación")} title={t("Replay film", "Repetir animación")}><RotateCcw size={14}/></button></div>}
    </figcaption>
    <span className="kf-sr-only">{t("Illustrative values. Not live transactions.", "Valores ilustrativos. No son transacciones reales.")}</span>
  </figure>;
}
