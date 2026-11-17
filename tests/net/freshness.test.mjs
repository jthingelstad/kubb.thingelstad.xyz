// The release line and the freshness check (src/site/release.js,
// src/net/freshness.js): the deployed release is newer only when its web
// commit differs, the check never reads a cache, waits between asks, and
// calls onStale once.
import assert from "node:assert/strict";
import test from "node:test";
import {
  isStale,
  makeRelease,
  parseCoreVersion,
  releaseText,
} from "../../src/site/release.js";
import { watchFreshness } from "../../src/net/freshness.js";

const A = "a2659b744210e4c5baa5b69c672e11ec87f9bfab";
const B = "bc5199f0000000000000000000000000000000aa";
const CORE = "cca8012ffffffffffffffffffffffffffffffff0";

test("the release line is version (build) · web · core", () => {
  assert.equal(
    releaseText({ version: "0.9.5", build: 6, web: A, core: CORE }),
    "0.9.5 (6) · web a2659b7 · core cca8012",
  );
  assert.equal(
    makeRelease({ version: "0.9.5", build: 6, web: null, core: null }).text,
    "0.9.5 (6) · web dev · core dev",
  );
});

test("the game's version comes from core/version.lua's constants", () => {
  const lua =
    'local VERSION <const> = "0.9.5"\nlocal BUILD <const> = 6\ntw.version = {}\n';
  assert.deepEqual(parseCoreVersion(lua), { version: "0.9.5", build: 6 });
  assert.throws(() => parseCoreVersion("tw.version = {}"));
});

test("stale only when the deployed web commit differs", () => {
  const loaded = { web: A };
  assert.equal(isStale(loaded, { web: A }), false);
  assert.equal(isStale(loaded, { web: B }), true);
  assert.equal(isStale(loaded, { web: "not a sha" }), false);
  assert.equal(isStale(loaded, null), false);
  assert.equal(isStale({ web: null }, { web: B }), false);
});

function harness(answer) {
  const listeners = {};
  const doc = {
    visibilityState: "visible",
    addEventListener: (t, fn) => (listeners[t] = fn),
    removeEventListener: (t) => delete listeners[t],
  };
  let clock = 0;
  let tick = null;
  const asks = [];
  const stale = [];
  const w = watchFreshness({
    release: { web: A },
    onStale: (d) => stale.push(d),
    doc,
    now: () => clock,
    every: (fn) => ((tick = fn), 1),
    fetchImpl: async (url, opts) => {
      asks.push({ url, opts });
      return { ok: true, json: async () => answer() };
    },
  });
  return {
    w,
    asks,
    stale,
    doc,
    advance: (ms) => (clock += ms),
    show: () => listeners.visibilitychange(),
    tick: () => tick(),
  };
}

const settle = () => new Promise((r) => setImmediate(r));

test("asks with no-store when the page shows again, at most once a minute", async () => {
  const t = harness(() => ({ web: A }));
  t.show();
  await settle();
  assert.equal(t.asks.length, 0, "not right after loading");
  t.advance(61000);
  t.show();
  await settle();
  assert.equal(t.asks.length, 1);
  assert.equal(t.asks[0].url, "/version.json");
  assert.deepEqual(t.asks[0].opts, { cache: "no-store" });
  t.advance(5000);
  t.show();
  await settle();
  assert.equal(t.asks.length, 1, "not again within the minute");
  assert.equal(t.stale.length, 0);
  t.w.stop();
});

test("the 10 minute tick asks only while visible, and onStale fires once", async () => {
  const t = harness(() => ({ web: B }));
  t.doc.visibilityState = "hidden";
  t.tick();
  await settle();
  assert.equal(t.asks.length, 0, "a hidden tab does not ask");
  t.doc.visibilityState = "visible";
  t.tick();
  await settle();
  assert.equal(t.asks.length, 1);
  assert.equal(t.stale.length, 1);
  t.advance(20 * 60000);
  t.tick();
  t.show();
  await settle();
  assert.equal(t.asks.length, 1, "nothing more once told");
  t.w.stop();
});

test("a failed ask is quiet and asks again later", async () => {
  let fail = true;
  const t = harness(() => {
    if (fail) throw new Error("offline");
    return { web: B };
  });
  t.tick();
  await settle();
  assert.equal(t.stale.length, 0);
  fail = false;
  t.tick();
  await settle();
  assert.equal(t.stale.length, 1);
  t.w.stop();
});
