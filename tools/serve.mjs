import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "parse5";

// Which exported app to serve. Lets the old demo and the new workbench run side by side during the
// migration, so both Playwright projects can exercise their own app in one CI run.
const app = process.env.SERVE_APP ?? "deck";
const root = fileURLToPath(new URL(`../apps/${app}/out/`, import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".txt": "text/plain", ".ico": "image/x-icon" };

function scriptHashes(html) {
  const hashes = [];
  function visit(node) {
    if (node.nodeName === "script" && !node.attrs.some((attribute) => attribute.name === "src")) {
      const text = node.childNodes.map((child) => child.value ?? "").join("");
      hashes.push(`'sha256-${createHash("sha256").update(text).digest("base64")}'`);
    }
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(parse(html));
  return hashes;
}

createServer(async (request, response) => {
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const path = resolve(root, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) {
      response.writeHead(403).end();
      return;
    }
    const data = await readFile(path);
    const hashes = extname(path) === ".html" ? scriptHashes(data.toString()) : [];
    response.writeHead(200, {
      "Content-Type": `${types[extname(path)] ?? "application/octet-stream"}; charset=utf-8`,
      "Content-Length": data.byteLength,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      // wasm-unsafe-eval: the meshopt decoder for the component models is WebAssembly. It allows
      // compiling wasm only; JavaScript eval stays blocked.
      "Content-Security-Policy": `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' ${hashes.join(" ")}; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'`,
      "Cache-Control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : data);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(Number(process.env.PORT ?? 3100), "127.0.0.1", () => {
  console.log(`Static ${app}: http://127.0.0.1:${process.env.PORT ?? 3100}`);
});