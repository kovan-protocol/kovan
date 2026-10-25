import { shortHash, txUrl, txsByGroup } from "@/lib/testnet";

const agents = [
  { name: "monitor", meta: "parent · example", used: "0.05", limit: "0.50", width: "10%", chips: ["data-provider"] },
  { name: "scout", meta: "child · example", used: "0.02", limit: "0.25", width: "8%", chips: ["data-provider"] },
  { name: "signals", meta: "agent · example", used: "0.08", limit: "0.40", width: "20%", chips: ["data-provider", "rpc"] },
];

export function OwnerDashboard() {
  const fund = txsByGroup("fund")[0];
  const created = txsByGroup("create_agent")[0];

  return (
    <div className="dash" aria-label="Illustrative owner dashboard">
      <div className="dash-h">
        <b>Owner dashboard</b>
        <span>Illustrative preview</span>
      </div>
      <div className="dash-sub">
        <span>Agents</span>
        <span>Example names · limits in testnet USDC</span>
      </div>
      <ul className="dash-list">
        {agents.map((agent) => (
          <li className="dash-row" key={agent.name}>
            <div className="dash-id">
              <strong>{agent.name}</strong>
              <em>{agent.meta}</em>
            </div>
            <div className="dash-bar" aria-hidden>
              <i style={{ ["--w" as string]: agent.width }} />
            </div>
            <div className="dash-lim">
              {agent.used}
              <span> / {agent.limit}</span>
            </div>
            <div className="dash-chips">
              {agent.chips.map((chip) => (
                <span key={chip}>{chip}</span>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="dash-sub">
        <span>Activity</span>
        <span>Recorded rows link to Stellar Expert</span>
      </div>
      <div className="feed">
        {fund ? (
          <a className="feed-row" href={txUrl(fund.hash)} target="_blank" rel="noopener noreferrer">
            <span className="tag ok">Recorded</span>
            <span className="feed-main">Fund · 5 testnet USDC</span>
            <span className="feed-hash">{shortHash(fund.hash)} ↗</span>
          </a>
        ) : null}
        {created ? (
          <a className="feed-row" href={txUrl(created.hash)} target="_blank" rel="noopener noreferrer">
            <span className="tag ok">Recorded</span>
            <span className="feed-main">create_agent · 0.50 limit</span>
            <span className="feed-hash">{shortHash(created.hash)} ↗</span>
          </a>
        ) : null}
        <div className="feed-row blocked">
          <span className="tag deny">Example</span>
          <span className="feed-main">Blocked: over cap</span>
          <span className="feed-hash">0.40 &gt; 0.05</span>
        </div>
      </div>
      <p className="dash-note">
        Product preview. Agent names and the blocked row are examples, not extra transactions. Fund and
        create_agent are the real testnet records.
      </p>
    </div>
  );
}
