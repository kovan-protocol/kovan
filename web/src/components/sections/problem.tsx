import { SplitWords } from "@/components/motion/split-words";

function Words({ text }: { text: string }) {
  const parts = text.split(/(\s+)/);
  return parts.map((part, index) => {
    if (!part) return null;
    if (/^\s+$/.test(part)) return part;
    return (
      <span className="w" key={`${part}-${index}`}>
        {part}
      </span>
    );
  });
}

export function Problem() {
  return (
    <section className="problem" data-sec="01" data-title="Problem">
      <div className="wrap">
        <div className="eyebrow" data-reveal>
          <b>§01</b> The problem
        </div>
        <h2 style={{ marginTop: 18 }}>
          <SplitWords text="A raw key, or a card with no limit." />
        </h2>
        <p className="reveal-text" id="rtext" style={{ marginTop: 28 }}>
          <Words text="AI agents now pay for their own data, one API call at a time. To let them, you either hand over" />{" "}
          <span className="bad">
            <Words text="a wallet they can empty" />
          </span>
          <Words text=", or refill it by hand forever. A bug, a loop or" />{" "}
          <span className="bad">
            <Words text="one injected prompt" />
          </span>{" "}
          <Words text="is all it takes. Kovan gives every agent" />{" "}
          <span className="hl">
            <Words text="a budget, not a blank check." />
          </span>
        </p>
        <p className="lede" data-reveal style={{ marginTop: 18 }}>
          Agents pay for data one call at a time. Today that money sits in a wallet they can empty, or on a
          payment method that never checks a rule. A bug, a loop, or one injected prompt is enough. The two
          never meet a covenant.
        </p>
        <div className="systems" data-reveal>
          <article className="sys">
            <span className="sys-k">01 · Raw private key</span>
            <div className="sys-ui">
              <div className="keyline">S························</div>
              <p>The agent holds the secret. Anything it can sign, it can spend.</p>
            </div>
          </article>
          <div className="sys-gap" aria-hidden>
            <span>no shared rule</span>
          </div>
          <article className="sys">
            <span className="sys-k">02 · Card, no covenant</span>
            <div className="sys-ui">
              <div className="nocap">
                limit <b>∞</b>
              </div>
              <p>A way to pay that does not know the payee, the cap, or the expiry.</p>
            </div>
          </article>
        </div>
        <div className="problem-foot" data-reveal>
          <div>
            <b>Who it&apos;s for</b>Developers and teams running agents that buy data, RPC or API calls per
            request.
          </div>
          <div>
            <b>What changes</b>The rules live on-chain, in the agent&apos;s own wallet. Not in a prompt, not in
            a server.
          </div>
          <div>
            <b>What stays yours</b>Non-custodial. Funds sit in contracts you control; freeze or pull them back
            anytime.
          </div>
        </div>
      </div>
    </section>
  );
}
