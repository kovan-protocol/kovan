import { Drift } from "@/components/motion/drift";
import { SplitWords } from "@/components/motion/split-words";

export function Autopilot() {
  return (
    <section className="sec" id="access" data-sec="02" data-title="Access">
      <div className="wrap">
        <div className="feature">
          <div>
            <div className="eyebrow" data-reveal>
              <b>§02</b> Access
            </div>
            <h2 style={{ marginTop: 18 }}>
              <SplitWords text="Set agent access on autopilot." />
            </h2>
            <Drift>
              <p className="lede" data-reveal>
                Limits, allowlists, and expiry, per agent. The owner sets them once. The pool writes them into a
                smart account the agent cannot edit.
              </p>
            </Drift>
            <ul className="feature-points" data-reveal>
              <li>A draw limit, carved from USDC already locked in the pool</li>
              <li>An allowlist of payees, each with a per-transfer cap and a total cap</li>
              <li>An expiry ledger. After it, spending stops and returning funds still works</li>
            </ul>
          </div>
          <div className="ui-panel" data-reveal>
            <div className="ui-bar">
              <span>create_agent</span>
              <span>Illustrative</span>
            </div>
            <div className="auto-field">
              <span>Agent</span>
              <b>monitor</b>
            </div>
            <div className="auto-field">
              <span>Draw limit</span>
              <b>
                0.50 USDC
                <i className="mini-bar" style={{ ["--w" as string]: "50%" }} />
              </b>
            </div>
            <div className="auto-field">
              <span>Allowlist</span>
              <b className="chips">
                <em>data-provider</em>
              </b>
            </div>
            <div className="auto-field">
              <span>Per-transfer cap</span>
              <b>0.10</b>
            </div>
            <div className="auto-field">
              <span>Expiry</span>
              <b>ledger +17,280</b>
            </div>
            <div className="auto-field result">
              <span>On creation</span>
              <b>Frozen · one rule, no admin</b>
            </div>
            <p className="ui-note">Example arguments. On testnet, create_agent enforces this shape in the contract.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
