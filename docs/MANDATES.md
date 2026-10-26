# On-chain payment mandates — native Kovan v1

Kovan now has owner-approved payment mandates in its existing contracts. This is a **native Kovan authorization profile**, not an implementation of AP2 signed credentials, MCP, A2A, escrow, or delivery verification. x402 remains the HTTP payment transport; the smart account enforces the grant even when the dashboard and SDK are bypassed.

## Deployment status

Published on **Stellar testnet, 2026-10-26 at 10:22 UTC**. The current policy is `CA2NXNPDGZ674K467K3K2IXV342BTPJ7YJRLVZPT4LCSJS5GHLVSMEN7`, pool WASM is `857f3a27fda736f842e5b4c548022a05197137650cc49f984dde141287175dc1`, and account WASM is `909b66bf67a425308f832ceadc4aa49ef5862ce256533cec3b8a9e4fdab6ccf4`. The unchanged Ed25519 verifier is reused. Mandate version 1 is independent of accounting version 3; no yield vault is enabled. Recovery version 1 adds pool-only allowance renewal and bounded delegation (depth 4, 17 lifetime agents per root family). The original native-mandate release remains in `previous_releases`; it does not gain these changes.

`deployments/testnet.json.current_release` selects these artifacts for **New pool**, the signer and CLI. Top-level bindings still describe the historical displayed default. Existing pools and agents remain immutable, with their original code and policy. Consumers resolve each selected pool's trusted code before choosing its bindings; new pools also expose immutable bindings through `get_config()`. The account checks the covenant's pool/asset and the policy's mandate version at construction. The pool only creates grants for mandate-capable member agents. An explicitly requested mandate never falls back to an unbound payment.

Create an owner-controlled pool using **New pool** or the updated signer, approve in Freighter, then fund it and create agents and grants. Migration is a separate owner-approved operation: recover/close old agents (children first), withdraw or close the old pool, and fund the new one. No existing balances were moved. A funded rehearsal through the actual x402 facilitator is still required before claiming live facilitator compatibility for this release; the direct-payment rehearsal below does not establish that.

To publish future reviewed releases, use `DEPLOYER=<dedicated-testnet-identity> bash scripts/deploy.sh`; `--check` is read-only. It never uses the existing pool owner's key. After a separately wallet-approved creation, `node dashboard/scripts/activate-pool.mjs --pool C... --tx HEX` can adopt a verified empty pool belonging to the original default owner. It preserves every old pool's bindings. Rebuild signer/CLI/website snapshots after changing the manifest. This does not publish a website or npm package.

## Contract responsibilities

| Contract | Responsibility |
| --- | --- |
| `KovanPool` | Original owner authorizes `create_mandate` and `revoke_mandate`; exposes grant and payment reads. |
| `CovenantPolicyContract` | Stores immutable grants, checks deadlines and budgets, records consumed payment IDs and receipts. Existing covenant accounting still applies. |
| `KovanAgentAccount` | Requires a signed mandate envelope for outgoing transfers of the configured settlement token, except returns to its pool. Checks the exact transfer and atomically consumes the grant. |
| `Ed25519VerifierContract` | Verifies the existing agent signature over the newly bound authorization digest. No ownership claim or new verifier contract. |

Pool recovery and lifecycle operations remain available without payment mandates. Generic allowlisted contract calls remain governed by the existing covenant; v1 does not assign task/mandate semantics to arbitrary methods or every asset.

## Grants and payments

Every grant has a nonzero 32-byte ID, an intent hash, an exclusive expiry ledger, and one scope:

- **Exact:** one asset, recipient, amount and purchase-reference hash; usable once, even if the caller chooses another payment ID.
- **Budget:** 1–16 allowed payees, a per-payment cap and a total cap. Multiple purchases are allowed, each with its own signed reference and payment ID.

Both scopes intersect with the existing covenant: a grant cannot authorize a forbidden recipient, bypass expiry/revocation, or reset shared spending counters. A grant does not reserve funds. Several grants can exceed the available balance or covenant budget in aggregate; whichever limit is reached first stops payments. Agents still need to draw funds or receive initial funding before paying. Children need their own original-owner-approved grants; mandates are not inherited delegation credentials.

