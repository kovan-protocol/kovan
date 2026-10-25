function Words({ text, tone }: { text: string; tone?: "bad" | "hl" }) {
  const words = text.split(/\s+/).filter(Boolean);
  return words.map((word, index) => (
    <span key={`${word}-${index}`} className={tone ? `w ${tone}` : "w"}>
      {index > 0 ? " " : null}
      {word}
    </span>
  ));
}

export function Problem() {
  return (
    <section className="problem" data-sec="01" data-title="Problem">
      <div className="wrap">
        <div className="eyebrow" data-reveal>
          <b>§01</b> The problem
        </div>
        <p className="reveal-text" id="rtext" style={{ marginTop: 28 }}>
          <Words text="AI agents now pay for their own data, one API call at a time. To let them, you either hand over" />{" "}
          <Words text="a wallet they can empty" tone="bad" />
          <Words text=", or refill it by hand forever. A bug, a loop or" />{" "}
          <Words text="one injected prompt" tone="bad" />{" "}
          <Words text="is all it takes. Kovan gives every agent" />{" "}
          <Words text="a budget, not a blank check." tone="hl" />
        </p>
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
