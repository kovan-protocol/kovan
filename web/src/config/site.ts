/**
 * Single config for the primary call to action and media that is not live yet.
 *
 * APP_URL — owner dashboard. Leave "" until the app is deployed.
 *   Set  → button label "Launch app", href = APP_URL.
 *   Empty → button label "View demo".
 * DEMO_VIDEO_URL — walkthrough video. Leave "" while it is still coming soon.
 *   Set  → "View demo" links here.
 *   Empty → "View demo" links to the interactive playground.
 *
 * The primary CTA must never point at GitHub. GitHub is only the separate
 * source button (nav is Docs + primary; the closing row and footer link the repo).
 */

export const APP_URL = "";

/** Empty while the walkthrough video is still coming soon. */
export const DEMO_VIDEO_URL = "";

/** Interactive demo used when APP_URL and DEMO_VIDEO_URL are both empty. */
export const DEMO_REPLAY_HREF = "/playground";

export const DOCS_URL = "/docs";

/** Production origin, for robots.txt and sitemap.xml. Keep in sync with SITE in scripts/build-docs.mjs. */
export const SITE_URL = "https://kovan-protocol.vercel.app";

export const GITHUB_URL = "https://github.com/kovan-protocol/kovan";

export const GITHUB_LABEL = "kovan-protocol/kovan";

/**
 * Blocked-payment transaction. null until the refusal is recorded on testnet.
 * The example receipt renders an em dash; it never invents a hash.
 */
export const BLOCKED_PAYMENT_HASH: string | null = null;

export type PrimaryCta = {
  label: "Launch app" | "View demo";
  href: string;
  external: boolean;
  kicker: string;
  detail: string;
};

export function primaryCta(): PrimaryCta {
  let cta: PrimaryCta;

  if (APP_URL) {
    cta = {
      label: "Launch app",
      href: APP_URL,
      external: true,
      kicker: "App",
      detail: "Owner dashboard on Stellar testnet",
    };
  } else if (DEMO_VIDEO_URL) {
    cta = {
      label: "View demo",
      href: DEMO_VIDEO_URL,
      external: /^https?:\/\//.test(DEMO_VIDEO_URL),
      kicker: "Demo",
      detail: "Watch the walkthrough",
    };
  } else {
    cta = {
      label: "View demo",
      href: DEMO_REPLAY_HREF,
      external: false,
      kicker: "Demo",
      detail: "Interactive covenant simulation",
    };
  }

  if (cta.href.includes("github.com")) {
    throw new Error(
      "Primary CTA must not link to GitHub. Set APP_URL or DEMO_VIDEO_URL in src/config/site.ts.",
    );
  }

  return cta;
}