Grant IDs cannot be replaced; revocation is terminal. Every new payment needs a nonzero payment ID, a nonzero reference hash and an exclusive deadline no later than the grant expiry. Payment IDs are unique **per agent across all mandates**, not just within one grant. Budget grants deliberately allow separate IDs to represent separate purchases; the chain cannot detect two IDs referring to the same real-world purchase.

The intent hash commits to a document, not its meaning. Store the full intent and evidence off-chain. Hashes do not inherently hide guessable private content; salt sensitive commitments appropriately.

## Signed envelope and atomic execution

The custom account's authorization signature contains:

```text
{ version: 1, auth: <existing OZ AuthPayload>,
  payment: { mandate_id, payment_id, reference, valid_until } }

bound_payload = SHA256(XDR((Symbol("kovan_mandate_payment_v1"), host_payload, payment)))
digest = OZ AuthDigestPreimage(account, bound_payload, [0]).digest()
```

The host payload binds the network, account where applicable, authorization nonce/expiry and exact invocation. The additional envelope binds the mandate and purchase metadata. Both legacy Address and AddressV2 authorization credentials are covered by tests.

The operation remains exactly `asset.transfer(agent, recipient, amount)`. There is no payment-wrapper operation or extra authorized sub-invocation, preserving the Stellar x402 `exact` transaction shape. The account accepts only one transfer context for a mandate payment, verifies its existing signature/covenant rule, and calls the policy itself to consume the grant. Direct authorization of policy consumption is forbidden so callers cannot manufacture receipts without a transfer.

The transfer, covenant counters, mandate counters, consumed ID, receipt and event commit together. If the token transfer fails, they roll back together. Grants and consumed IDs use persistent storage with TTL extension; archival is not permission to reuse an ID. Operators must maintain/restore contract storage as required by Soroban. Do not prune receipt keys to implement expiry.

A receipt includes the payment ID, mandate ID, asset, recipient, amount, reference, host authorization hash and execution ledger. It proves an authorized transfer, **not** delivery, task correctness, ownership of an HTTP server or entitlement to a refund.

## SDK usage

Use `@kovan-protocol/sdk` from this build against a matching deployment. Amounts are integer base units and hashes are 64-character hex strings. Persist IDs and exact inputs before signing.

```ts
const pool = client.pool(poolAddress);
const approval = await pool.prepareOwner("create_mandate", {
  agent,
  params: {
    id: mandateId, intent_hash: intentHash, expiry: expiryLedger,
    scope: { kind: "exact", asset, payee, amount, reference: quoteId },
  },
}, ownerAddress);
// Present the owner transaction for approval, submit, and confirm success.
await client.signAndSend(approval, ownerSigner);

const payment = await pool.prepareAgent("pay", {
  agent, to: payee, amount,
  payment: { mandateId, paymentId, reference: quoteId },
}, { source: feePayerAddress, signer: agentSigner });
// Submit only after confirmed owner approval. For x402, hand the authorized
// transaction to the existing sponsored-payment flow, without signing its envelope.
const receipt = await pool.getPayment(agent, paymentId);
const grant = await pool.getMandate(agent, mandateId);
```

The complete direct-payment example in [mandate-payment.mjs](../sdk/examples/mandate-payment.mjs) checks submission outcomes. `paymentIdForRequest(requestId)` derives a stable chain ID from a persisted application request ID. The SDK caps authorization lifetime by the payment, mandate and covenant deadlines. Owner revocation uses `prepareOwner("revoke_mandate", { agent, id: mandateId }, ownerAddress)`.

Legacy deployments can still use the old payment API without mandate metadata. New accounts refuse that authorization on-chain. Passing mandate metadata to an unsupported deployment fails before signing; it is never silently discarded.

## Dashboard and x402

