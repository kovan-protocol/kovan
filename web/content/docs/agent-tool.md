---
title: Agent tool
description: kovan.mjs, the one-file tool agents use to set up pools and agents and to spend.
---

# Agent tool: `kovan.mjs`

One self-contained Node.js file (Node 20+). Agents use it to prepare every Kovan transaction. Owner actions are approved by the person in **Freighter**; agent actions are signed with the agent's own key.

- Installed with the Kovan skill: `skills/kovan/scripts/kovan.mjs`
- Or download it: `curl -fsSO https://kovan-protocol.github.io/kovan/kovan.mjs`
- `node kovan.mjs --help` lists every command.

Contract IDs and code hashes are built into the file from [`deployments/testnet.json`](https://github.com/kovan-protocol/kovan/blob/main/deployments/testnet.json). Nothing passed on the command line can change them.

## Output

- **stdout:** exactly one JSON line per command, e.g. `{"v":1,"fn":"fund","status":"SUCCESS","tx":"…","pool":"C…"}`
- **stderr:** progress, and the approval link
- **Exit codes:** `0` success · `1` refused or failed on-chain · `2` bad usage
- **Amounts:** USDC (`100`, `0.25`), at most 7 decimals

## How owner approval works

For `connect` and every `owner …` command, the tool:

1. Validates the request and builds and simulates the transaction (refusals stop here).
2. Serves a small page on `http://127.0.0.1:<port>/<random>` and tries to open it.
3. Waits. The person opens the page in the browser where Freighter is installed and approves.
4. Checks that what was signed is exactly the transaction it prepared, submits it, and prints the result.

The page only accepts answers from itself (same origin, random path, single use). It refuses if Freighter is on another account or network. **The person should check Freighter's own window**: it shows the real contract call, amounts and addresses.

Options: `--port N` (default random), `--no-open` (only print the link), `--timeout-min N` (default 15).

The page lives on the person's computer, so this works when the agent runs on that machine. Cloud agents use the [hosted signing page](#cloud-agents).

## Commands

### `connect`

Gets the person's address. They sign a short message in Freighter (no transaction, no fee); the tool verifies the signature.

```json
{"v":1,"fn":"connect","address":"G…","verified":true}
```

### `owner <action> --owner G… [flags]`

| Action | Flags | Does |
|---|---|---|
| `trustline` | | Lets the wallet hold testnet USDC. Moves no money. |
| `create_pool` | | New pool owned by `--owner`. Result includes `pool`. |
| `fund` | `--pool --amount` | Locks USDC in the pool |
| `create_agent` | `--pool --agent-key --draw-limit`, `--providers` + `--provider-per-transfer-cap` + `--provider-total-cap` and/or `--recipients` + `--recipient-per-transfer-cap` + `--recipient-total-cap`, `--expiry-hours` (default 24, max 720) | Creates an agent wallet. Result includes `agent`. Lists are comma-separated, at most 10 each. |
| `revoke` | `--pool --agent` | Freezes the agent's payments and calls |
| `return_funds` | `--pool --agent --amount` | Pulls USDC from the agent wallet back into the pool |
| `close` | `--pool --agent` | Final; after everything drawn is back |
| `withdraw` | `--pool --amount` | Takes back unassigned USDC |

`--agent-key` takes the agent's **public** key (`G…` or 64 hex characters). A secret key is refused with a warning.

### `agent <draw|pay|return> --pool C… --agent C… --amount N [--to G…]`

Signed with the agent's key: `--key <stellar identity>` (read with `stellar keys secret`) or `KOVAN_AGENT_SECRET=S…`. The same key pays the XLM fee from its `G…` account, so fund it once (`stellar keys generate <name> --network testnet --fund`).

| Action | Moves |
|---|---|
| `draw` | Pool → agent wallet, within the draw limit |
| `pay` | Agent wallet → a listed provider or recipient (`--to`), within caps and before expiry |
| `return` | Agent wallet → pool. Always allowed. |

The covenant is checked during simulation, so a refused payment fails before anything is sent:

```json
{"v":1,"status":"ERROR","error":"#3904 PayeeNotAllowed"}
```

### `status --pool C… [--agent C…]`

Reads the pool (owner, locked, assigned, agents) and, with `--agent`, that agent's limits, drawn amount, covenant and spend counters.

### `ids`

Prints the contract IDs and code hashes the tool trusts.

## Common refusals

| Error | Meaning |
|---|---|
| `PayeeNotAllowed` | The payee isn't on the providers or recipients list |
| `PerTransferCapExceeded` / `TotalCapExceeded` | Over the per-payment cap, or the list's total is used up |
| `Expired` / `Revoked` | The covenant has expired or the owner revoked the agent |
| `ExceedsDrawLimit` | Drawing more than the agent's remaining draw limit |
| `ExceedsLocked` | Creating or amending would assign more than the pool holds |
| `NotActive` | The agent is revoked or closed |

Full list: [Contracts → Error codes](/docs/contracts#error-codes).

## Cloud agents

If the agent can't serve a page on the person's machine, it sends a link to the hosted signing page instead. The page builds the transaction in the person's browser, so the agent doesn't even need their address:

```bash
node -e 'console.log("https://kovan-protocol.github.io/kovan/#r="+Buffer.from(process.argv[1]).toString("base64url"))' \
  '{"v":1,"fn":"fund","pool":"C…","amount":"100"}'
```

The JSON uses the owner actions above with snake_case fields (`pool`, `amount`, `agent`, `agent_key`, `draw_limit`, `providers`, `provider_per_transfer_cap`, `provider_total_cap`, `recipients`, `recipient_per_transfer_cap`, `recipient_total_cap`, `expiry_hours`) plus `"v": 1` and `"fn"`. After signing, the page shows a one-line result for the person to paste back. With an `https://` endpoint, add `"callback"` and a random `"id"` and the page POSTs the result there.
