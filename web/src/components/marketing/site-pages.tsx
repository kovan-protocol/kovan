"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, GitBranch, LockKeyhole, ShieldCheck, SlidersHorizontal, Wallet } from "lucide-react";
import { CountUp } from "@/components/motion/count-up";
import { contractUrl, deployment, drawLimit, fundUsdc } from "@/lib/testnet";
import { AmbientCarousel } from "./ambient-carousel";
import { useCopy, usePreferences } from "./preferences";
import { ClosingNote, PrimaryAction, Reveal, TextLink } from "./primitives";
import { ProductFlow } from "./product-flow";
import { Playground } from "./playground";
import { PrincipleMotion } from "./principle-motion";
import { RiseText } from "./rise-text";

export function HomeContent() {
  const t = useCopy();
  const { locale } = usePreferences();
  return <main id="main" tabIndex={-1} className="page-main home-page">
    <section className="hero-section container">
      <div className="hero-copy">
        <Link href="/developers" className="network-label"><span className="status-dot" />{t("Built on Stellar", "Sobre Stellar")}<span className="label-divider" />Testnet<ArrowUpRight size={13} /></Link>
        <h1><RiseText text={t("Shared USDC budgets your AI agents can't overspend.", "Presupuestos compartidos en USDC que tus agentes de IA no pueden sobrepasar.")} /></h1>
        <p className="hero-subtitle">{t("Your agents move. Your limits stay.", "Tus agentes avanzan. Tus límites se respetan.")}</p>
        <p className="hero-description">{t("Humans configure. Agents only execute inside limits.", "Las personas configuran. Los agentes solo ejecutan dentro de los límites.")}</p>
        <div className="hero-actions"><PrimaryAction href="/agent-example" label={t("Try with your agent", "Prueba con tu agente")} /></div>
      </div>
      <div className="hero-visual"><ProductFlow locale={locale} /></div>
    </section>

    <div className="infrastructure container"><AmbientCarousel variant="stack" /><span>{t("BUILT WITH", "CONSTRUIDO CON")}</span><div className="infrastructure-brands"><span className="stack-word">Stellar</span><span className="stack-word">USDC</span><span className="stack-word">OpenZeppelin</span><span className="stack-word">Soroban</span></div></div>

    <section className="home-principles container section-space">
      <Reveal className="section-heading"><p className="eyebrow">{t("LESS OVERSIGHT. MORE CERTAINTY.", "MENOS SUPERVISIÓN. MÁS CERTEZA.")}</p><h2>{t("Room to do more.", "Espacio para hacer más.")}<br /><span>{t("Boundaries that hold.", "Límites que se respetan.")}</span></h2></Reveal>
      <div className="principles-grid">
        <Reveal><Link href="/how-it-works" className="principle"><PrincipleMotion kind="pool" locale={locale} /><span className="principle-number">01 / {t("ONE SHARED POOL", "UN FONDO COMÚN")}</span><h3>{t("One balance. Every agent.", "Un saldo. Todos tus agentes.")}</h3><p>{t("Allocate budgets from one place. Keep the full picture.", "Asigna presupuestos desde un lugar. Mantén la visión completa.")}</p><span className="principle-link">{t("See the flow", "Conoce el flujo")}<ArrowUpRight size={17} /></span></Link></Reveal>
        <Reveal><Link href="/security" className="principle"><PrincipleMotion kind="rules" locale={locale} /><span className="principle-number">02 / {t("BUILT-IN BOUNDARIES", "LÍMITES INTEGRADOS")}</span><h3>{t("Rules before payments.", "Las reglas, antes del pago.")}</h3><p>{t("Every transfer is checked against the permissions you set.", "Cada transferencia se verifica con los permisos que tú defines.")}</p><span className="principle-link">{t("Explore the safeguards", "Explora la protección")}<ArrowUpRight size={17} /></span></Link></Reveal>
        <Reveal><Link href="/why-kovan" className="principle"><PrincipleMotion kind="control" locale={locale} /><span className="principle-number">03 / {t("HUMAN CONTROL", "CONTROL HUMANO")}</span><h3>{t("The final say is yours.", "La última palabra es tuya.")}</h3><p>{t("Revoke access. Recover unspent funds. Stay in charge.", "Revoca accesos. Recupera fondos sin usar. Tú decides.")}</p><span className="principle-link">{t("Why Kovan", "Por qué Kovan")}<ArrowUpRight size={17} /></span></Link></Reveal>
      </div>
    </section>
    <ClosingNote />
  </main>;
}

