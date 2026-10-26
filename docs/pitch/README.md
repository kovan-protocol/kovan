# Kovan pitch deck

Updated 26 October 2026 for HackMeridian judges and demo day.

- [Main deck — editable PowerPoint](kovan-pitch-deck.pptx): the official five-section sequence, with Kovan branding.
- [Main deck — PDF](kovan-pitch-deck.pdf): presentation-ready rendering with the brand fonts embedded.
- [Judge backup — editable PowerPoint](kovan-judge-backup.pptx) and [PDF](kovan-judge-backup.pdf): seven optional technical/product slides.
- [Browser presentation](kovan-pitch-deck.html): all 12 slides, offline fonts, keyboard navigation and presenter notes. Arrow keys move; **N** toggles notes; **B** switches between pitch and backup.
- [Pitch script and Q&A](PITCH.md): roughly three minutes including a 65-second demo, plus evidence links and answers to judge questions.
- [Contact sheet](contact-sheet.jpg): all slides in one image.

The original file in `/tmp/claude-1000/.../scratchpad/kovan-pitch-deck.pptx` is preserved. These are new files. No contracts, deployment configuration, balances, application source or existing work were changed by the deck task.

## What changed

The main presentation retains cover → solution → PMF → technical workflow → team. Kovan's two-polygon mark, lowercase wordmark, Manrope/Inter/JetBrains Mono typography, blue accent and light/dark brand surfaces replace the generic content treatment. HackMeridian's event logo remains.

The solution uses a pool/agent diagram and a covenant summary. PMF now identifies an initial customer and the workflow problem; it does not suggest that customer demand has already been proven. The technical slide gives a reproducible pay → refuse → recover story. Expanded notes explain the demonstration and its limitations.

The backup covers the actual dashboard UI, authorization, pool accounting, delivery status, scoped evidence, agent integration and judge questions. The dashboard screenshot is explicitly labeled as real UI with illustrative API fixtures.

## Open items

Team names and roles remain open, as requested. Add those before presenting or introduce the team verbally. The close invites builder feedback; no funding amount, customers, revenue or commercial commitments have been invented.

Rehearse the demo against the exact deployment you will show. Existing USDC x402 receipts and the isolated v2 XLM lifecycle are separate runs. Yield and native mandates are described as locally tested, not deployed. The public website's playground is a simulation; use the actual console for live transactions.

## Evidence and sources

Repository sources inspected for this revision:

- `brand.md`, `web/src/app/marketing.css`, `web/src/components/marketing/primitives.tsx`: visual identity.
- `README.md`: core behavior, current default deployment and historical USDC receipts.
- `docs/SDK.md`: isolated v2 testnet XLM lifecycle and SDK distribution status.
- `docs/MANDATES.md`: undeployed native mandate implementation and documented test snapshot.
- `docs/YIELD.md`: undeployed DeFindex integration, liquidity and valuation limitations.
- `docs/SUBMISSION_FORM.md`: event context, prior-work disclosure and proposed next steps.

The **490** local tests on the backup slide are the documented 26 October snapshot: 151 contracts + 266 dashboard + 73 SDK. The count excludes one ignored optional fixture test. It includes undeployed work and was not independently rerun for this presentation.

Official external references checked on 26 October 2026:

- [Stellar x402 documentation](https://developers.stellar.org/docs/build/agentic-payments/x402/): per-request HTTP payments, authorization signing and supported assets.
- [OpenZeppelin smart-account policies](https://docs.openzeppelin.com/stellar-contracts/accounts/policies): policy enforcement during authorization.
- [Circle: USDC on Stellar](https://www.circle.com/multi-chain-usdc/stellar): native USDC support. No dated market-size figures from this page are used.

Transaction links and detailed caveats are embedded in the PowerPoint speaker notes and [PITCH.md](PITCH.md). Records were taken from the project's evidence register; the deck task did not submit transactions or independently re-query Stellar RPC.

## Editorial review for demo day

These are editorial judgments, not external scores:

| Dimension | Score | Remaining improvement |
| --- | --- | --- |
| Innovation | 8/10 | Show shared-budget accounting and recovery together. |
| Technical execution | 8/10 | Rehearse one fresh sequence on the deployment used on stage. |
| Completeness | 7/10 | Keep local-only extensions out of the live demo until activated and verified. |
| Blockchain necessity | 9/10 | Demonstrate rejection by the account authorization path. |
| Presentation | 8/10 | Fill team credits; practice the three-minute timing. |

## Editing and rebuilding

PowerPoint text, shapes and diagrams remain editable. Install Manrope, Inter and JetBrains Mono for faithful editing; the PDF has the rendered fonts embedded and the HTML embeds WOFF2 fonts. Do not assume another slide application will preserve line breaks if it substitutes fonts.

Run `python3 docs/pitch/build_deck.py` from the repository root. Dependencies are `python-pptx`, `fontTools` with WOFF2 support, and Pillow. The builder reads the existing licensed font assets from `signer/src/fonts/` and writes its temporary font/rendering configuration under `/tmp/kovan-pitch-work`.

The two HackMeridian logos were extracted from the supplied deck. The dashboard screenshot comes from the existing browser review fixture capture. No generated product imagery or fabricated financial activity is used.
