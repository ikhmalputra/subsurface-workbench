import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { exampleWellBrief, forgeDesign } from "@ikhmalputra/subsurface-core";
import { bundleSource, catalogueWell, loadWellCatalogue, readDetail, readHeaders } from "@ikhmalputra/subsurface-core/data-contract";
import type { WellBundle } from "@ikhmalputra/subsurface-core/data-contract";
import { siteOfWells } from "@ikhmalputra/subsurface-react";
import { designBundle, equatorBundles, forceBundle, forgeBundles, recordBundle } from "../src/data/sources/convert.ts";
import { busId, groupColour } from "../src/data/force-model.ts";
import type { ForceIndex } from "../src/data/force-model.ts";
import type { WellRecordValue } from "../src/data/records.ts";

const force = JSON.parse(readFileSync(new URL("../../../packages/fixtures/data/force2020/wells.json", import.meta.url), "utf8")) as ForceIndex;
const label = (area: string) => force.areas.find((entry) => entry.id === area)?.label ?? area;
const samples: readonly WellBundle[] = [...forgeBundles(), ...equatorBundles(), ...force.wells.map((well) => forceBundle(well, label(well.area))),
  designBundle({ siteId: "kestrel", wellId: "kestrel-a7", builtIn: true }, exampleWellBrief())];

test("every bundled sample passes the data contract, served as a source like a tenant's", async () => {
  const catalogue = await loadWellCatalogue([bundleSource("samples", "Bundled samples", "test", () => samples)]);
  const errors = catalogue.problems.filter((problem) => problem.severity === "error");
  assert.deepEqual(errors, [], errors.map((problem) => `${problem.id}: ${problem.message}`).join("\n"));
  assert.equal(catalogue.wells.length, 3 + 4 + force.wells.length + 1);
  // Every well drawn has a path, and every warning is one the reader is shown: the north reference not stated.
  assert.ok(catalogue.wells.every((entry) => entry.wellbores[0]!.path.length >= 2));
  assert.ok(catalogue.problems.every((problem) => /grid or true north/.test(problem.message)), catalogue.problems.map((problem) => problem.message).join("\n"));
});

test("FORGE 16A's survey comes through as the operator gave it, not recomputed", () => {
  const entry = catalogueWell(forgeBundles()[0]!, "samples").entry!;
  const path = entry.wellbores[0]!.path, record = forgeDesign.survey!;
  assert.equal(path.length, record.length);
  assert.equal(path.at(-1)!.tvdM, record.at(-1)!.tvdM);
  assert.equal(path.at(-1)!.eastingM, record.at(-1)!.eastingM);
});

test("FORCE wells are placed as their published ED50 grid coordinates place them", () => {
  // The site reprojects WGS84 longitude and latitude into WGS84 / UTM 31N. The index also gives
  // each wellhead in ED50 / UTM 31N, a different datum, derived independently of our code. The
  // offsets between wells must agree in both grids to within a metre or two.
  const area = force.areas.find((entry) => force.wells.filter((well) => well.area === entry.id).length >= 5)!;
  const wells = force.wells.filter((well) => well.area === area.id);
  const site = siteOfWells(wells.map((well) => catalogueWell(forceBundle(well, area.label), "samples").entry!), { id: area.id, label: area.label, summary: "", provenance: "documented", caveat: "", seismicNote: "", markerKinds: ["group"], surfaces: { kinds: ["group"], colour: groupColour } })!;
  const head = (id: string) => { const scene = site.wells.find((well) => well.id === id)!; return [scene.xyz[0]!, scene.xyz[1]!] as const; };
  let worst = 0;
  for (let i = 1; i < wells.length; i++) {
    const a = wells[0]!, b = wells[i]!;
    // East and north separately, so a swapped or mirrored axis cannot pass on distance alone.
    const [ax, ay] = head(busId(a)), [bx, by] = head(busId(b));
    worst = Math.max(worst, Math.abs((bx - ax) - (b.utm![0] - a.utm![0])), Math.abs((by - ay) - (b.utm![1] - a.utm![1])));
  }
  assert.ok(worst < 2, `wellhead offsets differ from the published grid by ${worst.toFixed(2)} m`);
  assert.equal(site.depthLabel, "m TVD below sea level");
});

test("FORCE group surfaces sit at the Directorate's own TVDSS for each top", () => {
  // The site puts each pick where the path is at the pick's MD. The Directorate published each top's
  // TVDSS from its own survey: the two must agree, within the coarse path in the index.
  const area = force.areas.find((entry) => force.wells.filter((well) => well.area === entry.id).length >= 5)!;
  const wells = force.wells.filter((well) => well.area === area.id);
  const site = siteOfWells(wells.map((well) => catalogueWell(forceBundle(well, area.label), "samples").entry!), { id: area.id, label: area.label, summary: "", provenance: "documented", caveat: "", seismicNote: "", markerKinds: ["group"], surfaces: { kinds: ["group"], colour: groupColour } })!;
  const tins = site.surfaces.filter((surface) => surface.geometry.kind === "tin");
  assert.ok(tins.length >= 3, `${tins.length} group surfaces`);
  let worst = 0, checked = 0;
  for (const surface of tins) {
    const name = surface.label.replace(/ top$/, "");
    const published = wells.flatMap((well) => well.groups.filter((top) => top.name === name && top.tvdss !== null).map((top) => top.tvdss!));
    if (surface.geometry.kind !== "tin") continue;
    for (const point of surface.geometry.points) {
      const nearest = Math.min(...published.map((tvdss) => Math.abs(tvdss - point[2])));
      worst = Math.max(worst, nearest);
      checked++;
    }
  }
  assert.ok(checked > 10 && worst < 3, `${checked} picks; worst ${worst.toFixed(2)} m from the Directorate's TVDSS`);
});

