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
  current_release?: {
    policy: string;
    published_at: string;
    transactions: {
      policy_deploy: { tx: string };
      pool_upload: { tx: string };
      account_upload: { tx: string };
    };
  };
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

/** Published release plus explicitly labeled retained historical instances. */
export const sorobanContracts = [
  { key: "pool", name: "retained default pool (legacy)", id: deployment.pool },
  ...(deployment.current_release ? [{ key: "mandate-policy", name: "covenant policy (new pools)", id: deployment.current_release.policy }] : []),
  { key: "legacy-policy", name: "covenant policy (legacy pools)", id: deployment.policy },
  { key: "verifier", name: "ed25519 verifier", id: deployment.verifier },
  { key: "agent", name: "historical agent account (legacy pool)", id: firstAgent },
] as const;

export const verifiedTransactions: TxRecord[] = [
  ...(deployment.current_release ? [
    { id: "deploy-mandate-policy", hash: deployment.current_release.transactions.policy_deploy.tx, group: "deploy" as const, label: "native-mandate policy" },
    { id: "upload-mandate-pool", hash: deployment.current_release.transactions.pool_upload.tx, group: "deploy" as const, label: "mandate-capable pool code" },
    { id: "upload-mandate-account", hash: deployment.current_release.transactions.account_upload.tx, group: "deploy" as const, label: "mandate-enforcing account code" },
  ] : []),
  { id: "deploy-pool", hash: deployment.pool_deploy_tx, group: "deploy", label: "historical default: pool v2 + shutdown", historical: true },
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

export const deployedAtLabel = formatDeployed(deployment.current_release?.published_at ?? deployment.deployed_at);

export function txsByGroup(group: TxRecord["group"]) {
  return verifiedTransactions.filter((tx) => tx.group === group);
}
