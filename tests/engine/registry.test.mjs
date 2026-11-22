// Carrying more than one engine on a page (docs/ENGINES.md): the page config's
// engines map (src/site/config.js, tools/build.mjs), the registry that makes each
// engine once (src/engine/registry.js), and room calls routed to a named engine
// (src/net/room-engine.js, lobby.js). The second engine is the vendored one with only
// its version changed, made in a temporary directory (engine-fixture.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Engine } from "../../src/engine/index.js";
import { makeRegistry, compareMinor } from "../../src/engine/registry.js";
import { withEngines } from "../../src/site/config.js";
import {
  ENGINE,
  engineConstants,
  useOlderEngine,
  useRoomEngine,
} from "../../src/net/lobby.js";
import { roomCall, roomEngine } from "../../src/net/room-engine.js";
import { bundleLua, carriedEngines } from "../../tools/lua-bundle.mjs";
import { configEngines } from "../../tools/build.mjs";
import { writeEngineTree } from "./engine-fixture.mjs";

const fake = (version) => ({ version, call: () => ({ value: version }) });

test("a page built before the set has a set of one", () => {
  const old = { engine: "0.7.4", luaUrl: "/assets/lua-sources-abc.json" };
  assert.deepEqual(withEngines(old).engines, {
    0.7: { version: "0.7.4", luaUrl: "/assets/lua-sources-abc.json" },
  });
  const now = {
    engine: "0.8.1",
    luaUrl: "/a.json",
    engines: {
      0.8: { version: "0.8.1", luaUrl: "/a.json" },
      0.7: { version: "0.7.4", luaUrl: "/b.json" },
    },
  };
  assert.equal(withEngines(now), now);
  assert.deepEqual(withEngines({ engine: "0.7.4", luaUrl: null }).engines, {});
});

test("the build names one bundle per carried engine; the newest keeps its name", async () => {
  assert.deepEqual(
    carriedEngines().map((e) => e.mm),
    ["0.13", "0.9", "0.8", "0.7"],
  );
  const asked = [];
  const asset = async (from, name) => {
    asked.push([from, name]);
    return `/assets/${name}-hash.json`;
  };
  const engines = await configEngines(
    [
      { mm: "0.13", version: "0.13.1" },
      { mm: "0.9", version: "0.9.0" },
      { mm: "0.8", version: "0.8.2" },
      { mm: "0.7", version: "0.7.4" },
    ],
    asset,
  );
  assert.deepEqual(engines, {
    0.13: { version: "0.13.1", luaUrl: "/assets/lua-sources-hash.json" },
    0.9: { version: "0.9.0", luaUrl: "/assets/lua-sources-0.9-hash.json" },
    0.8: { version: "0.8.2", luaUrl: "/assets/lua-sources-0.8-hash.json" },
    0.7: { version: "0.7.4", luaUrl: "/assets/lua-sources-0.7-hash.json" },
  });
  assert.deepEqual(asked, [
    [path.join("build", "lua-sources-0.13.json"), "lua-sources"],
    [path.join("build", "lua-sources-0.9.json"), "lua-sources-0.9"],
    [path.join("build", "lua-sources-0.8.json"), "lua-sources-0.8"],
    [path.join("build", "lua-sources-0.7.json"), "lua-sources-0.7"],
  ]);
});

test("the registry makes each engine once, newest first, and refuses others", async () => {
  const made = [];
  const engines = makeRegistry({
    engines: {
      0.7: { version: "0.7.4", luaUrl: "/b" },
      "0.10": { version: "0.10.0", luaUrl: "/c" },
      0.8: { version: "0.8.1", luaUrl: "/a" },
    },
    newest: "0.10.0",
    create: async (entry, mm) => {
      made.push(mm);
      return fake(entry.version);
    },
  });
  assert.equal(engines.newest, "0.10");
  assert.deepEqual(engines.carried(), ["0.10", "0.8", "0.7"]);
  assert.equal(engines.has("0.8"), true);
  assert.equal(engines.has("0.6"), false);
  assert.equal(engines.loaded("0.8"), null);

  const seen = [];
  engines.onLoad((e, mm) => seen.push(mm));
  const [a, b] = await Promise.all([
    engines.loadEngine("0.8"),
    engines.loadEngine("0.8"),
  ]);
  assert.equal(a, b);
  assert.equal(engines.loaded("0.8"), a);
  assert.equal((await engines.loadEngine()).version, "0.10.0");
  assert.deepEqual(made, ["0.8", "0.10"]);
  assert.deepEqual(seen, ["0.8", "0.10"]);
  await assert.rejects(engines.loadEngine("0.6"), /carries no engine 0\.6/);
  assert.ok(compareMinor("0.10", "0.9") > 0);
});

test("a bundle that is another engine is refused, and a failed load can be tried again", async () => {
  let tries = 0;
  const engines = makeRegistry({
    engines: { 0.7: { version: "0.7.4" }, 0.6: { version: "0.6.2" } },
    newest: "0.7.4",
    create: async (entry, mm) => {
      if (mm === "0.6") return fake("0.5.0");
      if (++tries === 1) throw new Error("network");
      return fake(entry.version);
    },
  });
  await assert.rejects(
    engines.loadEngine("0.6"),
    /0\.6 bundle is engine 0\.5\.0/,
  );
  await assert.rejects(engines.loadEngine("0.7"), /network/);
  assert.equal((await engines.loadEngine("0.7")).version, "0.7.4");
});

test("room calls go to the engine they name; the page plays on the newest", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kubb-second-engine-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  writeEngineTree(dir, "0.6.9");
  const newest = await Engine.create({ sources: bundleLua() });
  const older = await Engine.create({ sources: bundleLua(dir) });
  assert.equal(older.version, "0.6.9");

  useRoomEngine(newest);
  assert.equal(useOlderEngine(older), "0.6");
  assert.equal(ENGINE, "0.13");
  assert.equal(roomEngine(), newest);
  assert.equal(roomEngine("0.6"), older);
  assert.equal(roomCall("constants").ENGINE, "0.13");
  assert.equal(roomCall("constants", {}, "0.6").ENGINE, "0.6");
  assert.equal(engineConstants("0.6").ENGINE, "0.6");
  assert.equal(engineConstants().ENGINE, "0.13");
  assert.throws(() => roomCall("constants", {}, "0.5"), /no engine 0\.5/);
});
