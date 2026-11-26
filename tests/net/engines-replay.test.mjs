// Looking back at a match on its own engine (docs/ENGINES.md), with a second engine
// registered from a fixture (the site's own carried set is 1.4 and
// 1.0, docs/ENGINES.md; a made-up 0.6 keeps these independent of it): the vendored sources with only the version changed, made
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

const V = JSON.parse(
  fs.readFileSync(new URL("../../vendor/engine.json", import.meta.url), "utf8"),
).tag.replace(/^v/, "");
const Vre = V.replaceAll(".", "\\.");
const MM = V.split(".").slice(0, 2).join(".");
const older = fs.mkdtempSync(path.join(os.tmpdir(), "kubb-older-engine-"));
writeEngineTree(older, "0.6.9");
test.after(() => fs.rmSync(older, { recursive: true, force: true }));

const twoEngines = () =>
  makeRegistry({
    engines: {
      [MM]: { version: V, sources: bundleLua() },
      0.6: { version: "0.6.9", sources: bundleLua(older) },
    },
    newest: V,
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
  assert.equal(engines.pick("0.5"), MM);
  assert.equal(engines.pick(null), MM);
  const fallback = { version: "x" };
  assert.equal(engineFor(null, "0.6", fallback), fallback);
  // not loaded yet: a promise; loaded: at once
  const p = engineFor(engines, "0.6");
  assert.equal(typeof p.then, "function");
  const e = await p;
  assert.equal(e.version, "0.6.9");
  assert.equal(engineFor(engines, "0.6"), e);
  assert.equal((await engineFor(engines, "0.5")).version, V);
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
  // this checkout's own vendor/: 1.4 and 1.0 (docs/ENGINES.md)
  assert.deepEqual(checkoutEngines().carried(), ["1.4", "1.0"]);
});

test("the engine a record says played it", () => {
  assert.equal(matchEngineOf({ engine: "0.6.9" }), "0.6.9");
  assert.equal(matchEngineOf({}), null);
});

test("games:replay plays each match on its own engine, or the newest, or --engine", async () => {
  const engines = twoEngines();
  const old = playBrowserMatch(await engines.loadEngine("0.6"));
  const unknown = { ...old, engine: "0.5.0" };
  const said = [];
  const log = (s) => said.push(s);
  const r = await replayRecords({
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
  assert.match(lines[1], new RegExp(`actions on ${Vre}`));
  assert.match(
    lines[1],
    new RegExp(`played on engine 0\\.5\\.0, this checkout runs ${Vre}`),
  );

  said.length = 0;
  await replayRecords({
    browser: [old],
    engines,
    only: MM,
    log,
  });
  assert.match(said[0], new RegExp(`through kubb-engine ${Vre}`));
  assert.match(
    said[1],
    new RegExp(`actions on ${Vre}.*played on engine 0\\.6\\.9`),
  );
});

test("a record names the engine that played and the bundle it came from", async () => {
  const engines = twoEngines();
  const engine = await engines.loadEngine("0.6");
  const config = {
    version: "0.1.0",
    luaUrl: "/assets/lua-sources-new.json",
    engine: "1.0.0",
    engines: {
      "1.0": { version: "1.0.0", luaUrl: "/assets/lua-sources-new.json" },
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
  assert.equal(luaFor(config, "1.0.0"), "lua-sources-new.json");
  // a page with no engines map, or an engine it does not name: the newest's
  assert.equal(luaFor({ luaUrl: "/assets/x.json" }, "0.6.9"), "x.json");
  assert.equal(luaFor(config, "0.5.0"), "lua-sources-new.json");
  assert.equal(luaFor({}, "1.0.0"), null);
});

// Engine 1.0 replaced 0.18 with --drop (docs/ENGINES.md): a kept match of 0.18 says it
// can no longer be replayed, wherever it is opened, and one of the newest plays.
test("a kept 0.18 match is old; a newest one plays", async () => {
  const { replayProblem, problemText, OLD_REPLAY } =
    await import("../../src/replay/player.js");
  const r = JSON.parse(
    fs.readFileSync(
      new URL("../fixtures/replay-north-south.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(r.engine, MM);
  const engine = { version: V };
  assert.equal(replayProblem({ ...r, engine: "0.18" }, { engine }), "old");
  assert.equal(problemText("old"), OLD_REPLAY);
  const engines = makeRegistry({
    engines: { [MM]: { version: V, sources: bundleLua() } },
    newest: V,
  });
  assert.equal(replayProblem({ ...r, engine: "0.18" }, { engines }), "old");
  assert.notEqual(replayProblem(r, { engines }), "old");
});
