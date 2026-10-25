# Kovan landing

Next.js app for the Kovan marketing site. On Vercel, set **Root Directory** to `web`.

## Run locally

From the repository root:

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000. `npm run build` and `npm run lint` are the production and lint checks.

`predev` and `prebuild` run `scripts/sync-testnet.mjs`. When `../deployments/testnet.json` and `../README.md` exist, the script refreshes `src/data/testnet.json` and checks the contract IDs, transaction hashes, and the test count. A Vercel build that only contains `web/` keeps the committed snapshot.

## Config

`src/config/site.ts`

- `APP_URL` — owner dashboard. Empty until the app is deployed. When set, the primary button is **Launch app** and links here.
- `DEMO_VIDEO_URL` — walkthrough. Empty while the video is still coming soon. When `APP_URL` is empty and this is set, the primary button is **View demo** and links here.
- When both are empty, **Explore the demo** links to `/playground`.
- The primary button never links to GitHub. GitHub is only the separate source button and the footer link.
- `BLOCKED_PAYMENT_HASH` — `null` until a refused payment is on testnet. When set, the developer evidence list includes its transaction link.

`DOCS_URL` may still point at the repository readme until a docs site exists. That is the Docs button, not the primary call to action.

## Pages and preferences

The home page is a short overview. `/how-it-works`, `/why-kovan`, `/security`, `/developers`, `/playground` and `/agent-example` are separate routes. Developer evidence and expandable FAQs live on `/developers#faq`.

The hero's **Try with your agent** button opens `/agent-example`. It contains a copyable Node.js function that calls the Kovan console's existing `POST /api/x402` route with an agent account and an HTTPS paid resource. The caller needs a locally running console and an app-managed agent with that provider allowlisted; the agent's key stays on the console. The adjacent preview uses the local `evaluatePayment` model and never calls the API. Running the copied function against a configured console can submit a testnet payment.

All marketing pages support English and Spanish. The header controls persist language and light/dark appearance in local storage. Without a saved theme, the site follows the system preference. Preferences also work for the current tab when browser storage is unavailable.

Page navigation uses React's native view transitions, with a short exit and soft entry while the header stays in place. Browser history, link behavior and scroll restoration remain handled by Next. Reduced-motion and global pause preferences disable the transition.

The active design lives in `src/app/marketing.css` and `src/components/marketing/`. The older prototype styles and sections are retained for reference but are not mounted by the marketing routes.

The hero is a 24-second, four-scene product film rendered with GSAP: fund the pool, attach permissions, verify a payment, then revoke access and recover funds. Three SVG sequences illustrate allocation, policy checks and owner control below it. The film has chapter, pause and replay controls; pausing also stops the SVG sequences. All motion pauses offscreen and in hidden tabs. Reduced-motion preferences show completed scenes and retain chapter navigation. The simulator is local only; it never connects a wallet or submits transactions.
