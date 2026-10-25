# Components

The marketing site uses separate Next.js routes, shared English/Spanish preferences and light/dark themes. The active styles are in `src/app/marketing.css`; the original blue identity and brand mark are preserved.

The visual system and flow illustration are custom code. No third-party marketing design, imagery, customer logos or testimonials were copied.

| Piece | Location |
| --- | --- |
| Home, workflow, benefits and demo pages | `src/components/marketing/site-pages.tsx` |
| Security, deployment evidence and FAQ | `src/components/marketing/technical-pages.tsx` |
| Product film and scene controls | `src/components/marketing/product-flow.tsx` and `.css` |
| Scoped GSAP film timeline | `src/components/marketing/use-product-film.ts` |
| Allocation, policy and recovery animations | `src/components/marketing/principle-motion.tsx` and `.css` |
| Interactive payment simulator | `src/components/marketing/playground.tsx` and `.css` |
| Language and appearance preferences | `src/components/marketing/preferences.tsx` |
| Shared actions, brand and reveals | `src/components/marketing/primitives.tsx` |
| Navigation and footer | `src/components/layout/site-nav.tsx`, `site-footer.tsx` |
| Native page transitions | `src/components/layout/route-transition.tsx` and `.css` |

The hero uses a scoped 24-second GSAP timeline with four six-second scenes, perspective transforms, sequenced UI panels and payment verification. The workflow page selects completed scenes through `activeStep`. Three CSS/SVG loops illustrate the principles. Native reveals run once; scrolling stays native. Chapter, pause and replay controls are keyboard accessible. The shared `html[data-motion="paused"]` preference pauses the film and principle loops; offscreen and hidden-tab observers stop playback. `prefers-reduced-motion` shows completed scenes without autoplay and preserves chapter navigation. GSAP contexts, observers and navigation tweens are cleaned up on unmount.

The film's central object is an agent smart-account node: a network symbol, agent identity and explicit budget within a segmented covenant boundary. It represents a software account, not a payment card or issued token.

React 19.3 `ViewTransition` coordinates page exit/entry with Next's native navigation. The persistent header stays still; history, prefetching, route caching and scroll restoration keep their native behavior. Browsers without view-transition support use the existing page-entry fallback. Reduced motion and the global pause preference disable the route animation.

The simulator reuses `src/lib/simulator.ts` and native form controls. Animations and simulator balances are illustrative. Recorded testnet evidence is read from the existing data files and linked from the developer page.

The old `design/`, `prototype.css`, `hero-stage.css`, motion components and original sections remain as references. They are not imported by the active marketing routes.
