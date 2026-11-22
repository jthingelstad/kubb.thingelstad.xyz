// The web's host of kubb-engine (src/engine over vendor/engine): the bundle the build
// ships is the engine's own, Engine.create makes the start-up calls (the pointer tune,
// the "web <version>" label), and each carried engine's golden corpus (its golden/,
// docs/DETERMINISM.md in the engine) comes out hash for hash under this repository's
// wasmoon. The session's own tests are the engine's (kubb-engine tests/).
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

// One engine folder's golden corpus played by that engine. Returns the actions played.
async function playGolden(dir) {
  const at = (f) => fs.readFileSync(path.join(dir, f));
  const engineJson = JSON.parse(at("engine.json"));
  const corpus = JSON.parse(at("golden/hashes.json"));
  // the engine that wrote the corpus: a hash-neutral release keeps the one before it
  // (0.3.0 plays 0.2.0's corpus), so it is never newer than the engine
  const num = (v) => v.split(".").map(Number);
  const [a, b] = [num(corpus.version), num(engineJson.version)];
  assert.ok(
    a[0] < b[0] ||
      (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] <= b[2]))),
    `corpus ${corpus.version}, engine ${engineJson.version}`,
  );
  const e = await Engine.create({
    sources: {
      ...bundleLua(dir),
      "golden/drive": at("golden/drive.lua").toString("utf8"),
    },
    client: clientLabel(pkg.version),
  });
  assert.equal(e.version, engineJson.version);
  await e.lua.doString(`import "golden/drive"`);
  const played = JSON.parse(
    await e.lua.doString(`
      local out = {}
      for i, m in ipairs(tw.golden.matches()) do out[i] = tw.golden.play(m) end
      return tw.web.json.encode(out)`),
  );
  assert.equal(played.length, corpus.matches.length);
  let actions = 0;
  played.forEach((m, i) => {
    const want = corpus.matches[i];
    assert.equal(m.name, want.name);
    assert.equal(m.start, want.start, `${m.name}: the starting hash`);
    assert.deepEqual(m.actions, want.actions, `${m.name}: the actions`);
    actions += m.actions.length;
  });
  return actions;
}

// Every engine the site carries against its own corpus (docs/ENGINES.md).
test("the engine's golden corpus, every hash, under this wasmoon", async () => {
  const carried = carriedEngines();
  assert.equal(carried[0].version, manifest.version);
  const played = [];
  for (const { dir, version } of carried)
    played.push([version, await playGolden(dir)]);
  // 0.13.0's corpus: 15 matches, 579 actions; 0.9.0 wrote a new corpus: 523
  // actions; 0.8.0 added short batons under 2 m to its corpus: 505 actions; 0.7
  // plays 437
  assert.deepEqual(played, [
    [manifest.version, 579],
    ["0.9.0", 523],
    ["0.8.2", 505],
    ["0.7.4", 437],
  ]);
});

test("with two engines carried, each plays its own corpus", async (t) => {
  // stand-ins of the newest, numbered from it on: a corpus is never newer than its engine
  const repo = makeEngineRepo(["0.13.1", "0.14.0"]);
  const root = makeVendorRoot();
  t.after(() => {
    repo.clean();
    root.clean();
  });
  sync({ root: root.dir, repo: repo.dir, tag: "v0.13.1" });
  sync({ root: root.dir, repo: repo.dir, tag: "v0.14.0", keep: true });
  const carried = carriedEngines(path.join(root.dir, "vendor"));
  assert.deepEqual(
    carried.map((e) => e.version),
    ["0.14.0", "0.13.1"],
  );
  // both trees are copies of the newest's (tests/engine/engine-fixture.mjs)
  for (const { dir } of carried) assert.equal(await playGolden(dir), 579);
});

test("wasmoon is exactly 1.16.0, the engine's reference platform", () => {
  assert.equal(pkg.dependencies.wasmoon, "1.16.0");
  assert.equal(
    JSON.parse(read("node_modules/wasmoon/package.json")).version,
    "1.16.0",
  );
});
