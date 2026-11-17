// The engine fixtures the other tests serve stay true to this checkout's engine: the
// kept replay plays to the hashes it carries (tools/replay-fixture.mjs writes it again
// after an engine change), and the snapshots restore.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Engine } from "../../src/engine/index.js";
import { bundleLua } from "../../tools/lua-bundle.mjs";
import { FIXTURE, playFixture } from "../../tools/replay-fixture.mjs";

const sources = bundleLua();
const stale = `${FIXTURE} is stale: node tools/replay-fixture.mjs`;

test("the kept replay fixture is what this engine plays, hash for hash", async () => {
  const text = fs.readFileSync(FIXTURE, "utf8");
  const kept = JSON.parse(text);
  const e = await Engine.create({ sources });
  let r = e.replayLoad(kept);
  while (!r.replay.done) {
    r = e.replayStep();
    assert.equal(r.replay.differs, false, `${stale} (action ${r.replay.i})`);
  }
  assert.equal(r.replay.i, kept.log.length);
  assert.equal(e.hash().hash, kept.hash, stale);
  assert.equal(await playFixture(sources), text, stale);
});

test("the snapshot fixtures restore", async () => {
  const e = await Engine.create({ sources });
  e.restore(fs.readFileSync("tests/fixtures/snap-in-play.json", "utf8").trim());
  assert.equal(e.need().kind, "throw");
  e.restore(fs.readFileSync("tests/fixtures/snap-over.json", "utf8").trim());
  assert.equal(e.need().kind, "over");
});
