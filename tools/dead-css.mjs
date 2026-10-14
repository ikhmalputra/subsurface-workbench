// Report — and with --write, remove — CSS rules whose selectors name only classes that no source
// file mentions.
//
// Written after a purge run against a stale list left 78 dead rules behind and its own crash read
// as a clean result. So: the roots are checked before the walk, a missing one is fatal, and the
// parser respects the two things a naive one gets wrong — commas inside `:is(...)`, and braces
// inside comments.
//
//   node tools/dead-css.mjs            report
//   node tools/dead-css.mjs --write    remove them
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const SOURCE_ROOTS = ["packages/core/src", "packages/react/src", "tools"];
const SHEETS = ["packages/react/src/styles.css"];
const PREFIX = /\.((?:demo|sw|swb|swx)-[a-z0-9-]+)/g;

for (const path of [...SOURCE_ROOTS, ...SHEETS]) {
  if (!existsSync(path)) { console.error(`dead-css: ${path} does not exist. Fix this list before trusting the result.`); process.exit(2); }
}

const sources = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (["node_modules", "dist", ".next", "out"].includes(name)) continue;
    const path = join(dir, name);
    statSync(path).isDirectory() ? walk(path) : [".ts", ".tsx", ".mjs"].includes(extname(path)) && sources.push(path);
  }
};
for (const root of SOURCE_ROOTS) walk(root);
const code = sources.map((path) => readFileSync(path, "utf8")).join("\n");

/** Class names the source builds at runtime, e.g. `demo-view-${layout}`. Never reported dead. */
const stems = [...new Set([...code.matchAll(/((?:demo|sw|swb|swx)-[a-z0-9-]*?)\$\{/g)].map((m) => m[1]))].filter(Boolean);

/** Split a selector list on the commas that separate selectors, not the ones inside :is() or []. */
function splitSelectors(text) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out.map((selector) => selector.trim()).filter(Boolean);
}

/** Walk rules, carrying comments through untouched and recursing into at-rules. */
function purge(text, dead, removed) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const comment = text.indexOf("/*", i);
    const brace = text.indexOf("{", i);
    if (brace === -1) { out.push(text.slice(i)); break; }
    if (comment !== -1 && comment < brace) {
      const close = text.indexOf("*/", comment);
      if (close === -1) { out.push(text.slice(i)); break; }
      out.push(text.slice(i, close + 2));
      i = close + 2;
      continue;
    }
    const head = text.slice(i, brace);
    let depth = 0, j = brace;
    for (; j < text.length; j++) { if (text[j] === "{") depth++; else if (text[j] === "}") { depth--; if (!depth) break; } }
    const body = text.slice(brace + 1, j);
    const trimmed = head.trim();
    if (trimmed.startsWith("@")) {
      const inner = purge(body, dead, removed);
      if (inner.trim()) out.push(head + "{" + inner + "}");
    } else {
      const kept = splitSelectors(trimmed).filter((selector) => {
        const classes = [...selector.matchAll(PREFIX)].map((m) => m[1]);
        if (classes.length === 0 || !classes.every((name) => dead.has(name))) return true;
        removed.push(selector);
        return false;
      });
      if (kept.length) out.push(head.slice(0, head.length - head.trimStart().length) + kept.join(", ") + " {" + body + "}");
    }
    i = j + 1;
  }
  return out.join("");
}

const write = process.argv.includes("--write");
let removable = 0;
for (const sheet of SHEETS) {
  const css = readFileSync(sheet, "utf8");
  const classes = [...new Set([...css.matchAll(PREFIX)].map((m) => m[1]))];
  const dead = new Set(classes.filter((name) => !new RegExp(`\\b${name}\\b`).test(code) && !stems.some((stem) => name.startsWith(stem))));
  // A class no source names can still sit in a selector that targets something live, e.g.
  // `.sw-asm .sw-assembly-schematic`. The rule still applies, so only selectors whose classes are
  // ALL unnamed can go, and the honest number is selectors removed, not classes found.
  const removed = [];
  const next = purge(css, dead, removed);
  removable += removed.length;
  if (!removed.length) {
    console.log(`${sheet}: clean — ${classes.length} classes, nothing removable${dead.size ? `, ${dead.size} unnamed but inside live selectors` : ""}`);
    continue;
  }
  console.log(`${sheet}: ${removed.length} selectors name only classes no source file mentions`);
  console.log("  " + [...dead].sort().join(" "));
  if (write) {
    writeFileSync(sheet, next);
    console.log(`  removed, ${css.split("\n").length} → ${next.split("\n").length} lines`);
  }
}
if (!write && removable) console.log(`\n${removable} removable. Run with --write.`);
process.exit(write || !removable ? 0 : 1);
