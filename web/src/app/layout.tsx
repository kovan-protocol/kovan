import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Manrope } from "next/font/google";
import { CursorGlow } from "@/components/motion/cursor-glow";
import { Kick } from "@/components/motion/kick";
import { ProgressBar } from "@/components/motion/progress-bar";
import { SmoothScroll } from "@/components/motion/smooth-scroll";
import { SectionIndex } from "@/components/layout/section-index";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteNav } from "@/components/layout/site-nav";
import { Toaster } from "@/components/ui/toaster";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-manrope",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Kovan · Shared USDC budgets your AI agents can't overspend.",
  description:
    "One USDC pool. A smart-account wallet for every AI agent, bound by an on-chain covenant. Public beta on Stellar testnet.",
};

export const viewport: Viewport = {
  themeColor: "#07080B",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${manrope.variable} ${inter.variable} ${jetbrains.variable}`}>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(!matchMedia('(prefers-reduced-motion: reduce)').matches)document.documentElement.classList.add('js-anim')}catch(e){}",
          }}
        />
        <a className="skip" href="#main">
          Skip to content
        </a>
        <SmoothScroll>
          <ProgressBar />
          <div className="grain" aria-hidden />
          <CursorGlow />
          <Kick />
          <SectionIndex />
          <SiteNav />
          {children}
          <SiteFooter />
          <Toaster />
        </SmoothScroll>
      </body>
    </html>
  );
}
