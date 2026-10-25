# Components

The landing page is a port of the Kovan v2 prototype. Motion is framer-motion plus Lenis. GSAP is not used, so the smooth-scroll ticker and the scroll-linked effects do not fight each other. Pinned attack playback is a sticky stage inside a tall scroll track, driven by scroll progress.

Nothing was vendored from Magic UI, Aceternity, or 21st.dev. Border glow, grain, the dot field, word reveals, and counters are implemented in `src/app/prototype.css` and `src/components/motion/` to match the prototype.

| Piece | Where | Source | License |
| --- | --- | --- | --- |
| Smooth scroll | `src/components/motion/smooth-scroll.tsx` | [Lenis](https://github.com/darkroomengineering/lenis) | MIT |
| Scroll-linked motion | `src/components/motion/drift.tsx`, `kick.tsx` | [Motion](https://github.com/framer/motion) | MIT |
| Toasts on copy | `src/components/ui/toaster.tsx` | [sonner](https://github.com/emilkowalski/sonner), same role as the [shadcn Sonner](https://ui.shadcn.com/docs/components/sonner) block | MIT |

Radix packages are installed for future shadcn primitives. This page keeps the prototype controls (details, range, checkbox, tabs) so the 44px touch-target rules stay attached to those class names.
