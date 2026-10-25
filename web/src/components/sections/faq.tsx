import { SplitWords } from "@/components/motion/split-words";

const items = [
  {
    q: "Isn't this just a spending limit?",
    a: "A spending limit caps one wallet. Kovan adds a shared pool that can never assign more than it holds, parent-to-child delegation where a child can only be narrower, and owner recovery without the agent's key. The per-payment rules are one part of a covenant.",
  },
  {
    q: "What stops the agent from changing its own rules?",
    a: "Its smart account has exactly one rule: the agent's key plus the covenant policy. There's no admin rule, and the policy rejects calls from the wallet to itself. Only the owner can amend limits, through the pool.",
    code: ["amend"],
  },
  {
    q: "Who holds the money?",
    a: "Kovan is non-custodial. USDC sits in the pool contract and in each agent's own smart account, never with us. The owner can revoke an agent and pull unspent funds back with return_funds.",
    code: ["return_funds"],
  },
  {
    q: "How does x402 fit in?",
    a: "Providers charge per call over x402. The payment is a USDC transfer from the agent's smart account, so the covenant checks it like any other transfer. Settlement from a contract account follows the x402 Stellar spec and facilitator code, and we're validating it end to end on testnet.",
  },
  {
    q: "Is it live? Is it audited?",
    a: "Kovan is in public beta on Stellar testnet, where USDC has no value. It hasn't been audited yet; a security audit comes before any mainnet launch.",
  },
  {
    q: "What's next?",
    a: "Agent reputation, multiple pools per owner, and mainnet, with a security audit before any mainnet launch. The owner dashboard and the agent runtime are next. See the roadmap in the repo.",
  },
];

export function Faq() {
  return (
    <section className="sec" id="faq" data-sec="09" data-title="FAQ" style={{ paddingTop: 40 }}>
      <div className="wrap faq">
        <div>
          <div className="eyebrow" data-reveal>
            <b>§09</b> FAQ
          </div>
          <h2 style={{ marginTop: 18 }}>
            <SplitWords text="Straight answers." />
          </h2>
        </div>
        <div data-reveal>
          {items.map((item, index) => (
            <details key={item.q} open={index === 0}>
              <summary>
                {item.q}
                <span className="pm" />
              </summary>
              <div className="ans">{renderAnswer(item.a, item.code)}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function renderAnswer(text: string, code: string[] = []) {
  if (code.length === 0) return text;
  const pattern = new RegExp(`(${code.join("|")})`, "g");
  return text.split(pattern).map((part, index) =>
    code.includes(part) ? <code key={`${part}-${index}`}>{part}</code> : part,
  );
}
