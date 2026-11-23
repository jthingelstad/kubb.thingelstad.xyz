// The web's host of kubb-engine (src/engine over vendor/engine): the bundle the build
// ships is the engine's own, Engine.create makes the start-up calls (the pointer tune,
// the "web <version>" label), and with two engines carried each plays from its own
// folder. The whole golden corpus is golden.test.mjs, played when the engine changes
// or when asked for. The session's own tests are the engine's (kubb-engine tests/).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Engine } from "../../src/engine/index.js";
import path from "node:path";
import {
  bundleLua,
  bundleText,
  carriedEngines,
} from "../../tools/lua-bundle.mjs";
import { sync } from "../../tools/vendor.mjs";
import { makeEngineRepo, makeVendorRoot } from "./engine-fixture.mjs";
import { playGolden } from "./golden-play.mjs";
import { clientLabel, LOCATION } from "../../src/net/sync.js";

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url));
const manifest = JSON.parse(read("vendor/engine/engine.json"));
const pkg = JSON.parse(read("package.json"));
const sources = bundleLua();
const START = { year: 2026, month: 11, day: 15, hour: 10, min: 0 };

test("the Lua the site ships is the engine's bundle, byte for byte", () => {
  assert.equal(bundleText().sha256, manifest.bundle.sha256);
  assert.ok(
    sources["session/api"] && sources["tune/pointer"] && sources.version,
  );
  assert.equal(
    Object.keys(sources).some((k) => k.startsWith("web/")),
    false,
  );
});

test("Engine.create loads the pointer tune and labels the game file", async () => {
  const e = await Engine.create({
    sources,
    client: clientLabel(pkg.version),
    location: LOCATION,
  });
  assert.equal(e.version, manifest.version);
  assert.deepEqual(e.call("useTune", { name: "pointer" }), { tune: "pointer" });
  e.newMatch({ seed: 3, cpu: "both", start: START, maxTurns: 1 });
  assert.equal(clientLabel(pkg.version), `web ${pkg.version}`);
  assert.match(
    e.sheet().text,
    new RegExp(
      `\\[Scored by "Throwing Wood web ${pkg.version.replaceAll(".", "\\.")}"\\]`,
    ),
  );
  assert.match(e.sheet().text, /\[Location "throwingwood\.com"\]/);
  // neither is ever in the hash: a host without them plays the same match
  const plain = await Engine.create({ sources });
  plain.newMatch({ seed: 3, cpu: "both", start: START, maxTurns: 1 });
  assert.equal(plain.hash().hash, e.hash().hash);
  assert.match(plain.sheet().text, /\[Location "Playdate"\]/);
});

test("with two engines carried, each plays from its own corpus", async (t) => {
  // stand-ins of the newest, numbered from it on: a corpus is never newer than its engine
  const repo = makeEngineRepo(["1.0.0", "1.1.0"]);
  const root = makeVendorRoot();
  t.after(() => {
    repo.clean();
    root.clean();
  });
  sync({ root: root.dir, repo: repo.dir, tag: "v1.0.0" });
  sync({ root: root.dir, repo: repo.dir, tag: "v1.1.0", keep: true });
  const carried = carriedEngines(path.join(root.dir, "vendor"));
  assert.deepEqual(
    carried.map((e) => e.version),
    ["1.1.0", "1.0.0"],
  );
  // Both trees are copies of the newest's (tests/engine/engine-fixture.mjs), whose
  // whole corpus is golden.test.mjs. What is held here is that each engine loads and
  // plays from its own folder, and the corpus's first match shows that.
  const first = JSON.parse(read("vendor/engine/golden/hashes.json")).matches[0];
  for (const { dir, version } of carried)
    assert.equal(
      await playGolden(dir, { matches: 1 }),
      first.actions.length,
      version,
    );
});

test("wasmoon is exactly 1.16.0, the engine's reference platform", () => {
  assert.equal(pkg.dependencies.wasmoon, "1.16.0");
  assert.equal(
    JSON.parse(read("node_modules/wasmoon/package.json")).version,
    "1.16.0",
  );
});
