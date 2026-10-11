import assert from "node:assert/strict";
import test from "node:test";
import { createInitialSubsurfaceState, createSubsurfaceStore } from "./state.ts";
import { stateFromUrl, stateToUrl, syncStateToUrl } from "./state-url.ts";
import type { StateUrlHost } from "./state-url.ts";
import { fromLocalCoordinates, geographicToWebMercator, toLocalCoordinates, webMercatorToGeographic } from "./crs.ts";

function focusedStore() {
  const store = createSubsurfaceStore();
  store.focusAsset("well-1");
  return store;
}

test("stores are isolated, frozen and preserve untouched branch identity", () => {
  const a = focusedStore(), b = createSubsurfaceStore();
  const before = a.getState();
  const coordinate: [number, number, number] = [1, 2, 3];
  a.triggerSpatialPick(coordinate);
  coordinate[0] = 100;
  assert.deepEqual(a.getState().activeAsset.spatial_xyz, [1, 2, 3]);
  assert.equal(a.getState().viewState, before.viewState);
  assert.equal(b.getState().activeAsset.wellId, null);
  assert.ok(Object.isFrozen(a.getState()));
  assert.ok(Object.isFrozen(a.getState().activeAsset));
  assert.ok(Object.isFrozen(a.getState().activeAsset.spatial_xyz));
});

test("hover, pin, unlink and focus changes preserve intended depth semantics", () => {
  const store = focusedStore();
  store.pinDepth("well-1", 150);
  store.updateDepthHover("well-1", 180);
  assert.equal(store.getState().activeAsset.depth_md, 180);
  store.updateDepthHover("well-1", null);
  assert.equal(store.getState().activeAsset.depth_md, 150);
  store.updateDepthHover("well-1", 200);
  store.setDepthLinked(false);
  assert.equal(store.getState().activeAsset.depth_md, 150);
  store.setDepthWindow([100, 500]);
  store.selectComponent("casing");
  store.triggerSpatialPick([1, 2, 3]);
  store.focusAsset("well-2");
  assert.deepEqual(store.getState().activeAsset, { wellId: "well-2", componentId: null, spatial_xyz: null, depth_md: null });
  assert.equal(store.getState().depthLink.window, null);
  assert.equal(store.getState().depthLink.pinnedMdM, null);
  assert.equal(store.getState().depthLink.linked, false);
});

test("selector subscriptions and typed events suppress identical values and source echoes", () => {
  const store = focusedStore();
  const observed: (number | null)[] = [];
  const off = store.subscribeSelector((s) => s.activeAsset.depth_md, (md) => observed.push(md), { ignoreSource: "log" });
  const picks: string[] = [];
  const offPick = store.on("depth-pick", (event) => picks.push(event.source ?? ""));
  store.pinDepth("well-1", 10, "log");
  store.pinDepth("well-1", 10, "3d");
  store.pinDepth("well-1", 20, "3d");
  store.setSeismicSlices({ inline: 5 });
  assert.deepEqual(observed, [20]);
  assert.deepEqual(picks, ["log", "3d"]);
  off(); offPick();
  store.pinDepth("well-1", 30);
  assert.deepEqual(observed, [20]);
});

test("custom selector equality suppresses derived object notifications", () => {
  const store = focusedStore();
  let calls = 0;
  store.subscribeSelector((s) => ({ id: s.activeAsset.wellId }), () => calls++, { equality: (a, b) => a.id === b.id });
  store.pinDepth("well-1", 20);
  assert.equal(calls, 0);
  store.focusAsset("well-2");
  assert.equal(calls, 1);
});