export function HowContent() {
  const t = useCopy();
  const { locale } = usePreferences();
  const [step, setStep] = useState(0);
  const steps = [
    { title: t("Fund one pool.", "Deposita en un fondo."), description: t("The owner deposits testnet USDC into a shared pool. Each agent gets a defined share of the available budget.", "El propietario deposita USDC de testnet en un fondo común. Cada agente recibe una parte definida del presupuesto."), icon: Wallet },
    { title: t("Set the boundaries.", "Define los límites."), description: t("Choose the budget, approved recipients, payment caps and expiry. The agent cannot rewrite its own rules.", "Elige el presupuesto, los destinatarios, los límites de pago y la vigencia. El agente no puede reescribir sus reglas."), icon: SlidersHorizontal },
    { title: t("Let the agent work.", "Deja actuar al agente."), description: t("The agent draws within its allowance. Its smart account checks each outgoing payment against your rules.", "El agente retira fondos dentro de su asignación. Su cuenta inteligente verifica cada pago según tus reglas."), icon: ShieldCheck },
  ];
  return <main id="main" tabIndex={-1} className="page-main">
    <div className="container page-intro"><p className="eyebrow">{t("HOW IT WORKS", "CÓMO FUNCIONA")}</p><h1><RiseText text={t("From your budget", "De tu presupuesto")} /><br /><RiseText className="line-muted" text={t("to their next move.", "a su próxima acción.")} /></h1><p className="page-lede">{t("Three steps. A clear path for every payment.", "Tres pasos. Un camino claro para cada pago.")}</p></div>
    <section className="container how-layout" aria-label={t("Explore the payment flow", "Explora el flujo del pago")}>
      <div className="how-step-list">{steps.map((item, index) => <button key={index} type="button" className={`how-step ${step === index ? "is-active" : ""}`} onClick={() => setStep(index)} aria-pressed={step === index} aria-controls="flow-detail"><span className="step-number">0{index + 1}</span><span><span className="step-title">{item.title}</span><span className="step-description">{item.description}</span></span><ArrowRight size={18} aria-hidden="true" /></button>)}</div>
      <div id="flow-detail"><ProductFlow locale={locale} activeStep={step} /></div>
    </section>
    <Reveal className="container recovery-note"><ArrowDownLeft size={26} /><div><h2>{t("And you keep the keys.", "Y tú conservas el control.")}</h2><p>{t("Revoke an agent and recover its unspent funds. Returning funds remains possible after revocation or expiry.", "Revoca un agente y recupera sus fondos sin usar. Puedes recuperar fondos incluso tras una revocación o el vencimiento.")}</p></div><TextLink href="/playground">{t("Try a payment", "Prueba un pago")}</TextLink></Reveal>
    <ClosingNote />
  </main>;
}

