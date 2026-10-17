import assert from "node:assert/strict";
import test from "node:test";
import { bundleSource, gridConvergenceDeg, loadWellCatalogue, readDetail, readHeaders, resolveTrajectory, simplifyPath, trueToGrid, validateMarkerSet, validateTrajectory, validateWell, validateWellbore } from "./data-contract.ts";
import type { CanonicalMarkerSet, CanonicalTrajectory, CanonicalWell, CanonicalWellbore, WellBundle, WellDataSource } from "./data-contract.ts";

const provenance = { kind: "synthetic" as const, source: "test" };
const well = (id: string, extra: Partial<CanonicalWell> = {}): CanonicalWell => ({ id, name: `Well ${id}`, field: { id: "f", name: "Field" }, location: { longitude: 3, latitude: 60 }, environment: "offshore", waterDepthM: 100, groundElevationM: null, provenance, ...extra });
const wellbore = (id: string, wellId: string): CanonicalWellbore => ({ id, wellId, name: id, status: "drilled", datum: { reference: "RKB", elevationM: 25 }, totalDepthMdM: 3000, provenance });
const path = (id: string, wellboreId: string, stations: CanonicalTrajectory["stations"], kind: CanonicalTrajectory["kind"] = "definitive"): CanonicalTrajectory => ({ id, wellboreId, name: id, kind, azimuthReference: "grid", stations, provenance });

test("minimum curvature reproduces a circular build exactly", () => {
  // A hole building at a constant rate from vertical to horizontal, due east, is a quarter circle
  // of radius R = 180 / (π · rate). From the kickoff it drops R and steps out R. That is geometry,
  // not our code, and minimum curvature is exact on an arc.
  const kickoff = 500, ratePerM = 3 / 30, radius = 180 / (Math.PI * ratePerM);
  const stations = Array.from({ length: 31 }, (_, i) => ({ mdM: kickoff + i * (90 / ratePerM) / 30, inclinationDeg: i * 3, azimuthDeg: 90 }));
  const resolved = resolveTrajectory(path("arc", "b", [{ mdM: 0, inclinationDeg: 0, azimuthDeg: 90 }, ...stations]));
  const end = resolved.at(-1)!;
  assert.ok(Math.abs(end.tvdM - (kickoff + radius)) < 1e-6, `TVD ${end.tvdM} against ${kickoff + radius}`);
  assert.ok(Math.abs(end.eastingM - radius) < 1e-6, `east ${end.eastingM} against ${radius}`);
  assert.ok(Math.abs(end.northingM) < 1e-6);
});

test("supplied positions are kept, not recomputed", () => {
  // A definitive survey's TVD is the operator's. Deliberately unlike what minimum curvature gives
  // from these angles, it must come back as supplied.
  const resolved = resolveTrajectory(path("kept", "b", [
    { mdM: 0, inclinationDeg: 0, azimuthDeg: 0, tvdM: 0, northM: 0, eastM: 0 },
    { mdM: 100, inclinationDeg: 0, azimuthDeg: 0, tvdM: 97.5, northM: 3, eastM: 1 },
  ]));
  assert.equal(resolved[1]!.tvdM, 97.5);
  assert.equal(resolved[1]!.northingM, 3);
});

test("angles are derived from positions along a straight slant", () => {
  // Points on a straight line at 30° inclination toward 045°: every derived angle is that line's.
  const inc = 30 * Math.PI / 180, az = 45 * Math.PI / 180;
  const stations = [0, 200, 400, 600].map((md) => ({ mdM: md, tvdM: md * Math.cos(inc), northM: md * Math.sin(inc) * Math.cos(az), eastM: md * Math.sin(inc) * Math.sin(az) }));
  for (const station of resolveTrajectory(path("slant", "b", stations))) {
    assert.ok(Math.abs(station.inclinationDeg - 30) < 1e-9);
    assert.ok(Math.abs(station.azimuthDeg - 45) < 1e-9);
  }
});

