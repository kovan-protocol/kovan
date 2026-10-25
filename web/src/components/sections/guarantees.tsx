import { Drift } from "@/components/motion/drift";
import { SplitWords } from "@/components/motion/split-words";

export function Guarantees() {
  return (
    <section className="sec" id="guarantees" data-sec="06" data-title="Guarantees">
      <div className="wrap">
        <div className="sec-head">
          <div>
            <div className="eyebrow" data-reveal>
              <b>§06</b> Guarantees
            </div>
            <h2 style={{ marginTop: 18 }}>
              <SplitWords text="Enforced by contracts," />
              <br />
              <SplitWords text="not by good behavior." />
            </h2>
          </div>
          <Drift>
            <p className="lede" data-reveal>
              Each guarantee is covered by the open-source test suite and enforced by the contracts deployed on
              Stellar testnet.
            </p>
          </Drift>
        </div>
        <div className="bento">
          <article className="card spot w2" data-reveal>
            <span className="gnum">G · POOL INVARIANT</span>
            <div className="eq">
              Σ <span>draw_limit</span>(agents) ≤ <span>locked</span>(pool)
            </div>
            <h3>The pool can&apos;t promise money it doesn&apos;t hold.</h3>
            <p>Creating or amending an agent fails if total limits would exceed the locked USDC.</p>
          </article>
          <article className="card spot" data-reveal>
            <span className="gnum">G · DRAW</span>
            <div className="vis" style={{ marginTop: 14 }}>
              draw(0.60) → <span style={{ color: "var(--deny)" }}>✕ &gt; 0.50</span>
            </div>
            <h3>Draw stays under the limit.</h3>
            <p>Only the agent&apos;s own share ever leaves the pool.</p>
          </article>
          <article className="card spot" data-reveal>
            <span className="gnum">G · PAYEES</span>
            <div className="vis" style={{ marginTop: 14 }}>
              to ∈ allowlist ∧ amt ≤ cap
            </div>
            <h3>Allowlisted payees only.</h3>
            <p>Per-transfer cap and total cap, per payee.</p>
          </article>
          <article className="card spot" data-reveal>
            <span className="gnum">G · CALLS</span>
            <div className="vis" style={{ marginTop: 14 }}>
              contract.fn ∈ allowed
            </div>
            <h3>Allowlisted calls only.</h3>
            <p>Contract, function and argument caps are checked too.</p>
          </article>
          <article className="card spot" data-reveal>
            <span className="gnum">G · EXPIRY</span>
            <div className="vis" style={{ marginTop: 14 }}>
              ledger &lt; expiry
            </div>
            <h3>Authority ends on time.</h3>
            <p>After expiry, spending stops. Returning funds still works.</p>
          </article>
          <article className="card spot w2" data-reveal>
            <span className="gnum">G · SELF-BOUND</span>
            <div className="eq" style={{ fontSize: "clamp(17px,1.8vw,22px)" }}>
              rules = {"{"} agent key + <span>covenant policy</span> {"}"}
              <br />
              admin rule = <span style={{ color: "var(--deny)" }}>∅</span>
            </div>
            <h3>The agent can&apos;t rewrite its own rules.</h3>
            <p>
              Its wallet has a single rule and no admin rule. The policy rejects calls from the wallet to itself.
            </p>
          </article>
          <article className="card spot w2" data-reveal>
            <span className="gnum">G · DELEGATION</span>
            <div className="eq" style={{ fontSize: "clamp(17px,1.8vw,22px)" }}>
              child ⊆ parent <span style={{ color: "var(--muted)" }}>in every dimension</span>
            </div>
            <h3>Children are narrower. Revoke cascades.</h3>
            <p>
              A child can&apos;t exceed its parent on any limit; revoking the parent freezes the child; closing
              the child returns its limit to the parent.
            </p>
          </article>
          <article className="card spot w2" data-reveal>
            <span className="gnum">G · RECOVERY</span>
            <div className="eq" style={{ fontSize: "clamp(17px,1.8vw,22px)" }}>
              return_funds() <span style={{ color: "var(--ok)" }}>always works</span>
            </div>
            <h3>The owner gets funds back without the agent&apos;s key.</h3>
            <p>
              At creation, the agent wallet grants the pool a USDC allowance, so unspent funds can be pulled back
              after a revoke or expiry.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}
