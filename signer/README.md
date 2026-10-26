# Kovan signer

A static page where a pool owner signs requests prepared by an agent. Testnet only.

An agent sends a link like `https://kovan-protocol.github.io/kovan/#r=<base64url(JSON)>`. The link says what to do (create a pool, fund it, create an agent…). The page connects Freighter, builds and simulates the transaction for the connected wallet with `@kovan/sdk`, and submits it once the owner approves. The agent never needs the owner's address or keys.

- Request format and the agent workflow: [`.agents/skills/kovan/SKILL.md`](../.agents/skills/kovan/SKILL.md), also published as `agent.md` next to the page.
- Contract IDs and code hashes come from [`deployments/testnet.json`](../deployments/testnet.json) at build time. A link cannot choose code, policy, verifier or asset; unknown fields are refused.

## Develop

```bash
(cd ../sdk && npm ci && npm run build)
npm ci
npm run dev                                   # http://localhost:5173
npm test                                      # request parsing
LIVE=1 npx vitest run tests/chain.live.test.ts  # simulate on testnet, nothing is signed
npm run build                                 # → dist/
```

Pushes to `main` that touch this folder, the SDK, the deployment record or the agent skill redeploy GitHub Pages (`.github/workflows/signer-pages.yml`).