test("a valid well, wellbore, path and markers raise nothing", () => {
  assert.deepEqual(validateWell(well("a")), []);
  assert.deepEqual(validateWellbore(wellbore("a-1", "a")), []);
  assert.deepEqual(validateTrajectory(path("t", "a-1", [{ mdM: 0, inclinationDeg: 0, azimuthDeg: 0 }, { mdM: 1000, inclinationDeg: 10, azimuthDeg: 359.9 }])), []);
  const markers: CanonicalMarkerSet = { id: "m", wellboreId: "a-1", name: "Tops", markers: [{ id: "x", name: "Top X", mdM: 900, kind: "formation" }], provenance };
  assert.deepEqual(validateMarkerSet(markers, 3000), []);
});

test("bad records are caught, each for its own reason", () => {
  const errors = (list: readonly { severity: string; message: string }[]) => list.filter((problem) => problem.severity === "error").map((problem) => problem.message);
  assert.match(errors(validateWell(well("w", { location: { longitude: 3, latitude: 95 } }))).join(), /Latitude 95/);
  assert.match(errors(validateTrajectory(path("t", "b", [{ mdM: 0, inclinationDeg: 0, azimuthDeg: 0 }, { mdM: 0, inclinationDeg: 5, azimuthDeg: 0 }]))).join(), /does not increase/);
  assert.match(errors(validateTrajectory(path("t", "b", [{ mdM: 0, inclinationDeg: 0, azimuthDeg: 0 }, { mdM: 10, inclinationDeg: 200, azimuthDeg: 0 }]))).join(), /inclination 200/);
  assert.match(errors(validateTrajectory(path("t", "b", [{ mdM: 0, inclinationDeg: 0, azimuthDeg: 0 }, { mdM: 10, inclinationDeg: 5, azimuthDeg: 360 }]))).join(), /azimuth 360/);
  assert.match(errors(validateTrajectory(path("t", "b", [{ mdM: 0, inclinationDeg: 0, azimuthDeg: 0 }, { mdM: 10 }]))).join(), /neither/);
  assert.match(errors(validateTrajectory(path("t", "b", [{ mdM: 0, tvdM: 0, northM: 0, eastM: 0 }, { mdM: 100, tvdM: 140, northM: 0, eastM: 0 }]))).join(), /deeper than/);
  const warnings = validateWellbore({ ...wellbore("b", "w"), datum: { reference: "KB", elevationM: null } });
  assert.ok(warnings.some((problem) => problem.severity === "warning" && /elevation is not given/.test(problem.message)));
});

test("grid convergence: zero on the central meridian, and the known sign and size east of it", () => {
  assert.equal(gridConvergenceDeg(9, 60, 9), 0);
  // East of the central meridian in the northern hemisphere, grid north lies east of true north.
  // At 3° east and 60° N: atan(tan 3° · sin 60°) ≈ 2.599°.
  assert.ok(Math.abs(gridConvergenceDeg(12, 60, 9) - 2.5988) < 1e-3);
  // A true-north offset is then a little west of grid north, and its length is unchanged.
  const turned = trueToGrid(1000, 0, 2.5988);
  assert.ok(turned.eastM < 0 && Math.abs(Math.hypot(turned.northM, turned.eastM) - 1000) < 1e-9);
});

test("the catalogue keeps good wells when a source fails or a record is bad", async () => {
  const bundle = (w: CanonicalWell): WellBundle => ({ well: w, wellbores: [{ wellbore: wellbore(`${w.id}-1`, w.id),
    trajectories: [path(`${w.id}-1-plan`, `${w.id}-1`, [{ mdM: 0, inclinationDeg: 0, azimuthDeg: 0 }, { mdM: 500, inclinationDeg: 0, azimuthDeg: 0 }], "planned"),
      path(`${w.id}-1-def`, `${w.id}-1`, [{ mdM: 0, inclinationDeg: 0, azimuthDeg: 0 }, { mdM: 800, inclinationDeg: 0, azimuthDeg: 0 }])],
    markerSets: [] }] });
  const good = bundleSource("good", "Good", "test", () => [bundle(well("a")), bundle(well("bad", { location: { longitude: 200, latitude: 0 } }))]);
  const broken: WellDataSource = { id: "down", label: "Down", standard: "test", headers: async () => { throw new Error("HTTP 503"); }, detail: async () => [] };
  const duplicate = bundleSource("again", "Again", "test", () => [bundle(well("a"))]);
  const catalogue = await loadWellCatalogue([good, broken, duplicate]);
  assert.deepEqual(catalogue.wells.map((entry) => `${entry.sourceId}:${entry.well.id}`), ["good:a"]);
  // The definitive path is preferred over the plan.
  assert.equal(catalogue.wells[0]!.wellbores[0]!.trajectory!.id, "a-1-def");
  assert.equal(catalogue.wells[0]!.wellbores[0]!.path.at(-1)!.tvdM, 800);
  assert.ok(catalogue.problems.some((problem) => problem.sourceId === "good" && /Longitude 200/.test(problem.message)));
  assert.ok(catalogue.problems.some((problem) => problem.object === "source" && /HTTP 503/.test(problem.message)));
  assert.ok(catalogue.problems.some((problem) => problem.sourceId === "again" && /already serves/.test(problem.message)));
  assert.deepEqual(catalogue.sources.map((source) => [source.id, source.wells, source.error]), [["good", 1, null], ["down", 0, "HTTP 503"], ["again", 0, null]]);
});

