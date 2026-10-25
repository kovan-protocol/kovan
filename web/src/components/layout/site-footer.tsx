"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { DOCS_URL, GITHUB_URL } from "@/config/site";
import { Brand } from "@/components/marketing/primitives";
import { useCopy } from "@/components/marketing/preferences";

export function SiteFooter() {
  const t = useCopy();
  return <footer className="site-footer container">
    <div className="footer-top"><div><Link href="/" aria-label={t("Kovan home", "Kovan inicio")} className="brand-link"><Brand /></Link><p>{t("Agent autonomy. Human control.", "Autonomía para agentes. Control humano.")}</p></div>
      <nav aria-label={t("Footer navigation", "Navegación del pie")}>
        <Link href="/developers#faq">FAQ</Link>
        <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">{t("Documentation", "Documentación")}<ArrowUpRight size={14} /></a>
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub<ArrowUpRight size={14} /></a>
      </nav>
    </div>
    <div className="footer-bottom"><p>{t("Stellar testnet prototype. Not audited. Testnet USDC has no monetary value. Demos are simulations.", "Prototipo en Stellar testnet. Sin auditar. Los USDC de testnet no tienen valor monetario. Las demos son simulaciones.")}</p><span>© 2026 Kovan</span></div>
  </footer>;
}
