import { contractUrl, deployment, drawLimit, fundUsdc } from "@/lib/testnet";

function money(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : value;
}

const locked = money(fundUsdc);
const draw = money(drawLimit);
const free = (Number(locked) - Number(draw)).toFixed(2);
const used = Number(locked) > 0 ? `${Math.round((Number(draw) / Number(locked)) * 100)}%` : "0%";

function Mark() {
  return (
    <svg aria-hidden focusable="false" viewBox="0 0 401 505">
      <g fill="#014CFE">
        <polygon points="0,183 401,0 401,153 0,336" />
        <polygon points="62,350 330,229 330,505" />
      </g>
    </svg>
  );
}

function Tag({ live, children }: { live?: boolean; children: string }) {
  return <span className={live ? "hs-tag hs-tag-net" : "hs-tag"}>{children}</span>;
}

export function HeroStage() {
  const poolHref = contractUrl(deployment.pool);

  return (
    <div className="hs-slot">
      <div className="hs" id="hs-stage">
        <div className="hs-dots" aria-hidden />
        <div
          className="hs-app"
          role="img"
          aria-label="Example owner dashboard: a pool with 5.00 USDC locked, the monitor agent with a 0.50 USDC limit, and a payments feed with one blocked payment"
        >
          <div className="hs-bar" aria-hidden>
            <i />
            <i />
            <i />
            <b>Kovan · Owner dashboard</b>
            <Tag>Preview</Tag>
          </div>
          <div className="hs-body">
            <aside className="hs-side">
              <div className="hs-brand">
                <Mark />
                Kovan
              </div>
              <div className="hs-nav hs-on">
                <svg viewBox="0 0 16 16">
                  <circle cx="8" cy="8" r="6" />
                  <path d="M8 2v6h6" />
                </svg>
                Pool
              </div>
              <div className="hs-nav">
                <svg viewBox="0 0 16 16">
                  <circle cx="8" cy="5.5" r="2.5" />
                  <path d="M3 14c.6-2.8 2.6-4 5-4s4.4 1.2 5 4" />
                </svg>
                Agents
              </div>
              <div className="hs-nav">
                <svg viewBox="0 0 16 16">
                  <path d="M8 1.8 13 4v4c0 3-2.2 5.2-5 6.2C5.2 13.2 3 11 3 8V4z" />
                </svg>
                Covenants
              </div>
              <div className="hs-nav">
                <svg viewBox="0 0 16 16">
                  <path d="M1.5 8h3l2-5 3 10 2-5h3" />
                </svg>
                Payments
              </div>
              <div className="hs-net">
                <span className="hs-dot" />
                Stellar testnet
              </div>
            </aside>
            <div className="hs-main">
              <div className="hs-crumb">Pools / kovan-pool</div>
              <div className="hs-head">
                <h2>Pool</h2>
                <span className="hs-btn">+ New agent</span>
              </div>
              <div className="hs-kpis">
                <div className="hs-kpi">
                  <div className="l">
                    Locked <Tag live>testnet</Tag>
                  </div>
                  <div className="v">
                    <span data-n={locked}>{locked}</span>
                    <small>USDC</small>
                  </div>
                </div>
                <div className="hs-kpi">
                  <div className="l">Assigned to agents</div>
                  <div className="v">
                    <span data-n={draw}>{draw}</span>
                    <small>USDC</small>
                  </div>
                </div>
                <div className="hs-kpi">
                  <div className="l">Free</div>
                  <div className="v">
                    <span data-n={free}>{free}</span>
                    <small>USDC</small>
                  </div>
                </div>
                <div className="hs-kpi">
                  <div className="l">Invariant</div>
                  <div className="v inv">
                    Σ {draw} ≤ {locked}
                  </div>
                </div>
              </div>
              <div className="hs-alloc">
                <div className="hs-track">
                  <div className="hs-fill" data-grow style={{ width: used }} />
                </div>
                <div className="hs-legend">
                  <span>monitor {draw}</span>
                  <span className="hs-free">free {free}</span>
                </div>
              </div>
              <div className="hs-grid">
                <section className="hs-card" aria-label="Agents and covenant limits">
                  <div className="hs-card-h">
                    Agents · covenant limits <Tag>1 live</Tag>
                  </div>
                  <div className="hs-ag hs-in">
                    <div className="hs-av">M</div>
                    <div className="n">
                      monitor <Tag live>testnet</Tag>
                    </div>
                    <div className="lim">
                      {draw}
                      <small>draw limit</small>
                    </div>
                    <div className="p">Smart account · bound by covenant</div>
                    <div className="hs-bar2" title={`${draw} of ${locked} USDC pool`}>
                      <i data-grow style={{ width: used }} />
                    </div>
                  </div>
                  <div className="hs-ag hs-ex hs-in">
                    <div className="hs-av">S</div>
                    <div className="n">
                      scout <Tag>Example</Tag>
                    </div>
                    <div className="lim">
                      0.25
                      <small>draw limit</small>
                    </div>
                    <div className="p">Sub-agent of monitor · not deployed</div>
                    <div className="hs-bar2">
                      <i data-grow style={{ width: "5%" }} />
                    </div>
                  </div>
                  <div className="hs-ag hs-ex hs-in">
                    <div className="hs-av">R</div>
                    <div className="n">
                      research <Tag>Example</Tag>
                    </div>
                    <div className="lim">
                      1.00
                      <small>draw limit</small>
                    </div>
                    <div className="p">Not deployed · illustrative</div>
                    <div className="hs-bar2">
                      <i data-grow style={{ width: "20%" }} />
                    </div>
                  </div>
                </section>
                <section className="hs-card" aria-label="Payments feed (example)">
                  <div className="hs-card-h">
                    Payments <Tag>Example</Tag>
                  </div>
                  <div className="hs-pay hs-in">
                    <div className="hs-ic hs-ok">✓</div>
                    <div className="t">x402 · data-provider</div>
                    <div className="a">
                      0.05
                      <span className="hs-chip hs-c-ok">Settled</span>
                    </div>
                    <div className="s">monitor · GET /feed</div>
                  </div>
                  <div className="hs-pay hs-in">
                    <div className="hs-ic hs-ok">✓</div>
                    <div className="t">x402 · data-provider</div>
                    <div className="a">
                      0.05
                      <span className="hs-chip hs-c-ok">Settled</span>
                    </div>
                    <div className="s">monitor · GET /feed</div>
                  </div>
                  <div className="hs-pay hs-blocked hs-in" id="hs-blocked">
                    <div className="hs-ic hs-bad">✕</div>
                    <div className="t">transfer → GDX7…Q2LM</div>
                    <div className="a">
                      0.50
                      <span className="hs-chip hs-c-bad">Blocked</span>
                    </div>
                    <div className="s">payee not in covenant</div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
        <div className="hs-float hs-toast" id="hs-toast" role="img" aria-label="Example notification: payment blocked">
          <div className="hs-toast-h">
            <span className="hs-dot" />
            Payment blocked
            <em>Example</em>
          </div>
          <p>
            <b>monitor</b> tried to send <b>0.50 USDC</b> to GDX7…Q2LM. The covenant refused it, so the
            transaction failed on-chain.
          </p>
          <div className="hs-acts">
            <span>Revoke monitor</span>
            <span>Details</span>
          </div>
        </div>
        <div className="hs-float hs-cov" id="hs-cov" role="img" aria-label="Covenant card for monitor">
          <div className="hs-cov-h">
            <b>Covenant · monitor</b>
            <Tag>Example</Tag>
          </div>
          <div className="hs-cr hs-real">
            <span>Draw limit</span>
            <b>{draw}</b>
          </div>
          <div className="hs-cr">
            <span>Payee</span>
            <b>data-provider</b>
          </div>
          <div className="hs-cr">
            <span>Per transfer</span>
            <b>0.10</b>
          </div>
          <div className="hs-cr">
            <span>Expiry</span>
            <b>ledger +17,280</b>
          </div>
          <small>Set by the owner. The agent can&apos;t edit it.</small>
        </div>
      </div>
      <p className="hs-cap">
        <Tag>Example</Tag>
        <span>
          Illustrative UI based on legacy testnet evidence: {locked} USDC funded and a
          {draw} USDC agent draw limit. These are not the current pool&apos;s balances (
          <a href={poolHref} target="_blank" rel="noopener noreferrer">
            pool on Stellar Expert
          </a>
          ). The current pool was deployed empty with accounting v2 and permanent shutdown.
          The agents, payments and blocked payment shown here are examples.
        </span>
      </p>
    </div>
  );
}
