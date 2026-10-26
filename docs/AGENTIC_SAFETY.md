# Agentic payment safety: supported integration only

Kovan currently integrates **x402 v2 HTTP `exact` payments on Stellar testnet** with the configured USDC contract. The console supports fee-sponsored HTTPS GET resources. Direct SDK payments use the same covenant enforcement. The new testnet release additionally implements [native Kovan on-chain mandates](MANDATES.md); existing pools are unchanged. Direct mandate settlement has been rehearsed on testnet; the new envelope has not yet been rehearsed through the live x402 facilitator. This does not implement AP2 signed credentials, MCP, A2A, MPP, escrow, task-result verification, or reputation.

## What is enforced where

| Concern | Existing chain enforcement | Integration checks |
| --- | --- | --- |
| Spending authority | Agent smart account + covenant policy: payees, caps, expiry, revocation | SDK checks the network, trusted pool code, membership, policy, verifier and signer; only the intended invocation can be signed |
| Specific payment | Signed token transfer and host authorization nonce/expiry | Reviewed quote binds URL, scheme, network, asset, recipient, amount and timeout; changed terms are refused |
| Delegation | Pool's existing bounded parent/child allocation | Not presented as an AP2 or A2A delegation chain |
| Duplicate request | Stellar prevents reuse of a consumed authorization | A local persistent request journal prevents a retry with the same ID from creating another authorization |
| Payment evidence | Confirmed token transfer | Receipt must match the network, payer if present, transaction hash, transfer and exact signed authorization returned by Stellar RPC |
| Work result | No correctness verification | HTTP success is not payment confirmation; payment confirmation is not proof of useful work or a refund entitlement |

The quote ID alone is a comparison hash, **not** a user signature or a mandate. Legacy contracts do not bind it or the request ID. With the native mandate profile, the owner approves a grant and the agent signature binds the quote hash and a request-ID-derived payment ID; the chain enforces that grant and consumes the ID. It still cannot fetch or verify an HTTP URL or response. The agent key can bypass HTTP checks, but not its on-chain covenant or the new account's required mandate. We continue to trust the configured Stellar RPC for chain observations. The table above describes the original integration; [the mandate guide](MANDATES.md) details the additional enforcement and deployment requirements.

## Safe request flow

1. Run the console locally: `cd dashboard && npm run dev -- --port 3001`. Both `dev` and `start` bind to `127.0.0.1` by default. Do not expose a key-holding console through a public proxy; Host/Origin checks are defense in depth, not authentication. A remotely accessible service needs authenticated, owner-scoped access before use.
2. Create and fund an app-managed agent with the provider's payment address allowlisted. Allocating a draw limit alone does not fund its wallet.
3. Call `GET /api/x402?url=<encoded-https-url>`. It returns validated terms and `quoteId`, without accessing keys. Review the exact amount, asset, payee and URL.
4. Generate and **persist** one `requestId` for this intended request, then POST:

```json
{
  "agent": "C...",
  "pool": "C...",
  "url": "https://provider.example/paid",
  "quoteId": "<64-character hash from discovery>",
  "requestId": "<persisted UUID for this purchase>"
}
```

`pool` is optional (defaults to the configured pool); the console now passes the selected pool. Both `quoteId` and `requestId` are required. Older callers sending only `{agent,url}` fail closed and must adopt discovery first. The website's copyable agent example follows this flow. For a new mandate-capable agent, also pass `mandateId` (a nonzero 64-character lowercase hex string) for its owner-approved grant. Explicit mandate requests fail on unsupported deployments, without legacy fallback.

5. Retry only with **identical saved inputs and the same requestId**. Completed requests return their stored result; pending/interrupted requests return HTTP 409. A request ID reused with different inputs is rejected. The console's Pay button reuses its request ID until Read terms is explicitly selected again. Reloading the UI does not restore a previous request: inspect the local journal and on-chain activity before authorizing another attempt after an interrupted payment.

### Outcome semantics

- `paymentStatus: "not_sent"`: discovery, quote or signing checks refused the request before the paid HTTP call.
- `paymentStatus: "unknown"`: authorization may have reached the provider. Do not generate a new ID or fresh authorization to retry. Inspect RPC/token events and reconcile first; the current journal does not automatically refresh uncertain outcomes.
- `paymentStatus: "confirmed"`: RPC confirms the matching payment. A non-2xx resource response can still have this status and `ok: false`: payment happened but delivery failed. Do not pay again to fix delivery.
- `ok: true` requires both a matching confirmed transaction and a successful HTTP response. Resource content remains untrusted data, not instructions or proof of correct work.

Requests are recorded in `x402-requests/` beside the local keystore (normally `dashboard/.keys/`). Files are mode 0600 and contain input fingerprints/results, not private keys or signed transaction XDR. Result bodies/URLs may be sensitive. Keep this directory across restarts; deleting it removes retry protection. A shared persistent filesystem is required if multiple console processes are used. This is not a distributed idempotency service, and distinct IDs can authorize distinct payments within the covenant.

## Deliberately narrow transport profile

- HTTPS on port 443, no URL credentials/fragments, public IPv4 destinations only; IPv6-only providers are not supported.
- DNS answers are checked for private/reserved addresses and pinned into the TLS connection. Discovery and payment each revalidate. No redirects, cookies, or automatic paid-request retries.
- DNS lookup deadline: 5 seconds; HTTP deadline: 20 seconds. Resource response bodies are capped at 64 KiB; returned content is capped at 4,000 characters. HTTP timeouts can produce an unknown payment outcome.
- Positive canonical i128 amounts, valid Stellar addresses, testnet network, configured USDC, fee sponsorship, and 1–300 second payment timeouts. Unknown x402 extensions/extra features are rejected, not silently treated as enforced.
- The SDK uses the requested timeout for transaction time bounds and derives authorization expiry with the Stellar x402 estimate `ceil(timeout / 5)` ledgers. Actual execution still checks the covenant's expiry/revocation. No fee-payer envelope signature is sent to the resource server.

## Verification and limitations

Regression tests cover malformed terms, unsupported profiles, quote changes, URL/SSRF and DNS rebinding, SDK invocation checks and expiry, false/missing receipts, substituted transfers/nonces, pending/failed RPC outcomes, fee-bumped settlement, interrupted/repeated requests and local API access. Tests use mocked network/chain responses; they do not move funds or constitute a security audit.

Run `make test-js`, then `npm --prefix dashboard run lint`. These HTTP checks still work with legacy deployments. Native mandate enforcement requires a newly created pool/agents using the published release; run `make test` and follow [the activation notes](MANDATES.md). Publication did not migrate any existing agents or user funds.

For the browser/API regression check, run `cd dashboard && npm run build && node scripts/x402-smoke.mjs` with Chromium installed (`CHROMIUM_PATH` can override its location). This checks local access restrictions, quote review, selected-pool propagation, duplicate clicks, stable retry IDs and URL changes. Payment APIs are intercepted in the browser; it never signs or submits a payment.

References: [Stellar exact scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_stellar.md), [x402 v2](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md).
