import type { Metadata } from "next";
import { DocPage, docBySlug } from "@/components/docs/doc-page";

const page = docBySlug("index")!;
export const metadata: Metadata = { title: "Docs", description: page.description };

export default function Page() {
  return <DocPage slug="index" />;
}
