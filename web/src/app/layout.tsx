import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Manrope } from "next/font/google";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteNav } from "@/components/layout/site-nav";
import { RouteTransition } from "@/components/layout/route-transition";
import { CursorGlow } from "@/components/motion/cursor-glow";
import { SmoothScroll } from "@/components/motion/smooth-scroll";
import { PreferenceProvider, preferenceScript } from "@/components/marketing/preferences";
import "./globals.css";
import "./marketing.css";

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
  title: { default: "Kovan — Agent autonomy. Human control.", template: "%s | Kovan" },
  description:
    "One shared USDC pool. Clear on-chain spending rules for every AI agent. Explore the Kovan prototype on Stellar testnet.",
};

export const viewport: Viewport = {
  themeColor: "#FBFBFA",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${manrope.variable} ${inter.variable} ${jetbrains.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: preferenceScript }} /></head>
      <body>
        <PreferenceProvider>
          <SmoothScroll>
            <CursorGlow />
            <SiteNav />
            <RouteTransition>{children}</RouteTransition>
            <SiteFooter />
          </SmoothScroll>
        </PreferenceProvider>
      </body>
    </html>
  );
}
