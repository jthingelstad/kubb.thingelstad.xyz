// Looking back at a match on its own engine (docs/ENGINES.md), with a second engine
// registered from a fixture: the vendored sources with only the version changed, made
// in a temporary directory at test time (tests/engine/engine-fixture.mjs). Both play
// alike, so a match agrees hash for hash on either; what these pin is which engine
// each path picks, and what records and reports say played.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Engine } from "../../src/engine/index.js";
import { engineFor, makeRegistry } from "../../src/engine/registry.js";
import { luaFor } from "../../src/site/config.js";
import { matchRecord } from "../../src/net/record.js";
import { bundleLua } from "../../tools/lua-bundle.mjs";
import { checkoutEngines, engineForMatch } from "../../tools/engines.mjs";
import { matchEngineOf, replayRecords } from "../../tools/games.mjs";
import { sync } from "../../tools/vendor.mjs";
import { SETUP } from "../../tools/replay-fixture.mjs";
import {
  makeEngineRepo,
  makeVendorRoot,
  writeEngineTree,
} from "../engine/engine-fixture.mjs";

const older = fs.mkdtempSync(path.join(os.tmpdir(), "kubb-older-engine-"));
writeEngineTree(older, "0.6.9");
test.after(() => fs.rmSync(older, { recursive: true, force: true }));

const twoEngines = () =>
  makeRegistry({
    engines: {
      0.9: { version: "0.9.0", sources: bundleLua() },
      0.6: { version: "0.6.9", sources: bundleLua(older) },
    },
    newest: "0.9.0",
    create: ({ sources }) => Engine.create({ sources }),
  });

// A whole computer-against-computer match on `engine`, as a one-browser record.
function playBrowserMatch(engine) {
  engine.newMatch({ ...SETUP, maxTurns: 3 });
  const start = engine.snapshot();
  const actions = [];
  const hashes = [];
  for (let frames = 0; engine.need().kind !== "over"; frames++) {
    if (frames > 1e6) throw new Error("the match never ended");
    const out = engine.frame({ dt: 1 / 60 });
    if (out.action) {
      actions.push(out.action);
      hashes.push(engine.hash().hash);
    }
  }
  return {
    mode: "watch",
    t: Date.UTC(2026, 10, 20),
    start,
    actions,
    hashes,
    end: { hash: engine.hash().hash },
    name: null,
    client: "web",
    engine: engine.version,
  };
}

test("the browser's registry: a carried engine for its matches, the newest for others", async () => {
  const engines = twoEngines();
  assert.equal(engines.pick("0.6"), "0.6");
  assert.equal(engines.pick("0.6.2"), "0.6");
  assert.equal(engines.pick("0.5"), "0.9");
  assert.equal(engines.pick(null), "0.9");
  const fallback = { version: "x" };
  assert.equal(engineFor(null, "0.6", fallback), fallback);
  // not loaded yet: a promise; loaded: at once
  const p = engineFor(engines, "0.6");
  assert.equal(typeof p.then, "function");
  const e = await p;
  assert.equal(e.version, "0.6.9");
  assert.equal(engineFor(engines, "0.6"), e);
  assert.equal((await engineFor(engines, "0.5")).version, "0.9.0");
});

test("the tools' engines: each carried engine of a vendor folder, made once", async (t) => {
  const repo = makeEngineRepo(["0.7.4", "0.8.0"]);
  const root = makeVendorRoot();
  t.after(() => {
    repo.clean();
    root.clean();
  });
  sync({ root: root.dir, repo: repo.dir, tag: "v0.7.4" });
  sync({ root: root.dir, repo: repo.dir, tag: "v0.8.0", keep: true });
  const engines = checkoutEngines({ vendorDir: path.join(root.dir, "vendor") });
  assert.deepEqual(engines.carried(), ["0.8", "0.7"]);

  const own = await engineForMatch(engines, "0.7");
  assert.equal(own.engine.version, "0.7.4");
  assert.equal(own.own, true);
  const other = await engineForMatch(engines, "0.6.1");
  assert.equal(other.engine.version, "0.8.0");
  assert.equal(other.own, false);
  const unnamed = await engineForMatch(engines, null);
  assert.equal(unnamed.engine.version, "0.8.0");
  const only = await engineForMatch(engines, "0.7", { only: "0.8" });
  assert.equal(only.engine.version, "0.8.0");
  assert.equal(only.own, false);
  assert.equal((await engineForMatch(engines, "0.7")).engine, own.engine);
  await assert.rejects(
    engineForMatch(engines, "0.7", { only: "0.5" }),
    /carries no engine 0\.5/,
  );
  // this checkout's own vendor/: 0.9 and the 0.8 and 0.7 it keeps beside it
  assert.deepEqual(checkoutEngines().carried(), ["0.9", "0.8", "0.7"]);
});

