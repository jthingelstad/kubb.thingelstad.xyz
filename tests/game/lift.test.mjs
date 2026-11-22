// Watching a raise (src/game/lift.js): the pace, the clip of a raise action (the end
// the engine's choice stands it on, the same tip as the hand's drag), and the kubbs
// the engine raised itself found between two throws of a real match.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  liftPace,
  actionClip,
  raiseEnd,
  settledClips,
  turnItem,
  liftKubb,
  tune,
} from "../../src/game/lift.js";
import { tiltItem } from "../../src/game/raise-touch.js";
import { poseItem } from "../../src/game/scenes.js";
import { Engine } from "../../src/engine/index.js";
import { bundleLua } from "../../tools/lua-bundle.mjs";

test("half a second a kubb, quicker when there are many, the whole raise 4 s at most", () => {
  assert.deepEqual(liftPace(1), { lead: 0.4, beat: 0.5, tip: 0.35 });
  assert.equal(liftPace(7).beat, 0.5);
  for (const n of [8, 10, 14, 20]) {
    const p = liftPace(n);
    assert.ok(p.beat < 0.5, `${n} kubbs`);
    assert.ok(p.lead + n * p.beat <= tune.total + 1e-9, `${n} kubbs in 4 s`);
  }
  assert.ok(liftPace(100).beat >= tune.minBeat);
});

const pose = { x: 0.7, y: 2.3, angle: 0.35, standing: false };
const foot = (k) => ({
  x: pose.x + k * Math.cos(pose.angle) * 0.11,
  y: pose.y + k * Math.sin(pose.angle) * 0.11,
  standing: true,
  angle: pose.angle,
});
const need = {
  kind: "raise",
  side: "A",
  kubb: "b2",
  n: 1,
  of: 2,
  pose,
  default: 2,
  ends: [
    { which: 1, ok: true, pose: foot(1) },
    { which: 2, ok: true, pose: foot(-1) },
  ],
  choices: [
    { which: 1, pose: foot(1) },
    { which: 2, pose: foot(-1) },
  ],
  others: [{ id: "b3", pose: { x: 1.2, y: 2.6, standing: false, angle: 1 } }],
  king: { x: 0, y: 4, standing: true, angle: 0 },
};

test("a raise action's clip stands the kubb on the engine's end, tipped as the hand tips it", () => {
  // no choice: the engine's own (default 2, end 2)
  assert.deepEqual(raiseEnd(need, { type: "raise" }).i, 1);
  assert.deepEqual(raiseEnd(need, { type: "raise", choice: 1 }).i, 0);
  const clip = actionClip(need, { type: "raise" });
  const kubb = (u) => clip.items(u).find((it) => it.id === "b2");
  assert.deepEqual(kubb(0), poseItem("b2", "kubb", pose));
  // part way: the hand's own tip toward end 2
  const u = 0.35;
  const s = (u / tune.tipOf) ** 2 * (3 - 2 * (u / tune.tipOf));
  const want = tiltItem(need, 1, s);
  for (const k of ["x", "y", "z", "qw", "qx", "qy", "qz"])
    assert.ok(Math.abs(kubb(u)[k] - want[k]) < 1e-9, k);
  const end = kubb(1);
  assert.ok(Math.hypot(end.x - foot(-1).x, end.y - foot(-1).y) < 1e-9);
  assert.equal(end.toppled, false);
  // the others and the king are drawn as the need has them
  assert.ok(clip.items(0.5).some((it) => it.id === "b3"));
  assert.ok(clip.items(0.5).some((it) => it.id === "king"));
  // the chosen footprint is lit
  assert.deepEqual(
    clip.footprints.map((f) => f.chosen),
    [false, true],
  );
  assert.equal(actionClip({ kind: "throw" }, { type: "raise" }), null);
});

test("a crowded raise's kubb slides from its footprint to where the engine stood it", () => {
  const moved = { ...foot(-1), x: foot(-1).x + 0.2 };
  const n = { ...need, choices: [need.choices[0], { which: 2, pose: moved }] };
  const clip = actionClip(n, { type: "raise", choice: 2 });
  const at = (u) => clip.items(u).find((it) => it.id === "b2");
  const top = tiltItem(n, 1, 1);
  assert.ok(Math.abs(at(tune.tipOf).x - top.x) < 1e-9, "on the footprint");
  assert.ok(Math.abs(at(1).x - moved.x) < 1e-9, "then where it stands");
});

test("with reduced motion the kubb does not tip: it lies, then stands", () => {
  const lie = poseItem("b2", "kubb", pose);
  assert.deepEqual(liftKubb(need, 1, foot(-1), 0.3, { reduced: true }), lie);
  assert.equal(
    liftKubb(need, 1, foot(-1), 0.6, { reduced: true }).toppled,
    false,
  );
});

test("turning an item half about (0, 4) twice gives it back", () => {
  const it = poseItem("a1", "kubb", { ...pose });
  const back = turnItem(turnItem(it));
  for (const k of ["x", "y", "z"]) assert.ok(Math.abs(back[k] - it[k]) < 1e-12);
  // a quaternion and its negative are one turn
  const dot =
    back.qw * it.qw + back.qx * it.qx + back.qy * it.qy + back.qz * it.qz;
  assert.ok(Math.abs(Math.abs(dot) - 1) < 1e-12);
});

// A computer-against-computer match that raises automatically: at each first baton
// after kubbs were thrown in, the clips found from the last kubb's resting pieces and
// the next view are kubbs the engine raised (at most the kubbs thrown in), each lying
// where it lay at the start and standing where the view has it at the end; between
// two batons none are found.
test("the kubbs the engine raised itself are found between two throws of a real match", async () => {
  const e = await Engine.create({ sources: bundleLua() });
  e.call("useTune", { name: "pointer" });
  e.newMatch({
    seed: 7,
    cpu: "both",
    raising: "auto",
    start: { year: 2026, month: 11, day: 22, hour: 10, min: 0 },
    maxTurns: 8,
  });
  let last = null;
  let side = null;
  let kind = null;
  let tossed = 0;
  let checked = 0;
  let between = 0;
  for (let guard = 0; guard < 120000 && checked < 3; guard++) {
    const v = e.view();
    const n = v.need;
    if (n.kind === "over") break;
    if (n.kind === "throw" && last) {
      const clips = settledClips(last, v.items, {
        fromSide: side,
        toSide: n.side,
        raiser: n.side === "A" ? "B" : "A",
      });
      const raising = kind === "toss" && n.setup?.kind !== "toss";
      if (!raising && kind === "baton") {
        assert.equal(clips.length, 0, "between two batons");
        between += 1;
      }
      last = null;
      if (!raising || !clips.length) continue;
      assert.ok(clips.length <= tossed, `${clips.length} of ${tossed}`);
      for (const c of clips) {
        const start = c.items(0).find((it) => it.id === c.need.kubb);
        assert.equal(start.toppled, true);
        const end = c.items(1).find((it) => it.id === c.need.kubb);
        assert.equal(end.toppled, false);
      }
      checked += 1;
      tossed = 0;
    }
    const o = e.frame({ dt: 1 / 30 });
    if (o.event === "release") {
      side = n.side;
      kind = n.setup?.kind;
      if (kind === "toss") tossed += 1;
      else tossed = 0;
      last = e.showAt(o.recording.duration).items;
    }
  }
  assert.ok(checked > 0, "a turn raised by the engine");
  assert.ok(between > 0, "batons compared too");
});
