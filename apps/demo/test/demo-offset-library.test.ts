import assert from "node:assert/strict";
import test from "node:test";
import { exampleWellBrief } from "@ikhmalputra/subsurface-core/well-design";
import { forgeOffsetWell, offsetFromBrief } from "@ikhmalputra/subsurface-core/offset-wells";
import { loadSavedOffsetLibrary, parseSavedOffsetLibrary, serializeSavedOffsetLibrary } from "../src/lib/demo-offset-library.ts";

const saved = offsetFromBrief(exampleWellBrief(), { id: "user-test-well", name: "Test well", notes: ["locally authored"] });
const stored = JSON.parse(serializeSavedOffsetLibrary([saved])).offsets[0];

test("versioned saved offset library round-trips user well designs", () => {
  const serialized = serializeSavedOffsetLibrary([saved]);
  assert.equal(JSON.parse(serialized).version, 1);
  const [loaded] = parseSavedOffsetLibrary(serialized);
  assert.equal(loaded?.id, saved.id);
  assert.equal(loaded?.name, saved.name);
  assert.equal(loaded?.provenance, "user");
  assert.deepEqual(loaded?.notes, saved.notes);
  assert.deepEqual(loaded?.brief, saved.brief);
  assert.deepEqual(loaded?.asDrilled, []);
});

test("only user-authored offsets are persisted", () => {
  assert.deepEqual(parseSavedOffsetLibrary(serializeSavedOffsetLibrary([])), []);
  assert.deepEqual(parseSavedOffsetLibrary(serializeSavedOffsetLibrary([saved, forgeOffsetWell])), [saved]);
});

test("migrates valid unversioned user-offset arrays to the versioned document", () => {
  const loaded = loadSavedOffsetLibrary(JSON.stringify([saved]));
  assert.equal(loaded.offsets[0]?.id, saved.id);
  assert.equal(loaded.offsets[0]?.provenance, "user");
  assert.equal(JSON.parse(loaded.migratedDocument ?? "null").version, 1);
});

test("empty, corrupt, unsupported, and structurally invalid libraries fail explicitly", () => {
  assert.deepEqual(parseSavedOffsetLibrary(null), []);
  assert.throws(() => parseSavedOffsetLibrary("{"), /not valid JSON/);
  assert.throws(() => parseSavedOffsetLibrary(JSON.stringify({ version: 2, offsets: [] })), /version 2 is not supported/);
  assert.throws(() => parseSavedOffsetLibrary(JSON.stringify({ version: 1, offsets: [null] })), /must be an object/);
  assert.throws(() => parseSavedOffsetLibrary(JSON.stringify({ version: 1, offsets: [{ ...stored, brief: { identity: {}, geology: {}, sections: [] } }] })), /location is required/);
  assert.throws(() => parseSavedOffsetLibrary(JSON.stringify({ version: 1, offsets: [{ ...stored, brief: { ...saved.brief, totalDepthMdM: null } }] })), /totalDepthMdM must be a finite number/);
  assert.throws(() => parseSavedOffsetLibrary(JSON.stringify({ version: 1, offsets: [{ ...stored, brief: { ...saved.brief, trajectory: [{ mdM: 10, inclinationDeg: 0, azimuthDeg: 0 }, { mdM: 5, inclinationDeg: 0, azimuthDeg: 0 }] } }] })), /strictly increasing/);
  assert.throws(() => parseSavedOffsetLibrary(JSON.stringify([{ ...saved, provenance: "documented" }])), /provenance must be "user"/);
});

test("duplicate user IDs are rejected before persistence or use", () => {
  assert.throws(() => serializeSavedOffsetLibrary([saved, saved]), /duplicate ID/);
  assert.throws(() => parseSavedOffsetLibrary(JSON.stringify({ version: 1, offsets: [stored, stored] })), /duplicate ID/);
});