export function WhyContent() {
  const t = useCopy();
  return <main id="main" tabIndex={-1} className="page-main">
    <div className="container page-intro"><p className="eyebrow">{t("WHY KOVAN", "POR QUÉ KOVAN")}</p><h1><RiseText text={t("Give them autonomy.", "Dales autonomía.")} /><br /><RiseText className="line-muted" text={t("Keep your peace of mind.", "Conserva la tranquilidad.")} /></h1><p className="page-lede">{t("An agent needs a budget. It doesn't need unlimited access to yours.", "Un agente necesita presupuesto. No necesita acceso ilimitado al tuyo.")}</p></div>
    <section className="container why-feature">
      <Reveal className="allocation-visual"><div className="allocation-header"><Wallet size={19} /><span>{t("Shared pool", "Fondo común")}</span><a className="subtle-tag" href={contractUrl(deployment.pool)} target="_blank" rel="noopener noreferrer">{t("Testnet", "Testnet")}</a></div><div className="allocation-total"><CountUp value={Number(fundUsdc)} decimals={2} /> <small>USDC</small></div><div className="allocation-bar" aria-label={t("10% allocated, 90% unallocated", "10% asignado, 90% sin asignar")}><span /></div><div className="allocation-legend"><span><i />{t("Agent budget", "Presupuesto del agente")}<b><CountUp value={Number(drawLimit)} decimals={2} /></b></span><span><i />{t("Unallocated", "Sin asignar")}<b>{(Number(fundUsdc) - Number(drawLimit)).toFixed(2)}</b></span></div><div className="allocation-agent"><span className="agent-monogram">M</span><div><strong>Monitor</strong><small>{t("A wallet with boundaries", "Una cuenta con límites")}</small></div><LockKeyhole size={17} /></div></Reveal>
      <Reveal className="why-copy"><p className="eyebrow">01 / {t("SHARED CAPITAL", "CAPITAL COMPARTIDO")}</p><h2>{t("One pool.", "Un fondo.")}<br />{t("A clearer picture.", "Una visión más clara.")}</h2><p>{t("Stop scattering funds across agent wallets. Define individual allowances from a shared pool, with total allocations bounded by its balance.", "Deja de repartir fondos entre cuentas aisladas. Define asignaciones individuales desde un fondo común, limitadas por su saldo.")}</p><TextLink href="/how-it-works">{t("See how it works", "Descubre cómo funciona")}</TextLink></Reveal>
    </section>
    <section className="container feature-grid section-space">
      <Reveal className="feature-item"><ShieldCheck /><p className="eyebrow">02 / {t("ACCOUNT-LEVEL RULES", "REGLAS EN CADA CUENTA")}</p><h3>{t("A boundary, not a prompt.", "Un límite, no una instrucción.")}</h3><p>{t("Spending permissions are checked by the smart account. They don't depend on an agent remembering instructions.", "La cuenta inteligente verifica los permisos de gasto. No dependen de que el agente recuerde una instrucción.")}</p></Reveal>
      <Reveal className="feature-item"><GitBranch /><p className="eyebrow">03 / {t("BOUNDED DELEGATION", "DELEGACIÓN CON LÍMITES")}</p><h3>{t("Smaller scope. Same rules.", "Menos alcance. Mismas reglas.")}</h3><p>{t("A child agent gets a narrower covenant, carved from its parent's remaining allowance. Delegation can't expand authority.", "Un subagente recibe permisos más acotados, tomados de la asignación restante de su agente padre. Delegar no amplía la autoridad.")}</p></Reveal>
      <Reveal className="feature-item"><SlidersHorizontal /><p className="eyebrow">04 / {t("OWNER AUTHORITY", "AUTORIDAD DEL PROPIETARIO")}</p><h3>{t("You have the final say.", "Tú tienes la última palabra.")}</h3><p>{t("Amend numeric limits, revoke an agent or recover unspent funds. The agent cannot grant itself new permissions.", "Ajusta límites numéricos, revoca un agente o recupera fondos sin usar. El agente no puede otorgarse nuevos permisos.")}</p></Reveal>
    </section>
    <ClosingNote />
  </main>;
}

export function PlaygroundContent() {
  const t = useCopy();
  const { locale } = usePreferences();
  return <main id="main" tabIndex={-1} className="page-main">
    <div className="container page-intro compact-intro"><p className="eyebrow">{t("INTERACTIVE DEMO", "DEMO INTERACTIVA")}</p><h1><RiseText text={t("Try the freedom.", "Prueba la autonomía.")} /><br /><RiseText className="line-muted" text={t("Test the limits.", "Comprueba los límites.")} /></h1><p className="page-lede">{t("Change a payment. See what the covenant allows.", "Modifica un pago. Descubre qué permite el acuerdo de gasto.")}</p></div>
    <div className="container playground-container"><Playground locale={locale} /></div>
    <div className="container playground-next"><TextLink href="/security">{t("Understand the safeguards", "Conoce las medidas de protección")}</TextLink></div>
  </main>;
}
