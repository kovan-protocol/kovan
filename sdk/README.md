# @kovan-protocol/sdk

Standalone TypeScript/ESM SDK for Kovan's pool → agent → spending → recovery lifecycle on Stellar. Node.js 22+ and modern browser bundlers. No dashboard backend, React, wallet-extension dependency, environment loading, private-key storage, or automatic funding.

**Testnet prototype, not audited.** New pool/account code and the native-mandate policy are published on testnet. Existing v2 pools retain their original bindings. Yield is experimental, provider-specific v3 code, not an enabled live integration.

Native mandate v1 provides owner-approved exact/budget grants, signed purchase bindings, replay protection and payment receipts. The configuration below creates matching new pools/agents. See [the mandate guide and live rehearsal](../docs/MANDATES.md) and [direct-payment example](examples/mandate-payment.mjs). This is not AP2 credential conformance. Build this source for the latest deployment helpers; npm v0.1.0 is a separate, earlier snapshot.

## Install the earlier npm snapshot

```bash
npm install @kovan-protocol/sdk@0.1.0 @stellar/stellar-sdk@16.4.1
```

Stellar's SDK is a peer dependency, shared with the application. For the **0.2.0 fixes and current-release examples below**, build this source using the next section; 0.2.0 has not been published to npm. The package includes compiled JavaScript, TypeScript declarations, source files for debugging, documentation and standalone examples.

## Build from source

From `sdk/`:

```bash
npm ci
npm run build
npm test
npm pack
```

In another application:

```bash
npm install /absolute/path/to/kovan-protocol-sdk-0.2.0.tgz @stellar/stellar-sdk@16.4.1
```

`npm pack` builds a local tarball; it does not publish to npm.

## Configure explicitly

Source/package version **0.2.0** verifies immutable pool bindings (policy,
verifier, settlement token and account WASM), not just pool bytecode, before
preparing owner or agent operations. An unavailable `get_config` fails closed.
Use `releaseContracts` with a reviewed deployment manifest: it explicitly marks
pre-mandate releases with `legacyBindings: true` because those contracts cannot
report their constructor bindings. Never enable that exception for arbitrary
untrusted pools. `previous_releases` preserves access to older immutable native
mandate releases after a rollout. This source update does not publish to npm.

`transactionStatus(client, hash)` reconciles a saved submission without signing
or sending anything. Persist the signed envelope and hash before broadcast;
retry the identical envelope, not a newly prepared payment, while status is unknown.

The SDK does not load deployment files or select an existing pool for you. Supply reviewed public IDs from your application's configuration:

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
  maxFeeStroops: "10000000", // total transaction fee ceiling: 1 XLM
});
```

These testnet artifacts can change after resets or reviewed rollouts. For a reviewed repository manifest, `releaseContracts(currentRelease(manifest))` configures new creation; `releaseContracts(await resolvePoolRelease(client, manifest, poolAddress))` selects bindings for an existing pool after checking its code and, for new pools, immutable constructor configuration. Create a separate client with those bindings. Merely adding old hashes to `legacyPoolWasmHashes` cannot reconcile different policies/account code. There are no mainnet presets or cross-chain operations.

## Owner wallet: prepare → review → sign → submit

Supply a `TransactionSigner`. For example, a Freighter adapter:

```ts
import { signTransaction } from "@stellar/freighter-api";
import type { TransactionSigner } from "@kovan-protocol/sdk";

const signOwner: TransactionSigner = async (xdr, { networkPassphrase, address }) => {
  const response = await signTransaction(xdr, { networkPassphrase, address });
  if (response.error) throw new Error(response.error.message);
  return response.signedTxXdr;
};

