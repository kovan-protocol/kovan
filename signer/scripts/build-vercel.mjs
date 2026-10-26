// Builds the hosted signing page into the website, which serves everything:
//   web/public/sign/           → https://kovan-protocol.vercel.app/sign
//   web/public/agent.md        → /agent.md        (the Kovan skill, for any agent)
//   web/public/kovan.mjs       → /kovan.mjs       (the agent tool)
//   web/public/wait-for-result.mjs
// Run from signer/ after building the SDK: npm run build:vercel. Commit the output.
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const pub = here("../../web/public/");

// vite.config.ts copies extra files into signer/dist for GitHub Pages; give it a place to write.
await mkdir(here("../dist"), { recursive: true });
await build({
  root: here(".."),
  base: "/sign/",
  logLevel: "warn",
  build: { outDir: `${pub}sign`, emptyOutDir: true },
});

await copyFile(here("../../skills/kovan/SKILL.md"), `${pub}agent.md`);
await copyFile(here("../../skills/kovan/SKILL.md"), `${pub}sign/agent.md`);
await copyFile(here("../../skills/kovan/scripts/kovan.mjs"), `${pub}kovan.mjs`);
await copyFile(here("../../skills/kovan/scripts/wait-for-result.mjs"), `${pub}wait-for-result.mjs`);
console.log("built web/public/sign and agent files");
