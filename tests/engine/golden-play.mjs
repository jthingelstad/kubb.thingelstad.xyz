// One engine folder's golden corpus (its golden/, docs/DETERMINISM.md in the engine)
// played by that engine under this repository's wasmoon, each hash held to the corpus.
// Returns the actions played. `matches` plays only that many from the front: the whole
// corpus takes minutes, and a test of which folder an engine plays from needs one match.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Engine } from "../../src/engine/index.js";
import { bundleLua } from "../../tools/lua-bundle.mjs";
import { clientLabel } from "../../src/net/sync.js";

const pkg = JSON.parse(
  fs.readFileSync(new URL("../../package.json", import.meta.url)),
);

export async function playGolden(dir, { matches = Infinity } = {}) {
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
  const count = Math.min(matches, corpus.matches.length);
  const played = JSON.parse(
    await e.lua.doString(`
      local out = {}
      for i, m in ipairs(tw.golden.matches()) do
        if i > ${count} then break end
        out[i] = tw.golden.play(m)
      end
      return tw.web.json.encode(out)`),
  );
  assert.equal(played.length, count);
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