const prepared = await kovan.prepareCreatePool(ownerAddress);
// Show the action and configured contracts to the owner before signing.
const created = await kovan.signAndSend(prepared, signOwner);
if (created.status !== "SUCCESS") throw new Error(`${created.status}: ${created.hash}`);
const pool = kovan.pool(created.returnValue as string);
const funded = await kovan.signAndSend(
  await pool.prepareOwner("fund", { amount: "10000000" }, ownerAddress), signOwner,
);
if (funded.status !== "SUCCESS") throw new Error(`${funded.status}: ${funded.hash}`);
```

Amounts are **integer base-unit strings**, never floating point. For 7-decimal USDC, `"10000000"` means 1 USDC. The historical `usdc` ABI field identifies an exact token contract; the display name is not a trust check. Pool creation deploys the configured, already uploaded code and never migrates/funds an existing pool. Use the confirmed return value, not the simulation preview, as the deployed address.

## Create an agent

Keep its private key in your runtime/signer; only its raw 32-byte Ed25519 public key in hex goes into creation:

```ts
const latest = await kovan.rpc.getLatestLedger();
const preparedAgent = await pool.prepareOwner("create_agent", {
  agent_pubkey: agentPublicKeyHex, draw_limit: "5000000",
  covenant: {
    providers: [providerAddress], provider_per_transfer_cap: "2000000", provider_total_cap: "5000000",
    recipients: [], recipient_per_transfer_cap: "0", recipient_total_cap: "0",
    calls: [], expiry: latest.sequence + 720,
  },
}, ownerAddress);
const createdAgent = await kovan.signAndSend(preparedAgent, signOwner);
if (createdAgent.status !== "SUCCESS") throw new Error(`${createdAgent.status}: ${createdAgent.hash}`);
const agentAddress = createdAgent.returnValue as string;
```

Creation reserves an allocation; **draw before paying**. It does not transfer funds into the agent. Signer, allowlists and policy are immutable; numeric limits and expiry can be amended within the contract's rules. New agents also need an owner-approved mandate:

```ts
// Persist these nonzero 32-byte hex commitments and the purchase ID in your app.
const approved = await kovan.signAndSend(await pool.prepareOwner("create_mandate", {
  agent: agentAddress,
  params: { id: mandateId, intent_hash: intentHash, expiry: latest.sequence + 720,
    scope: { kind: "exact", asset: kovan.contracts.usdc, payee: providerAddress,
      amount: "1000000", reference: purchaseReference } },
}, ownerAddress), signOwner);
if (approved.status !== "SUCCESS") throw new Error(`${approved.status}: ${approved.hash}`);
```

## Agent signer and separate fee payer

```ts
import type { DigestSigner } from "@kovan-protocol/sdk";

