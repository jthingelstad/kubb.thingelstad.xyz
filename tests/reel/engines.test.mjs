// The highlight reel renderer and the share check on the match's own engine
// (docs/ENGINES.md, docs/REEL.md "Engines"). The site carries one engine today, so a
// second is made at test time: a vendor folder in a temporary directory synced from a
// stand-in kubb-engine (tests/engine/engine-fixture.mjs), 0.7.4 as the newest and
// 0.6.9 kept, the vendored sources with only the version changed. Both play alike;
// what these pin is which engine each path runs, what the package carries, and that a
// match of an engine not carried is refused as before.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { asciiJson } from "../../backend/api/checks.mjs";
import { createApi } from "../../backend/api/core.mjs";
import { memoryStore } from "../../backend/api/memory-store.mjs";
import { memoryReels } from "./memory-reels.mjs";
import { carriedLookup } from "../../backend/reels/carried.mjs";
import { checkShare } from "../../backend/reels/check.mjs";
import { packageEngines } from "../../backend/reels/handler.mjs";
import { pickHighlights } from "../../backend/reels/highlights.mjs";
import { runReel } from "../../backend/reels/job.mjs";
import { scanReplay } from "../../backend/reels/scan.mjs";
import { bundleLua, carriedEngines } from "../../tools/lua-bundle.mjs";
import {
  bundleReels,
  engineEntries,
  reelEngines,
} from "../../tools/reels-bundle.mjs";
import { devCarried, devReelEngines } from "../../tools/reels-dev.mjs";
import { replayEngine } from "../../tools/reel/render.mjs";
import { playSolo, soloSetup } from "../../tools/reel/solo.mjs";
import { sync } from "../../tools/vendor.mjs";
import { makeEngineRepo, makeVendorRoot } from "../engine/engine-fixture.mjs";

const repo = makeEngineRepo(["0.6.9", "0.7.4"]);
const root = makeVendorRoot();
sync({ root: root.dir, repo: repo.dir, tag: "v0.6.9" });
sync({ root: root.dir, repo: repo.dir, tag: "v0.7.4", keep: true });
const vendorDir = path.join(root.dir, "vendor");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "kubb-reel-engines-"));
test.after(() => {
  repo.clean();
  root.clean();
  fs.rmSync(scratch, { recursive: true, force: true });
});

const carried = devCarried(vendorDir);
const ROOM = "abcdefgh23";
const T0 = 1_700_000_000_000;
const replayOf = (engine) => ({
  v: 1,
  n: 1,
  engine,
  log: [{ a: { type: "throw", how: "baton" } }],
  snap: "{}",
});

test("the package carries one bundle per engine, newest first, the same bytes every time", async () => {
  assert.equal(reelEngines(vendorDir), "0.7,0.6");
  assert.deepEqual(devReelEngines(vendorDir), ["0.7", "0.6"]);
  // this checkout: the newest alone (docs/ENGINES.md), REEL_ENGINES "0.15"
  assert.equal(reelEngines(), "0.15");
  assert.deepEqual(
    engineEntries().map((e) => e.name),
    carriedEngines().map((e) => `engines/${e.mm}.json`),
  );

  const two = engineEntries(vendorDir);
  assert.deepEqual(
    two.map((e) => e.name),
    ["engines/0.7.json", "engines/0.6.json"],
  );
  const read = two.map((e) => JSON.parse(e.data));
  assert.deepEqual(
    read.map((x) => x.engine),
    ["0.7.4", "0.6.9"],
  );
  assert.deepEqual(read[0].sources, bundleLua(path.join(vendorDir, "engine")));
  const again = engineEntries(vendorDir);
  two.forEach((e, i) => assert.ok(e.data.equals(again[i].data), e.name));

  const binary = {
    node: Buffer.from("not a real binary"),
    pkg: Buffer.from('{"name":"@napi-rs/canvas-linux-arm64-gnu"}'),
  };
  const a = await bundleReels({ binary, vendorDir });
  const b = await bundleReels({ binary, vendorDir });
  assert.ok(a.zip.equals(b.zip));
  assert.equal(a.key, b.key);
  const text = a.zip.toString("latin1");
  assert.ok(text.includes("engines/0.7.json"));
  assert.ok(text.includes("engines/0.6.json"));
  assert.ok(!text.includes("lua-sources.json"));
});

test("the function reads each engine of its package once, and only one it holds", () => {
  const dir = path.join(scratch, "engines");
  fs.mkdirSync(dir, { recursive: true });
  for (const e of engineEntries(vendorDir))
    fs.writeFileSync(path.join(scratch, e.name), e.data);
  // a file that names another engine than its name is not carried
  fs.writeFileSync(
    path.join(dir, "0.5.json"),
    JSON.stringify({ engine: "0.7.4", sources: {} }),
  );
  const lookup = packageEngines(dir);
  assert.deepEqual(lookup.list().sort(), ["0.5", "0.6", "0.7"]);
  assert.equal(lookup("0.6").engine, "0.6.9");
  assert.equal(lookup("0.6"), lookup("0.6"));
  assert.equal(lookup("0.7").engine, "0.7.4");
  assert.equal(lookup("0.5"), null);
  assert.equal(lookup("0.8"), null);
});

