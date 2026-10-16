import assert from "node:assert/strict";
import test from "node:test";
import { kestrelSite } from "@ikhmalputra/subsurface-react";
import { initialLayout } from "../src/modules/registry.ts";
import { SHARE_KEY, decodeSharedDeck, encodeSharedDeck, sharedPayload, validateSharedDeck } from "../src/deck/share-codec.ts";
import type { SharedDeck } from "../src/deck/share-codec.ts";

const forge: SharedDeck = {
  v: 1, site: { id: "forge", well: null }, tiles: initialLayout as SharedDeck["tiles"], stage: "globe",
  component: "forge-casing-intermediate", md: 2412, window: [2000, 2600], brush: [2380, 2440], time: Date.UTC(2020, 10, 22),
  slices: { inline: 120, crossline: null, depth: null }, sectionLine: [[-112.9, 38.5], [-112.88, 38.51]], fusions: { "logs>well3d": "GR" },
  whatIf: null, carried: null,
};

test("a shared deck survives the link: encoded, read back, every field the same", async () => {
  const payload = await encodeSharedDeck(forge);
  assert.match(payload, /^[A-Za-z0-9_-]+$/, "base64url only, so it sits in a fragment unescaped");
  assert.deepEqual(await decodeSharedDeck(payload), forge);
});

test("a planned well rides in the link and stays a short link", async () => {
  const kestrel = kestrelSite();
  const shared: SharedDeck = { ...forge, site: { id: "kestrel", well: null }, time: null, carried: { kind: "design", builtIn: true, value: { brief: kestrel.brief, hydraulics: { sectionId: "production", flowGpm: 450, nozzles32nds: [12, 12, 12, 13], pipeOdIn: 5 } } } };
  const payload = await encodeSharedDeck(shared);
  const back = await decodeSharedDeck(payload);
  assert.deepEqual(back.carried, shared.carried);
  // Deflate keeps a whole design well inside what chat apps and mail carry.
  assert.ok(payload.length < 16_000, `${payload.length} characters`);
  assert.ok(payload.length < JSON.stringify(shared).length, "compressed");
});

test("a cut or changed link says so instead of opening something else", async () => {
  const payload = await encodeSharedDeck(forge);
  await assert.rejects(decodeSharedDeck(payload.slice(0, payload.length / 2)), /cut or changed/);
  await assert.rejects(decodeSharedDeck(`${payload}%20`), /cut or changed/);
});

test("a link from another version of the deck is refused in words", () => {
  assert.throws(() => validateSharedDeck({ ...forge, v: 2 }), /different version/);
  assert.throws(() => validateSharedDeck({ ...forge, tiles: { globe: { col: 0, row: 0, w: "8", h: 8 } } }), /different version/);
  assert.throws(() => validateSharedDeck({ ...forge, md: -5 }), /different version/);
  assert.throws(() => validateSharedDeck({ ...forge, carried: { kind: "recorded", value: { identity: {} } } }), /different version/);
});

test("older fields that are missing read as nothing set", () => {
  const bare: Record<string, unknown> = { ...forge };
  for (const key of ["slices", "sectionLine", "fusions", "whatIf", "carried"]) delete bare[key];
  const read = validateSharedDeck(bare);
  assert.equal(read.slices, null);
  assert.equal(read.sectionLine, null);
  assert.deepEqual(read.fusions, {});
  assert.equal(read.carried, null);
});

test("only a deck fragment is read as a shared deck", () => {
  assert.equal(sharedPayload(`#${SHARE_KEY}=abc_-1`), "abc_-1");
  assert.equal(sharedPayload(`${SHARE_KEY}=abc`), "abc");
  assert.equal(sharedPayload("#tools"), null);
  assert.equal(sharedPayload(""), null);
  assert.equal(sharedPayload(`#${SHARE_KEY}=a b`), null);
});
