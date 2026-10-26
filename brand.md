# Brand — Kovan

_Status: established from the home landing page_

Use the home landing page as the visual reference for the demo dashboard and agent-generated wallet approval pages: `web/src/app/marketing.css` and `web/src/components/marketing/primitives.tsx`.

## Palette

| Role | Light | Dark |
| --- | --- | --- |
| Background | `#fbfbfa` | `#07080b` |
| Surface | `#ffffff` | `#0f1217` |
| Secondary surface | `#f1f2f4` | `#191f2a` |
| Text | `#151a24` | `#edf0f6` |
| Secondary text | `#626977` | `#a0a9ba` |
| Border | `#e3e5e9` | `#29313f` |
| Primary blue | `#014cfe` | `#3d74ff` |
| Soft blue | `#eaf0ff` | `#15264a` |
| Blue text / focus | `#0346dc` | `#87aaff` |

Use blue for primary actions, links, and selection. Reserve red and green for error and success feedback. Default to the system theme; save an explicit choice under `kovan-theme` in local storage.

## Typography and layout

Manrope 600–800 for headings and the lowercase wordmark; Inter 400–700 for interface text; JetBrains Mono for addresses, code, and small technical labels. Use the two-polygon Kovan symbol from the landing page.

Use flat surfaces, fine borders, 6px control radii, and 8px card radii. Keep generous section spacing and one clear primary action per form. Controls are at least 40px tall. The dashboard content caps at 1280px; wallet approvals use a focused 720px column.

Voice: clear, specific, and calm. “Agent autonomy. Human control.” Explain what a request does before asking for wallet approval. Preserve transaction details, permission boundaries, errors, and signing confirmations when generating a new interface.

## Implementation references

- Dashboard semantic tokens: `dashboard/app/globals.css`; shared controls: `dashboard/components/ui/`.
- Both signer templates: `signer/src/style.css`, `signer/index.html`, and the page shell in `signer/src/cli.ts`.
- Signer fonts are local assets with their license in `signer/src/fonts/`. The CLI build embeds them; no external font requests are needed.
- After changing signer styles, run `npm run build:cli` from `signer/` to update the agent skill's distributed template.

_Aligned to the landing page: 2026-10-26_
