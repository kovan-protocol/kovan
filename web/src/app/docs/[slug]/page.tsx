import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocPage, docBySlug, docPages } from "@/components/docs/doc-page";

// Every page is prerendered; unknown slugs hit notFound() below.
// (`dynamicParams` isn't available with Cache Components.)
export function generateStaticParams() {
  return docPages.filter((p) => p.slug !== "index").map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/docs/[slug]">): Promise<Metadata> {
  const page = docBySlug((await params).slug);
  return page ? { title: `${page.title} · Docs`, description: page.description } : {};
}

export default async function Page({ params }: PageProps<"/docs/[slug]">) {
  const { slug } = await params;
  if (slug === "index" || !docBySlug(slug)) notFound();
  return <DocPage slug={slug} />;
}