const agentSigner: DigestSigner = {
  publicKey: agentPublicKeyHex,
  sign: async (digest, context) => {
    // Inspect context.entryXdr: invocation, nonce and ledger expiry.
    // Ed25519-sign these exact bytes; do not hash again or use signMessage.
    return yourSigner.signEd25519(digest);
  },
};
const draw = await pool.prepareAgent("draw", { agent: agentAddress, amount: "5000000" }, {
  source: feePayerAddress, signer: agentSigner,
});
const drawn = await kovan.signAndSend(draw, signFeePayer);
if (drawn.status !== "SUCCESS") throw new Error(`${drawn.status}: ${drawn.hash}`);
const payment = await pool.prepareAgent("pay", {
  agent: agentAddress, to: providerAddress, amount: "1000000",
  payment: { mandateId, paymentId, reference: purchaseReference },
}, { source: feePayerAddress, signer: agentSigner });
const paid = await kovan.signAndSend(payment, signFeePayer);
if (paid.status !== "SUCCESS") throw new Error(`${paid.status}: ${paid.hash}`);
```

The agent signs contract authorization; the fee payer separately signs the envelope and pays XLM fees. `prepareAgent` **invokes the agent signer**, re-simulates with enforcement, and returns an unsigned envelope; it never submits. It checks pool code, asset, agent membership, signer/verifier/policy and the exact expected authorization invocation. Legacy and AddressV2 credentials are supported; delegated/source-account credentials are refused for agent signing.

For a caller-held Node `Keypair`, use `keypairTransactionSigner(keypair)` for envelopes, and `{ publicKey: keypair.rawPublicKey().toString("hex"), sign: digest => keypair.sign(Buffer.from(digest)) }` for agent authorization. The SDK never loads/saves these keys. Concurrent transactions sharing a fee payer require application-level sequence coordination.

## API scope

| Capability | API |
| --- | --- |
| New pool | `kovan.prepareCreatePool(owner, optionalSalt)` |
| Read | `pool.getPool()`, `listAgents()`, `getAgent(agent)`, `balance(address?)` |
| Mandates / receipts | `pool.getMandate(agent, id)`, `pool.getPayment(agent, paymentId)` |
| Owner actions | `pool.prepareOwner(fn, args, owner)` |
| Agent actions | `pool.prepareAgent("draw" / "pay" / "return", request, { source, signer })` |
| Sign and send | `kovan.signAndSend(prepared, signer)` |

Owner methods: `fund`, `withdraw`, `create_agent`, `create_mandate`, `revoke_mandate`, `amend`, `revoke`, `return_funds`, `close`, `close_pool`, `resolve_dispute`. Mandate revocation takes `{agent, id}`. Agent revoke/close take `{agent, by: owner}`; owner returns also take `amount`; final pool closure takes `{}`. Close children before parents, then close the pool. V2+ agent closure recovers remaining cash and settles consumed funding. Pool closure returns remaining pool cash to its original owner permanently. A plain transfer is not `return_funds`. No automated recovery or hierarchical-delegation wrapper is included in this SDK version.

Pure builders and generic helpers (`buildOwnerOp`, `buildAgentOp`, `buildCreatePoolOp`, `prepareOperation`, `simulateRead`, `signPrepared`, `submitSigned`) are also exported. **They do not perform all high-level target/code/membership checks.** Prefer `KovanClient`; custom composition must preserve those checks. Reads trust the selected RPC and are not cryptographic ownership proofs.

## Safety and retries

- `KovanError` identifies a `guard`, `simulate` or `submit` stage, with contract error names. No automatic restoration, deployment, investment or fee-payer funding.
- Wallet rejection stops before submission. The returned signed transaction body must match the prepared hash. Preview success is not final success.
- Submission status is `SUCCESS`, `FAILED`, `ERROR` or `NOT_FOUND`. **`NOT_FOUND` means unknown/pending, not safe to pay again.** Query `kovan.rpc.getTransaction(hash)` and reconcile. The SDK sends once and never blindly rebuilds/resubmits.
- Ledger expiry, fee limits, stale sequences, current policy and liquidity can invalidate a preview. Each transaction is atomic; the multi-transaction lifecycle is not.
- Legacy pool closure is capability-gated; accounting version alone does not imply `close_pool` exists.
- Persist payment IDs (`paymentIdForRequest(persistedRequestId)`) and references before signing. Reconcile `getPayment` and the transaction after unknown outcomes; never retry a purchase with a new ID. Exact grants permit one payment even with a different ID. Receipts prove authorized transfers, not delivery.

## Experimental yields

`@kovan-protocol/sdk/experimental` exposes `buildYieldOp`, `yieldFns` and types for the DeFindex-specific v3 implementation. Stable `prepareOwner` does **not** accept yield methods. These builders do not activate or validate providers: callers must enforce v3 deployment, reviewed vault code/allowlist, exact asset, liquidity, quote minima and deadline. The dashboard retains those gates. V3 code is published but no vault is enabled. Generic adapters and further supported yields remain separate work.

## Verification and independent example

```bash
npm test                    # deterministic tests, no chain writes
npm run test:browser        # production bundle + Chromium, no chain writes
npm run test:package        # install packed package outside the repo + check TypeScript
node examples/testnet-lifecycle.mjs             # read-only network check
node examples/testnet-lifecycle.mjs --execute   # explicit isolated testnet lifecycle
```

The example uses disposable in-memory accounts, Friendbot XLM and a **new pool**. No USDC, existing keys, dashboard endpoints or repository deployment files. It checks cap refusal, revocation, payment, returns, recovery and shutdown. Only public addresses/hashes are printed. Secrets are not saved; interruption can strand worthless testnet XLM. Do not fund these disposable accounts or use this example to recover existing pools.

The repository's `docs/SDK.md` records an executed run. Mainnet, real-USDC funding/trustlines, wallet extensions, remote HSMs, x402 facilitators and live yield liquidity are not claimed as covered by that run.

## Native yield and external positions

The experimental DeFindex integration supports a Kovan-managed lending vault and
locking existing single-USDC vault shares. Import provisioning helpers from
`@kovan-protocol/sdk/experimental`: `prepareNativeVault` atomically creates and
seeds an immutable vault; `prepareActivateNativeVault` invests its seed into the
reviewed strategy; `inspectYieldVault` checks the actual allocation.
`nativeVaultFromReceipt` recovers the committed vault from a successful factory
transaction and verifies the constructor, live roles, fees and pinned code. Transactions
are unsigned and testnet-only. The manager supplies a reviewed
`NativeYieldSource`; its underlying token must match the pool exactly.

`buildYieldOp` builds owner-signed pool investment, share-locking, redemption and
recovery operations. Shares remain in pool custody and can continue earning until
redeemed for agent draws. One vault per pool. Yield is variable, investment is
opt-in. The selected XOXNO testnet strategy matches Kovan's exact USDC; the
dashboard's `/yield/setup` page prepares creation and activation for Freighter.
It is not enabled for pool funding until an invested vault is registered.
See [yield setup and verification](../docs/YIELD.md) before activation.

## License

MIT. See [LICENSE](./LICENSE).