test("an entered well on the globe: below sea level when its datum is given, its head even before a survey", () => {
  const value: WellRecordValue = {
    identity: { name: "Test 1", field: "", operator: "", country: "", uwi: "" },
    location: { environment: "offshore-platform", latitude: 4.2, longitude: 113.9, groundElevationM: null, waterDepthM: 80 },
    datum: { reference: "RKB", elevationMslM: 30 },
    totalDepthM: 2000,
    stations: [{ mdM: 0, inclinationDeg: 0, azimuthDeg: 0 }, { mdM: 1000, inclinationDeg: 0, azimuthDeg: 0 }],
    surveySource: "test", tops: [{ id: "t", name: "Top A", topMdM: 900, lithology: "", source: "" }], components: [],
  };
  const site = siteOfWells([catalogueWell(recordBundle({ siteId: "rec-1", wellId: "w" }, value), "browser").entry!], { id: "rec-1", label: "Test", summary: "", provenance: "user-authored", caveat: "", seismicNote: "" })!;
  const well = site.wells[0]!;
  // Projected to TD along the last station: vertical, so 2,000 m MD is 2,000 m below the RKB, 1,970 m below the sea.
  assert.equal(well.xyz[well.xyz.length - 1], 1970);
  assert.ok(site.surfaces.some((surface) => surface.id === "seabed" && surface.geometry.kind === "plane" && surface.geometry.depthM === 80));
  assert.deepEqual(well.markers?.map((marker) => marker.label), ["Top A"]);
  const unsurveyed = siteOfWells([catalogueWell(recordBundle({ siteId: "rec-2", wellId: "w2" }, { ...value, stations: [] }), "browser").entry!], { id: "rec-2", label: "Test", summary: "", provenance: "user-authored", caveat: "", seismicNote: "" })!;
  assert.equal(unsurveyed.map.wells.length, 1, "the head is on the globe");
  assert.equal(unsurveyed.wells.length, 0, "nothing is drawn in 3D without a path");
});

test("a host's config.json: what it may name, and what it may not", async () => {
  const { DEFAULT_CONFIG, parseDeckConfig } = await import("../src/data/sources/config.ts");
  assert.deepEqual(parseDeckConfig({}).config, DEFAULT_CONFIG, "no sources list: the default");
  const read = parseDeckConfig({ sources: [
    { type: "samples" }, { type: "samples" },
    { type: "contract-json", url: "data/field.wells.json", label: "Field" },
    { type: "contract-json", url: "javascript:alert(1)" },
    { type: "contract-json", url: "http://plain.example.com/w.json" },
    { type: "osdu", url: "https://osdu.example.com" },
    { type: "osdu", url: "https://osdu.example.com", dataPartition: "opendes" },
    { type: "ftp" },
  ] });
  assert.deepEqual(read.config.sources.map((source) => source.type), ["samples", "contract-json", "osdu"]);
  assert.equal(read.problems.length, 5, read.problems.join("\n"));
  assert.ok(read.problems.some((problem) => /listed twice/.test(problem)));
  assert.ok(read.problems.some((problem) => /dataPartition/.test(problem)));
  assert.ok(read.problems.some((problem) => /type "ftp"/.test(problem)));
  assert.equal(read.problems.filter((problem) => /"url" must be/.test(problem)).length, 2, "a script URL and plain http are both refused");
});

