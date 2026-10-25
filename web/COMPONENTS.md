# Components

The landing page is a port of the Kovan v2 prototype (`design/index-v2.html`, notes in `design/NOTAS-UJ.md`). Scroll-linked motion uses GSAP 3.12.5 and ScrollTrigger, driven from the same ticker as Lenis, matching the prototype script. The hero dashboard is the #034 stage (`design/hero-dashboard.html`, `design/ESTILO-RAMP.md`).

Nothing was vendored from Magic UI, Aceternity, or 21st.dev. Border glow, grain, the dot field, and the aurora are in `src/app/prototype.css`.

| Piece | Where | Source | License |
| --- | --- | --- | --- |
| Smooth scroll | `src/components/motion/smooth-scroll.tsx` | [Lenis](https://github.com/darkroomengineering/lenis) 1.3 | MIT |
| Scroll triggers, split headlines, pin, counters, magnetic, cursor glow | `src/components/motion/kick.tsx`, `magnetic.tsx`, `cursor-glow.tsx`, `count-up.tsx`, `attack-replay.tsx` | [GSAP](https://github.com/greensock/GSAP) 3.12.5 and [@gsap/react](https://github.com/greensock/react) | MIT |
| Toasts on copy | `src/components/ui/toaster.tsx` | [sonner](https://github.com/emilkowalski/sonner), same role as the [shadcn Sonner](https://ui.shadcn.com/docs/components/sonner) block | MIT |

`prefers-reduced-motion` skips Lenis smoothing, the GSAP timeline, the attack pin, and the dashboard intro. Those `gsap.from` states are applied only when motion is allowed, so the page stays visible.

Radix packages are installed for future shadcn primitives. This page keeps the prototype controls (details, range, checkbox, tabs) so the 44px touch-target rules stay attached to those class names.
