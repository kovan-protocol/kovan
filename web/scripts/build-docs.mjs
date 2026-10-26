// Builds the docs from content/docs/*.md:
//   src/data/docs.generated.json  pages for /docs (HTML + table of contents)
//   public/llms.txt               index for AI agents (llmstxt.org)
//   public/llms-full.txt          every page as one Markdown file
// Runs before dev and build. The Markdown files are the only source to edit.
import { readFile, writeFile } from "node:fs/promises";
import { Marked } from "marked";

const SITE = "https://kovan-protocol.vercel.app";
const ORDER = ["index", "quickstart", "concepts", "agent-tool", "sdk", "contracts", "x402", "security"];
const here = (p) => new URL(p, import.meta.url);

const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const href = (slug) => (slug === "index" ? "/docs" : `/docs/${slug}`);
// Table-of-contents entries are rendered as React text, so strip tags and decode entities.
const ENTITIES = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'" };
const plainText = (html) => html.replace(/<[^>]+>/g, "").replace(/&(lt|gt|amp|quot|#39);/g, (m) => ENTITIES[m]);

function frontmatter(src, file) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(src);
  if (!m) throw new Error(`${file}: missing frontmatter`);
  const meta = Object.fromEntries(m[1].split("\n").map((l) => {
    const i = l.indexOf(":");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"(.*)"$/, "$1")];
  }));
  if (!meta.title || !meta.description) throw new Error(`${file}: title and description are required`);
  return { meta, body: src.slice(m[0].length) };
}

function render(markdown) {
  const toc = [];
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const id = slugify(text);
        if (depth === 2 || depth === 3) toc.push({ id, text: plainText(text), depth });
        if (depth === 1) return `<h1>${text}</h1>\n`;
        return `<h${depth} id="${id}"><a class="docs-anchor" href="#${id}">${text}</a></h${depth}>\n`;
      },
      link({ href: url, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const external = /^https?:\/\//.test(url);
        const t = title ? ` title="${title}"` : "";
        return external ? `<a href="${url}"${t} target="_blank" rel="noopener noreferrer">${text}</a>` : `<a href="${url}"${t}>${text}</a>`;
      },
      table(token) {
        // Wide tables scroll inside their own box instead of the page.
        return `<div class="docs-table">${this.constructor.prototype.table.call(this, token)}</div>`;
      },
    },
  });
  return { html: marked.parse(markdown), toc };
}

const pages = [];
for (const slug of ORDER) {
  const file = `content/docs/${slug}.md`;
  const { meta, body } = frontmatter(await readFile(here(`../${file}`), "utf8"), file);
  pages.push({ slug, href: href(slug), title: meta.title, description: meta.description, body, ...render(body) });
}

await writeFile(here("../src/data/docs.generated.json"),
  JSON.stringify({ pages: pages.map(page => Object.fromEntries(Object.entries(page).filter(([key]) => key !== "body"))) }, null, 2) + "\n");

const llms = `# Kovan

> Shared USDC budgets AI agents can't overspend. An owner locks USDC in a pool on Stellar testnet; each agent gets a smart account bound by an on-chain covenant (allowed payees, per-payment and total caps, expiry). Agents prepare transactions with kovan.mjs; owners approve in Freighter.

Stellar testnet only. Not audited.

## Docs

${pages.map((p) => `- [${p.title}](${SITE}${p.href}): ${p.description}`).join("\n")}

## For agents

- [Agent guide (skill)](https://kovan-protocol.vercel.app/agent.md): rules and step-by-step recipes for agents
- [kovan.mjs](https://kovan-protocol.vercel.app/kovan.mjs): the one-file agent tool (Node 20+)
- [Signing page](https://kovan-protocol.vercel.app/sign): for agents that can't serve a local approval page
- [Deployment record](https://raw.githubusercontent.com/kovan-protocol/kovan/main/deployments/testnet.json): contract IDs and code hashes

## Optional

- [All docs in one file](${SITE}/llms-full.txt)
- [Source code](https://github.com/kovan-protocol/kovan)
`;
await writeFile(here("../public/llms.txt"), llms);

const full = `# Kovan docs (all pages)\n\nSource: ${SITE}/docs · Stellar testnet only · Not audited\n\n` +
  pages.map((p) => `<!-- ${SITE}${p.href} -->\n${p.body.trim()}\n`).join("\n---\n\n");
await writeFile(here("../public/llms-full.txt"), full);

console.log(`docs: ${pages.length} pages, llms.txt, llms-full.txt`);
