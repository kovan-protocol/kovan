# Kovan — 3-minute pitch and judge notes

Official order: cover → solution → PMF → technical workflow + demo → team.
Main deck: 5 slides. Separate judge backup: 7 slides. Updated 26 October 2026.
Team credits are intentionally open. Timing allows approximately 65 seconds for the demo.

## Slide 1: Give agents a budget, not your wallet.

0:00–0:12 · COVER
AI agents are starting to spend money on their own. Kovan gives them a shared USDC budget, with spending rules enforced by their own Stellar smart accounts. Agent autonomy. Human control.

The 100 USDC allocation is an illustrative example, not traction or current pool funding. All product evidence in this presentation is testnet evidence; testnet tokens have no real value. The project is unaudited.
Transition: Here is how we separate an agent's ability to work from its ability to move money.

## Slide 2: One shared pool. Every agent has limits.

0:12–0:42 · SOLUTION
You lock USDC in one pool. Each agent gets its own smart account and a covenant: who it may pay, how much per payment and in total, and until when. The pool keeps allocations backed. An agent can delegate a narrower budget to a child, carved out of its own allocation. The owner can revoke and recover unused funds without needing the agent's key. The agent cannot remove the spending policy.

Technical detail: the signer, allowlists and policy binding are fixed at account creation. The owner can amend numeric limits and expiry. The recovery allowance is established at creation and lasts 3,000,000 ledgers. Children must be closed before their parent. Recovery does not undo completed payments.
Do not claim the system prevents all prompt injection: a compromised agent may still waste its approved budget with an approved payee. Contract bugs and deployment configuration are separate risks.
Sources: README.md; contracts/agent-account; contracts/covenant-policy; contracts/pool.

## Slide 3: Agents can pay. Teams need control.

0:42–1:08 · PMF / PROBLEM
Our first user is a developer running agents that buy data, APIs or compute. Today they either fund a wallet and expose that balance, or interrupt the agent with manual top-ups. x402 makes paying per request possible. Kovan adds a shared treasury and an enforceable spending boundary around those payments. The first pilot question is simple: can a team let an agent complete useful paid work and keep every payment within its approved rules?

Objection prep — “Have you proven product-market fit?”
No. The evidence today proves execution and controls on testnet, not customer demand. Recruit developers already using paid APIs and measure completed tasks, paid calls, rejected out-of-policy attempts, and repeat weekly use.

The original deck's unsubstantiated “9+ teams” line and broad incident comparisons are omitted. A jailbreak challenge and a real operational compromise are not interchangeable evidence of customer demand.
Current ecosystem context checked 2026-10-26: Stellar Developer Docs describes x402 per-request payments, Soroban auth-entry signing, SEP-41 assets and USDC as the default asset. https://developers.stellar.org/docs/build/agentic-payments/x402/

## Slide 4: Pay. Refuse. Recover.

1:08–1:35 · WORKFLOW
Four Soroban contracts power this: the pool, agent account, covenant policy and signature verifier. The owner funds the pool and approves setup in Freighter. The pool deploys an account for each agent. Every outgoing authorized call is checked by the covenant. We built the smart-account authorization payload needed to pay over x402. The same covenant applies to direct transfers.

1:35–2:40 · DEMO — show the application or prepared recording
00–15 seconds: show a funded pool and one prepared agent. Point to its approved payee and spending cap. “The owner approves setup in their own wallet; the agent uses its own key.”
15–35 seconds: execute or replay the x402 payment. “The API returns 402. The agent signs an authorization, the facilitator settles the payment, and the API returns the content.” Show the actual transaction receipt.
35–50 seconds: attempt payment to an unapproved address. “The account refuses it: PayeeNotAllowed. This is a contract authorization failure before submission, so there is no failed transaction hash to show.”
50–65 seconds: show revocation and recovery, or the documented v2 lifecycle receipt. “New spending stops. We close the agent and recover unused funds without the agent's key.”

Evidence boundaries: historical USDC x402 transaction 781a5f2b560df66d3d6c587ef4f2a283e82421ce16b54565a9a64a8ba662775d belongs to a legacy pool. Full v2 revoke/recover/shutdown evidence is a separate isolated testnet XLM pool in docs/SDK.md. Do not present these as one continuous USDC run. Rehearse a fresh sequence before recording. No new payment was submitted while making this deck.
Optional extensions only after deployment and funded rehearsal: delegation with on-chain evidence; owner-approved mandates; DeFindex yield. Avoid spending the core demo on unrehearsed integrations.

