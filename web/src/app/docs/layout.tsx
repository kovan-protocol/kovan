import { DocsSidebar } from "@/components/docs/docs-sidebar";
import { docPages } from "@/components/docs/doc-page";
import "./docs.css";

export default function DocsLayout({ children }: LayoutProps<"/docs">) {
  return (
    <main className="page-main" id="main" tabIndex={-1}>
      <div className="container docs-shell">
        <DocsSidebar items={docPages.map(({ href, title }) => ({ href, title }))} />
        {children}
      </div>
    </main>
  );
}
