# Pool accounting, shutdown, yield and signers

Details moved from the README. The README keeps the overview; this page keeps the exact rules.

## Deployed cash-pool accounting v2

The historical v2 pool implements the complete draw → spend → recover → close → withdraw lifecycle. The new release adds native owner-approved payment mandates and intent-hash commitments in the existing contract types. AP2 credential conformance, task verification and escrow remain deferred.

- `locked` = the pool's actual USDC balance + outstanding agent advances. It is an accounting total, **not** the pool's cash balance. An advance includes money already spent until it is settled at closure.
- `sum_limits` = draw limits of all non-closed agents. Available funds are `locked - sum_limits`, always backed by cash in the pool.
- `close` atomically freezes spending, pulls back the agent's entire USDC balance, records unrecovered advances as `settled_spent`, and releases only the unused allocation. A child returns only that unused allocation to its parent. Children must close before their parent.
- `settle` freezes the requesting agent's spending while awaiting owner/parent closure. Expired agents cannot draw or delegate, but the owner can still recover and close.
- Use `return_funds` to reconcile an agent's advance. A raw transfer to the pool counts as an unattributed deposit instead; it is still available, but it does not update that agent's return history. `settled_spent` is net funding consumed at closure, not gross provider payment volume.

For example: draw 10 USDC, spend 3, then close. The pool recovers 7, settles 3, and releases 7 of allocation. The 3 already consumed can never be allocated or withdrawn again.

## Permanent pool shutdown

The console's **Close pool** replaces **Free pool**: revoke agents, recover and close them child-first, then invoke owner-only `close_pool()`. The final transaction requires zero open agents, allocations, and outstanding advances, returns all pool cash to the original owner, and sets `closed: true`. If the refund fails, shutdown rolls back. A maintained open-agent counter includes zero-limit delegated parents and avoids scanning every historical agent in the final transaction.

This is irreversible deactivation, not deletion of the contract or its history. There is no reopen/upgrade function. The pool rejects new funding, agents, draws, delegation, amendments, and other operational changes. `return_funds`, owner-only `withdraw`, and reads remain available so late USDC deposits can be recovered without reopening it. Closing agents and closing their pool are distinct operations; draining cash alone does not close a pool.

**Historical default:** accounting v2 and permanent shutdown were deployed on testnet (2026-10-25, 22:30:42 UTC), using pool WASM `cc1aadcf38ffeee5d15717e04f48f325024b7a47e57ca1548a8e9d49b731b464`. That displayed pool keeps its original policy/account bindings. **New pool now uses the mandate-capable release below.** No old balances or agents were moved.

Existing pools are immutable and cannot be upgraded in place. The [previous deployment record](../deployments/history/testnet-2026-10-25-legacy.json) is preserved, and the dashboard keeps its old default plus browser-saved pools selectable. Explicit legacy WASM hashes remain allowed for access and recovery, never for new deployments. Old pools retain **Recover funds** and **Return to wallet**; the console only offers permanent closure when `get_pool` includes the boolean `closed` field. Create a new pool owned by your connected wallet, fund it, and create new agents to use the new lifecycle. Moving funds from an old pool still requires its owner's separate signatures.

## Optional yield — v3 published, not activated

The new pool source supports both **investing pool USDC into a DeFindex vault** and **locking an existing transferable vault-share position**. It uses actual share custody, discounts estimated backing by 10%, redeems only missing cash during an agent draw, and returns shares in kind during closure. The console separates cash from estimated vault backing and requires owner-signed opt-in and bounded quotes. This buffer is not insurance; investment losses and unavailable liquidity can stop draws.

**New pool deploys v3 in cash-only mode.** No vault is allowlisted. The published DeFindex testnet vault uses a different USDC contract, so it is deliberately not enabled. Existing funds are untouched. See [yield design, trust boundaries, tests and activation requirements](docs/YIELD.md). A compatible reviewed vault and owner-signed configuration are required before using yield on chain.

## Agent signer choice

The console supports **app-managed signers** and **your own runtime's public key**. App-managed keys are bound to the requesting pool owner's wallet, with an optional private-key download authorized through Freighter. Exporting gives the owner a copy; the app retains its signing copy. External runtimes keep their own private keys. The contracts accept the same public-key argument in either mode. See [console setup and key management](../dashboard/README.md).

## Earlier test snapshots

- 2026-10-25, cash-only deployment, before the v3 yield work: 231 tests (107 contract, 124 dashboard).
- 2026-10-26, after the SDK merge: 322 tests (132 contract, 149 dashboard, 41 SDK).

One optional DeFindex-bytecode integration test is ignored by the default contract run and excluded from every total; see [yield verification](YIELD.md#verification).
