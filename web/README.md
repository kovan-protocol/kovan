# Kovan landing

Next.js app for the Kovan marketing page. On Vercel, set **Root Directory** to `web`.

```bash
npm install
npm run dev
npm run build
npm run lint
```

`predev` and `prebuild` run `scripts/sync-testnet.mjs`. When `../deployments/testnet.json` and `../README.md` exist, the script refreshes `src/data/testnet.json` and checks the contract IDs, transaction hashes, and the test count. A Vercel build that only contains `web/` keeps the committed snapshot.

## Config

`src/config/site.ts`

- `APP_URL` — owner dashboard. Empty until the app is deployed. When set, the primary button is **Launch app** and links here.
- `DEMO_VIDEO_URL` — walkthrough. Empty while the video is still coming soon. When `APP_URL` is empty and this is set, the primary button is **View demo** and links here.
- When both are empty, **View demo** links to the in-page attack replay (`#attack`).
- The primary button never links to GitHub. GitHub is only the separate source button and the footer link.
- `BLOCKED_PAYMENT_HASH` — `null` until a refused payment is on testnet. The example receipt shows an em dash.

`DOCS_URL` may still point at the repository readme until a docs site exists. That is the Docs button, not the primary call to action.