test("carriedLookup: a set, a function, or one engine as a set of one", () => {
  const set = { 0.6: { engine: "0.6.9", sources: 1 } };
  assert.equal(carriedLookup({ carried: set })("0.6").engine, "0.6.9");
  assert.equal(carriedLookup({ carried: set })("toString"), null);
  assert.equal(carriedLookup({ carried: () => undefined })("0.6"), null);
  const one = carriedLookup({ engine: "0.7.4", sources: 2 });
  assert.deepEqual(one("0.7"), { engine: "0.7.4", sources: 2 });
  assert.equal(one("0.6"), null);
  assert.equal(carriedLookup({})("0.7"), null);
});

async function reelRun({ replay, tag, engines = ["0.7", "0.6"] }) {
  const store = memoryReels({ now: () => T0 });
  const exp = T0 / 1000 + 3600;
  await store.putReplay(ROOM, {
    v: 4,
    t: T0,
    data: JSON.stringify(replay),
    exp,
  });
  await store.putReel(
    ROOM,
    { v: 4, tag, job: `4-${tag}`, at: T0, exp },
    { staleBefore: 0 },
  );
  let rendered = null;
  const logs = [];
  const out = await runReel({
    input: { room: ROOM, v: 4, tag },
    store,
    carried,
    engines,
    upload: async () => {},
    render: async ({ out: dir, engine, sources }) => {
      rendered = { engine, sources };
      const files = {};
      for (const f of ["tall", "wide", "edit"]) {
        files[f] = `${dir}/${f}`;
        fs.writeFileSync(files[f], f);
      }
      return { files, edit: { seconds: 30 } };
    },
    now: () => T0 + 5,
    log: (e) => logs.push(e),
  });
  return { out, rendered, logs };
}

test("a reel renders on the engine its match was played on, and only that one", async () => {
  const older = await reelRun({ replay: replayOf("0.6.9"), tag: "r1-0.6" });
  assert.equal(older.out.state, "done");
  assert.equal(older.out.wide, `/reels/${ROOM}/4-r1-0.6/wide.mp4`);
  assert.equal(older.rendered.engine, "0.6.9");
  assert.equal(older.rendered.sources, carried("0.6").sources);
  assert.ok(older.logs.every((e) => e.engine === "0.6.9"));

  const newest = await reelRun({ replay: replayOf("0.7.4"), tag: "r1-0.7" });
  assert.equal(newest.out.state, "done");
  assert.equal(newest.rendered.engine, "0.7.4");
  assert.equal(newest.rendered.sources, carried("0.7").sources);

  for (const [replay, tag, engines] of [
    [replayOf("0.5.0"), "r1-0.5", undefined], // not carried
    [replayOf("0.6.9"), "r1-0.7", undefined], // the tag names another engine
    [replayOf("0.7.4"), "r1-0.6", undefined],
    [replayOf("0.6.9"), "r1-0.6", ["0.7"]], // carried, not in REEL_ENGINES
    [replayOf(undefined), "r1-0.7", undefined],
  ]) {
    const r = await reelRun({ replay, tag, engines });
    assert.deepEqual(r.out, { state: "failed", why: "engine" }, tag);
    assert.equal(r.rendered, null);
  }
});

test("a shared match is checked on the engine it names, and one not carried is refused", async () => {
  const older = carried("0.6");
  const played = await playSolo(soloSetup(2), older.sources);
  const g = {
    engine: "0.6.9",
    start: played.start,
    log: played.log,
    end: { winner: played.end.winner, throws: played.end.throws },
  };
  const out = await checkShare({ g, carried, engines: ["0.7", "0.6"] });
  assert.equal(out.ok, true);
  assert.equal(out.engine, "0.6.9");
  assert.equal(
    JSON.parse(out.replay).engine.split(".").slice(0, 2).join("."),
    "0.6",
  );
  // REEL_ENGINES without it, or an engine the package does not hold: as today
  for (const [share, engines] of [
    [g, ["0.7"]],
    [{ ...g, engine: "0.5.2" }, ["0.7", "0.6", "0.5"]],
    [{ ...g, engine: "junk" }, ["0.7", "0.6"]],
  ])
    assert.deepEqual(await checkShare({ g: share, carried, engines }), {
      ok: false,
      why: "engine",
      step: "engine",
    });
});

// The api function with the reel function's REEL_ENGINES: what it starts and asks.
function apiWith({ engines, store }) {
  const started = [];
  const checked = [];
  const api = createApi({
    store,
    now: () => T0,
    reelEngines: engines,
    startReel: async (job) => started.push(job),
    checkShare: async (g) => {
      checked.push(g.engine);
      return { ok: false, why: "does-not-replay" };
    },
    log: () => {},
  });
  const post = async (path, body) =>
    JSON.parse(
      (
        await api.handle({
          method: "POST",
          path,
          query: new URLSearchParams(),
          headers: {},
          body: Buffer.from(asciiJson(body)),
        })
      ).body,
    );
  return {
    started,
    checked,
    reel: (pitch) => post("/reel", { pitch }),
    share: (g) => post("/share", { g }),
  };
}

