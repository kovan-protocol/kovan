import { DOCS_URL } from "@/config/site";
import { PrimaryLink } from "@/components/primary-link";
import { Magnetic } from "@/components/motion/magnetic";
import { SplitWords } from "@/components/motion/split-words";
import { HeroStage } from "@/components/sections/hero-stage";
import { TestnetTicker } from "@/components/sections/testnet-ticker";
import {
  contractUrl,
  deployedAtLabel,
  deployment,
  shortId,
  txUrl,
  txsByGroup,
} from "@/lib/testnet";

function txTail(hash: string) {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

export function Hero() {
  const fund = txsByGroup("fund")[0];
  const created = txsByGroup("create_agent")[0];
  const proof = [
    { k: "kovan-pool", v: shortId(deployment.pool), href: contractUrl(deployment.pool) },
    { k: "covenant policy", v: shortId(deployment.policy), href: contractUrl(deployment.policy) },
    fund
      ? { k: "legacy fund · 5 testnet USDC", v: `tx ${txTail(fund.hash)}`, href: txUrl(fund.hash) }
      : null,
    created
      ? { k: "legacy create_agent · $0.50 limit", v: `tx ${txTail(created.hash)}`, href: txUrl(created.hash) }
      : null,
    { k: "ed25519 verifier", v: shortId(deployment.verifier), href: contractUrl(deployment.verifier) },
  ].filter((item): item is { k: string; v: string; href: string } => item !== null);

  return (
    <section className="hero" id="top" data-sec="00" data-title="Kovan">
      <div className="aurora" aria-hidden>
        <i className="a1" />
        <i className="a2" />
        <i className="a3" />
      </div>
      <div className="bgdots" />
      <div className="glow" />
      <div className="wrap">
        <TestnetTicker />
        <div className="hero-copy">
          <a className="badge" href="#developers">
            <span className="pill">
              <span className="dot" />
              Public beta
            </span>
            Stellar testnet <span aria-hidden>→</span>
          </a>
          <h1>
            <SplitWords text="Shared USDC budgets your AI agents can't overspend." />
          </h1>
          <p className="subhead">Humans configure. Agents only execute inside limits.</p>
          <p className="lede">
            One USDC pool. A smart-account wallet for every AI agent, bound by an on-chain covenant it
            can&apos;t rewrite, can&apos;t exceed, and can&apos;t hand down wider than it was given.
          </p>
          <div className="ctas">
            <Magnetic>
              <PrimaryLink className="btn btn-primary magnet" />
            </Magnetic>
            <Magnetic>
              <a className="btn btn-ghost magnet" href={DOCS_URL} target="_blank" rel="noopener noreferrer">
                Read the docs
              </a>
            </Magnetic>
            <a className="btn btn-text" href="#attack">
              See an attack fail <span className="arr">↓</span>
            </a>
          </div>
          <a className="livechip" href={contractUrl(deployment.pool)} target="_blank" rel="noopener noreferrer">
            <span className="dot" />
            Live on Stellar testnet · pool <b>{shortId(deployment.pool)}</b>{" "}
            <span className="ext">Stellar Expert ↗</span>
          </a>
        </div>
        <HeroStage />
        <div className="proof" role="group" aria-label="Live on Stellar testnet">
          <div className="proof-head">
            <span className="l">
              <span className="dot" />
              Live on Stellar testnet · deployed {deployedAtLabel}
            </span>
            <span>Verify on Stellar Expert ↗</span>
          </div>
          <div className="proof-grid">
            {proof.map((item) => (
              <a key={item.k} className="proof-item" href={item.href} target="_blank" rel="noopener noreferrer">
                <span className="k">
                  {item.k} <span className="ext">↗</span>
                </span>
                <span className="v">{item.v}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
