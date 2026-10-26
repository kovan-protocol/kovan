---
title: Quickstart
description: From zero to a funded pool and an agent that pays inside its limits.
---

# Quickstart

Two paths: let an agent do it for you, or call the SDK from your own code. Both run on **Stellar testnet**.

## Before you start

- **Freighter** wallet, switched to **Testnet**. Fund it with testnet XLM ("Fund with Friendbot" in Freighter).
- **Testnet USDC** in that wallet. Add a USDC trustline first (your agent can prepare it), then get USDC from the [Circle faucet](https://faucet.circle.com) (choose Stellar Testnet).
- **Node.js 20+** and the **Stellar CLI** where your agent runs (the CLI is used to create agent keys).

Tip: use a separate Freighter account as the pool owner. A pool's owner can't be changed later.

## With an agent

### 1. Install Kovan into your agent

```text
Claude Code:  /plugin install kovan --marketplace kovan-protocol/kovan
              (older versions: /plugin marketplace add kovan-protocol/kovan, then /plugin install kovan@kovan)
Other agents: "Read https://kovan-protocol.vercel.app/agent.md and follow it."
```

ChatGPT, Grok and other chat assistants can't run commands. After reading the guide, they write a single [setup link](/docs/agent-tool#chat-agents-setup-links) with your limits. Open it and approve each step in Freighter.

### 2. Ask for what you want

> Set me up a $100 Kovan pool with 2 agents. Each may pay `G…PROVIDER` up to 0.50 USDC per call and 40 USDC in total, for 48 hours.

### 3. Approve each step

The agent opens a local page like `http://127.0.0.1:53817/…`. Open it in the browser where Freighter is installed, check what **Freighter's own window** shows, and approve. The agent continues by itself.

Behind the scenes, the agent runs:

```bash
node kovan.mjs connect                                    # your address, proven by a signed message
node kovan.mjs owner create_pool --owner G…OWNER          # → pool C…
node kovan.mjs owner fund --owner G…OWNER --pool C…POOL --amount 100
stellar keys generate kovan-agent-1 --network testnet --fund
node kovan.mjs owner create_agent --owner G…OWNER --pool C…POOL \
  --agent-key "$(stellar keys public-key kovan-agent-1)" --draw-limit 40 \
  --providers G…PROVIDER --provider-per-transfer-cap 0.5 --provider-total-cap 40 --expiry-hours 48
node kovan.mjs agent draw --pool C…POOL --agent C…AGENT --amount 5 --key kovan-agent-1
# Persist these nonzero 32-byte hex commitments; choose a future ledger
# no later than the agent's expiry, read from `status`. The request ID is
# 16-128 characters from A-Z a-z 0-9 _ - and must be persisted too.
node kovan.mjs owner create_mandate --owner G…OWNER --pool C…POOL --agent C…AGENT \
  --mandate-id $MANDATE_ID --intent-hash $INTENT_HASH --expiry-ledger $EXPIRY_LEDGER \
  --scope budget --payees G…PROVIDER --per-payment-cap 0.5 --total-cap 40
node kovan.mjs agent pay --pool C…POOL --agent C…AGENT --amount 0.5 --to G…PROVIDER --key kovan-agent-1 \
  --mandate-id $MANDATE_ID --request-id $PERSISTED_REQUEST_ID --reference $PURCHASE_HASH
```

Every command prints one JSON line. See [Agent tool](/docs/agent-tool) for all commands.

The setup page creates pools and agents, but does not automatically approve payment grants. Approve one separately in the console or signing page. Keep each purchase's ID and exact inputs across retries; a receipt proves payment, not delivery.

## From code

`@kovan-protocol/sdk` targets Node.js 22+ and browser bundlers. The deployment helpers used below (`currentRelease`, `releaseContracts`) are in source version 0.2.0, which is not on npm yet; the published 0.1.0 package does not export them. Build a local tarball from the repository's `sdk/` (`npm ci && npm pack`) and install it:

```bash
npm install /absolute/path/to/kovan-protocol-sdk-0.2.0.tgz @stellar/stellar-sdk@16.4.1
```

```ts
import { Networks } from "@stellar/stellar-sdk";
import { KovanClient, currentRelease, releaseContracts } from "@kovan-protocol/sdk";

const d = await (await fetch("https://raw.githubusercontent.com/kovan-protocol/kovan/main/deployments/testnet.json")).json();
const kovan = new KovanClient({
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
  contracts: releaseContracts(currentRelease(d)),
});

// Owner: prepare → show the owner → sign (e.g. Freighter) → submit.
const created = await kovan.signAndSend(await kovan.prepareCreatePool(owner), signOwner);
if (created.status !== "SUCCESS") throw new Error(`${created.status}: ${created.hash}`);
const pool = kovan.pool(created.returnValue as string);
await kovan.signAndSend(await pool.prepareOwner("fund", { amount: "1000000000" }, owner), signOwner); // 100 USDC
```

SDK amounts are **integer base units**: 7 decimals, so `"10000000"` is 1 USDC. Continue with [SDK](/docs/sdk) for creating agents and signing agent payments.

Review/pin a manifest before signing. `current_release` selects new creation; top-level bindings describe the current default pool. `legacy_pools` and `previous_releases` retain earlier bindings. Existing pools need generation-specific configuration, not the latest policy applied to an old account.

## Check what happened

```bash
node kovan.mjs status --pool C…POOL --agent C…AGENT
```

Or open the pool on [stellar.expert](https://stellar.expert/explorer/testnet). Every owner and agent action is a normal testnet transaction.