test("the engine a record says played it", () => {
  assert.equal(matchEngineOf({ engine: "0.6.9" }), "0.6.9");
  const at = (match, w) => ({ doc: { started: true, match }, with: w });
  assert.equal(
    matchEngineOf({
      start: at({ seq: 0, engine: "0.6" }),
      steps: [at({ seq: 1 }, { e: "0.9.0" })],
    }),
    "0.6",
  );
  assert.equal(
    matchEngineOf({ start: null, steps: [at({ seq: 1 }, { e: "0.6.9" })] }),
    "0.6.9",
  );
  assert.equal(matchEngineOf({ start: null, steps: [] }), null);
});

test("games:replay plays each match on its own engine, or the newest, or --engine", async () => {
  const engines = twoEngines();
  const old = playBrowserMatch(await engines.loadEngine("0.6"));
  const unknown = { ...old, engine: "0.5.0" };
  const said = [];
  const log = (s) => said.push(s);
  const r = await replayRecords({
    matches: [],
    browser: [old, unknown],
    engines,
    log,
  });
  assert.equal(r.browser.differs, 0);
  assert.equal(r.browser.same, old.actions.length * 2);
  const lines = said.filter((s) => s.startsWith("watch"));
  assert.match(
    lines[0],
    new RegExp(`${old.actions.length} actions on 0\\.6\\.9`),
  );
  assert.doesNotMatch(lines[0], /played on engine/);
  assert.match(lines[1], /actions on 0\.9\.0/);
  assert.match(
    lines[1],
    /played on engine 0\.5\.0, this checkout runs 0\.9\.0/,
  );

  said.length = 0;
  await replayRecords({
    matches: [],
    browser: [old],
    engines,
    only: "0.9",
    log,
  });
  assert.match(said[0], /through kubb-engine 0\.9\.0/);
  assert.match(said[1], /actions on 0\.9\.0.*played on engine 0\.6\.9/);
});

test("a record names the engine that played and the bundle it came from", async () => {
  const engines = twoEngines();
  const engine = await engines.loadEngine("0.6");
  const config = {
    version: "0.1.0",
    luaUrl: "/assets/lua-sources-new.json",
    engine: "0.9.0",
    engines: {
      0.9: { version: "0.9.0", luaUrl: "/assets/lua-sources-new.json" },
      0.6: { version: "0.6.9", luaUrl: "/assets/lua-sources-0.6-old.json" },
    },
  };
  engine.newMatch({ ...SETUP, maxTurns: 1 });
  const game = {
    engine,
    need: engine.need(),
    trail: {
      kind: "match",
      start: engine.snapshot(),
      actions: [],
      hashes: [],
    },
  };
  const rec = matchRecord({ game, mode: "solo", config, now: () => 0 });
  assert.equal(rec.engine, "0.6.9");
  assert.equal(rec.build.lua, "lua-sources-0.6-old.json");
  assert.equal(luaFor(config, "0.9.0"), "lua-sources-new.json");
  // a page with no engines map, or an engine it does not name: the newest's
  assert.equal(luaFor({ luaUrl: "/assets/x.json" }, "0.6.9"), "x.json");
  assert.equal(luaFor(config, "0.5.0"), "lua-sources-new.json");
  assert.equal(luaFor({}, "0.9.0"), null);
});
