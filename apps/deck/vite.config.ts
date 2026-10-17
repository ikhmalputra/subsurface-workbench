import { defineConfig } from "vite";
import type { Plugin } from "vite";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { CONTRACT_VERSION } from "../../packages/core/src/data-contract.ts";
import { CONFIG_SCHEMA_VERSION } from "../../packages/core/src/deck-config.ts";

/**
 * Raise when a release can no longer be reached in one step from an older one (a storage
 * migration path dropped, a config key removed): the deck and docs/UPGRADING.md both read it.
 */
const MIN_UPGRADE_FROM = "0.0.1";

/**
 * `version.json` beside the pages: the build the deck is, for the deck itself (it polls the file on
 * its own origin and offers a reload when a newer build appears), for /version.json on a server,
 * and for a release's verification. The same file is served by the dev server.
 */
function versionFile(): Plugin {
  const text = () => {
    const pkg = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as { version: string };
    let commit = "unknown";
    try { commit = execFileSync("git", ["rev-parse", "--short=9", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* a source archive without .git */ }
    return `${JSON.stringify({ version: pkg.version, commit, builtAt: new Date().toISOString(), schemas: { config: CONFIG_SCHEMA_VERSION, contract: CONTRACT_VERSION }, minUpgradeFrom: MIN_UPGRADE_FROM }, null, 2)}\n`;
  };
  return {
    name: "deck-version-file",
    generateBundle() { this.emitFile({ type: "asset", fileName: "version.json", source: text() }); },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?")[0] !== `${server.config.base}version.json`) { next(); return; }
        response.setHeader("content-type", "application/json");
        response.end(text());
      });
    },
  };
}

// Three static pages with nothing to render on a server: the landing page at / (what the deck is and
// how to use it), the deck itself at /deck/, and the Developers page at /developers/ (the SDK the
// deck is built from). Both build into out/ so tools/serve.mjs
// (SERVE_APP=deck) serves them with the project's CSP.
export default defineConfig({
  // "/" by default; DECK_BASE=/subsurface-workbench/ builds for GitHub Pages, which serves the site in a subfolder.
  base: process.env.DECK_BASE ?? "/",
  plugins: [react(), versionFile()],
  resolve: { dedupe: ["react", "react-dom", "three"] },
  server: { port: 5180, strictPort: true },
  build: {
    outDir: "out", emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 4000,
    rollupOptions: { input: { landing: fileURLToPath(new URL("index.html", import.meta.url)), deck: fileURLToPath(new URL("deck/index.html", import.meta.url)), developers: fileURLToPath(new URL("developers/index.html", import.meta.url)) } },
  },
});
