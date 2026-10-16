// Performance budgets for the built site (apps/deck/out): what each page downloads before it can
// draw, the largest chunk anything can pull in, the compute worker and the data files. Sizes are
// gzip, what actually crosses the network. Fails, naming every budget broken, when one is.
//
//   pnpm build && pnpm test:budget
//
// Runtime budgets (startup, main-thread blocking per module) are checked in a real browser by
// tools/bench-deck.mjs. Both read their numbers from tools/budgets.mjs.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { BUDGETS } from "./budgets.mjs";

const out = new URL("../apps/deck/out/", import.meta.url).pathname;
if (!existsSync(`${out}deck/index.html`)) { console.error("No build in apps/deck/out: run `pnpm build` first."); process.exit(1); }
const kb = (bytes) => bytes / 1024;
const gz = (file) => gzipSync(readFileSync(file)).length;
const broken = [], rows = [];
const check = (label, value, budget, unit) => { rows.push(`${value <= budget ? "ok  " : "OVER"} ${label.padEnd(44)} ${value.toFixed(unit === "MB" ? 1 : 0).padStart(7)} / ${budget} ${unit}`); if (value > budget) broken.push(`${label}: ${value.toFixed(1)} ${unit} over the ${budget} ${unit} budget`); };

for (const [page, budget] of Object.entries(BUDGETS.initialJs)) {
  const html = readFileSync(`${out}${page}`, "utf8");
  const files = [...new Set([...html.matchAll(/(?:src|href)="[^"]*?\/?assets\/([^"]+\.js)"/g)].map((m) => m[1]))];
  check(`${page} initial JS (${files.length} files)`, kb(files.reduce((sum, f) => sum + gz(`${out}assets/${f}`), 0)), budget, "kB");
}
const chunks = readdirSync(`${out}assets`).filter((f) => f.endsWith(".js"));
const largest = chunks.map((f) => [f, kb(gz(`${out}assets/${f}`))]).sort((a, b) => b[1] - a[1]);
for (const [file, size] of largest.filter(([f]) => !f.startsWith("worker-")).slice(0, 3)) check(`chunk ${file}`, size, BUDGETS.chunk, "kB");
for (const [file, size] of largest.filter(([f]) => f.startsWith("worker-"))) check(`worker ${file}`, size, BUDGETS.worker, "kB");
const data = existsSync(`${out}data`) ? readdirSync(`${out}data`).map((f) => [f, statSync(`${out}data/${f}`).size / 1e6]).sort((a, b) => b[1] - a[1]) : [];
for (const [file, size] of data.slice(0, 2)) check(`data ${file}`, size, BUDGETS.dataFile, "MB");

console.log(rows.join("\n"));
if (broken.length) { console.error(`\n${broken.length} budget${broken.length === 1 ? "" : "s"} broken:\n  ${broken.join("\n  ")}`); process.exit(1); }
console.log("\nEvery budget holds.");
