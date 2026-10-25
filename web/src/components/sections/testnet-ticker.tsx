import { CountUp } from "@/components/motion/count-up";
import { fundUsdc, sorobanContracts, testCount, txsByGroup, verifiedTransactions } from "@/lib/testnet";

export function TestnetTicker() {
  const locked = Number(fundUsdc);
  const agents = txsByGroup("create_agent").length;
  const figures = [
    { value: Number.isFinite(locked) ? locked : 0, label: "USDC locked" },
    { value: agents, label: agents === 1 ? "agent account" : "agent accounts" },
    { value: sorobanContracts.length, label: "Soroban contracts" },
    { value: verifiedTransactions.length, label: "verified transactions" },
    { value: testCount, label: "tests in the repo" },
  ];

  return (
    <div className="tticker" aria-label="Stellar testnet figures, not customer volume">
      <span className="k">Stellar testnet · on-chain figures, not customer volume</span>
      {figures.map((figure) => (
        <span className="stat" key={figure.label}>
          <CountUp value={figure.value} />
          {figure.label}
        </span>
      ))}
    </div>
  );
}
