import { CountUp } from "@/components/motion/count-up";
import { deployment, fundUsdc, sorobanContracts, testCount, txsByGroup } from "@/lib/testnet";

export function TestnetTicker() {
  const locked = Number(fundUsdc);
  const agents = txsByGroup("create_agent").length;
  const pools = deployment.pool ? 1 : 0;
  const contracts: number = sorobanContracts.length;
  const figures = [
    { value: pools, label: pools === 1 ? "pool" : "pools" },
    { value: Number.isFinite(locked) ? locked : 0, label: "USDC" },
    { value: agents, label: agents === 1 ? "agent" : "agents" },
    { value: contracts, label: contracts === 1 ? "contract" : "contracts" },
    { value: testCount, label: testCount === 1 ? "test" : "tests" },
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