test("dataset interaction links stable IDs and ranges, freezes state, and ignores equal source echoes", () => {
  const store = focusedStore();
  const changes: string[] = [];
  let events = 0;
  store.subscribe((event) => { if (event.type === "data-interaction") events += 1; });
  const stop = store.subscribeSelector((state) => state.dataInteraction, (_next, _previous, event) => changes.push(event.source ?? ""), {
    ignoreSource: "linked-chart",
  });
  store.setDataInteraction({
    datasetId: "logs:well-1",
    hoveredId: "sample-2",
    selectedIds: ["sample-2"],
    depthRange: [100, 250],
    brush: { datasetId: "logs:well-1", startId: "sample-1", endId: "sample-9" },
  }, "linked-chart");
  assert.equal(changes.length, 0);
  assert.deepEqual(store.getState().dataInteraction, {
    datasetId: "logs:well-1",
    hoveredId: "sample-2",
    selectedIds: ["sample-2"],
    depthRange: [100, 250],
    timeRange: null,
    brush: { datasetId: "logs:well-1", startId: "sample-1", endId: "sample-9" },
  });
  assert.ok(Object.isFrozen(store.getState().dataInteraction));
  assert.ok(Object.isFrozen(store.getState().dataInteraction.selectedIds));
  store.setDataInteraction({ hoveredId: "sample-2" }, "linked-chart");
  assert.equal(events, 1, "equal source echoes must not publish");
  assert.deepEqual(changes, []);
  store.setDataInteraction({ hoveredId: null }, "linked-table");
  assert.deepEqual(changes, ["linked-table"]);
  stop();
});

test("changing or clearing dataset context discards stale IDs, ranges, and brush", () => {
  const store = focusedStore();
  store.setDataInteraction({
    datasetId: "first",
    hoveredId: "row-a",
    selectedIds: ["row-a"],
    depthRange: [1, 10],
    timeRange: [1_700_000_000_000, 1_700_000_001_000],
    brush: { datasetId: "first", startId: "row-a", endId: "row-b" },
  });
  store.setDataInteraction({ datasetId: "second" });
  assert.deepEqual(store.getState().dataInteraction, {
    datasetId: "second", hoveredId: null, selectedIds: [], depthRange: null, timeRange: null, brush: null,
  });
  store.clearDataInteraction();
  assert.deepEqual(store.getState().dataInteraction, {
    datasetId: null, hoveredId: null, selectedIds: [], depthRange: null, timeRange: null, brush: null,
  });
});

test("identical controlled echoes are harmless; different reentrant writes fail explicitly without recursive loops", () => {
  const store = focusedStore();
  let last = 0;
  const echo = store.subscribe((event) => store.pinDepth("well-1", event.state.depthLink.pinnedMdM));
  store.pinDepth("well-1", 1);
  echo();
  const invalid = store.subscribe(() => store.pinDepth("well-1", 10));
  store.subscribe(() => last++);
  assert.throws(() => store.pinDepth("well-1", 2), AggregateError);
  assert.equal(last, 1);
  assert.equal(store.getState().activeAsset.depth_md, 2);
  invalid();
  store.pinDepth("well-1", 3);
  assert.equal(last, 2);
});

test("unsubscribe during publication and listener failures do not starve other views", () => {
  const store = focusedStore();
  let calls = 0;
  let remove = () => {};
  store.subscribe(() => remove());
  remove = store.subscribe(() => calls++);
  store.subscribe(() => { throw new Error("renderer failure"); });
  store.subscribe(() => calls++);
  assert.throws(() => store.triggerSpatialPick([1, 2, 3]), AggregateError);
  assert.equal(calls, 1);
});

const invalidActions: readonly [string, (store: ReturnType<typeof focusedStore>) => void][] = [
  ["negative depth", (s) => s.pinDepth("well-1", -1)],
  ["nonfinite hover", (s) => s.updateDepthHover("well-1", NaN)],
  ["unfocused depth", (s) => s.pinDepth(null, 1)],
  ["empty ID", (s) => s.focusAsset(" ")],
  ["zero zoom", (s) => s.setViewState({ zoom: 0 })],
  ["nonfinite camera", (s) => s.setViewState({ position: [0, Infinity, 1] })],
  ["zero-length camera", (s) => s.setViewState({ position: [0, 0, 0] })],
  ["reversed window", (s) => s.setDepthWindow([2, 1])],
  ["negative window", (s) => s.setDepthWindow([-1, 1])],
  ["nonfinite slice", (s) => s.setSeismicSlices({ inline: Infinity })],
  ["interaction without dataset", (s) => s.setDataInteraction({ hoveredId: "row-a" })],
  ["interaction brush for another dataset", (s) => s.setDataInteraction({ datasetId: "a", brush: { datasetId: "b", startId: "x", endId: "y" } })],
  ["duplicate interaction IDs", (s) => s.setDataInteraction({ datasetId: "a", selectedIds: ["x", "x"] })],
  ["too many selected IDs", (s) => s.setDataInteraction({ datasetId: "a", selectedIds: Array.from({ length: 129 }, (_, i) => `sample-${i}`) })],
  ["reversed time range", (s) => s.setDataInteraction({ datasetId: "a", timeRange: [2, 1] })],
  ["unknown interaction field", (s) => s.setDataInteraction({ unsupported: "value" } as never)],
];
for (const [name, action] of invalidActions) test(`state rejects ${name} atomically`, () => {
  const store = focusedStore(), before = store.getState();
  assert.throws(() => action(store));
  assert.equal(store.getState(), before);
});

