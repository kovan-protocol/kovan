// End-to-end through the built kovan.mjs and its local wallet page, with a
// throwaway testnet account standing in for Freighter. Submits a real testnet
// transaction (a USDC trustline on that throwaway account).
// Run with: LIVE=1 npx vitest run tests/cli.live.test.ts
import { spawn } from "node:child_process";
import { describe as suite, expect, it } from "vitest";
import { BASE_FEE, Keypair, Operation, rpc, TransactionBuilder } from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, RPC_URL, usdcAsset } from "../src/chain";

const live = process.env.LIVE === "1";
const TOOL = new URL("../../skills/kovan/scripts/kovan.mjs", import.meta.url).pathname;

suite.skipIf(!live)("kovan.mjs owner approval (live testnet)", () => {
  it("accepts only the prepared transaction, submits it, and prints the result", async () => {
    const owner = Keypair.random();
    const fb = await fetch(`https://friendbot.stellar.org/?addr=${owner.publicKey()}`);
    expect(fb.ok).toBe(true);

    const port = 8793;
    const child = spawn("node", [TOOL, "owner", "trustline", "--owner", owner.publicKey(), "--no-open", "--port", String(port), "--timeout-min", "2"]);
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    const exited = new Promise<number>((res) => child.on("exit", (code) => res(code ?? -1)));

    let url = "";
    for (let i = 0; i < 300 && !url; i++) {
      url = /http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]+/.exec(stderr)?.[0] ?? "";
      if (!url) await new Promise((r) => setTimeout(r, 100));
    }
    expect(url).not.toBe("");

    const html = await (await fetch(url)).text();
    const job = JSON.parse(/window\.__KOVAN_JOB__=(.*?);window\.__KOVAN_DONE__/.exec(html)![1]);
    expect(job).toMatchObject({ mode: "sign", owner: owner.publicKey() });

    const post = (signedXdr: string, origin = `http://127.0.0.1:${port}`) =>
      fetch(`${url}/done`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ signedXdr }) });

    // A different transaction from the same account is refused, and the session keeps waiting.
    const account = await new rpc.Server(RPC_URL).getAccount(owner.publicKey());
    const other = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(Operation.changeTrust({ asset: usdcAsset, limit: "1" })).setTimeout(120).build();
    other.sign(owner);
    const refused = await post(other.toXDR());
    expect(refused.status).toBe(422);
    expect((await refused.json()).error).toMatch(/not the one that was prepared/);

    // Wrong origin is refused.
    expect((await post("x", "https://evil.example")).status).toBe(403);

    // The prepared one, signed, goes through.
    const tx = TransactionBuilder.fromXDR(job.xdr, NETWORK_PASSPHRASE);
    tx.sign(owner);
    const ok = await post(tx.toXDR());
    expect(ok.status).toBe(200);

    expect(await exited).toBe(0);
    const result = JSON.parse(stdout.trim());
    expect(result).toMatchObject({ v: 1, fn: "trustline", status: "SUCCESS", tx: job.hash });
  }, 120_000);
});
