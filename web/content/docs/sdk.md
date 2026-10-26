---
title: SDK
description: "@kovan-protocol/sdk: create pools and agents, and sign agent payments from TypeScript."
---

# SDK: `@kovan-protocol/sdk`

A standalone TypeScript/ESM package for the pool → agent → spending → recovery lifecycle. Node.js 22+ and modern browser bundlers. No backend, wallet dependency, key storage or automatic funding: you supply configuration and signers.

> Available on [npm](https://www.npmjs.com/package/@kovan-protocol/sdk). Testnet prototype, not audited.

## Install

```bash
npm install @kovan-protocol/sdk@0.1.0 @stellar/stellar-sdk@16.4.1
```

`@stellar/stellar-sdk` is a peer dependency, shared with your app.

To develop against the latest repository code, build a local tarball with `npm ci && npm pack` from `sdk/`. The repository may contain changes newer than the published release.

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
    policy: "CAQAHBSHKEUQCXUMFCD65GNRTKDNE5A7HOHA7XVOKVKTV4H4O63OWJYB",
    verifier: "CAEU4VYRTV4ZDHFGCRYQNPN6URDOYLP4TS4OMRAJX5RD7AMLWBTYW6G4",
    poolWasmHash: "74c5789668a69ca5236e2b099d26509bd6ea445c048aa06970dcc9a088e6eccf",
    accountWasmHash: "0f618da0dabad752b3229e80dade5eec7bd7b49a52cbc75a1916b585402c8a7d",
  },
  maxFeeStroops: "10000000", // fee ceiling: 1 XLM
});
```

This configuration uses the new native-mandate release. Build the latest source for deployment helpers: `releaseContracts(currentRelease(manifest))` selects new creation; `releaseContracts(await resolvePoolRelease(kovan, manifest, address))` selects an existing pool's verified generation for a separate client. Old code hashes alone do not reconcile different policies or account code. Do not point an old pool at the new policy.

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
| Owner actions | `pool.prepareOwner(fn, args, owner)`: `fund`, `withdraw`, `create_agent`, `amend`, `revoke`, `return_funds`, `close`, `close_pool`, `resolve_dispute` |
| Agent actions | `pool.prepareAgent("draw" \| "pay" \| "return", request, { source, signer })` |
| Sign and send | `kovan.signAndSend(prepared, signer)` |
| Signers | `keypairTransactionSigner(keypair)`, or your own `TransactionSigner` / `DigestSigner` |

`revoke` and `close` take `{ agent, by: owner }`; owner `return_funds` also takes `amount`; `close_pool` takes `{}`. Close children before parents, then close the pool.

New owner methods: `create_mandate` (above) and `revoke_mandate` with `{agent, id: mandateId}`. `paymentIdForRequest(persistedRequestId)` derives a stable payment ID. Keep IDs and exact inputs across retries; reconcile receipts and unknown transaction outcomes before paying again. Grants intersect with the covenant, never expand it. Intent hashes and receipts are not proof of useful work or AP2 credential conformance.

Lower-level builders (`buildOwnerOp`, `buildAgentOp`, `buildCreatePoolOp`, `prepareOperation`, `simulateRead`, `signPrepared`, `submitSigned`) are exported too. They **don't** run all the safety checks above; prefer `KovanClient`.

## Errors and retries

- `KovanError` has a stage (`guard`, `simulate` or `submit`) and names contract errors, e.g. `#3904 PayeeNotAllowed`. See [error codes](/docs/contracts#error-codes).
- `signAndSend` returns `SUCCESS`, `FAILED`, `ERROR` or `NOT_FOUND`. **`NOT_FOUND` means pending or unknown, not safe to retry.** Check `kovan.rpc.getTransaction(hash)` first. The SDK sends once and never resubmits blindly.
- A signed transaction must match the prepared hash. A preview's success isn't final success: sequence numbers, ledger expiry, fees and the current policy can change before submission.

## Test it

```bash
npm test                                         # deterministic, no chain writes
node examples/testnet-lifecycle.mjs --execute    # full lifecycle on a NEW testnet pool with throwaway accounts
```
