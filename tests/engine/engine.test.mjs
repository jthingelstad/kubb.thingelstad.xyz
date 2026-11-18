// The web's host of kubb-engine (src/engine over vendor/engine): the bundle the build
// ships is the engine's own, Engine.create makes the start-up calls (the pointer tune,
// the "web <version>" label), and the engine's golden corpus (vendor/engine/golden,
// docs/DETERMINISM.md in the engine) comes out hash for hash under this repository's
// wasmoon. The session's own tests are the engine's (kubb-engine tests/).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Engine } from "../../src/engine/index.js";
import { bundleLua, bundleText } from "../../tools/lua-bundle.mjs";
import { clientLabel } from "../../src/net/sync.js";

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
  const e = await Engine.create({ sources, client: clientLabel(pkg.version) });
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
  // the label is never in the hash: a host without one plays the same match
  const plain = await Engine.create({ sources });
  plain.newMatch({ seed: 3, cpu: "both", start: START, maxTurns: 1 });
  assert.equal(plain.hash().hash, e.hash().hash);
});

test("the engine's golden corpus, every hash, under this wasmoon", async () => {
  const corpus = JSON.parse(read("vendor/engine/golden/hashes.json"));
  // the engine that wrote the corpus: a hash-neutral release keeps the one before it
  // (0.3.0 plays 0.2.0's corpus), so it is never newer than the vendored engine
  const num = (v) => v.split(".").map(Number);
  const [a, b] = [num(corpus.version), num(manifest.version)];
  assert.ok(
    a[0] < b[0] ||
      (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] <= b[2]))),
    `corpus ${corpus.version}, engine ${manifest.version}`,
  );
  const e = await Engine.create({
    sources: {
      ...sources,
      "golden/drive": read("vendor/engine/golden/drive.lua").toString("utf8"),
    },
    client: clientLabel(pkg.version),
  });
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
  assert.equal(actions, 437);
});

test("wasmoon is exactly 1.16.0, the engine's reference platform", () => {
  assert.equal(pkg.dependencies.wasmoon, "1.16.0");
  assert.equal(
    JSON.parse(read("node_modules/wasmoon/package.json")).version,
    "1.16.0",
  );
});
