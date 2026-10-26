import deploymentJson from "@/data/testnet.json";
import evidenceJson from "@/data/evidence.json";
import { BLOCKED_PAYMENT_HASH } from "@/config/site";

export type Deployment = {
  network: string;
  verifier: string;
  policy: string;
  account_wasm_hash: string;
  pool: string;
  usdc: string;
  owner: string;
  deployed_at: string;
  pool_deploy_tx: string;
  pool_wasm_hash: string;
};

export type TxRecord = {
  id: string;
  hash: string;
  group: "deploy" | "fund" | "create_agent" | "draw" | "x402" | "direct_payment" | "return_funds" | "blocked";
  label: string;
  historical?: boolean;
};

export const deployment = deploymentJson as Deployment;

const evidence = evidenceJson as {
  historicalPool: string;
  firstAgent: string;
  testCount: number;
  fundUsdc: string;
  drawLimit: string;
  transactions: TxRecord[];
};

export const EXPERT = "https://stellar.expert/explorer/testnet";

export function contractUrl(id: string) {
  return `${EXPERT}/contract/${id}`;
}

export function txUrl(hash: string) {
  return `${EXPERT}/tx/${hash}`;
}

export function shortId(id: string, head = 6, tail = 4) {
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

export function shortHash(hash: string) {
  return `${hash.slice(0, 6)}…`;
}

export function formatDeployed(iso: string) {
  const d = new Date(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

// Historical demonstration evidence, not balances/agents of the current pool.
export const historicalPool = evidence.historicalPool;
export const firstAgent = evidence.firstAgent;
export const testCount = evidence.testCount;
export const fundUsdc = evidence.fundUsdc;
export const drawLimit = evidence.drawLimit;

/** Current pool/shared contracts and a clearly labeled historical agent. */
export const sorobanContracts = [
  { name: "kovan-pool", id: deployment.pool },
  { name: "covenant policy", id: deployment.policy },
  { name: "ed25519 verifier", id: deployment.verifier },
  { name: "historical agent account (legacy pool)", id: firstAgent },
] as const;

export const verifiedTransactions: TxRecord[] = [
  { id: "deploy-pool", hash: deployment.pool_deploy_tx, group: "deploy", label: "pool v2 + permanent shutdown" },
  ...evidence.transactions,
  ...(BLOCKED_PAYMENT_HASH
    ? [
        {
          id: "blocked-payment",
          hash: BLOCKED_PAYMENT_HASH,
          group: "blocked" as const,
          label: "blocked payment",
        },
      ]
    : []),
];

export const deployedAtLabel = formatDeployed(deployment.deployed_at);

export function txsByGroup(group: TxRecord["group"]) {
  return verifiedTransactions.filter((tx) => tx.group === group);
}