test("after the site moves to 0.8: a 0.7 match keeps its r1-0.7 reel, a 0.8 match gets r1-0.8", async () => {
  const store = memoryStore({ now: () => T0 });
  const exp = T0 / 1000 + 3600;
  const V = T0 - 1000;
  // a kept replay as the api keeps one: the log's half and the final snapshot's half
  const keep = async (code, engine) => {
    await store.putKept(code, {
      made: V,
      n: 1,
      v: V,
      data: JSON.stringify(replayOf(engine)),
      exp,
    });
    await store.putFinal(code, { made: V, n: 1, snap: "{}", exp });
  };
  const finish = (code, fields) =>
    Object.assign(store.items.get(`pitch#${code}|reel`), fields);
  await keep("seventhm", "0.7.4");

  // today: the 0.7 match's reel is asked for, rendered and done
  const today = apiWith({ engines: ["0.7"], store });
  const first = await today.reel("seventhm");
  assert.equal(first.reel.tag, "r1-0.7");
  assert.deepEqual(today.started, [{ room: "seventhm", v: V, tag: "r1-0.7" }]);
  finish("seventhm", {
    state: "done",
    wide: `/reels/seventhm/${V}-r1-0.7/wide.mp4`,
    tall: `/reels/seventhm/${V}-r1-0.7/tall.mp4`,
    edit: `/reels/seventhm/${V}-r1-0.7/edit.json`,
    seconds: 30,
    done: T0,
  });

  // the site carries 0.8 and keeps 0.7: the same reel, nothing rendered again
  const later = apiWith({ engines: ["0.8", "0.7"], store });
  const again = await later.reel("seventhm");
  assert.equal(again.reel.state, "done");
  assert.equal(again.reel.tag, "r1-0.7");
  assert.equal(later.started.length, 0);

  await keep("aughtmmm", "0.8.1");
  const eighth = await later.reel("aughtmmm");
  assert.equal(eighth.reel.tag, "r1-0.8");
  assert.deepEqual(later.started, [{ room: "aughtmmm", v: V, tag: "r1-0.8" }]);

  // a 0.7 share from an iPhone build still on 0.7 goes on to the check
  const share = {
    engine: "0.7.4",
    start: "{}",
    log: [],
    end: { winner: "A", throws: 1 },
  };
  const asked = await later.share(share);
  assert.deepEqual(later.checked, ["0.7.4"]);
  assert.equal(asked.why, "does-not-replay");

  // once 0.7 is dropped: a share is refused before the check, as any engine not
  // carried is, but the reel already made is still answered
  const dropped = apiWith({ engines: ["0.8"], store });
  assert.equal((await dropped.share(share)).why, "engine");
  assert.deepEqual(dropped.checked, []);
  const kept = await dropped.reel("seventhm");
  assert.equal(kept.reel.state, "done");
  assert.equal(kept.reel.wide, `/reels/seventhm/${V}-r1-0.7/wide.mp4`);
  assert.equal(dropped.started.length, 0);

  // a 0.7 match with no reel made yet: refused, and nothing is started or written
  await keep("sxthmmmm", "0.7.4");
  const none = await dropped.reel("sxthmmmm");
  assert.equal(none.reel, null);
  assert.equal(none.why, "engine");
  assert.equal(dropped.started.length, 0);
  assert.equal(await store.getReel("sxthmmmm"), null);
  // nor one whose render was started but never finished
  await keep("ffthmmmm", "0.7.4");
  await store.putReel(
    "ffthmmmm",
    { v: V, tag: "r1-0.7", job: `${V}-r1-0.7`, at: T0, exp },
    { staleBefore: 0 },
  );
  const rendering = await dropped.reel("ffthmmmm");
  assert.equal(rendering.why, "engine");
  assert.equal(dropped.started.length, 0);
});

test("the command line renders a replay on its own engine where the checkout carries it", () => {
  assert.equal(replayEngine({ engine: "0.6.9" }, vendorDir).version, "0.6.9");
  const other = replayEngine({ engine: "0.5.0" }, vendorDir);
  assert.equal(other.version, "0.7.4");
  assert.equal(other.own, false);
});

// One render test per carried engine: the kept fixture scanned and its highlights
// picked on each (the encoder is not run here: CI has no ffmpeg).
for (const { mm, dir } of carriedEngines())
  test(`the renderer scans the kept replay on carried engine ${mm} and finds moments`, async () => {
    const replay = JSON.parse(
      fs.readFileSync(
        new URL("../fixtures/replay-north-south.json", import.meta.url),
        "utf8",
      ),
    );
    const scan = await scanReplay(replay, { sources: bundleLua(dir) });
    assert.ok(scan.throws.length > 0);
    assert.ok(pickHighlights(scan).moments.length > 0);
  });
