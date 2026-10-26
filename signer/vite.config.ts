import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // Relative asset paths: the page is served from /kovan/ on GitHub Pages.
  base: "./",
  // One copy of the Stellar SDK, even though @kovan/sdk is linked from ../sdk.
  resolve: { dedupe: ["@stellar/stellar-sdk", "buffer"] },
  // The deployment record lives outside this folder.
  server: { fs: { allow: [".."] } },
  build: { target: "es2022" },
  plugins: [
    {
      // Publish the agent guide next to the page, so one site serves both.
      name: "agent-guide",
      closeBundle() {
        copyFileSync(here("src/fonts/OFL.txt"), here("dist/fonts-OFL.txt"));
        copyFileSync(here("../skills/kovan/SKILL.md"), here("dist/agent.md"));
        copyFileSync(here("../skills/kovan/scripts/kovan.mjs"), here("dist/kovan.mjs"));
        copyFileSync(here("../skills/kovan/scripts/wait-for-result.mjs"), here("dist/wait-for-result.mjs"));
      },
    },
  ],
});
