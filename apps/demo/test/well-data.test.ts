import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { forgeDesign, parseLas } from "@ikhmalputra/subsurface-core";
import { checkDrillingLog } from "../src/lib/drilling-study.ts";
import { computedSurvey, designSurvey, lasAttempt, lasProjection, loadLas, loadedLas } from "../src/lib/well-data.ts";

const source = readFileSync(new URL("../public/data/forge-16a-mudlog-10ft.las", import.meta.url), "utf8");

/** Counts requests so a test can assert what the network actually saw, not what a cache claims. */
function stubFetch(body: string | (() => never)) {
  const calls: string[] = [];
  globalThis.fetch = ((url: string) => {
    calls.push(String(url));
    if (typeof body !== "string") body();
    return Promise.resolve(new Response(body, { status: 200 }));
  }) as typeof fetch;
  return calls;
}

test("a LAS is fetched and parsed once however many views ask for it", async () => {
  const calls = stubFetch(source);
  const url = "/data/one-parse.las";
  const [first, second] = await Promise.all([loadLas(url), loadLas(url)]);
  const third = await loadLas(url);
  assert.equal(calls.length, 1, "three callers, one request");
  // Identity, not deep equality: views share the parsed object, which is what makes a projection
  // memoized against it valid for all of them.
  assert.equal(first.las, second.las);
  assert.equal(first.las, third.las);
  assert.equal(loadedLas(url)?.las, first.las, "a pane opening later renders ready, not loading");
  assert.ok(first.text.includes("DEPTH"), "the source text is kept for the study signature");
});

test("a failed load is not remembered, so a retry can succeed", async () => {
  const failing = stubFetch(() => { throw new Error("offline"); });
  await assert.rejects(loadLas("/data/retry.las"), /offline/);
  assert.equal(failing.length, 1);
  const recovered = stubFetch(source);
  const loaded = await loadLas("/data/retry.las");
  assert.equal(recovered.length, 1, "the second attempt reached the network");
  assert.equal(loaded.las.curves[0]?.mnemonic, "DEPTH");
});

test("each view's shape is derived from the one parse, once", () => {
  const las = parseLas(source);
  let built = 0;
  const build = (file: typeof las) => { built += 1; return file.curves.length; };
  assert.equal(lasProjection(las, "count", build), lasProjection(las, "count", build));
  assert.equal(built, 1, "a re-render reuses the projection");
  lasProjection(las, "other-view", build);
  assert.equal(built, 2, "a different view gets its own projection of the same parse");
  // A different parse of the same bytes is a different file, and must not read the first's answers.
  assert.equal(lasProjection(parseLas(source), "count", build), las.curves.length);
  assert.equal(built, 3);
});

test("a projection may refuse the data, and the refusal is a value a pane can show", () => {
  const unmatched = parseLas(source.replace("DEPTH.ft", "DEPTH.psi"));
  let attempts = 0;
  const check = (file: typeof unmatched) => { attempts += 1; return checkDrillingLog(file); };
  const first = lasAttempt(unmatched, "drilling-study", check);
  assert.equal(first.ok, false);
  assert.match(first.ok ? "" : first.error, /DEPTH curve/);
  const again = lasAttempt(unmatched, "drilling-study", check);
  assert.equal(again, first, "re-rendering does not re-validate");
  assert.equal(attempts, 1);
  const good = lasAttempt(parseLas(source), "drilling-study", check);
  assert.equal(good.ok, true);
});

test("minimum curvature is computed once per station list, and per revision", () => {
  const stations = forgeDesign.survey!;
  const computed = computedSurvey(stations);
  assert.equal(computed.length, 422);
  assert.equal(computedSurvey(stations), computed, "four views, one calculation");
  assert.equal(designSurvey(forgeDesign), computed);
  // An authored revision supplies a different array for the same well; it must not read the
  // source well's trajectory back out of the cache.
  const edited = [...stations.slice(0, -1), { ...stations.at(-1)!, inclinationDeg: 12 }];
  const other = computedSurvey(edited);
  assert.notEqual(other, computed);
  assert.notEqual(other.at(-1)!.tvdM, computed.at(-1)!.tvdM);
  // One station is a position, not a trajectory; no view should be handed a one-point path.
  assert.deepEqual(computedSurvey(stations.slice(0, 1)), []);
  assert.deepEqual(computedSurvey(undefined), []);
});
