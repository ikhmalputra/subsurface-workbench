import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
// @ts-expect-error: a plain .mjs build script without type declarations.
import { buildReference } from "../scripts/sdk-reference.mjs";
import { ENTRY_NOTES } from "../src/developers/entries.ts";
import { main as survey } from "../src/developers/examples/survey.ts";

// The Developers page shows source files as the code to copy and runs those same files. These
// tests keep that honest: the reference matches the built packages, the examples import only what
// the packages export, and the console example prints what the page shows.
type Entry = { entry: string; exports: { name: string }[] };
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const listed: Entry[] = JSON.parse(read("../src/developers/sdk-exports.json"));

test("the API reference is generated from the current packages", async () => {
  const current: Entry[] = await buildReference();
  assert.deepEqual(listed, current, "sdk-exports.json is out of date: run `pnpm --filter deck sdk:reference`");
  assert.ok(listed.length >= 30);
});

test("every entry point has a line saying what it is for, and no line outlives its entry", () => {
  assert.deepEqual(Object.keys(ENTRY_NOTES).sort(), listed.map((entry) => entry.entry).sort());
});

const sources = ["examples", "guides"].flatMap((folder) => readdirSync(new URL(`../src/developers/${folder}/`, import.meta.url)).map((file) => `${folder}/${file}`));

test("examples and guides import only React and the SDK, and only names the SDK exports", () => {
  assert.ok(sources.length >= 8);
  for (const file of sources) {
    const source = read(`../src/developers/${file}`);
    for (const match of source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)) {
      const [, names, specifier] = match;
      if (specifier === "react") continue;
      const entry = listed.find((candidate) => candidate.entry === specifier);
      assert.ok(entry, `${file} imports ${specifier}, which is not an SDK entry point`);
      if (/^import\s+type/.test(match[0])) continue;
      for (const raw of names!.split(",").map((name) => name.trim()).filter(Boolean)) {
        if (raw.startsWith("type ")) continue;
        const name = raw.split(/\s+as\s+/)[0]!;
        assert.ok(entry.exports.some((item) => item.name === name), `${file}: ${specifier} does not export ${name}`);
      }
    }
    assert.doesNotMatch(source, /from\s+"\.\.?\//, `${file} reaches into the page; an example must stand alone`);
  }
});

test("the survey example prints every station and the closure", () => {
  const lines: string[] = [];
  survey((line) => lines.push(line));
  assert.equal(lines.length, 6);
  assert.match(lines[0]!, /^\s+0 m MD\s+TVD\s+0\.0/);
  assert.match(lines.at(-1)!, /^TD [\d.]+ m TVD · closure [\d.]+ m at [\d.]+°/);
});
