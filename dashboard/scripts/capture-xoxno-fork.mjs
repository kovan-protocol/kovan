// Read-only RPC capture for the opt-in Rust XOXNO integration test. No signatures.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { Account, Address, Contract, hash, nativeToScVal, Networks, rpc, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { simulateRead } from "@kovan-protocol/sdk";

const { values } = parseArgs({ options: { out: { type: "string", default: "/tmp/kovan-xoxno-fork" } } });
const source = JSON.parse(readFileSync(new URL("../../deployments/candidates/xoxno-testnet.source.json", import.meta.url), "utf8"));
const manifest = JSON.parse(readFileSync(new URL("../../deployments/testnet.json", import.meta.url), "utf8"));
assert.equal(manifest.network, "testnet");
const server = new rpc.Server("https://soroban-testnet.stellar.org");
const ctx = { rpc: server, networkPassphrase: Networks.TESTNET };
assert.equal((await server.getNetwork()).passphrase, Networks.TESTNET);
const reference = "CBCTPTAL7E54BCDYO54GJUNM7GLEPL3UXAF6HEGWMM2MTXLFVJ7NCNSZ";
const manager = await simulateRead(ctx, reference, "get_manager");
const vec = (...v) => xdr.ScVal.scvVec(v);
const instruction = name => vec(xdr.ScVal.scvSymbol(name), new Address(source.strategy.address).toScVal(), nativeToScVal(10000000n, { type: "i128" }));
const tx = new TransactionBuilder(new Account(manager, "0"), { fee: "100", networkPassphrase: Networks.TESTNET })
  .addOperation(new Contract(reference).call("rebalance", new Address(manager).toScVal(), vec(instruction("Invest"), instruction("Unwind"))))
  .setTimeout(60).build();
const sim = await server.simulateTransaction(tx);
assert(rpc.Api.isSimulationSuccess(sim), sim.error ?? "Round trip failed");
const footprint = sim.transactionData.build().resources().footprint();
const keys = [...footprint.readOnly(), ...footprint.readWrite()];
const rows = [];
for (let i = 0; i < keys.length; i += 20) {
  const response = await server.getLedgerEntries(...keys.slice(i, i + 20));
  for (const entry of response.entries) {
    const full = new xdr.LedgerEntry({ lastModifiedLedgerSeq: entry.lastModifiedLedgerSeq, data: entry.val, ext: new xdr.LedgerEntryExt(0) });
    rows.push(`${entry.liveUntilLedgerSeq ?? 0} ${full.toXDR("base64")}`);
  }
}
mkdirSync(values.out, { recursive: true });
for (const [filename, address, expected] of [["vault.wasm", reference, source.vault_wasm_hash], ["factory.wasm", source.factory, source.factory_wasm_hash], ["strategy.wasm", source.strategy.address, source.strategy.wasm_hash]]) {
  const code = Buffer.from(await server.getContractWasmByContractId(address));
  assert.equal(hash(code).toString("hex"), expected, `${filename} changed`);
  writeFileSync(`${values.out}/${filename}`, code);
}
const capturedAt = Math.floor(Date.now() / 1000);
const poolHash = manifest.current_release.pool_wasm_hash;
const publishedPool = Buffer.from(await server.getContractWasmByHash(Buffer.from(poolHash, "hex")));
assert.equal(hash(publishedPool).toString("hex"), poolHash);
writeFileSync(`${values.out}/published-pool.wasm`, publishedPool);
const accountHash = manifest.current_release.account_wasm_hash;
const publishedAccount = Buffer.from(await server.getContractWasmByHash(Buffer.from(accountHash, "hex")));
assert.equal(hash(publishedAccount).toString("hex"), accountHash);
writeFileSync(`${values.out}/published-account.wasm`, publishedAccount);
writeFileSync(`${values.out}/ledger.txt`, `${sim.latestLedger} ${capturedAt}\n${rows.join("\n")}\n`);
console.log(JSON.stringify({ directory: values.out, ledger: sim.latestLedger, entries: rows.length, publishedPoolHash: poolHash, publishedAccountHash: accountHash, readOnly: true, runtime: "Rust replay uses the project's SDK host version; RPC capture is not an atomic ledger snapshot." }));
