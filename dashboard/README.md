# Kovan console

## Getting Started

Build the SDK first, then run from `dashboard/` with Node.js 22 or newer:

```bash
npm --prefix ../sdk ci
npm --prefix ../sdk run build
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), switch Freighter to Stellar testnet, and connect the pool owner's wallet. Contract IDs come from `../deployments/testnet.json`. The console can create/select pools, lock USDC, create agents, and show balances and events. App-managed agents can draw, pay directly or over x402, and return funds.

## Shared SDK

The console consumes [`@kovan/sdk`](../sdk/README.md) for operations, custom authorization, reads, preparation/submission and agent execution. Local keystore access, deployment configuration, wallet UI and yield allowlisting stay here; the SDK does not depend on this app.

`file:../sdk` is installed as a package copy (`install-links=true`), sharing this app's Stellar SDK peer dependency. After SDK edits, rebuild it and run `npm ci` here to refresh the copy: plain `npm install` can retain an old same-version package. Tests/builds use the installed package, not a source alias.

## Pool lifecycle

For accounting-v2 pools, **Recover & close** permanently stops an agent, returns its wallet's remaining USDC, records net funding consumed, and releases the unused allocation. Close child agents before their parent. **Withdraw** sends only unallocated funds back to the connected owner. Both actions require Freighter approval.

The pool panel separates actual pool cash, allocated limits, available withdrawals, and settled spending. Outstanding agent funding includes payments until closure; it is not the agent's wallet balance. Expired agents cannot draw or spend through the console.

**Close pool** replaces **Free pool**. On shutdown-capable deployments, it revokes agents, recovers their unspent USDC, and closes allocations (children before parents). The final owner-only `close_pool()` transaction atomically returns the remaining pool balance to its original owner and sets an irreversible on-chain `closed` flag. Funding, agent creation, draws, delegation, and other operational changes are then rejected. Even an empty pool can be closed. The contract and its history are not erased, and there is no reopen function.

**Return to wallet** independently withdraws all currently available USDC to the pool's original owner address, shown before confirmation. It does not close the pool or stop agents. Owner-authorized withdrawal and agent-fund recovery remain available after shutdown for unsolicited late USDC deposits; they never reopen the pool. No funds are sent to an arbitrary connected wallet, and payments already made cannot be reversed.

These are separate, individually signed transactions, not an atomic batch. Every step waits for success and re-reads chain state before preparing the next. Rejection or failure stops the sequence; confirmed steps remain applied and retry resumes from current state. Rejecting the final signature leaves recovered funds in an open pool until closure is retried. The UI only reports closure after reading `closed: true` from chain, retains the pool for history/late refunds, and disables funding and creation. Pool/wallet switching and conflicting dashboard actions are disabled during recovery.

On legacy pools, spent advances cannot be closed. Recovery reduces revoked agents' draw limits to their outstanding advances, releasing unused allocation without pretending those agents are closed. A parent blocked by a spent child may retain the minimum positive allocation of one USDC base unit (`0.0000001 USDC`). Expired legacy numeric policies may have their expiry advanced to permit this reduction, but stay revoked. With a 10 USDC pool and a single agent that drew 0.50 and spent 0.01, recovery makes 9.99 USDC withdrawable while leaving the 0.01 legacy accounting record. Recovery still depends on the pool's existing token allowance; an expired allowance will stop the sequence.

The checked-in testnet default is now `CDP6UNP5YZ6NIMJ2XVQGYLBUAA5RP2LD7SPIRBP4VTVZLKPKCHFX42BR`, deployed with accounting v2 and permanent shutdown. **New pool** always deploys this current WASM, even when viewing a legacy pool. The new default was deployed empty, owned by the CLI deployment identity; connect your own wallet and choose **New pool** to create one you control. Refresh the page to load the new default and preserved historical entries. No funds or agents are migrated automatically.

The previous default and browser-saved pools remain selectable. Their explicitly retained WASM hashes are accepted for recovery. Existing pools cannot be upgraded; even earlier accounting-v2 deployments lack `close_pool`. The console detects shutdown support by the explicit boolean `closed` field in `get_pool`, not by accounting version alone. Unsupported pools offer **Recover funds** plus **Return to wallet**, never a misleading successful closure. See the root README for deployment and accounting details. A token-balance read failure is surfaced rather than displayed as a zero balance.

Keep `POOL_ID`, `POLICY_ID`, `VERIFIER_ID`, and `USDC_SAC_ID` unset unless deliberately overriding the manifest. `KOVAN_DEPLOYMENTS` also overrides its location. After changing environment overrides, restart the dashboard; manifest changes are read at runtime. `node scripts/deploy-pool.mjs --check --source <identity>` checks a rollout without broadcasting transactions (run from `dashboard/`, after building the contracts).

## Optional yield (v3)

The pool panel explains both funding paths: **Fund → Invest pool USDC**, or **Lock existing shares** without withdrawing the external underlying position. V3 pools expose cash, shares, estimated assets, and discounted budget backing separately. Configure the vault before opening agents. Previews set explicit minimum outputs and a ledger deadline; Freighter signs every owner operation. Agent draws redeem only a cash shortfall, and fail atomically if backing or redemption is insufficient. Pool closure returns shares in kind, not as USDC.

This is implemented locally, **not enabled on the current v2 deployment**. `New pool` still uses the manifest's v2 WASM. No matching vault is allowlisted: the published DeFindex testnet vault uses a different USDC asset. Do not change USDC to make an incompatible vault appear supported. [Activation, risks and tests](../docs/YIELD.md) describe the required fresh v3 rollout and reviewed `yield_vaults` configuration. No automatic migration or investment occurs.

`POST /api/yield/quote` takes `{pool, action, amount}` (base-unit string), where action is `invest`, `lock_shares`, or `redeem_shares`. It only reads/simulates. Its response contains a bounded argument set for `/api/tx/build`, then the usual owner wallet signature and `/api/tx/submit`. New risk-taking paths require the reviewed vault allowlist; delisting does not disable redemption or share recovery. V1/v2 reads and cash operations remain supported.

## Covenant options and examples

The creation form includes field hints and expandable options/examples for providers, recipients, and contract calls. **Add demo payee** appends the public Stellar x402 testnet payee; **Add pool owner** appends the connected, verified owner as a recipient. Neither replaces existing addresses, changes caps, signs, nor submits anything. Check current x402 terms before paying. Blank payment caps mean zero, and totals are shared across each category for one agent, not recurring budgets.

Contract-call fields explain exact function matching, zero-based argument indexes, and the current form's 7-decimal cap encoding (`0.10` → `1,000,000` raw units). A blank index disables the argument check; caps are per-call, not cumulative. Illustrative function names are not a catalog of deployed integrations. The form configures permission only; a runtime must construct the corresponding call.

## Choose an agent signer

Each agent smart account registers a public key. Its matching private key signs the account's Soroban authorization entries; the smart account's C-address has no private key of its own. The covenant applies regardless of where signing happens.

- **App-managed:** the app generates a signer after the pool owner authorizes generation in Freighter. It stores the private key in `.keys/agents.json` (git-ignored, file mode `0600`). Owner transactions still require Freighter. The backend signs agent actions, with a separate fee payer automatically generated and funded through Friendbot on testnet.
- **Use my own signer:** provide a G-address or raw 32-byte public key in hex. Keep the private key in your own agent runtime; it is never requested by the creation form. The console displays the agent and covenant, while the runtime signs actions.

## Optional private-key export

For a new app-managed agent, choose **Download signer key** on its card. Freighter signs a one-use message which expires after two minutes. The backend checks the pool owner, the agent's membership and configured signer, and the owner bound to that key when it was generated. No transaction is submitted for the export. Responses use `Cache-Control: no-store`; secrets are only returned by this explicitly authorized action and downloaded as a JSON file.

The export contains `secret`, `publicKey`, `agent`, `pool` and `network`. It gives you a **copy**; the app keeps its signing copy. This is not an exclusive handoff or a change to the pool owner or covenant. Existing keys created before verified owner binding remain usable but cannot be exported through the app. Ownership is never inferred just because someone created a new agent with a known public key.

External runtimes can use `@kovan/sdk`'s `pool.prepareAgent` with a caller-provided digest signer and separate fee payer, without this dashboard or a private-key export. Low-level `signAgentEntry` remains available for existing integrations. Signing authorizes the smart account's C-address, not a plain G-account payment; the private key need not be sent to Kovan.

## Key API

`POST /api/agent/keys` accepts:

1. `{action:"generate-challenge", owner, pool}` → `{id, message, expiresAt}`.
2. Sign `message` using Freighter `signMessage` / SEP-53. Send `{action:"generate", challengeId:id, signature}` → public key metadata, with no secret.
3. For export, request `{action:"export-challenge", owner, pool, agent}`, sign the returned message, then send `{action:"export", challengeId:id, signature}` → the signer export.

`signature` is the base64 SEP-53 signature. Challenges are scoped to the action, owner, pool, origin and (for export) agent/signer. Challenge files live beside the keystore and are consumed atomically. `GET` returns public metadata only.

## Hosting

The app-managed signer is a service supplied by the dashboard backend; the on-chain protocol accepts public keys independently of it. The current backend stores signer secrets on disk. For a hosted instance, the operator holds those keys and all workers need the same protected, persistent keystore volume. An ephemeral serverless filesystem cannot retain agent keys. This console is a testnet prototype; it does not provide an exclusive key handoff or hosted-service account authentication for all existing agent-action endpoints.

Optional environment overrides are listed in `.env.example`. `AGENT_SECRET` and `FEE_PAYER_SECRET` remain supported for existing local setups. `KOVAN_KEYSTORE` can point to a different protected keystore file.

## Checks

```bash
npm test
npx tsc --noEmit
npm run build
# Optional browser smoke test (all APIs/signatures mocked; requires Chromium)
node scripts/recovery-smoke.mjs
```
