import assert from "node:assert/strict";
import test from "node:test";
import { forgeConstructionWells } from "./forge-construction.ts";
import { usSurveyFeetToMetres } from "./units.ts";

const well = (id: string) => forgeConstructionWells.find((entry) => entry.id === id)!;
const casing = (id: string, role: string) => well(id).components.find((component) => component.id === `${id}-${role}`)!;

test("the five FORGE neighbours are all here, documented, with a source on GDR", () => {
  assert.deepEqual(forgeConstructionWells.map((entry) => entry.id), ["16b", "58-32", "56-32", "78-32", "78b-32"]);
  for (const entry of forgeConstructionWells) {
    assert.equal(entry.provenance, "documented");
    assert.match(entry.source.url, /^https:\/\/gdr\.openei\.org\/files\//);
    assert.equal(entry.source.licence, "CC-BY-4.0");
  }
});

test("feet become metres with 1200/3937, as 16A's records do: 16B's 7 in shoe at 10,208 ft", () => {
  assert.equal(casing("16b", "production").bottomDepthM, 10208 * 1200 / 3937);
  assert.equal(casing("16b", "production").rawBottomDepthFt, 10208);
  assert.equal(well("16b").totalDepthM, usSurveyFeetToMetres(10947));
});

test("every string sits inside its well: shoes deepen as the casing narrows, all above TD; holes outsize their strings", () => {
  for (const entry of forgeConstructionWells) {
    const casings = entry.components.filter((component) => component.kind === "Casing").sort((a, b) => a.bottomDepthM - b.bottomDepthM);
    for (let index = 1; index < casings.length; index++) assert.ok(casings[index]!.outerDiameterMm! < casings[index - 1]!.outerDiameterMm!, `${entry.label}: ${casings[index]!.name} is narrower than the string outside it`);
    for (const string of casings) assert.ok(string.bottomDepthM <= entry.totalDepthM, `${entry.label}: ${string.name} above TD`);
    for (const hole of entry.components.filter((component) => component.kind === "Hole")) {
      const inside = casings.filter((string) => string.bottomDepthM > hole.topDepthM && string.bottomDepthM <= hole.bottomDepthM + 1);
      for (const string of inside) assert.ok(hole.outerDiameterMm! > string.outerDiameterMm!, `${entry.label}: ${hole.name} outsizes ${string.name}`);
      assert.ok(hole.bottomDepthM <= entry.totalDepthM + 0.01, `${entry.label}: ${hole.name} ends by TD`);
    }
  }
});

test("a cement interval only where the report gives its top; otherwise the string says what the report does", () => {
  // 58-32: no cement top is given for any string.
  assert.equal(well("58-32").components.filter((component) => component.kind === "Cement").length, 0);
  assert.match(casing("58-32", "surface").description, /four feet below the cellar/);
  // 78B-32: the 7 in cement fell to 95 ft.
  const fell = well("78b-32").components.find((component) => component.id === "78b-32-production-cement")!;
  assert.equal(fell.topDepthM, usSurveyFeetToMetres(95));
  // 16B: the bond log's ~3,000 ft is marked approximate.
  assert.match(well("16b").components.find((component) => component.id === "16b-production-cement")!.name, /≈ 3,000 ft/);
});

test("surveys: 56-32 and 78B-32 from their own tables, 16B and 58-32 from the survey files, 78-32 has none", () => {
  assert.equal(well("56-32").stations.at(-1)!.mdM, usSurveyFeetToMetres(9145));
  assert.ok(Math.abs(well("56-32").stations.at(-1)!.tvdM - usSurveyFeetToMetres(9138.3)) < 0.1, "TVD matches the report's 9,138.3 ft");
  assert.ok(Math.abs(well("78b-32").stations.at(-1)!.tvdM - usSurveyFeetToMetres(9497.3)) < 0.1, "TVD matches the report's 9,497.3 ft");
  assert.ok(well("16b").stations.length > 400);
  assert.equal(well("78-32").stations.length, 0);
  assert.match(well("78-32").surveyNote, /no azimuths/);
});

test("datums: elevations where the report gives them, none for 78-32 whose elevation is of an unstated point", () => {
  assert.equal(well("56-32").datum.elevationMslM, usSurveyFeetToMetres(5482.11));
  assert.equal(well("78-32").datum.elevationMslM, null);
  assert.match(well("78-32").datum.note!, /without saying of what/);
  assert.match(well("16b").datum.note!, /confirm/);
});

test("contradictions are kept as notes with their pages, not resolved silently", () => {
  assert.ok(well("16b").notes.some((note) => /JFE125T/.test(note.text) && note.page === 163));
  assert.ok(well("58-32").notes.some((note) => /K-55/.test(note.text) && note.page === 31));
  assert.ok(well("56-32").notes.some((note) => /9,105/.test(note.text)));
});
