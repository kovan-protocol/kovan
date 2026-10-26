"use client";

import { ArrowUpRight, Clock3, Fingerprint, ShieldCheck } from "lucide-react";
import { DOCS_URL, GITHUB_URL } from "@/config/site";
import {
  contractUrl,
  deployment,
  drawLimit,
  fundUsdc,
  shortId,
  sorobanContracts,
  testCount,
  txUrl,
  verifiedTransactions,
} from "@/lib/testnet";
import { ClosingNote, Reveal, TextLink } from "./primitives";
import { useCopy, usePreferences } from "./preferences";

export function SecurityContent() {
  const t = useCopy();
  const checks = [
    {
      icon: Fingerprint,
      title: t("Known recipients.", "Destinatarios autorizados."),
      detail: t("Payments go only to the providers and recipients you approve.", "Los pagos solo llegan a los proveedores y destinatarios que autorizas."),
    },
    {
      icon: ShieldCheck,
      title: t("Defined limits.", "Límites definidos."),
      detail: t("Per-payment and total caps are checked by the agent’s account.", "La cuenta del agente verifica los límites por pago y de gasto total."),
    },
    {
      icon: Clock3,
      title: t("An expiry built in.", "Una vigencia definida."),
      detail: t("Spending authority ends when the covenant expires. Unspent funds can still be returned.", "El permiso de gasto termina cuando vence el acuerdo. Los fondos no utilizados pueden devolverse."),
    },
  ];
  const rules = [
    [t("The agent cannot rewrite the rules.", "El agente no puede cambiar sus reglas."), t("Its account has no admin rule. The owner can amend limits through the pool.", "Su cuenta no tiene permisos de administración. El propietario puede ajustar los límites desde el fondo.")],
    [t("Delegation stays within bounds.", "La delegación respeta los límites."), t("A child agent receives a subset of its parent’s permissions and remaining budget.", "Cada agente hijo recibe parte de los permisos y del presupuesto disponible de su agente padre.")],
    [t("Revocation extends to children.", "La revocación se aplica a los hijos."), t("Revoke a parent and its child agents stop spending too.", "Al revocar al agente padre, sus agentes hijos también dejan de gastar.")],
    [t("Recovery stays with you.", "La recuperación depende de ti."), t("The owner can return unspent funds to the pool without the agent’s signature.", "El propietario puede devolver al fondo el saldo no utilizado sin la firma del agente.")],
  ];

  return (
    <main className="page-main" id="main" tabIndex={-1}>
      <div className="container">
        <header className="page-intro">
          <p className="eyebrow">{t("SECURITY BY DESIGN", "SEGURIDAD DESDE EL DISEÑO")}</p>
          <h1>{t("Autonomy has", "La autonomía tiene")}<br /><span>{t("a boundary.", "un límite.")}</span></h1>
          <p className="page-lede">{t("Every payment passes through the account’s on-chain rules. Anything outside them is refused.", "Cada pago pasa por las reglas de la cuenta en la red. Si no las cumple, se rechaza.")}</p>
        </header>

        <Reveal className="feature-grid">
          {checks.map(({ icon: Icon, title, detail }) => (
            <article className="feature-item" key={title}>
              <Icon size={24} strokeWidth={1.5} aria-hidden="true" />
              <h3>{title}</h3>
              <p>{detail}</p>
            </article>
          ))}
        </Reveal>

        <section className="section-space">
          <Reveal className="section-heading">
            <div><p className="eyebrow">{t("CONTROL THAT STAYS WITH YOU", "EL CONTROL SIGUE EN TUS MANOS")}</p><h2>{t("The last word is yours.", "La última palabra es tuya.")}</h2></div>
            <TextLink href="/playground">{t("Try the boundaries", "Prueba los límites")}</TextLink>
          </Reveal>
          <Reveal className="rule-list">
            {rules.map(([title, detail], index) => (
              <article key={title}>
                <span aria-hidden="true">0{index + 1}</span>
                <h3>{title}</h3>
                <p>{detail}</p>
              </article>
            ))}
          </Reveal>
        </section>

        <aside className="notice">
          <ShieldCheck size={20} aria-hidden="true" />
          <div>
            <strong>{t("Built on testnet. Not yet audited.", "En testnet. Aún sin auditoría.")}</strong>
            <p>{t("Kovan is a prototype. Explore the source, recorded transactions and tests before evaluating it.", "Kovan es un prototipo. Consulta el código, las transacciones registradas y las pruebas para evaluarlo.")}</p>
            <TextLink href="/developers">{t("Inspect the implementation", "Revisa la implementación")}</TextLink>
          </div>
        </aside>
      </div>
      <ClosingNote />
    </main>
  );
}

