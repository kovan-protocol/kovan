import type { MetadataRoute } from "next";
import { docPages } from "@/components/docs/doc-page";
import { SITE_URL } from "@/config/site";

const pages = ["/", "/how-it-works", "/why-kovan", "/security", "/developers", "/playground", "/agent-example"];

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...pages.map((path) => ({ url: `${SITE_URL}${path}`, priority: path === "/" ? 1 : 0.7 })),
    ...docPages.map((p) => ({ url: `${SITE_URL}${p.href}`, priority: p.slug === "index" ? 0.9 : 0.8 })),
  ];
}
