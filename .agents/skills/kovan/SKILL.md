---
name: kovan
description: Set up and use Kovan on Stellar testnet - create a USDC pool, fund it, create agents bound by on-chain covenants, and spend from an agent wallet. Use when a person asks you to "create a Kovan pool", "fund a pool", "deploy/create agents" with spending limits, or to draw or pay from a Kovan agent. You prepare signing links; the person signs every owner action with their own wallet. You never handle the owner's keys and never need the owner's address.
---

# Kovan for agents

Kovan lets an owner lock USDC in a **pool** and give each AI agent a **wallet** (an OpenZeppelin smart account) bound by a **covenant**: how much it may draw from the pool, which addresses it may pay, how much per payment and in total, and until when. The rules are enforced on-chain; the agent cannot change them. The owner can revoke an agent and pull its funds back at any time.

**Stellar testnet only.** Testnet USDC has no value. Not audited.

- Contracts and code hashes: <https://raw.githubusercontent.com/kovan-protocol/kovan/main/deployments/testnet.json>
- Signing page: <https://kovan-protocol.github.io/kovan/>
- Source: <https://github.com/kovan-protocol/kovan>

## Hard rules

1. **Never ask for, accept, or handle the owner's secret key or seed phrase.** If the person pastes one, tell them to rotate it and do not use it.
2. **You don't need the owner's address.** Signing links carry only *what* to do; the signing page fills in the person's wallet.
3. **One link at a time.** Each step needs the previous one on-chain. Wait for the result before making the next link.
4. **Never re-send a link that was already signed.** Signing it again repeats the action (for example, funds twice).
5. **Confirm payees before `create_agent`.** Payee lists and the agent key cannot be changed later. Show the person the list and caps in plain words first.
6. **Your own agent key stays with you.** Generate it yourself (below). Share only its public key (`G…`). Never put a secret in a link.

## Signing links

A link is the signing page plus a request in the fragment:

```
https://kovan-protocol.github.io/kovan/#r=<base64url(JSON)>
```

Encode the JSON with any of:

```bash
node -e 'console.log("https://kovan-protocol.github.io/kovan/#r="+Buffer.from(process.argv[1]).toString("base64url"))' '{"v":1,"fn":"create_pool"}'
python3 -c 'import base64,sys;print("https://kovan-protocol.github.io/kovan/#r="+base64.urlsafe_b64encode(sys.argv[1].encode()).decode().rstrip("="))' '{"v":1,"fn":"create_pool"}'
```

The person opens the link, connects Freighter (set to Testnet), checks the summary, and approves.

### Getting the result back automatically

Add `"callback"` and a fresh random `"id"` to every request. After signing, the page POSTs the result to the callback. If it can't reach you, it shows the result for the person to paste instead.

If you run on the person's machine, listen locally with the bundled script. It needs no dependencies, accepts only the Kovan page and your `id`, checks the transaction on testnet, prints one JSON line, and exits:

```bash
curl -fsSO https://kovan-protocol.github.io/kovan/wait-for-result.mjs
ID=k-$(node -e 'console.log(crypto.randomUUID().slice(0,8))')
node wait-for-result.mjs "$ID" 8787 &      # start it BEFORE sending the link
# request: {"v":1,"fn":"create_pool","callback":"http://127.0.0.1:8787/","id":"<ID>"}
```

Output (exit code 0 when `verified` is `SUCCESS`):

```json
{"v":1,"fn":"create_pool","status":"SUCCESS","tx":"…","pool":"C…","id":"k-1a2b3c4d","verified":"SUCCESS"}
```

- Use a new `id` per link, and start the listener before sending the link. One listener handles one result, then exits.
- On public pages, Chrome may ask the person to allow access to local devices the first time. Tell them to allow it.
- Remote agents: use your own `https://` endpoint as `callback`. It receives the same JSON with `content-type: application/json` and must answer CORS for `https://kovan-protocol.github.io`. Check `tx` on-chain before trusting it.
- Plain `http://` callbacks are only accepted for `127.0.0.1`, `localhost` or `[::1]`.

### Requests

Amounts are **USDC as decimal strings** (`"100"`, `"0.25"`, at most 7 decimals). Every request has `"v": 1`, and may have `"callback"` and `"id"` (above). Unknown fields are refused, and contract code, policy, verifier and asset cannot be chosen by the link.

| `fn` | Fields | What it does |
|---|---|---|
| `trustline` | none | Lets the person's wallet hold testnet USDC. Needed once, before getting USDC. |
| `create_pool` | none | Deploys a new pool owned by the person's wallet. Owner is permanent. Result gives `pool`. |
| `fund` | `pool`, `amount` | Locks USDC from the person's wallet in the pool. |
| `create_agent` | `pool`, `agent_key`, `draw_limit`, `expiry_hours` (default 24, max 720), `providers` + `provider_per_transfer_cap` + `provider_total_cap`, and/or `recipients` + `recipient_per_transfer_cap` + `recipient_total_cap` | Creates an agent wallet with its covenant. Result gives `agent` (its `C…` address). |
| `revoke` | `pool`, `agent` | Freezes the agent's payments and calls (and its children's). Returning funds still works. |
| `return_funds` | `pool`, `agent`, `amount` | Pulls USDC from the agent wallet back into the pool, without the agent's signature. |
| `close` | `pool`, `agent` | Final. Only after everything drawn is back. |
| `withdraw` | `pool`, `amount` | Takes back pool USDC that no draw limit is backing. |