export function DevelopersContent() {
  const t = useCopy();
  const { locale } = usePreferences();
  const deployed = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(deployment.deployed_at));
  const contractDescriptions = [
    [t("Shared pool · v2", "Fondo común · v2"), t("Reconciled accounting and permanent shutdown", "Contabilidad conciliada y cierre permanente")],
    [t("Covenant policy", "Política de gasto"), t("Payment permissions and limits", "Permisos y límites de pago")],
    [t("Signature verifier", "Verificador de firmas"), "ed25519"],
    [t("Historical agent account", "Cuenta de agente histórica"), t("Legacy pool · OpenZeppelin smart account", "Fondo anterior · cuenta de OpenZeppelin")],
  ];
  function transactionLabel(id: string, fallback: string) {
    const labels: Record<string, string> = {
      "deploy-verifier": t("Deploy signature verifier", "Desplegar verificador de firmas"),
      "deploy-policy": t("Deploy covenant policy", "Desplegar política de gasto"),
      "deploy-pool": t("Deploy pool v2 · permanent shutdown", "Desplegar fondo v2 · cierre permanente"),
      "deploy-legacy-pool": t("Deploy legacy pool", "Desplegar fondo anterior"),
      fund: t(`Fund legacy pool · ${fundUsdc} testnet USDC`, `Fondear el fondo anterior · ${fundUsdc} USDC de testnet`),
      "create-agent": t(`Legacy agent · ${drawLimit} USDC limit`, `Agente anterior · límite de ${drawLimit} USDC`),
      "blocked-payment": t("Blocked payment", "Pago rechazado"),
    };
    return labels[id] ?? fallback;
  }
  const faq = [
    [t("Is Kovan ready for real funds?", "¿Kovan está listo para fondos reales?"), t("No. This is an unaudited prototype on Stellar testnet. Testnet USDC has no monetary value.", "No. Es un prototipo sin auditar en la testnet de Stellar. El USDC de testnet no tiene valor monetario.")],
    [t("Can an agent change its own rules?", "¿Un agente puede cambiar sus propias reglas?"), t("No. Its smart account is bound to the covenant policy and has no admin rule. Only the owner can amend numeric limits through the pool.", "No. Su cuenta está vinculada a la política de gasto y no tiene permisos de administración. Solo el propietario puede ajustar los límites numéricos desde el fondo.")],
    [t("Where do the funds live?", "¿Dónde están los fondos?"), t("In the pool contract and the agents’ smart accounts. The owner can revoke an agent and recover its unspent funds through the pool, without the agent’s key.", "En el contrato del fondo y en las cuentas inteligentes de los agentes. El propietario puede revocar un agente y recuperar el saldo no utilizado a través del fondo, sin la clave del agente.")],
    [t("How does x402 fit in?", "¿Cómo se integra x402?"), t("x402 lets providers charge per request. A payment from the agent’s smart account must satisfy its covenant. End-to-end contract-account settlement is still being validated on testnet.", "x402 permite cobrar por solicitud. Los pagos desde la cuenta del agente deben cumplir sus reglas. La liquidación completa desde cuentas de contrato sigue en validación en testnet.")],
    [t("Are the visual demos live transactions?", "¿Las demos muestran transacciones reales?"), t("No. Animations and the playground are simulations. The explorer links above point to recorded testnet transactions; simulated results do not produce transaction hashes.", "No. Las animaciones y la demo interactiva son simulaciones. Los enlaces al explorador muestran transacciones registradas en testnet; las simulaciones no generan hashes de transacción.")],
  ];

  return (
    <main className="page-main" id="main" tabIndex={-1}>
      <div className="container">
        <header className="page-intro">
          <p className="eyebrow">{t("FOR DEVELOPERS", "PARA DESARROLLADORES")}</p>
          <h1>{t("Built in the open.", "Desarrollado en abierto.")}<br /><span>{t("Ready to inspect.", "Listo para revisar.")}</span></h1>
          <p className="page-lede">{t("Rust contracts on Stellar. OpenZeppelin smart accounts. Every recorded deployment, one click away.", "Contratos Rust en Stellar. Cuentas inteligentes de OpenZeppelin. Cada despliegue registrado, a un clic.")}</p>
          <div className="page-actions">
            <a className="button button-primary" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">{t("Explore the source", "Explorar el código")}<ArrowUpRight size={17} aria-hidden="true" /></a>
            <a className="button button-secondary" href={DOCS_URL} target="_blank" rel="noopener noreferrer">{t("Read the docs", "Leer documentación")}<ArrowUpRight size={17} aria-hidden="true" /></a>
          </div>
        </header>

        <section>
          <p className="page-lede">{t("The current pool was deployed empty with accounting v2 and permanent shutdown. The unchanged policy, verifier and agent-account code are reused. Older funding and agent records below belong to the legacy pool; this rollout did not move funds or migrate agents.", "El fondo actual se desplegó vacío, con contabilidad v2 y cierre permanente. Se reutilizan la política, el verificador y el código de las cuentas. Los registros anteriores de fondos y agentes pertenecen al fondo anterior; este despliegue no movió fondos ni migró agentes.")}</p>
          <Reveal className="section-heading">
            <div><p className="eyebrow">STELLAR TESTNET</p><h2>{t("Inspect the contracts.", "Revisa los contratos.")}</h2></div>
            <p>{t(`${testCount} tests in the repository.`, `${testCount} pruebas en el repositorio.`)}</p>
          </Reveal>
          <Reveal className="evidence-list">
            {sorobanContracts.map((contract, index) => (
              <a className="evidence-row" key={contract.id} href={contractUrl(contract.id)} target="_blank" rel="noopener noreferrer">
                <div><strong>{contractDescriptions[index][0]}</strong><small>{contractDescriptions[index][1]}</small></div>
                <code title={contract.id}>{shortId(contract.id, 8, 6)}</code>
                <ArrowUpRight size={18} aria-hidden="true" />
              </a>
            ))}
          </Reveal>
        </section>

        <section className="section-space">
          <Reveal className="section-heading">
            <div><p className="eyebrow">{t("RECORDED ON THE NETWORK", "REGISTRADO EN LA RED")}</p><h2>{t("Follow the evidence.", "Comprueba la evidencia.")}</h2></div>
            <p>{t("Deployment", "Despliegue")} · {deployed}</p>
          </Reveal>
          <Reveal className="evidence-list">
            {verifiedTransactions.map((transaction) => (
              <a className="evidence-row" key={transaction.id} href={txUrl(transaction.hash)} target="_blank" rel="noopener noreferrer">
                <div><strong>{transactionLabel(transaction.id, transaction.label)}</strong><small>Stellar Expert · testnet{transaction.historical ? t(" · historical / legacy pool", " · histórico / fondo anterior") : ""}</small></div>
                <code title={transaction.hash}>{shortId(transaction.hash, 8, 6)}</code>
                <ArrowUpRight size={18} aria-hidden="true" />
              </a>
            ))}
          </Reveal>
        </section>

        <section className="section-space" id="faq">
          <Reveal className="section-heading">
            <div><p className="eyebrow">{t("A FEW ANSWERS", "ALGUNAS RESPUESTAS")}</p><h2>{t("Before you build.", "Antes de empezar.")}</h2></div>
          </Reveal>
          <div className="faq-list">
            {faq.map(([question, answer]) => (
              <details key={question}>
                <summary>{question}</summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
      </div>
      <ClosingNote />
    </main>
  );
}
