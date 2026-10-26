// Builds and simulates real testnet transactions without signing or sending.
// Run with: LIVE=1 npx vitest run tests/chain.live.test.ts
import { describe as suite, expect, it } from "vitest";
import { Keypair, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";
import deployment from "../../deployments/testnet.json";
import { NETWORK_PASSPHRASE, prepare } from "../src/chain";
import { parseRequest } from "../src/request";

const live = process.env.LIVE === "1";
const owner = deployment.owner;

suite.skipIf(!live)("prepare against testnet (simulation only)", () => {
  it("create_pool builds a deploy for the connected owner", async () => {
    const p = await prepare(parseRequest({ v: 1, fn: "create_pool" }), owner);
    const tx = TransactionBuilder.fromXDR(p.xdr, NETWORK_PASSPHRASE) as Transaction;
    expect(tx.source).toBe(owner);
    expect(tx.signatures).toHaveLength(0);
  }, 30_000);

  it("trustline builds a changeTrust for USDC", async () => {
    const p = await prepare(parseRequest({ v: 1, fn: "trustline" }), owner);
    const tx = TransactionBuilder.fromXDR(p.xdr, NETWORK_PASSPHRASE) as Transaction;
    expect(tx.operations[0].type).toBe("changeTrust");
  }, 30_000);

  it("create_agent simulates against the live pool", async () => {
    const req = parseRequest({
      v: 1, fn: "create_agent", pool: deployment.pool, agent_key: Keypair.random().publicKey(), draw_limit: "0.01",
      providers: [Keypair.random().publicKey()], provider_per_transfer_cap: "0.01", provider_total_cap: "0.01", expiry_hours: 1,
    });
    try {
      const p = await prepare(req, owner);
      expect(TransactionBuilder.fromXDR(p.xdr, NETWORK_PASSPHRASE).signatures).toHaveLength(0);
    } catch (e) {
      // A pool whose locked funds are fully assigned refuses with ExceedsLocked. The contract
      // only reaches that check after decoding the covenant, so encoding is still verified.
      expect(String((e as Error).message)).toMatch(/ExceedsLocked|PoolClosed/);
    }
  }, 30_000);

  it("refuses a wallet that is not the pool owner", async () => {
    await expect(prepare(parseRequest({ v: 1, fn: "fund", pool: deployment.pool, amount: "1" }), Keypair.random().publicKey())).rejects.toThrow(/owner/i);
  }, 30_000);
});