Why Stellar: the settlement asset, programmable authorization and HTTP payment rail are composable. Official sources: https://developers.stellar.org/docs/build/agentic-payments/x402/ ; https://docs.openzeppelin.com/stellar-contracts/accounts/policies ; https://www.circle.com/multi-chain-usdc/stellar .

## Slide 5: Built at HackMeridian.

2:40–3:00 · TEAM / CLOSE
[Introduce each teammate and the part they built. Names and roles are intentionally left open at the user's request.]
We built Kovan at HackMeridian: shared budgets, on-chain spending rules and a working smart-account x402 payment. We want developers of paid-API agents to try the bounded spending loop and tell us where it breaks. Kovan. Give your agents a budget, not your wallet.

If names are not filled before the presentation, introduce the team verbally. Do not claim a precise 24-hour build duration without confirming it.
Evidence for build period: README.md “Built during event vs prior work” and docs/SUBMISSION_FORM.md, which disclose event-built code, prior planning, OpenZeppelin verifier code and vendored Stellar skills.
The website's primary demo may be the interactive playground (a simulation); it is not the deployed owner dashboard. Use an actual running console for live payments.
Suggested pilot invitation, not an existing customer claim. No funding amount or commercial commitment has been invented.

## Backup 1: The owner’s control surface.

BACKUP A · PRODUCT DEMO
This is the real dashboard UI captured in a browser check with API fixtures. The values are not chain activity or evidence of users. It is included to show the product surface, not to substitute for a transaction receipt.
The screenshot was already present in /tmp/kovan-design-review-qQWT0a/dashboard-light-1440.png; the associated script intercepts /api/state and /api/events. For the stage demo, use the running dashboard and real testnet records, or an explicitly labeled replay.
Prepare: funded testnet pool, approved payee, small cap, endpoint terms, explorer tabs, and backup recording. Use a fresh agent for repeat demos so spent caps and revocations do not invalidate the script.

## Backup 2: A policy the agent cannot remove.

BACKUP B · HOW THE BOUNDARY WORKS
The pool deploys an OpenZeppelin smart account with one context rule: the agent's External Ed25519 signer and the covenant policy. It has no management rule. The account cannot add a signer or remove the policy through an authorized self-call.
The policy is a separate contract from the pool to avoid Soroban re-entry constraints. It checks approved token transfers and configured contract calls, caps, expiry and revocation. The verifier checks the agent's signature.
Differentiation: Kovan combines shared allocation accounting, frozen agent accounts, narrower delegation and owner recovery. x402 is the payment transport; OpenZeppelin is the account primitive. They are foundations, not competitors Kovan replaces.
For a stolen key: the attacker still operates within the permitted destinations and caps, but may exhaust those budgets. Revoke quickly. Recovery can only recover the remaining balance and depends on the allowance, contract execution and available chain state.
Official reference: https://docs.openzeppelin.com/stellar-contracts/accounts/policies

## Backup 3: Spent funds never become a new budget.

BACKUP C · ACCOUNTING
For v2, locked is an accounting total: actual pool cash plus outstanding agent advances. It is not simply the pool's cash balance. sum_limits is the draw limit total for non-closed agents, and available funds are locked minus sum_limits.
Closing an agent freezes spending, pulls back its balance, records unrecovered advances as settled_spent and releases unused allocation. Spent funding cannot be counted twice. A child returns only unused allocation to its parent, and children close first.
The example assumes a 10-USDC allocation drawn in full, 3 spent and 7 left in the wallet. A raw transfer to the pool is an unattributed deposit; use return_funds for the agent's reconciliation history.
Permanent pool closure requires zero open agents, allocations and advances, and returns remaining pool cash to the original owner. Historical records remain. Source: README.md.

## Backup 4: What ships today. What comes next.

BACKUP D · COMPLETENESS WITHOUT OVERCLAIMING
Current default deployment: cash-only pool v2. Historical USDC x402 evidence and isolated v2 lifecycle evidence are linked in the evidence slide.
Native Kovan mandates: implemented and tested locally, not deployed. They add owner-approved exact/budget grants, payment IDs, expiry and receipts, and intersect with covenant limits. They are not AP2 signed credentials, MCP, A2A, escrow or delivery verification. New compatible contracts and agents plus a funded facilitator rehearsal are required.
Yield v3: locally tested, not deployed/activated. Supports one compatible single-asset DeFindex vault and transferable shares using the exact pool asset. Cash is used before redemption. Backing discounts estimated vault value by 10%; this buffer is not insurance. Losses or unavailable liquidity may stop draws. No APY or live yield claim.
SDK: @kovan-protocol/sdk is local and packable, not yet published to npm. Agent guides/plugin and owner signing flows exist. Publication and hosted-flow verification should be checked before a live announcement.
General contract-call allowlisting is not equivalent to a completed Blend/Soroswap integration. No broad claims about MPP/AP2/A2A or reputation implementations.
This is a status snapshot from the repository, not a deployment verification run.

## Backup 5: Inspect the evidence.

BACKUP E · EVIDENCE REGISTER
Test count is 151 Rust + 266 dashboard + 73 SDK = 490, from docs/MANDATES.md verification on 2026-10-26. This is a documented local snapshot, not tests re-run during deck production. It includes undeployed mandates and yield work, and excludes an optional ignored external fixture test. It does not establish an audit or a live production deployment.
Legacy USDC x402 payment: https://stellar.expert/explorer/testnet/tx/781a5f2b560df66d3d6c587ef4f2a283e82421ce16b54565a9a64a8ba662775d
Legacy USDC direct payment: https://stellar.expert/explorer/testnet/tx/263d05036ee5bcc7520cef1dc39fb36a85ab4c90d5eda2caa5a62e7d2b0f4fb0
Legacy USDC return: https://stellar.expert/explorer/testnet/tx/c455d6a3229fe29f82ecd00d26de2d0c86ee76f365a8230bb96b153db71665b3
Current default v2 deployment: https://stellar.expert/explorer/testnet/tx/b2b2f1f8fd3911504f91a5d9f959ffdb61a24e1b9a9fa9c29b56965eb26074f5
Separate isolated v2 XLM agent closure: https://stellar.expert/explorer/testnet/tx/4d1eb6b875096c799aefc9bbb6e7a50ce201e85a8330517c9fc4ea02a66969f4
Separate isolated v2 XLM pool shutdown: https://stellar.expert/explorer/testnet/tx/0a8d81a9006b5a53ec6676e0df72a99d0ce6a30812b65f075631db097accc0ae
Sources: README.md, docs/SDK.md, docs/MANDATES.md. Contract records were not independently re-queried in this deck task. Testnet history can reset.

## Backup 6: Built to be adopted by agents.

BACKUP F · INTEGRATION / PATH TO USERS
The agent guide and Claude Code plugin let an agent prepare owner transactions using kovan.mjs. Owner approvals are signed in Freighter through local or hosted signing interfaces. Runtime agents may supply their own public keys; app-managed keys are an optional convenience and the app retains its signing copy even after export.
The package name is @kovan-protocol/sdk, not @kovan/sdk. It is a local TypeScript/ESM package; do not show npm install as a published workflow until a package is actually released. Applications supply their own configuration and signers.
Go-to-market hypothesis: start with developers already running x402 API agents, publish reproducible examples, onboard pilot teams and measure useful paid tasks and repeat usage. No revenue, customer count or committed commercial model is asserted. A possible future business is hosted operations and monitoring; validate willingness to pay before putting pricing on a slide.

## Backup 7: What the covenant does—and doesn’t do.

BACKUP G · TWO-SENTENCE ANSWERS
“Why not just x402?” x402 carries the payment request and settlement authorization. Kovan constrains who may be paid and how much, and coordinates many agents against one shared pool.
“Why not a standard wallet?” A raw signing key can authorize transfers from a classic account without Kovan's application policy. Kovan puts the restrictions in the smart account's authorization path, together with pool allocation accounting and recovery.
“What if the key is stolen?” The attacker remains subject to the approved payees, caps, expiry and revocation. The owner can revoke and recover the remaining funds, but a permitted payment can still be wasteful.
“Who holds keys?” Owners sign with their own wallet; runtime agents can supply their own signing keys. App-managed mode retains an application-side signing copy, so avoid a blanket claim that Kovan never holds any agent key.
“Why blockchain?” The recipient, asset and amount can be checked at the same execution boundary that moves the funds. The public settlement record makes those controls inspectable independently of the agent prompt and UI.
“Can you guarantee recovery?” Recovery does not reverse settled payments and depends on the token allowance and executable chain state. The default recovery allowance is valid for 3,000,000 ledgers from account creation.
“What about yield?” Yield is an opt-in, locally tested DeFindex integration, currently inactive. Vault losses and liquidity constraints can prevent draws; the 10% backing discount is not insurance.
“What would prove demand?” Onboard developers who already pay for agent inputs and track completed paid tasks and repeat use. The pitch currently demonstrates technical capability, not proven product-market fit.
