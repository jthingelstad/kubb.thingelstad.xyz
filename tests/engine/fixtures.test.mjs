// The engine fixtures the other tests serve stay true to this checkout's engine: the
// kept replay plays to the hashes it carries (tools/replay-fixture.mjs writes it again
// after an engine change), and the snapshots restore.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Engine } from "../../src/engine/index.js";
import { bundleLua, carriedEngines } from "../../tools/lua-bundle.mjs";
import {
  FIXTURE,
  fixtureFor,
  playFixture,
} from "../../tools/replay-fixture.mjs";

const sources = bundleLua();

// Each carried engine plays its own kept replay (docs/ENGINES.md): the newest's is
// FIXTURE, an older one's carries its major.minor in the name.
test("each engine's kept replay fixture is what it plays, hash for hash", async () => {
  const carried = carriedEngines();
  assert.equal(fixtureFor(carried[0].mm), FIXTURE);
  for (const [i, { mm, dir }] of carried.entries()) {
    const file = fixtureFor(mm);
    const stale = `${file} is stale: node tools/replay-fixture.mjs${i ? ` --engine ${mm}` : ""}`;
    assert.ok(fs.existsSync(file), stale);
    const text = fs.readFileSync(file, "utf8");
    const kept = JSON.parse(text);
    const own = bundleLua(dir);
    const e = await Engine.create({ sources: own });
    let r = e.replayLoad(kept);
    while (!r.replay.done) {
      r = e.replayStep();
      assert.equal(r.replay.differs, false, `${stale} (action ${r.replay.i})`);
    }
    assert.equal(r.replay.i, kept.log.length);
    assert.equal(e.hash().hash, kept.hash, stale);
    assert.equal(await playFixture(own), text, stale);
  }
  assert.equal(
    fixtureFor("0.6", "0.7"),
    "tests/fixtures/replay-north-south-0.6.json",
  );
});

test("the snapshot fixtures restore", async () => {
  const e = await Engine.create({ sources });
  e.restore(fs.readFileSync("tests/fixtures/snap-in-play.json", "utf8").trim());
  assert.equal(e.need().kind, "throw");
  e.restore(fs.readFileSync("tests/fixtures/snap-over.json", "utf8").trim());
  assert.equal(e.need().kind, "over");
});
