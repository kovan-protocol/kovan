# SDK extraction and end-to-end verification

Subsequent work adds [native on-chain payment mandates](MANDATES.md) to the contracts, SDK, dashboard and signer. New artifacts were published on testnet on 2026-10-26 and passed a separate disposable-XLM mandate lifecycle (evidence in that guide). The historical execution below used legacy contracts. New-pool creation selects `current_release`; existing pools retain their original bindings and funds.

`sdk/` is a standalone TypeScript/ESM package. [`@kovan-protocol/sdk` v0.1.0](https://www.npmjs.com/package/@kovan-protocol/sdk/v/0.1.0) was published to npm on 2026-10-26. See [integration instructions](../sdk/README.md).

The published tarball passed 73 tests, the Chromium compatibility check, and an isolated installation/TypeScript consumer check. Its registry integrity matches the validated artifact:

```text
sha512-YhEdqcYvynUQ+0J7jmCYWxiJ1L2U+0ms7y8ymAapU0NJJvOP4yC3z5cF84YAgt4Ejx87fptLM11/TDxGxqVPKw==
```

This release used a fixed source snapshot. Later working-tree changes, including deployment helpers and the standalone mandate-payment example, are not included in v0.1.0; they require a subsequent release. Package publication does not deploy or upgrade contracts.

Source version **0.2.0** is now built and tested locally, not published to npm. It validates pool constructor bindings, retains earlier releases, adds read-only transaction reconciliation, and includes the current recovery-v1 testnet configuration. Install its local tarball following the SDK README. The signer/CLI bundles use this updated source.

The dashboard consumes SDK builders, covenant serialization, custom authorization, reads, error decoding, owner preparation, agent execution and submission. Deployment discovery, local keys, Freighter UI, x402 HTTP handling, yield-provider activation gates and recovery UI remain application-side. Unfinished yield operations have an explicitly experimental export, not a stable client API.

The existing x402 console flow now also uses `PoolClient.prepareAgent`, with an optional `timeoutSeconds` (integer 1–300, default 120) controlling transaction bounds and authorization lifetime. It adds reviewed quotes, persistent request IDs, restricted HTTP transport and RPC-confirmed payment evidence; see [agentic payment safety and API migration](AGENTIC_SAFETY.md). The HTTP checks alone do not change contracts. The optional native mandate profile uses new contract enforcement; neither profile claims AP2 credential/MCP/A2A support.

Explicit operation construction preserves custom-account authorization and deployed ABI behavior. Stellar's SDK handles XDR, credential-aware preimages, simulation assembly and RPC transport. The Stellar dApp skill guided configuration/signer separation and client/server boundaries.

## Isolated testnet execution — 2026-10-25 UTC

Ran `node examples/testnet-lifecycle.mjs --execute` in the SDK package. No dashboard server or existing owner key was used. Public v2 pool code, account code, policy and verifier were reused; **no code upgrade or default deployment change**.

- Pool: `CAU7NRSW3YNW44J7XPC5PCM2TSWONADW27DYRXXFB4BWY433SFPRBF7A`
- Agent: `CAPRYMTHROWXROURCECTY3I3O6SOZZIAFAMC4JQ6CMOS5CN7A53FHDIU`
- Asset: native **testnet XLM**, SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` (not USDC).
- Funded 1 XLM; drew 0.5; paid 0.1; agent returned 0.1; closure recovered remaining 0.3; owner withdrew 0.1; pool shutdown returned 0.8. Total returned: 0.9 XLM, excluding fees.
- Refused a 0.3 payment exceeding the 0.2 per-transfer cap, and refused payment after revocation, both before submission.
- Final assertions: closed pool, zero allocations, zero pool/agent balances, consumed funding 0.1 XLM.

| Step | Transaction |
| --- | --- |
| Create pool | [02e7191…](https://stellar.expert/explorer/testnet/tx/02e7191ad9bda54e11e678eaa1e36387e35449fd429dc580600d453afa5669f6) |
| Fund | [80bde86…](https://stellar.expert/explorer/testnet/tx/80bde86a4c685d189d1575670ea22d2f86018e8897730d2d44af1deffa24b8a0) |
| Create agent | [a6181b9…](https://stellar.expert/explorer/testnet/tx/a6181b925c5ae6cec14dfba038e8324e221126c629cdbb9510645fa68699ff20) |
| Draw | [2df3857…](https://stellar.expert/explorer/testnet/tx/2df38579aa272fc15c55a5b0b10b14c49fd4b16b05911c5b1fa4cefa5167b3ee) |
| Pay | [48b5c11…](https://stellar.expert/explorer/testnet/tx/48b5c1114cf4c51a5de04554b14e3ec360997cffcfdb44d964409070fff61e23) |
| Return | [748e25c…](https://stellar.expert/explorer/testnet/tx/748e25c5622233b090c5884ba3355b5d7a587041b22bded10015238a999e5447) |
| Revoke | [447cdd0…](https://stellar.expert/explorer/testnet/tx/447cdd0f2b1c7f36a64308f01295df39068935688f9930e986480ed8df765f8b) |
| Close agent | [4d1eb6b…](https://stellar.expert/explorer/testnet/tx/4d1eb6b875096c799aefc9bbb6e7a50ce201e85a8330517c9fc4ea02a66969f4) |
| Withdraw | [cbf24d0…](https://stellar.expert/explorer/testnet/tx/cbf24d059313a2f036bef5066fbd2b3de002c48adb8256bab36ef75fadca41da) |
| Close pool | [0a8d81a…](https://stellar.expert/explorer/testnet/tx/0a8d81a9006b5a53ec6676e0df72a99d0ce6a30812b65f075631db097accc0ae) |

This proves the cash lifecycle through the standalone SDK with disposable testnet funds, not mainnet readiness, USDC issuance/trustline setup, live yield liquidity or every wallet/HSM integration. Existing pools and their funds were untouched.

## Local verification — 2026-10-26 UTC

- SDK: **41 tests passed**, covering operation validation, legacy/AddressV2 signatures, signer/policy/asset/membership checks, unexpected authorization rejection, fee limits, wallet rejection, mutation detection and ambiguous submission outcomes.
- Dashboard: **149 tests passed**, including five new installed-SDK integration tests and all existing recovery/yield tests.
- SDK TypeScript build and dashboard production build passed.
- Browser smoke: production SDK bundle constructed and signed transactions and AddressV2 authorizations in Chromium without a global Buffer shim or dashboard backend; no chain writes.
- Package smoke: packed tarball installed in a fresh temporary application outside the repository; public ESM exports and TypeScript declarations/type restrictions passed.
- Dashboard browser smoke: recovery/closure, rejection/retry, late refunds, experimental yield controls and responsive layouts passed with mocked APIs/wallet signatures; no chain writes.

The Stellar SDK peer dependency is deduplicated in the dashboard. No Rust contract edits, new WASM upload, yield activation or default-deployment change were made during SDK extraction. Existing uncommitted contract/deployment work was preserved. No commit, push, npm publication or website deployment was performed during that extraction; the subsequent npm release is recorded above.
