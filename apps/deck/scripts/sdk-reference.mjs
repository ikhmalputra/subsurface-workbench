// Writes src/developers/sdk-exports.json: every entry point of the two SDK packages (read from their
// package.json export maps) and every name each one exports at runtime, imported from the built
// packages. The Developers page lists these, so the reference cannot claim an export that is not
// there or miss one that is. `--check` fails instead of writing when the file is out of date.
import { readFileSync, writeFileSync } from "node:fs";

const packages = ["core", "react"];
const target = new URL("../src/developers/sdk-exports.json", import.meta.url);

/** "function" | "component" | "hook" | "class" | "value", from the runtime value and its name. */
function kindOf(pkg, name, value) {
  if (typeof value !== "function") return "value";
  if (/^use[A-Z]/.test(name)) return "hook";
  if (/^[A-Z]/.test(name)) return pkg === "react" && !/Error$|Registry$|Picker$/.test(name) ? "component" : "class";
  return "function";
}

export async function buildReference() {
  const result = [];
  for (const pkg of packages) {
    const manifest = JSON.parse(readFileSync(new URL(`../../../packages/${pkg}/package.json`, import.meta.url), "utf8"));
    for (const entry of Object.keys(manifest.exports)) {
      if (entry.includes("*") || entry.endsWith(".css")) continue;
      const specifier = manifest.name + entry.slice(1);
      const module = await import(specifier);
      const names = Object.keys(module).filter((name) => name !== "default").sort((a, b) => a.localeCompare(b));
      result.push({
        package: manifest.name,
        entry: specifier,
        exports: names.map((name) => ({ name, kind: kindOf(pkg, name, module[name]) })),
        ...(names.length === 0 && "default" in module ? { defaultOnly: true } : {}),
      });
    }
  }
  // Each package's root entry first, then its subpaths alphabetically.
  return result.sort((a, b) => a.package.localeCompare(b.package) || (a.entry === a.package ? -1 : b.entry === b.package ? 1 : a.entry.localeCompare(b.entry)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = `${JSON.stringify(await buildReference(), null, 1)}\n`;
  if (process.argv.includes("--check")) {
    if (readFileSync(target, "utf8") !== text) { console.error("sdk-exports.json is out of date: run `pnpm --filter deck sdk:reference`."); process.exit(1); }
  } else writeFileSync(target, text);
}
