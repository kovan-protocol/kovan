# Kovan signer

A static page where a pool owner signs requests prepared by an agent. Testnet only.

An agent sends a link like `https://kovan-protocol.github.io/kovan/#r=<base64url(JSON)>`. The link says what to do (create a pool, fund it, create an agent…). The page connects Freighter, builds and simulates the transaction for the connected wallet with `@kovan/sdk`, and submits it once the owner approves. The agent never needs the owner's address or keys.

- Request format and the agent workflow: [`skills/kovan/SKILL.md`](../skills/kovan/SKILL.md), also published as `agent.md` next to the page.
- Contract IDs and code hashes come from [`deployments/testnet.json`](../deployments/testnet.json) at build time. A link cannot choose code, policy, verifier or asset; unknown fields are refused.

## Agent tool: `kovan.mjs`

`src/cli.ts` builds into [`skills/kovan/scripts/kovan.mjs`](../skills/kovan/scripts/kovan.mjs), one self-contained Node file for agents running on the owner's machine: `connect`, `owner <action>`, `agent draw|pay|return`, `status`. It reuses this folder's request validation (`src/request.ts`) and transaction building (`src/chain.ts`). For owner approval it serves a local wallet page (`src/wallet-page.ts`) on `127.0.0.1` behind a random path, so the agent itself prepares each transaction and the owner signs in Freighter. The bundle is committed so the skill works when installed; CI rebuilds it and fails if the committed copy is stale. It's also published as `kovan.mjs` next to the page.

## Develop

```bash
(cd ../sdk && npm ci && npm run build)
npm ci
npm run dev                                   # http://localhost:5173
npm test                                      # request parsing
LIVE=1 npx vitest run tests/chain.live.test.ts  # simulate on testnet, nothing is signed
npm run build                                 # → dist/
npm run build:cli                             # → ../skills/kovan/scripts/kovan.mjs (commit it)
```

Pushes to `main` that touch this folder, the SDK, the deployment record or the agent skill redeploy GitHub Pages (`.github/workflows/signer-pages.yml`).