test("URL round trip preserves state, unrelated parameters and hash, excluding transient hover", () => {
  const store = focusedStore();
  store.selectComponent("casing / A");
  store.pinDepth("well-1", 123.75);
  store.updateDepthHover("well-1", 145);
  store.triggerSpatialPick([10.25, 20, 30]);
  store.setSeismicSlices({ inline: 50, crossline: -20, time_depth: 1000 });
  store.setDepthWindow([10, 1000]);
  store.setViewState({ position: [1, 2, 3], target: [4, 5, 6], zoom: 2 });
  const url = stateToUrl(store.getState(), "https://example.test/view?theme=dark&well=legacy#inspect");
  assert.equal(url.searchParams.get("theme"), "dark");
  assert.equal(url.searchParams.get("well"), "legacy");
  assert.equal(url.hash, "#inspect");
  const next = stateFromUrl(url)!;
  assert.equal(next.activeAsset.depth_md, 123.75);
  assert.equal(next.depthLink.hoverMdM, null);
  assert.equal(next.activeAsset.componentId, "casing / A");
  assert.deepEqual(next.viewState, store.getState().viewState);
  assert.deepEqual(next.seismicSlices, store.getState().seismicSlices);
  assert.deepEqual(next.depthLink.window, [10, 1000]);
});

for (const query of [
  "sw.v=2", "sw.v=1&sw.md=abc", "sw.v=1&sw.md=-1&sw.well=a", "sw.v=1&sw.md=1",
  "sw.v=1&sw.xyz=1,2", "sw.v=1&sw.xyz=1,,3", "sw.v=1&sw.xyz=1,0x2,3",
  "sw.v=1&sw.xyz=1,2,Infinity", "sw.v=1&sw.zoom=0", "sw.v=1&sw.linked=2",
  "sw.v=1&sw.window=10,5", "sw.v=1&sw.well=a&sw.well=b", "sw.v=1&sw.extra=1",
]) test(`URL rejects malformed state: ${query}`, () => assert.throws(() => stateFromUrl(`https://example.test/?${query}`)));

test("URL parsing is SSR safe, supports custom prefixes, and leaves unrelated URLs alone", () => {
  assert.equal(stateFromUrl("https://example.test/?well=a#depth"), null);
  const url = stateToUrl(focusedStore().getState(), "https://example.test/", "model.");
  assert.equal(stateFromUrl(url, "model.")?.activeAsset.wellId, "well-1");
  assert.equal(stateFromUrl(url), null);
  assert.throws(() => stateFromUrl(url, ""));
});

test("URL serialization replaces the reserved namespace, repairing stale or duplicate SDK parameters", () => {
  const url = stateToUrl(focusedStore().getState(), "https://example.test/?theme=dark&sw.v=0&sw.v=2&sw.retired=1");
  assert.equal(url.searchParams.get("theme"), "dark");
  assert.equal(url.searchParams.has("sw.retired"), false);
  assert.equal(url.searchParams.getAll("sw.v").length, 1);
  assert.equal(stateFromUrl(url)?.activeAsset.wellId, "well-1");
});

function urlHost(initial: string) {
  let current = initial;
  let pop: (() => void) | undefined;
  const writes: string[] = [];
  const host: StateUrlHost = {
    read: () => current,
    replace: (next) => { current = next; writes.push(next); },
    onPopState: (listener) => { pop = listener; return () => { pop = undefined; }; },
  };
  return { host, writes, navigate: (next: string) => { current = next; pop?.(); } };
}
const wait = () => new Promise((resolve) => setTimeout(resolve, 30));

