---
title: SDK
description: "@kovan-protocol/sdk: create pools and agents, and sign agent payments from TypeScript."
---

# SDK: `@kovan-protocol/sdk`

A standalone TypeScript/ESM package for the pool → agent → spending → recovery lifecycle. Node.js 22+ and modern browser bundlers. No backend, wallet dependency, key storage or automatic funding: you supply configuration and signers.

> Testnet prototype, not audited. The fixes and current-release examples below use source version **0.2.0**, not yet published to npm. The earlier 0.1.0 package remains on [npm](https://www.npmjs.com/package/@kovan-protocol/sdk).

## Install

Build a local tarball with `npm ci && npm pack` from the repository's `sdk/`, then install it into your application:

```bash
npm install /absolute/path/to/kovan-protocol-sdk-0.2.0.tgz @stellar/stellar-sdk@16.4.1
```

`@stellar/stellar-sdk` is a peer dependency, shared with your app. Packing builds the package but does not publish it.

## Configure

The SDK doesn't load deployment files or pick a pool for you. Pass reviewed public IDs, e.g. from [`deployments/testnet.json`](https://github.com/kovan-protocol/kovan/blob/main/deployments/testnet.json):

```ts
import { KovanClient } from "@kovan-protocol/sdk";
import { Networks } from "@stellar/stellar-sdk";

const kovan = new KovanClient({
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
  contracts: {
    usdc: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    policy: "CA2NXNPDGZ674K467K3K2IXV342BTPJ7YJRLVZPT4LCSJS5GHLVSMEN7",
    verifier: "CAEU4VYRTV4ZDHFGCRYQNPN6URDOYLP4TS4OMRAJX5RD7AMLWBTYW6G4",
    poolWasmHash: "857f3a27fda736f842e5b4c548022a05197137650cc49f984dde141287175dc1",
    accountWasmHash: "909b66bf67a425308f832ceadc4aa49ef5862ce256533cec3b8a9e4fdab6ccf4",
  },
  maxFeeStroops: "10000000", // fee ceiling: 1 XLM
  // rpc: yourRpcServer,     // optional: your own (or a mocked) rpc.Server instead of one built from rpcUrl
});
```

This configuration uses the new native-mandate release. Build the latest source for deployment helpers: `releaseContracts(currentRelease(manifest))` selects new creation; `releaseContracts(await resolvePoolRelease(kovan, manifest, address))` selects an existing pool's verified generation for a separate client. Old code hashes alone do not reconcile different policies or account code. Do not point an old pool at the new policy.

Version 0.2.0 checks the immutable policy, verifier, token, account WASM and mandate capability before preparing pool operations. A failed binding read refuses preparation. Only explicitly reviewed pre-mandate releases use `legacyBindings: true`; it must never be an automatic fallback for an RPC error. Retained `previous_releases` keep existing pools resolvable after a rollout.

For uncertain submissions, persist the hash and signed envelope before sending and use `transactionStatus(kovan, hash)` to reconcile without another signature. If resubmission is necessary, use the identical envelope, not a freshly prepared action.

**Amounts are integer base-unit strings.** USDC has 7 decimals: `"10000000"` is 1 USDC.

## Owner: prepare → review → sign → submit

Supply a `TransactionSigner`, for example a Freighter adapter:

```ts
import { signTransaction } from "@stellar/freighter-api";
import type { TransactionSigner } from "@kovan-protocol/sdk";

const signOwner: TransactionSigner = async (xdr, { networkPassphrase, address }) => {
  const r = await signTransaction(xdr, { networkPassphrase, address });
  if (r.error) throw new Error(r.error.message);
  return r.signedTxXdr;
};

const created = await kovan.signAndSend(await kovan.prepareCreatePool(owner), signOwner);
if (created.status !== "SUCCESS") throw new Error(`${created.status}: ${created.hash}`);
const pool = kovan.pool(created.returnValue as string);

await kovan.signAndSend(await pool.prepareOwner("fund", { amount: "1000000000" }, owner), signOwner); // 100 USDC
```

Use the confirmed `returnValue` as the pool address, not the simulation preview.

## Create an agent

Only the agent's raw 32-byte ed25519 public key (hex) goes into creation. Keep its secret in your runtime.

```ts
const latest = await kovan.rpc.getLatestLedger();
const r = await kovan.signAndSend(await pool.prepareOwner("create_agent", {
  agent_pubkey: agentPublicKeyHex,
  draw_limit: "400000000",                                  // 40 USDC
  covenant: {
    providers: [provider], provider_per_transfer_cap: "5000000", provider_total_cap: "400000000",
    recipients: [], recipient_per_transfer_cap: "0", recipient_total_cap: "0",
    calls: [], expiry: latest.sequence + 48 * 720,          // ~48 h at ~5 s per ledger
  },
}, owner), signOwner);
const agent = r.returnValue as string;
```

Check `r.status === "SUCCESS"` before using its return value. Creating an agent reserves its draw limit; it doesn't move funds. **Draw before paying.** The signer, allowlists and policy are fixed; numeric limits and expiry can be amended. New agents additionally require an owner-approved grant:

```ts
// Application-persisted, nonzero 32-byte hex commitments; never regenerate on retry.
const approval = await kovan.signAndSend(await pool.prepareOwner("create_mandate", {
  agent, params: { id: mandateId, intent_hash: intentHash, expiry: latest.sequence + 720,
    scope: { kind: "exact", asset: kovan.contracts.usdc, payee: provider,
      amount: "5000000", reference: purchaseReference } },
}, owner), signOwner);
if (approval.status !== "SUCCESS") throw new Error(`${approval.status}: ${approval.hash}`);
```

## Agent: sign with the agent key, pay fees with any account

```ts
import { Keypair } from "@stellar/stellar-sdk";
import { keypairTransactionSigner, type DigestSigner } from "@kovan-protocol/sdk";

const key = Keypair.fromSecret(process.env.KOVAN_AGENT_SECRET!);
const agentSigner: DigestSigner = {
  publicKey: key.rawPublicKey().toString("hex"),
  sign: (digest) => key.sign(Buffer.from(digest)),        // sign these exact bytes
};

const draw = await pool.prepareAgent("draw", { agent, amount: "50000000" }, { source: key.publicKey(), signer: agentSigner });
await kovan.signAndSend(draw, keypairTransactionSigner(key));

const pay = await pool.prepareAgent("pay", {
  agent, to: provider, amount: "5000000",
  payment: { mandateId, paymentId, reference: purchaseReference },
}, { source: key.publicKey(), signer: agentSigner });
await kovan.signAndSend(pay, keypairTransactionSigner(key));
```

The agent signs the contract authorization; the `source` account signs the envelope and pays the XLM fee. Here one key does both. `prepareAgent` checks the pool code, asset, agent membership, signer, verifier and policy, signs the authorization, and re-simulates with the covenant enforced. A refused payment throws there, before anything is sent.

## API

| Capability | API |
|---|---|
| New pool | `kovan.prepareCreatePool(owner, salt?)` |
| Read | `pool.getPool()`, `pool.listAgents()`, `pool.getAgent(agent)`, `pool.balance(address?)` |
| Grants / receipts | `pool.getMandate(agent, id)`, `pool.getPayment(agent, paymentId)` |
| Owner actions | `pool.prepareOwner(fn, args, owner)`: `fund`, `withdraw`, `create_agent`, `create_mandate`, `revoke_mandate`, `amend`, `revoke`, `return_funds`, `close`, `close_pool`, `resolve_dispute` |
| Agent actions | `pool.prepareAgent("draw" \| "pay" \| "return", request, { source, signer, timeoutSeconds? })` (1–300 s, default 120) |
| Sign and send | `kovan.signAndSend(prepared, signer)` |
| Signers | `keypairTransactionSigner(keypair)`, or your own `TransactionSigner` / `DigestSigner` |

`revoke` and `close` take `{ agent, by: owner }`; owner `return_funds` also takes `amount`; `close_pool` takes `{}`. Close children before parents, then close the pool.

`create_mandate` is shown above; `revoke_mandate` takes `{agent, id: mandateId}`. The pool's `delegate`, `settle` and `dispute` functions have no SDK wrapper yet. `paymentIdForRequest(persistedRequestId)` derives a stable payment ID. Keep IDs and exact inputs across retries; reconcile receipts and unknown transaction outcomes before paying again. Grants intersect with the covenant, never expand it. Intent hashes and receipts are not proof of useful work or AP2 credential conformance.

Lower-level builders (`buildOwnerOp`, `buildAgentOp`, `buildCreatePoolOp`, `prepareOperation`, `simulateRead`, `signPrepared`, `submitSigned`) are exported too. They **don't** run all the safety checks above; prefer `KovanClient`. `submitSigned` accepts `{ attempts?, intervalMs? }` and polls 30 × 1.5 s (about 45 s) before returning `NOT_FOUND`. Deployment helpers (`currentRelease`, `releaseContracts`, `resolvePoolRelease`), `transactionStatus`, error tables (`decodeContractError`, `explainError`), ScVal helpers and the `KovanError` class are exported as well; the full list is in the [package README](https://github.com/kovan-protocol/kovan/blob/main/sdk/README.md). `signAgentEntry` and `agentPubkeyHex` take a raw secret and are for tests only. `@kovan-protocol/sdk/experimental` holds the DeFindex yield builders, which stable `prepareOwner` does not accept; no vault is enabled.

## Errors and retries

- `KovanError` is thrown from the `guard` or `simulate` stage and names contract errors, e.g. `#3904 PayeeNotAllowed`. Submission never throws; it returns a result with `status` and `error`. See [error codes](/docs/contracts#error-codes).
- `signAndSend` returns `SUCCESS`, `FAILED`, `ERROR` or `NOT_FOUND`. **`NOT_FOUND` means pending or unknown, not safe to retry.** Check `kovan.rpc.getTransaction(hash)` first. The SDK sends once and never resubmits blindly.
- A signed transaction must match the prepared hash. A preview's success isn't final success: sequence numbers, ledger expiry, fees and the current policy can change before submission.

## Test it

```bash
npm test                                         # deterministic, no chain writes
node examples/testnet-lifecycle.mjs --execute    # full lifecycle on a NEW testnet pool with throwaway accounts
```