test("a wells file in the data contract loads as a source; a bad file fails alone", async () => {
  const { contractJsonSource } = await import("../src/data/sources/config.ts");
  const file = JSON.parse(readFileSync(new URL("./fixtures/test.wells.json", import.meta.url), "utf8")) as unknown;
  const asked: string[] = [];
  const good = contractJsonSource("file-0", { type: "contract-json", url: "./data/test.wells.json", label: "Test file" }, "/deck/", async (url) => { asked.push(url); return file; });
  const bad = contractJsonSource("file-1", { type: "contract-json", url: "data/wrong.json" }, "/deck/", async () => ({ wells: [] }));
  const catalogue = await loadWellCatalogue([good, bad]);
  assert.deepEqual(asked, ["/deck/data/test.wells.json"], "a relative url is read beside the deck");
  assert.equal(catalogue.wells.length, 3);
  assert.ok(catalogue.problems.some((problem) => problem.sourceId === "file-1" && /not a subsurface-wells file/.test(problem.message)));
  // The file's surveys are to true north: drawn on the grid, each is turned by the convergence at its
  // wellhead. At 3° E and 60° N in UTM 31N (central meridian 3° E) that is a few hundredths of a
  // degree, so the bottom holes move by centimetres, and in the right sense.
  const site = siteOfWells(catalogue.wells, { id: "t", label: "Test", summary: "", provenance: "synthetic", caveat: "", seismicNote: "", surfaces: { kinds: ["formation"], colour: () => "#000" } })!;
  assert.equal(site.wells.length, 3);
  assert.equal(site.surfaces.filter((surface) => surface.geometry.kind === "tin").length, 2, "Top Alpha and Top Beta, each in three wells");
  assert.equal(site.depthLabel, "m TVD below sea level");
  // The same well read as grid-north: the bearing from its head to its bottom hole differs by the
  // convergence, computed here from the formula, γ = atan(tan(λ − 3°) · sin φ), and not by the library.
  const asGrid = catalogue.wells.map((entry) => ({ ...entry, wellbores: entry.wellbores.map((bore) => ({ ...bore, trajectory: { ...bore.trajectory!, azimuthReference: "grid" as const } })) }));
  const gridSite = siteOfWells(asGrid, { id: "g", label: "Test", summary: "", provenance: "synthetic", caveat: "", seismicNote: "" })!;
  const bearing = (xyz: Float64Array) => Math.atan2(xyz[xyz.length - 3]! - xyz[0]!, xyz[xyz.length - 2]! - xyz[1]!) * 180 / Math.PI;
  const turned = bearing(site.wells[0]!.xyz) - bearing(gridSite.wells[0]!.xyz);
  const gamma = Math.atan(Math.tan((2.95 - 3) * Math.PI / 180) * Math.sin(60.10 * Math.PI / 180)) * 180 / Math.PI;
  assert.ok(Math.abs(turned - -gamma) < 1e-6, `turned ${turned}°, convergence ${gamma}°`);
});

test("the fetch guard: a body too large is stopped as it streams, server errors are retried, a dead server times out", async () => {
  const { fetchJsonGuarded, TooLarge } = await import("../src/data/sources/fetch-guard.ts");
  // 3 MB sent in 64 kB chunks, no Content-Length: refused past the 1 MB cap, before the rest is read.
  let sent = 0;
  const big: typeof fetch = async () => new Response(new ReadableStream({ pull(controller) { if (sent >= 3 << 20) { controller.close(); return; } sent += 1 << 16; controller.enqueue(new Uint8Array(1 << 16).fill(32)); } }));
  await assert.rejects(fetchJsonGuarded("x", { fetcher: big, maxBytes: 1 << 20 }), (error: unknown) => error instanceof TooLarge);
  assert.ok(sent < 3 << 20, `stopped after ${sent} bytes`);
  // Two 503s, then the answer.
  let calls = 0;
  const flaky: typeof fetch = async () => (++calls < 3 ? new Response("busy", { status: 503 }) : new Response('{"ok":true}'));
  assert.deepEqual(await fetchJsonGuarded("x", { fetcher: flaky, retries: 2 }), { ok: true });
  assert.equal(calls, 3);
  // A 404 is not retried.
  calls = 0;
  const missing: typeof fetch = async () => { calls++; return new Response("no", { status: 404 }); };
  await assert.rejects(fetchJsonGuarded("x", { fetcher: missing }), /HTTP 404/);
  assert.equal(calls, 1);
  // A server that never answers is given up on.
  const silent: typeof fetch = (_, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
  await assert.rejects(fetchJsonGuarded("x", { fetcher: silent, timeoutMs: 50, retries: 0 }), /no answer/);
});

test("an index of fields: headers come from the index, and a field's file is read only when its wells are asked for", async () => {
  const { contractJsonSource } = await import("../src/data/sources/config.ts");
  const file = JSON.parse(readFileSync(new URL("./fixtures/test.wells.json", import.meta.url), "utf8")) as { wells: WellBundle[] };
  const index = { format: "subsurface-wells-index", version: 1, fields: [
    { id: "a", name: "Field A", wells: file.wells.slice(0, 2).map((bundle) => bundle.well), detail: "fields/a.json" },
    { id: "b", name: "Field B", wells: file.wells.slice(2).map((bundle) => bundle.well), detail: "fields/b.json" },
  ] };
  const asked: string[] = [];
  const load = async (url: string) => { asked.push(url); return url.endsWith("index.json") ? index : { format: "subsurface-wells", version: 1, wells: url.endsWith("a.json") ? file.wells.slice(0, 2) : file.wells.slice(2) }; };
  const source = contractJsonSource("file-0", { type: "contract-json", url: "data/wells.index.json" }, "/", load);
  const listed = await readHeaders(source);
  assert.equal(listed.wells.length, 3);
  assert.deepEqual(asked, ["/data/wells.index.json"], "only the index is read to list the wells");
  const detail = await readDetail(source, [file.wells[2]!.well.id]);
  assert.equal(detail.wells.length, 1);
  assert.deepEqual(asked, ["/data/wells.index.json", "/fields/b.json"], "only the field holding the well asked for");
  await readDetail(source, [file.wells[2]!.well.id]);
  assert.equal(asked.length, 2, "a field read once is not read again");
});