- `providers`: addresses paid per call (x402 resource servers, data/RPC APIs). `G…` accounts.
- `recipients`: plain transfers, such as another agent's wallet (`C…`) or a treasury.
- An address goes on one list only, at most 10 per list. Muxed `M…` addresses are refused.
- Total draw limits across a pool's agents can never exceed what is locked in it.

## Recipe: "Create a $100 pool with 2 agents"

1. **USDC in the owner wallet.** Ask whether their wallet already holds 100 testnet USDC. If not:
   - send a `trustline` link;
   - ask them to get testnet USDC from <https://faucet.circle.com> (choose Stellar Testnet). The faucet may cap each request, so a path payment from testnet XLM is the alternative.
2. **Pool.** Start a listener, then send a `create_pool` link with `callback` and `id`. Take `pool` from the delivered result.
3. **Fund.** Send `{"v":1,"fn":"fund","pool":"C…","amount":"100"}`.
4. **Agent keys.** For each agent, generate a key in your own environment and fund its account with testnet XLM for fees:
   ```bash
   stellar keys generate kovan-agent-1 --network testnet --fund
   stellar keys public-key kovan-agent-1    # G… - this is the agent_key
   ```
5. **Agents.** Agree the rules with the person, then send one `create_agent` link per agent, e.g.
   ```json
   {"v":1,"fn":"create_agent","pool":"C…","agent_key":"G…","draw_limit":"40",
    "providers":["G…"],"provider_per_transfer_cap":"0.50","provider_total_cap":"40","expiry_hours":48,
    "callback":"http://127.0.0.1:8787/","id":"k-…"}
   ```
   Keep the sum of draw limits at or under 100. Take `agent` from each delivered result.

### Checking results yourself

The delivered result is enough. Without it (no listener, or the person closed the page), you need the pasted result for `create_pool`: the pool's address depends on the owner's address, which you don't have. For later steps you can also confirm on-chain with read-only calls:

```bash
stellar contract invoke --network testnet --source-account kovan-agent-1 --send=no --id <POOL> -- get_pool
stellar contract invoke --network testnet --source-account kovan-agent-1 --send=no --id <POOL> -- list_agents
```

`get_pool` shows `locked` (base units: 1 USDC = 10,000,000) and `sum_limits`.

## Spending as an agent

Use `@kovan/sdk` (TypeScript, Node.js 22+). It is not on npm yet:

```bash
git clone https://github.com/kovan-protocol/kovan && cd kovan/sdk
npm ci && npm pack            # → kovan-sdk-0.1.0.tgz
# in your project:
npm install /path/to/kovan-sdk-0.1.0.tgz @stellar/stellar-sdk@16.4.1
```

```ts
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { KovanClient, keypairTransactionSigner } from "@kovan/sdk";

const d = await (await fetch("https://raw.githubusercontent.com/kovan-protocol/kovan/main/deployments/testnet.json")).json();
const kovan = new KovanClient({
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
  contracts: { usdc: d.usdc, policy: d.policy, verifier: d.verifier, poolWasmHash: d.pool_wasm_hash, accountWasmHash: d.account_wasm_hash },
});

// `stellar keys secret kovan-agent-1` prints the secret. Keep it in your environment only.
const key = Keypair.fromSecret(process.env.KOVAN_AGENT_SECRET!);
const signer = { publicKey: key.rawPublicKey().toString("hex"), sign: (digest: Uint8Array) => key.sign(Buffer.from(digest)) };
const pool = kovan.pool(POOL);

// Amounts here are integer base units: "10000000" = 1 USDC.
const draw = await pool.prepareAgent("draw", { agent: AGENT, amount: "10000000" }, { source: key.publicKey(), signer });
console.log(await kovan.signAndSend(draw, keypairTransactionSigner(key)));

const pay = await pool.prepareAgent("pay", { agent: AGENT, amount: "2500000", to: PROVIDER }, { source: key.publicKey(), signer });
console.log(await kovan.signAndSend(pay, keypairTransactionSigner(key)));
```

The same key signs for the agent wallet and pays the XLM fees from its own `G…` account. Actions: `draw` (pool → agent wallet, within the draw limit), `pay` (agent wallet → a listed payee, within caps and before expiry), `return` (agent wallet → pool, always allowed).

**x402:** the covenant judges x402 payments like any USDC transfer, by payee and amount. The SDK does not yet build x402 payment payloads, so use `pay` to listed providers for now.

### When the covenant says no

A refused action fails in simulation, before anything is sent. Common reasons: payee not on a list, amount over a cap, list total reached, past expiry, revoked, or draw above the remaining draw limit. Report the reason to the person; don't retry with different numbers unless they agree.