Each agent has an owner-signed mandate panel. For an exact x402 approval: read the endpoint terms, copy the quote ID as the exact purchase reference, create the grant with the matching asset/recipient/amount, then enter its mandate ID in payment controls and read the terms again before paying. Budget grants permit reviewed purchases within their approved limits. Direct payments accept a purchase-reference hash.

`POST /api/x402` retains its existing reviewed-quote/request-ID flow and accepts `mandateId`. The integration binds `quoteId` as the purchase reference and `paymentIdForRequest(requestId)` as the consumed ID. The chain compares the signed hash; it does not fetch the URL or verify HTTP contents. Changing a mandate or URL invalidates the reviewed quote in the UI.

Public read-only reconciliation is available at:

```text
GET /api/mandates?pool=C...&agent=C...&id=<hex>&paymentId=<hex>
```

At least one ID is required. These reads use the configured RPC, not independent light-client proofs. A present receipt confirms consumption; an absent receipt while authorization is live does **not** prove a payment cannot still settle. Keep the same IDs for retries, and reconcile unknown outcomes before issuing another purchase. The UI does not restore payment IDs after a reload; persist them externally and retain the local request journal. Exact mandates additionally prevent reuse under a fresh payment ID.

## Verification

Run `make test` for contract builds and Rust tests, `make test-js` for SDK/dashboard tests, and `npm --prefix dashboard run lint`. After a dashboard production build, `node dashboard/scripts/x402-smoke.mjs` exercises the UI with intercepted payment APIs and no chain writes.

Coverage includes real Ed25519/AddressV2 authorizations, owner approval, exact and budget scopes, tampered metadata, unbound transfer rejection, revocation, deadlines, cross-mandate replay, shared covenant accounting, durable receipts, forged-receipt rejection and rollback on insufficient balance. TypeScript tests share a fixed digest vector with Rust. Live facilitator acceptance and existing-fund migration are separate steps.

Original native-mandate release verification on 2026-10-26: **548 tests passed** — 152 Rust (one optional external DeFindex fixture ignored), 79 SDK, 268 dashboard and 49 signer (six opt-in network tests excluded). Builds and dashboard lint passed. Browser checks cover native mandate signing, stable x402 retry IDs, recovery and responsive layouts; package checks validate exports and declarations outside the repository. Four additional read-only signer tests passed against live testnet.

Recovery-v1 working-tree verification: **605 tests passed** — 157 Rust, 107 SDK, 280 dashboard and 61 signer. Three external contract integrations and six signer network tests are excluded. Added regressions cover expired-allowance recovery, bounded family revocation with real pool/policy WASM, constructor bindings, persisted transaction resumption and generated-key backup/import.

### Recovery-v1 live rehearsal

The updated standalone SDK completed `testnet-lifecycle.mjs --execute` against the 10:22 release using fresh in-memory keys and faucet **testnet XLM**. No existing owner credentials, pools or USDC were used. Pool `CC4CBCZ6MDBWBHXDG2CJV6QDRBLRE6GM3V5EWKY27E7X7UKXXRRL76XM` and agent `CD5YMLG7TC6KFOSGWVB2XHAFIAGY5AV6PUVQPDTGLD4YFPRDA7L5DVW3` were created with the current pool/account hashes and policy.

It funded 1 XLM, drew 0.5, paid 0.1 under an owner-approved mandate, returned 0.9 in total, and closed the agent and pool with zero balances. Unbound, above-cap, repeated payment-ID, revoked-grant and revoked-agent payments were refused. Expired allowance renewal is covered by the ledger-advanced contract regression, not by waiting for expiry on the live network.