test("URL binding hydrates, debounces, handles popstate, and cancels pending writes on dispose", async () => {
  const start = focusedStore();
  start.pinDepth("well-1", 100);
  const host = urlHost(stateToUrl(start.getState(), "https://example.test/?theme=dark#logs").href);
  const store = createSubsurfaceStore(), errors: unknown[] = [];
  const stop = syncStateToUrl(store, { host: host.host, onError: (error) => errors.push(error), debounceMs: 5 });
  assert.equal(store.getState().activeAsset.depth_md, 100);
  store.pinDepth("well-1", 110);
  store.pinDepth("well-1", 120);
  await wait();
  assert.equal(host.writes.length, 1);
  assert.equal(new URL(host.writes[0]!).searchParams.get("sw.md"), "120");
  store.updateDepthHover("well-1", 200);
  await wait();
  assert.equal(host.writes.length, 1);
  host.navigate("https://example.test/?sw.v=1&sw.well=well-2&sw.md=150");
  assert.equal(store.getState().activeAsset.wellId, "well-2");
  assert.equal(store.getState().activeAsset.depth_md, 150);
  await wait();
  assert.equal(host.writes.length, 1);
  store.pinDepth("well-2", 160);
  stop();
  await wait();
  assert.equal(host.writes.length, 1);
  host.navigate("https://example.test/?sw.v=1&sw.well=other");
  assert.equal(store.getState().activeAsset.wellId, "well-2");
  assert.deepEqual(errors, []);
});

test("URL binding preserves initial focus on plain links and resets to defaults on unversioned history navigation", () => {
  const host = urlHost("https://example.test/?theme=dark"), store = focusedStore();
  const stop = syncStateToUrl(store, { host: host.host, onError: (e) => { throw e; } });
  assert.equal(store.getState().activeAsset.wellId, "well-1");
  host.navigate("https://example.test/?theme=light");
  assert.deepEqual(store.getState(), createInitialSubsurfaceState());
  stop();
});

test("invalid URLs and host-level asset validation report errors without corrupting state", () => {
  const host = urlHost("https://example.test/?sw.v=invalid"), store = focusedStore(), errors: unknown[] = [];
  const stop = syncStateToUrl(store, {
    host: host.host, onError: (error) => errors.push(error),
    validateState: (s) => { if (s.activeAsset.wellId !== "well-1") throw new Error("Unknown asset"); },
  });
  const before = store.getState();
  host.navigate("https://example.test/?sw.v=1&sw.well=missing");
  assert.equal(store.getState(), before);
  assert.equal(errors.length, 2);
  stop();
});

test("URL history write failures reach onError", async () => {
  const host = urlHost("https://example.test/"), store = focusedStore(), errors: unknown[] = [];
  const stop = syncStateToUrl(store, { host: { ...host.host, replace: () => { throw new Error("History denied"); } }, debounceMs: 0, onError: (e) => errors.push(e) });
  store.pinDepth("well-1", 10);
  await wait();
  assert.equal(errors.length, 1);
  stop();
});

test("explicit geographic and local-frame conversions round trip without changing vertical datum", () => {
  const point = [-112.9, 38.5, 100] as const;
  const result = webMercatorToGeographic(geographicToWebMercator(point));
  assert.ok(Math.abs(result[0] - point[0]) < 1e-10);
  assert.ok(Math.abs(result[1] - point[1]) < 1e-10);
  assert.equal(result[2], 100);
  assert.deepEqual(fromLocalCoordinates(toLocalCoordinates([332800.25, 4260700.5, 100], [332800, 4260700, 0]), [332800, 4260700, 0]), [332800.25, 4260700.5, 100]);
  assert.throws(() => geographicToWebMercator([0, 90, 0]), RangeError);
  assert.throws(() => geographicToWebMercator([181, 0, 0]), RangeError);
  assert.throws(() => webMercatorToGeographic([1e9, 0, 0]), RangeError);
  assert.throws(() => toLocalCoordinates([NaN, 0, 0], [0, 0, 0]), TypeError);
});
