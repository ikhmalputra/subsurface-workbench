import assert from "node:assert/strict";
import test from "node:test";
import { readVersion, resetVersionWatch, runningVersion, startUpdateWatch, subscribeUpdate, updateAvailable } from "../src/deck/version.ts";

const build = (version: string, commit: string) => ({ version, commit, builtAt: "2026-10-17T00:00:00Z", schemas: { config: 1, contract: "1.1" }, minUpgradeFrom: "0.0.1" });
const serving = (bodies: () => unknown) => {
  const urls: string[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    assert.equal(init?.cache, "no-store", "the version file is never read from the HTTP cache");
    const body = bodies();
    return body === undefined ? new Response("not here", { status: 404 }) : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetcher, urls };
};
/** A window whose interval and visibility the test drives by hand. */
const fakeWindow = () => {
  let tick: (() => void) | null = null;
  const handlers = new Map<string, () => void>();
  let visibility: DocumentVisibilityState = "visible";
  return {
    window: {
      setInterval: ((fn: () => void) => { tick = fn; return 1; }) as unknown as Window["setInterval"],
      clearInterval: (() => { tick = null; }) as Window["clearInterval"],
      addEventListener: ((type: string, fn: () => void) => handlers.set(type, fn)) as unknown as Window["addEventListener"],
      removeEventListener: ((type: string) => handlers.delete(type)) as unknown as Window["removeEventListener"],
      get document() { return { visibilityState: visibility }; },
    },
    tick: () => tick?.(), show: () => { visibility = "visible"; handlers.get("visibilitychange")?.(); }, hide: () => { visibility = "hidden"; handlers.get("visibilitychange")?.(); },
    get watching() { return tick !== null && handlers.size > 0; },
  };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("readVersion reads <base>version.json and refuses anything that is not a version file", async () => {
  const good = serving(() => build("0.3.0", "abc1234"));
  assert.deepEqual(await readVersion("/sub/", good.fetcher), build("0.3.0", "abc1234"));
  assert.deepEqual(good.urls, ["/sub/version.json"]);
  assert.equal(await readVersion("/", serving(() => undefined).fetcher), null, "a host without the file");
  assert.equal(await readVersion("/", serving(() => ({ hello: 1 })).fetcher), null, "a file that is not a version");
  assert.equal(await readVersion("/", (async () => { throw new TypeError("offline"); }) as typeof fetch), null, "a network failure");
});

test("the first read is the running build; a later read naming another build announces an update once", async () => {
  resetVersionWatch();
  let served: unknown = build("0.3.0", "abc1234");
  const { fetcher, urls } = serving(() => served);
  const win = fakeWindow();
  const changes: (string | null)[] = [];
  subscribeUpdate(() => changes.push(updateAvailable()?.version ?? null));
  const stop = startUpdateWatch({ base: "/", fetcher, window: win.window });
  await settle();
  assert.deepEqual(runningVersion(), build("0.3.0", "abc1234"));
  assert.equal(updateAvailable(), null);
  win.tick(); await settle();
  assert.equal(updateAvailable(), null, "the same build again is not an update");
  // A rebuild of the same version is new code: it counts.
  served = build("0.3.0", "def5678");
  win.tick(); await settle();
  assert.equal(updateAvailable()?.commit, "def5678");
  win.tick(); await settle();
  assert.deepEqual(changes, [null, "0.3.0"], "listeners hear the first read and the update, not every poll");
  served = build("0.4.0", "0123456");
  win.show(); await settle();
  assert.equal(updateAvailable()?.version, "0.4.0", "coming back into view checks again");
  win.hide(); const before = urls.length; await settle();
  assert.equal(urls.length, before, "going hidden does not");
  assert.ok(win.watching);
  stop();
  assert.equal(win.watching, false, "stopping clears the timer and the listener");
});

test("a host that stops serving the file never fakes an update", async () => {
  resetVersionWatch();
  let served: unknown = build("0.3.0", "abc1234");
  const { fetcher } = serving(() => served);
  const win = fakeWindow();
  const stop = startUpdateWatch({ base: "/", fetcher, window: win.window });
  await settle();
  served = undefined;
  win.tick(); await settle();
  assert.equal(updateAvailable(), null);
  assert.equal(runningVersion()?.version, "0.3.0");
  stop();
});
