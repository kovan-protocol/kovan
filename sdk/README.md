# @kovan/sdk

Standalone TypeScript/ESM SDK for Kovan's pool → agent → spending → recovery lifecycle on Stellar. Node.js 22+ and modern browser bundlers. No dashboard backend, React, wallet-extension dependency, environment loading, private-key storage, or automatic funding.

**Testnet prototype, not audited. Local package, not published to npm.** Cash-only v2 is the verified deployment. Yield is experimental, provider-specific v3 code, not an enabled live integration.

## Build and install

From `sdk/`:

```bash
npm ci
npm run build
npm test
npm pack
```

In another application:

```bash
npm install /absolute/path/to/kovan-sdk-0.1.0.tgz @stellar/stellar-sdk@16.4.1
```

The tarball includes compiled JavaScript, TypeScript declarations, documentation and standalone examples. `npm pack` does not publish. Stellar's SDK is a peer dependency, shared with the application.

## Configure explicitly

The SDK does not load deployment files or select an existing pool for you. Supply reviewed public IDs from your application's configuration:

```ts
import { KovanClient } from "@kovan/sdk";
import { Networks } from "@stellar/stellar-sdk";

const kovan = new KovanClient({
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
  contracts: {
    usdc: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    policy: "CDEQUCR4OHOQHWPIP5RONRR46G7DTJMFZKNKRIQJCLYACDDZGWKAISD2",
    verifier: "CAEU4VYRTV4ZDHFGCRYQNPN6URDOYLP4TS4OMRAJX5RD7AMLWBTYW6G4",
    poolWasmHash: "cc1aadcf38ffeee5d15717e04f48f325024b7a47e57ca1548a8e9d49b731b464",
    accountWasmHash: "25dabe1afc7a1ef93a0bc7b40ffa784e0a70463db91c4b1812fc155768ead2d7",
  },
  maxFeeStroops: "10000000", // total transaction fee ceiling: 1 XLM
});
```

These testnet artifacts can change after resets or reviewed rollouts. `legacyPoolWasmHashes` explicitly permits older code for existing-pool recovery, never new deployment. There are no mainnet presets or cross-chain operations. Custom configuration is not a production-readiness claim.

## Owner wallet: prepare → review → sign → submit

Supply a `TransactionSigner`. For example, a Freighter adapter:

```ts
import { signTransaction } from "@stellar/freighter-api";
import type { TransactionSigner } from "@kovan/sdk";

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

Creation reserves an allocation; **draw before paying**. It does not transfer funds into the agent. Signer, allowlists and policy are immutable; numeric limits and expiry can be amended within the contract's rules.

## Agent signer and separate fee payer

```ts
import type { DigestSigner } from "@kovan/sdk";

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
| Owner actions | `pool.prepareOwner(fn, args, owner)` |
| Agent actions | `pool.prepareAgent("draw" / "pay" / "return", request, { source, signer })` |
| Sign and send | `kovan.signAndSend(prepared, signer)` |

Owner methods: `fund`, `withdraw`, `create_agent`, `amend`, `revoke`, `return_funds`, `close`, `close_pool`, `resolve_dispute`. Revoke/close take `{agent, by: owner}`; owner returns also take `amount`; final pool closure takes `{}`. Close children before parents, then close the pool. V2 agent closure recovers remaining cash and settles consumed funding. Pool closure returns remaining pool cash to its original owner permanently. A plain transfer is not `return_funds`. No automated recovery or hierarchical-delegation wrapper is included in this SDK version.

Pure builders and generic helpers (`buildOwnerOp`, `buildAgentOp`, `buildCreatePoolOp`, `prepareOperation`, `simulateRead`, `signPrepared`, `submitSigned`) are also exported. **They do not perform all high-level target/code/membership checks.** Prefer `KovanClient`; custom composition must preserve those checks. Reads trust the selected RPC and are not cryptographic ownership proofs.

## Safety and retries

- `KovanError` identifies a `guard`, `simulate` or `submit` stage, with contract error names. No automatic restoration, deployment, investment or fee-payer funding.
- Wallet rejection stops before submission. The returned signed transaction body must match the prepared hash. Preview success is not final success.
- Submission status is `SUCCESS`, `FAILED`, `ERROR` or `NOT_FOUND`. **`NOT_FOUND` means unknown/pending, not safe to pay again.** Query `kovan.rpc.getTransaction(hash)` and reconcile. The SDK sends once and never blindly rebuilds/resubmits.
- Ledger expiry, fee limits, stale sequences, current policy and liquidity can invalidate a preview. Each transaction is atomic; the multi-transaction lifecycle is not.
- Legacy pool closure is capability-gated; accounting version alone does not imply `close_pool` exists.

## Experimental yields

`@kovan/sdk/experimental` exposes `buildYieldOp`, `yieldFns` and types for the local DeFindex-specific v3 implementation. Stable `prepareOwner` does **not** accept yield methods. These builders do not activate or validate providers: callers must enforce v3 deployment, reviewed vault code/allowlist, exact asset, liquidity, quote minima and deadline. The dashboard retains those gates. No vault is enabled and v3 was not deployed by this work. Generic adapters and further supported yields remain separate work.

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
