// A forged match from outside, judged by the engine (its names.check and strict doors,
// since 0.13.4; docs/MULTIPLAYER.md "Names"): the committed replay fixture with only
// `save.game.teams.A.name` changed keeps generated names in `opts.teams`, so a check of
// the options alone would pass it, but `restore` builds the match from `save`. Each
// boundary the web runs the engine at refuses it: adopting a pitch's snapshot
// (Game.adopt's restoreChecked), a kept replay (replayProblem, replayLoad), and the
// pitch's document (names.check), while the honest fixture passes everywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { engine } from "./room-engine.mjs";
import { NamesRefused } from "../../src/engine/index.js";
import { replayProblem } from "../../src/replay/player.js";

const REPLAY = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/replay-north-south.json", import.meta.url),
    "utf8",
  ),
);
// exactly the forgery: one field of the saved game, the options left generated
const forge = (snapText, text = "Typed Text") => {
  const s = JSON.parse(snapText);
  s.save.game.teams.A.name = text;
  return JSON.stringify(s);
};
const FORGED_SNAP = forge(REPLAY.snap);
const FORGED_REPLAY = { ...REPLAY, snap: FORGED_SNAP };

test("the forgery keeps the options generated: only the saved game differs", () => {
  const s = JSON.parse(FORGED_SNAP);
  assert.equal(s.opts.teams.A.name, "Mighty Maple");
  assert.equal(s.save.game.teams.A.name, "Typed Text");
  assert.equal(engine.call("names.check", { snap: REPLAY.snap }).allowed, true);
  const out = engine.call("names.check", { snap: FORGED_SNAP });
  assert.equal(out.allowed, false);
  assert.deepEqual(
    out.refused.map((r) => r.place),
    ["save.game.teams.A.name"],
  );
  assert.equal(out.mismatches.length, 1, "the two copies disagree");
});

test("a pitch's snapshot: the strict door refuses the forgery and changes nothing", () => {
  engine.restoreChecked(REPLAY.snap);
  const before = engine.hash().hash;
  assert.throws(
    () => engine.restoreChecked(FORGED_SNAP),
    (err) => {
      assert.ok(err instanceof NamesRefused);
      // the error names places, never the text
      assert.ok(!err.message.includes("Typed Text"), err.message);
      assert.match(err.message, /save\.game\.teams\.A\.name/);
      return true;
    },
  );
  assert.equal(engine.hash().hash, before, "the session is as it was");
  // this browser's own snapshot still resumes with the plain restore
  engine.restore(FORGED_SNAP);
});

test("a kept replay: replayProblem says names, and replayLoad refuses it", () => {
  assert.equal(replayProblem(REPLAY, { engine }), null);
  assert.equal(replayProblem(FORGED_REPLAY, { engine }), "names");
  assert.throws(() => engine.replayLoad(FORGED_REPLAY), NamesRefused);
  // the honest replay loads through the same door
  assert.ok(engine.replayLoad(REPLAY).replay);
  engine.replayEnd();
});

test("a pitch's document: a refused name is not among the places that pass", () => {
  const out = engine.call("names.check", {
    document: {
      v: 1,
      teams: { A: ["a", "b"], B: ["c"] },
      teamNames: { A: "Typed Team", B: "Wobbly Towers" },
    },
    members: [
      { id: "a", me: { name: "Typed Text" } },
      { id: "b", me: { name: "Mighty Maple" } },
    ],
  });
  const refused = new Set(out.refused.map((r) => r.from));
  assert.ok(refused.has("teamNames.A"));
  assert.ok(refused.has("members[0].me.name"));
  assert.ok(!refused.has("teamNames.B"));
  assert.ok(!refused.has("members[1].me.name"));
});
