import { DOCS_URL, GITHUB_LABEL, GITHUB_URL, primaryCta } from "@/config/site";
import { PrimaryLink } from "@/components/primary-link";
import { Magnetic } from "@/components/motion/magnetic";
import { SplitWords } from "@/components/motion/split-words";

export function Cta() {
  const cta = primaryCta();
  return (
    <section className="cta" data-sec="10" data-title="Get started">
      <div className="wrap">
        <div className="cta-box scrub" data-reveal>
          <svg className="bigmark" viewBox="0 0 401 505" aria-hidden>
            <g fill="#fff">
              <polygon points="0,183 401,0 401,153 0,336" />
              <polygon points="62,350 330,229 330,505" />
            </g>
          </svg>
          <h2>
            <SplitWords text="Give your agents a budget, not a blank check." />
          </h2>
          <p>Humans configure. Agents only execute inside limits. Start on Stellar testnet today.</p>
          <div className="cta-links">
            <Magnetic block strength={0.06}>
              <PrimaryLink className="cl beam">
                <span className="k">{cta.kicker}</span>
                <span className="v">
                  {cta.label} <span>{cta.external ? "↗" : "→"}</span>
                </span>
                <small>{cta.detail}</small>
              </PrimaryLink>
            </Magnetic>
            <Magnetic block strength={0.06}>
              <a className="cl beam" href={DOCS_URL} target="_blank" rel="noopener noreferrer">
                <span className="k">Docs</span>
                <span className="v">
                  Read the docs <span>↗</span>
                </span>
                <small>Covenants, pool and agent runtime</small>
              </a>
            </Magnetic>
            <Magnetic block strength={0.06}>
              <a className="cl beam" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                <span className="k">Source</span>
                <span className="v">
                  View on GitHub <span>↗</span>
                </span>
                <small>{GITHUB_LABEL} · contracts and tests</small>
              </a>
            </Magnetic>
          </div>
        </div>
      </div>
    </section>
  );
}
