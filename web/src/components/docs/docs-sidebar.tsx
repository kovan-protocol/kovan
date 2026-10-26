"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePreferences } from "@/components/marketing/preferences";

export function DocsSidebar({ items }: { items: { href: string; title: string }[] }) {
  const pathname = usePathname().replace(/\/$/, "") || "/";
  const { locale } = usePreferences();
  return (
    <nav className="docs-sidebar" aria-label="Documentation">
      <p className="eyebrow">DOCS</p>
      <ul>
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} aria-current={pathname === item.href ? "page" : undefined}>{item.title}</Link>
          </li>
        ))}
      </ul>
      {locale === "es" && <p className="docs-locale-note" lang="es">La documentación técnica está en inglés.</p>}
    </nav>
  );
}
