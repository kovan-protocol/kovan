// The whole loop through the built kovan.mjs on testnet, with throwaway
// accounts: owner gets USDC, creates and funds a pool, creates an agent; the
// agent draws, pays a listed provider, and is refused paying anyone else.
// Run with: LIVE=1 npx vitest run tests/loop.live.test.ts
import { spawn } from "node:child_process";
import { describe as suite, expect, it } from "vitest";
import { Asset, BASE_FEE, Keypair, Operation, rpc, TransactionBuilder } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, RPC_URL, usdcAsset } from "../src/chain";

const live = process.env.LIVE === "1";
const TOOL = new URL("../../skills/kovan/scripts/kovan.mjs", import.meta.url).pathname;
const server = new rpc.Server(RPC_URL);
let port = 8800;

type Run = { code: number; json: Record<string, unknown>; stderr: string };

/** Runs kovan.mjs. When it serves a wallet page, signs the prepared transaction with `wallet`, as Freighter would. */
async function tool(args: string[], wallet?: Keypair, env: Record<string, string> = {}): Promise<Run> {
  const p = port++;
  const child = spawn("node", [TOOL, ...args, "--no-open", "--port", String(p), "--timeout-min", "2"], { env: { ...process.env, ...env } });
  let stdout = "", stderr = "";
  child.stdout.on("data", (c) => { stdout += c; });
  child.stderr.on("data", (c) => { stderr += c; });
  const exited = new Promise<number>((res) => child.on("exit", (code) => res(code ?? -1)));
  if (wallet) {
    let url = "";
    while (!url && child.exitCode === null) {
      url = /http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]+/.exec(stderr)?.[0] ?? "";
      if (!url) await new Promise((r) => setTimeout(r, 100));
    }
    if (url) {
      const html = await (await fetch(url)).text();
      const job = JSON.parse(/window\.__KOVAN_JOB__=(.*?);window\.__KOVAN_DONE__/.exec(html)![1]);
      const tx = TransactionBuilder.fromXDR(job.xdr, NETWORK_PASSPHRASE);
      tx.sign(wallet);
      await fetch(`${url}/done`, { method: "POST", headers: { "content-type": "application/json", origin: `http://127.0.0.1:${p}` }, body: JSON.stringify({ signedXdr: tx.toXDR() }) });
    }
  }
  const code = await exited;
  return { code, json: JSON.parse(stdout.trim().split("\n").pop() || "{}"), stderr };
}

async function classic(source: Keypair, ...ops: ReturnType<typeof Operation.changeTrust>[]) {
  const account = await server.getAccount(source.publicKey());
  const b = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE });
  for (const op of ops) b.addOperation(op);
  const tx = b.setTimeout(120).build();
  tx.sign(source);
  const sent = await server.sendTransaction(tx);
  for (let i = 0; i < 30; i++) {
    const r = await server.getTransaction(sent.hash);
    if (r.status === "SUCCESS") return;
    if (r.status === "FAILED") throw new Error(`classic tx failed: ${sent.hash}`);
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error("classic tx not confirmed");
}

suite.skipIf(!live)("kovan.mjs full loop (live testnet)", () => {
  it("owner sets up, agent draws and pays inside its covenant", async () => {
    const owner = Keypair.random(), agentKey = Keypair.random(), provider = Keypair.random(), stranger = Keypair.random();
    for (const k of [owner, agentKey, provider, stranger]) expect((await fetch(`https://friendbot.stellar.org/?addr=${k.publicKey()}`)).ok).toBe(true);

    // USDC: trustlines, then 2 USDC for the owner from the testnet DEX.
    for (const k of [provider, stranger]) await classic(k, Operation.changeTrust({ asset: usdcAsset }));
    expect((await tool(["owner", "trustline", "--owner", owner.publicKey()], owner)).json.status).toBe("SUCCESS");
    await classic(owner, Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax: "500", destination: owner.publicKey(), destAsset: usdcAsset, destAmount: "2", path: [] }));

    const pool = await tool(["owner", "create_pool", "--owner", owner.publicKey()], owner);
    expect(pool.json).toMatchObject({ fn: "create_pool", status: "SUCCESS" });
    const POOL = pool.json.pool as string;
    expect(POOL).toMatch(/^C[A-Z2-7]{55}$/);

    expect((await tool(["owner", "fund", "--owner", owner.publicKey(), "--pool", POOL, "--amount", "1"], owner)).json.status).toBe("SUCCESS");

    const created = await tool(["owner", "create_agent", "--owner", owner.publicKey(), "--pool", POOL, "--agent-key", agentKey.publicKey(),
      "--draw-limit", "0.5", "--providers", provider.publicKey(), "--provider-per-transfer-cap", "0.1", "--provider-total-cap", "0.3", "--expiry-hours", "1"], owner);
    expect(created.json).toMatchObject({ fn: "create_agent", status: "SUCCESS" });
    const AGENT = created.json.agent as string;
    expect(AGENT).toMatch(/^C[A-Z2-7]{55}$/);

    const env = { KOVAN_AGENT_SECRET: agentKey.secret() };
    const base = ["--pool", POOL, "--agent", AGENT];
    expect((await tool(["agent", "draw", ...base, "--amount", "0.3"], undefined, env)).json.status).toBe("SUCCESS");
    expect((await tool(["agent", "pay", ...base, "--amount", "0.1", "--to", provider.publicKey()], undefined, env)).json.status).toBe("SUCCESS");

    const refused = await tool(["agent", "pay", ...base, "--amount", "0.1", "--to", stranger.publicKey()], undefined, env);
    expect(refused.code).toBe(1);
    expect(String(refused.json.error)).toMatch(/PayeeNotAllowed|#\d+/);

    const overCap = await tool(["agent", "pay", ...base, "--amount", "0.2", "--to", provider.publicKey()], undefined, env);
    expect(overCap.code).toBe(1);

    const status = await tool(["status", "--pool", POOL, "--agent", AGENT]);
    expect(status.json).toMatchObject({ agents: [AGENT] });
    console.log(JSON.stringify({ POOL, AGENT, refused: refused.json.error, overCap: overCap.json.error }));
  }, 300_000);
});
