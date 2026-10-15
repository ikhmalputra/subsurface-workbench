import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "parse5";
import { gzipSync } from "node:zlib";

// Which exported app to serve. Lets the old demo and the new workbench run side by side during the
// migration, so both Playwright projects can exercise their own app in one CI run.
const app = process.env.SERVE_APP ?? "deck";
const root = fileURLToPath(new URL(`../apps/${app}/out/`, import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".json": "application/json", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".txt": "text/plain", ".ico": "image/x-icon" };

// Text and raw data shrink several times under gzip; the meshopt models and images are already
// compressed. Each file is compressed once per version and kept, so a slow link (a tunnel, a
// remote viewer) moves a fraction of the bytes.
const compressible = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".txt", ".las", ".sgy", ".i8"]);
const gzipped = new Map();
function gzipOf(path, data) {
  // Keyed by content, not size: a rebuilt page can keep its length and change its asset hashes.
  const key = `${path}:${createHash("sha1").update(data).digest("hex")}`;
  if (!gzipped.has(key)) gzipped.set(key, gzipSync(data, { level: 6 }));
  return gzipped.get(key);
}

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
    // A page's folder without its slash ("/deck") goes to the page ("/deck/").
    if (!pathname.endsWith("/") && !extname(pathname)) {
      response.writeHead(301, { Location: `${pathname}/` }).end();
      return;
    }
    const path = resolve(root, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
    if (!path.startsWith(root.endsWith(sep) ? root : root + sep)) {
      response.writeHead(403).end();
      return;
    }
    const raw = await readFile(path);
    const hashes = extname(path) === ".html" ? scriptHashes(raw.toString()) : [];
    const gzip = compressible.has(extname(path)) && /\bgzip\b/.test(request.headers["accept-encoding"] ?? "");
    const data = gzip ? gzipOf(path, raw) : raw;
    response.writeHead(200, {
      "Content-Type": `${types[extname(path)] ?? "application/octet-stream"}; charset=utf-8`,
      "Content-Length": data.byteLength,
      ...(gzip ? { "Content-Encoding": "gzip" } : {}),
      Vary: "Accept-Encoding",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      // wasm-unsafe-eval: the meshopt decoder for the component models is WebAssembly. It allows
      // compiling wasm only; JavaScript eval stays blocked.
      "Content-Security-Policy": `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' ${hashes.join(" ")}; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'`,
      // Vite's hashed bundles never change under one name; everything else is re-read every time.
      "Cache-Control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : data);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(Number(process.env.PORT ?? 3100), "127.0.0.1", () => {
  console.log(`Static ${app}: http://127.0.0.1:${process.env.PORT ?? 3100}`);
});