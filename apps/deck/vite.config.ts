import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";

// Three static pages with nothing to render on a server: the landing page at / (what the deck is and
// how to use it), the deck itself at /deck/, and the Developers page at /developers/ (the SDK the
// deck is built from). Both build into out/ so tools/serve.mjs
// (SERVE_APP=deck) serves them with the project's CSP.
export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom", "three"] },
  server: { port: 5180, strictPort: true },
  build: {
    outDir: "out", emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 4000,
    rollupOptions: { input: { landing: fileURLToPath(new URL("index.html", import.meta.url)), deck: fileURLToPath(new URL("deck/index.html", import.meta.url)), developers: fileURLToPath(new URL("developers/index.html", import.meta.url)) } },
  },
});