test("headers page through a large source, and stop at the deck's limit with a warning", async () => {
  const many = Array.from({ length: 2500 }, (_, i): WellBundle => ({ well: well(`w${i}`), wellbores: [] }));
  const source = bundleSource("big", "Big", "test", () => many, 1000);
  const pages: number[] = [];
  const all = await readHeaders(source, { onPage: (wells) => pages.push(wells.length) });
  assert.deepEqual(pages, [1000, 1000, 500]);
  assert.equal(all.wells.length, 2500);
  assert.equal(all.truncated, false);
  const capped = await readHeaders(source, { maxWells: 1200 });
  assert.equal(capped.wells.length, 1200);
  assert.ok(capped.truncated && capped.problems.some((problem) => /first 1,200 wells/.test(problem.message)));
});

test("detail is read in batches, a failed batch is reported alone, and cancelling stops it", async () => {
  const bundles = Array.from({ length: 450 }, (_, i): WellBundle => ({ well: well(`w${i}`), wellbores: [] }));
  let asked = 0;
  const flaky: WellDataSource = { ...bundleSource("f", "F", "test", () => bundles), detail: async (ids) => { asked++; if (ids.includes("w150")) throw new Error("HTTP 500"); return bundles.filter((bundle) => ids.includes(bundle.well.id)); } };
  const read = await readDetail(flaky, bundles.map((bundle) => bundle.well.id), { batch: 100, concurrency: 2 });
  assert.equal(asked, 5);
  assert.equal(read.wells.length, 350, "one batch of 100 failed; the other 350 wells were read");
  assert.ok(read.problems.some((problem) => /100 wells could not be read \(HTTP 500\)/.test(problem.message)));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readDetail(flaky, ["w1"], { signal: controller.signal }));
});

test("a simplified path keeps its shape within the tolerance, and its ends", () => {
  // A build to horizontal over 3,000 stations; simplified to 1 m, every dropped station lies within
  // 1 m of the kept polyline, checked here by brute force rather than by the algorithm's own bookkeeping.
  const stations = Array.from({ length: 3000 }, (_, i) => ({ mdM: i, inclinationDeg: Math.min(90, Math.max(0, (i - 500) * 0.04)), azimuthDeg: 45 }));
  const full = resolveTrajectory(path("long", "b", stations));
  const kept = simplifyPath(full, 1);
  assert.ok(kept.length < full.length / 10, `${kept.length} of ${full.length} stations kept`);
  assert.equal(kept[0], full[0]); assert.equal(kept.at(-1), full.at(-1));
  let worst = 0;
  for (const point of full) {
    let nearest = Infinity;
    for (let k = 1; k < kept.length; k++) {
      const a = kept[k - 1]!, b = kept[k]!;
      const d = [b.eastingM - a.eastingM, b.northingM - a.northingM, b.tvdM - a.tvdM], p = [point.eastingM - a.eastingM, point.northingM - a.northingM, point.tvdM - a.tvdM];
      const l2 = d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2, t = l2 ? Math.max(0, Math.min(1, (p[0]! * d[0]! + p[1]! * d[1]! + p[2]! * d[2]!) / l2)) : 0;
      nearest = Math.min(nearest, Math.hypot(p[0]! - t * d[0]!, p[1]! - t * d[1]!, p[2]! - t * d[2]!));
    }
    worst = Math.max(worst, nearest);
  }
  assert.ok(worst <= 1 + 1e-9, `worst ${worst} m`);
});
