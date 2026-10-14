import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The deck is one interactive page with nothing to render on a server, so it is a plain Vite SPA.
// It builds into out/ so tools/serve.mjs (SERVE_APP=deck) serves it with the project's CSP.
export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ["react", "react-dom", "three"] },
  server: { port: 5180, strictPort: true },
  build: { outDir: "out", emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 4000 },
});
