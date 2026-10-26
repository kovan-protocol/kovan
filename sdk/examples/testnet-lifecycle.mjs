// Standalone consumer: uses the package export, Stellar RPC, and caller-held signers only.
// No dashboard server, keystore, dotenv, existing owner credentials, or existing pool.
import assert from "node:assert/strict";
import { setDefaultResultOrder } from "node:dns";
import { Asset, Keypair, Networks, rpc } from "@stellar/stellar-sdk";
import { KovanClient, keypairTransactionSigner } from "@kovan/sdk";
import { testnetContracts } from "./testnet-config.mjs";

setDefaultResultOrder("ipv4first");
const server = new rpc.Server("https://soroban-testnet.stellar.org");
assert.equal((await server.getNetwork()).passphrase, Networks.TESTNET, "Refusing to run outside testnet");
if (!process.argv.includes("--execute")) {
  console.log("Read-only check passed. Add --execute to create disposable testnet accounts and a NEW pool, then exercise and close it. Uses faucet XLM, NOT real USDC; no existing funds or deployment manifests are changed.");
  process.exit(0);
}

const owner = Keypair.random();
const feePayer = Keypair.random();
const recipient = Keypair.random();
const agentKey = Keypair.random();
// Use native testnet XLM's SAC to avoid requiring USDC or an issuer secret.
// `usdc` is the contract ABI's historical field name; the exact token address is what is enforced.
const client = new KovanClient({ rpcUrl: server.serverURL.toString(), networkPassphrase: Networks.TESTNET, rpc: server,
  contracts: { ...testnetContracts, usdc: Asset.native().contractId(Networks.TESTNET) } });
const ownerSigner = keypairTransactionSigner(owner);
const feeSigner = keypairTransactionSigner(feePayer);
const agentSigner = { publicKey: agentKey.rawPublicKey().toString("hex"), sign: (digest) => agentKey.sign(Buffer.from(digest)) };
for (const key of [owner, feePayer, recipient]) {
  const r = await fetch(`https://friendbot.stellar.org/?addr=${key.publicKey()}`);
  if (!r.ok) throw new Error(`Friendbot failed (${r.status}); no existing account will be used instead`);
}

const transactions = [];
async function send(label, prepared, signer = ownerSigner) {
  const result = await client.signAndSend(prepared, signer);
  console.log(JSON.stringify({ step: label, hash: result.hash, status: result.status, error: result.error }));
  if (result.status !== "SUCCESS") throw new Error(`${label}: ${result.error ?? result.status}. Inspect ${result.hash}; do not automatically repeat a deployment or payment.`);
  transactions.push({ step: label, hash: result.hash });
  return result.returnValue;
}
const poolAddress = await send("create_pool", await client.prepareCreatePool(owner.publicKey()));
assert.equal(typeof poolAddress, "string");
const pool = client.pool(poolAddress);
console.log(JSON.stringify({ pool: poolAddress, owner: owner.publicKey(), asset: "testnet XLM", token: client.contracts.usdc }));
assert.equal((await pool.getPool()).owner, owner.publicKey());
await send("fund", await pool.prepareOwner("fund", { amount: "10000000" }, owner.publicKey()));
const latest = await server.getLatestLedger();
const agent = await send("create_agent", await pool.prepareOwner("create_agent", {
  agent_pubkey: agentSigner.publicKey, draw_limit: "5000000",
  covenant: { providers: [recipient.publicKey()], provider_per_transfer_cap: "2000000", provider_total_cap: "5000000",
    recipients: [], recipient_per_transfer_cap: "0", recipient_total_cap: "0", calls: [], expiry: latest.sequence + 720 },
}, owner.publicKey()));
assert.equal(typeof agent, "string");
assert.deepEqual(await pool.listAgents(), [agent]);
const prepareAgent = (action, amount, to) => pool.prepareAgent(action, { agent, amount, to }, { source: feePayer.publicKey(), signer: agentSigner });
await send("draw", await prepareAgent("draw", "5000000"), feeSigner);
assert.equal(await pool.balance(agent), 5000000n);
await assert.rejects(() => prepareAgent("pay", "3000000", recipient.publicKey()), /PerTransferCapExceeded/);
console.log("Verified: above-cap payment refused before submission");
const before = await pool.balance(recipient.publicKey());
await send("pay", await prepareAgent("pay", "1000000", recipient.publicKey()), feeSigner);
assert.equal(await pool.balance(recipient.publicKey()), before + 1000000n);
await send("return", await prepareAgent("return", "1000000"), feeSigner);
assert.equal(await pool.balance(agent), 3000000n);
await send("revoke", await pool.prepareOwner("revoke", { agent, by: owner.publicKey() }, owner.publicKey()));
await assert.rejects(() => prepareAgent("pay", "1000000", recipient.publicKey()), /Revoked/);
console.log("Verified: revoked agent cannot pay");
await send("close_agent", await pool.prepareOwner("close", { agent, by: owner.publicKey() }, owner.publicKey()));
assert.equal(await pool.balance(agent), 0n);
assert.equal(await pool.balance(), 9000000n);
await send("withdraw", await pool.prepareOwner("withdraw", { amount: "1000000" }, owner.publicKey()));
await send("close_pool", await pool.prepareOwner("close_pool", {}, owner.publicKey()));
const final = await pool.getPool();
assert.equal(final.closed, true);
assert.equal(final.sum_limits, 0n);
assert.equal(await pool.balance(), 0n);
assert.equal((await pool.getAgent(agent)).settled_spent, 1000000n);
console.log(JSON.stringify({ result: "PASS", pool: poolAddress, agent, closed: true, agentBalance: "0", poolBalance: "0", spent: "1000000", returnedToOwner: "9000000", transactions }, null, 2));
// Secrets exist only in this process and are never printed/saved. Do not send funds
// to these disposable accounts. An interrupted run can strand worthless testnet XLM.