| Step | Confirmed transaction |
| --- | --- |
| Create pool | [0b2ec427…](https://stellar.expert/explorer/testnet/tx/0b2ec4275bf52e2a79071efdf8154775774b4fe5a3a221da92a95356ea324438) |
| Fund | [d8240183…](https://stellar.expert/explorer/testnet/tx/d8240183bbeb6c63c45b1adf2e1d69504590eac69822ac116e74f2fb1907728f) |
| Create agent | [56d39153…](https://stellar.expert/explorer/testnet/tx/56d39153d2608aac34069e5fb551617e82e67e7f55ada4a346ebd120c0322e25) |
| Draw | [4a3c281c…](https://stellar.expert/explorer/testnet/tx/4a3c281cc464c3982e7602ee88ffaf0e4b7730b4611058332fd14b6321886c8b) |
| Approve mandate | [4add12b5…](https://stellar.expert/explorer/testnet/tx/4add12b53ac396f9f5a7ab3d1712ccdbaf6e47f1bb0d474dff6b3d2bba0bd9b1) |
| Pay | [b7b056d6…](https://stellar.expert/explorer/testnet/tx/b7b056d6dcce9a543c07e8201502085e6bac05689cc30d819e3c1bf60df4c02a) |
| Revoke mandate | [7279b109…](https://stellar.expert/explorer/testnet/tx/7279b1099e8c8b43ee27411c76625964d733c96f2fa888cf16c100c41fde9fc1) |
| Return funds | [72a63afe…](https://stellar.expert/explorer/testnet/tx/72a63afea82c29b859b3f604011fb7f68dadfe49d68b357753565aaeb83d4990) |
| Revoke agent | [1f1a9a0b…](https://stellar.expert/explorer/testnet/tx/1f1a9a0baab3b1c73f5449831e0a7dc58fea5b62cc7874ed319c78e197661d01) |
| Close agent and recover balance | [6335bc2b…](https://stellar.expert/explorer/testnet/tx/6335bc2bfd9a8d5ede84bfba2e5b94a95553cce502dc87b82c64d80681553ef9) |
| Withdraw | [2c212822…](https://stellar.expert/explorer/testnet/tx/2c2128222b10ff421061e20809faf3ad8817eec23f8a12bcfa6bde9b09fe0364) |
| Close pool | [1941f4e8…](https://stellar.expert/explorer/testnet/tx/1941f4e8d3a6adf231972e7352f46f7564e44f76148827da0b37062057971c55) |

### Original native-payment rehearsal (09:03 release)

`sdk/examples/testnet-lifecycle.mjs --execute` completed using disposable in-memory keys and faucet **testnet XLM**, not USDC or existing user funds. Pool `CA3UJGOTLFZG46SL565IDQTYFAPD7ZU6P7C63MTBSUOY7FDWCHFPGXWP` and agent `CDDW3HYSKEJGTB7T62MUMCFMMBSDWMFZMFJE3BETIMCC3NMUAVQAWCEU` used the original native-mandate release, not recovery v1. It funded 1 XLM, drew 0.5, paid 0.1 under an owner grant, recovered 0.9, and closed both with zero balances. Unbound, over-cap, repeated-ID and revoked-grant payments were refused.

| Evidence | Confirmed transaction |
| --- | --- |
| Deploy policy | [d992200…](https://stellar.expert/explorer/testnet/tx/d99220004f7dfe630e271f50231a161b7a4c33c718e6cbb1374eea07a4f0692a) |
| Approve mandate | [e1b677a…](https://stellar.expert/explorer/testnet/tx/e1b677a6af65462bc06d7ef33e45b83312b44f7599a6b4427ba082fcd938698a) |
| Bound payment and receipt | [d267719…](https://stellar.expert/explorer/testnet/tx/d267719688958301059d244b1452aae69fbc44bc15ce6885f1e7b9923f0a08af) |
| Revoke mandate | [8caf0f7…](https://stellar.expert/explorer/testnet/tx/8caf0f78a245d1d5e2dfb51b6c72ec9a31f96043d581671192e77c26cf2bbfca) |
| Close pool | [728129e…](https://stellar.expert/explorer/testnet/tx/728129ed2c226baf1ea50aca6c02c91ed681b6753567da6f65a229d2c8e17c09) |

This is not an audit, mainnet validation, live x402 facilitator test, or yield-liquidity test.

References: [Stellar x402 exact scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_stellar.md), [AP2 specification](https://ap2-protocol.org/ap2/specification/).
