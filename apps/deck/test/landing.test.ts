import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The landing page lists the deck's modules by hand (it must not pull the deck's code in). This
// keeps the two from drifting: every module in the registry is on the page, and nothing else is.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const titles = (source: string, pattern: RegExp) => [...source.matchAll(pattern)].map((match) => match[1]!).sort();

test("the landing page lists exactly the deck's modules", () => {
  const registry = titles(read("../src/modules/registry.ts"), /\{ id: "[a-z0-9]+", title: "([^"]+)"/g);
  const landing = titles(read("../src/landing/Landing.tsx"), /\{ title: "([^"]+)", icon:/g);
  assert.equal(registry.length, 34);
  assert.deepEqual(landing, registry);
});

test("every screenshot the landing page shows is in the build", () => {
  const sources = read("../src/landing/Landing.tsx") + read("../src/landing/Showcase3D.tsx");
  const images = [...sources.matchAll(/landing\/([a-z0-9-]+\.jpg)`/g)].map((match) => match[1]!);
  assert.ok(images.length >= 8);
  for (const image of images) assert.ok(readFileSync(new URL(`../public/landing/${image}`, import.meta.url)).byteLength > 10_000, image);
});

test("the dock's groups are the landing page's disciplines, with the same modules in each", () => {
  const registry = read("../src/modules/registry.ts");
  const dock = new Map<string, string[]>();
  for (const match of registry.matchAll(/\{ id: "[a-z0-9]+", title: "([^"]+)", icon: \w+, group: "([^"]+)"/g)) dock.set(match[2]!, [...(dock.get(match[2]!) ?? []), match[1]!].sort());
  const landing = new Map<string, string[]>();
  for (const block of read("../src/landing/Landing.tsx").split(/\{ name: "/).slice(1)) {
    const name = block.slice(0, block.indexOf('"'));
    const tools = [...block.matchAll(/\{ title: "([^"]+)", icon:/g)].map((match) => match[1]!).sort();
    if (tools.length) landing.set(name, tools);
  }
  assert.deepEqual([...dock.keys()].sort(), [...landing.keys()].sort());
  for (const [name, tools] of dock) assert.deepEqual(tools, landing.get(name), name);
});
