import Link from "next/link";
import { notFound } from "next/navigation";
import docs from "@/data/docs.generated.json";

export type DocMeta = { slug: string; href: string; title: string; description: string };

export const docPages: DocMeta[] = docs.pages.map(({ slug, href, title, description }) => ({ slug, href, title, description }));

export function docBySlug(slug: string) {
  return docs.pages.find((p) => p.slug === slug);
}

/** Renders one generated page. HTML comes from the repository's own Markdown (scripts/build-docs.mjs). */
export function DocPage({ slug }: { slug: string }) {
  const index = docs.pages.findIndex((p) => p.slug === slug);
  if (index < 0) notFound();
  const page = docs.pages[index];
  const prev = docs.pages[index - 1];
  const next = docs.pages[index + 1];
  return (
    <div className="docs-main">
      <article className="docs-prose">
        <div dangerouslySetInnerHTML={{ __html: page.html }} />
        <nav className="docs-pager" aria-label="Previous and next page">
          {prev ? <Link href={prev.href} className="docs-pager-prev"><span>Previous</span>{prev.title}</Link> : <span />}
          {next ? <Link href={next.href} className="docs-pager-next"><span>Next</span>{next.title}</Link> : <span />}
        </nav>
        <p className="docs-edit">
          <a href={`https://github.com/kovan-protocol/kovan/blob/main/web/content/docs/${page.slug}.md`} target="_blank" rel="noopener noreferrer">Edit this page on GitHub</a>
        </p>
      </article>
      {page.toc.length > 1 && (
        <aside className="docs-toc" aria-label="On this page">
          <p className="eyebrow">ON THIS PAGE</p>
          <ul>
            {page.toc.map((h) => (
              <li key={h.id} className={h.depth === 3 ? "docs-toc-sub" : undefined}><a href={`#${h.id}`}>{h.text}</a></li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
