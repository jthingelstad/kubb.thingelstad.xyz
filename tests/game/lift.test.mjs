// Watching a raise (src/game/lift.js): the pace, the clip of a raise action (the end
// the engine's choice stands it on, the same tip as the hand's drag), and the seam for
// the kubbs the engine raises itself, which has none to give until the engine hands
// them out.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  liftPace,
  actionClip,
  raiseEnd,
  settledClips,
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

// The engine's own raises (a match raising automatically, the computer's, watching):
// the engine hands them out on the next throw need (setup.settled), and each becomes a
// clip in the list's order, the kubb lying where the engine says it lay and standing
// where it stood it, in the raiser's frame as given; since 0.17.0 with its own
// surroundings (`others`, `king`), drawn as the raise by hand draws its need.
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;

async function autoMatch({ wide = false, seed = 7 } = {}) {
  const e = await Engine.create({ sources: bundleLua() });
  e.call("useTune", { name: "pointer" });
  e.newMatch({
    seed,
    cpu: "both",
    raising: "auto",
    start: { year: 2026, month: 11, day: 22, hour: 10, min: 0 },
    maxTurns: 6,
  });
  if (wide) e.setWide({ left: 0, top: 0, right: 800, bottom: 600, k: 1 });
  return e;
}

// the throw needs that carry a settled list, each with its view, until n are seen
function settledNeeds(e, n = 3) {
  const out = [];
  let last = null;
  for (let guard = 0; guard < 60000 && out.length < n; guard++) {
    const v = e.view();
    if (v.need.kind === "over") break;
    const st = v.need.kind === "throw" ? v.need.setup?.settled : null;
    const key = st ? JSON.stringify(st) : null;
    if (st && key !== last) out.push({ v, st, snap: e.snapshot() });
    last = key;
    e.frame({ dt: 1 / 30 });
  }
  return out;
}

test("the engine's own raises: a clip a kubb, in its order, from its own poses", async () => {
  const e = await autoMatch();
  const seen = settledNeeds(e, 3);
  assert.ok(seen.length >= 2, "an automatic match hands its raises out");
  for (const { v, st } of seen) {
    const list = st.list;
    assert.equal(list.length, st.raised + st.punished);
    // the raiser is the defender, never the next thrower: its frame is not the view's,
    // so nothing is taken from the view: each entry brings its own surroundings
    for (const x of list) assert.notEqual(x.side, v.need.side);
    const clips = settledClips(st, { around: v.items });
    assert.equal(clips.length, list.length);
    clips.forEach((c, k) => {
      const x = list[k];
      assert.equal(c.need.kubb, x.id, "in the engine's order");
      assert.equal(c.need.side, x.side);
      assert.equal(c.i, x.which === 2 ? 1 : 0, "on the engine's end");
      const at = (u) => c.items(u).find((it) => it.id === x.id);
      // lying where it lay, standing where it was stood: the poses as given
      const lie = at(0);
      assert.ok(near(lie.x, x.lying.x) && near(lie.y, x.lying.y));
      assert.ok(lie.z < 0.05, "lying");
      const up = at(1);
      assert.ok(near(up.x, x.standing.x) && near(up.y, x.standing.y));
      assert.ok(up.z > 0.07, "standing");
      // part way: tipped toward its end, as the hand's drag tips it
      const mid = at(0.35);
      assert.ok(mid.z > lie.z && mid.z < up.z + 0.02);
      // round it: the entry's own others and king, as given (engine 0.17.0), and
      // nothing of the view's (the next thrower's frame)
      assert.ok(Array.isArray(x.others) && x.others.length > 0);
      assert.ok(x.king);
      const items = c.items(0.5);
      // the stakes from the view (alike in either frame), its others, the king, itself
      const stakes = v.items.filter((it) => it.kind === "stake").length;
      assert.equal(stakes, 6);
      assert.equal(items.length, stakes + x.others.length + 2);
      for (const o of x.others) {
        const it = items.find((q) => q.id === o.id);
        assert.ok(it, `${o.id} drawn`);
        assert.ok(
          near(it.x, o.pose.x) && near(it.y, o.pose.y),
          `${o.id} as given`,
        );
      }
      const king = items.find((it) => it.id === "king");
      assert.ok(near(king.x, x.king.x) && near(king.y, x.king.y));
      // the list's kubbs before it stand among its others, the ones after still lie
      list.forEach((o, j) => {
        if (j === k || o.kind !== "raise") return;
        const it = items.find((p) => p.id === o.id);
        assert.ok(it, `${o.id} drawn`);
        assert.equal(it.z > 0.07, j < k, `${o.id} ${j < k ? "up" : "down"}`);
      });
    });
  }
});

test("the engine's own raises in the wide view: the world frame, drawn with the pitch", async () => {
  const e = await autoMatch({ wide: true });
  const seen = settledNeeds(e, 2);
  assert.ok(seen.length >= 1);
  for (const { v, st } of seen) {
    for (const x of st.list) assert.equal(x.frame, "world");
    // the entries' own surroundings, in the world frame too: once every kubb is up the
    // clip's last moment is the pitch as the view has it
    for (const x of st.list) assert.ok(Array.isArray(x.others));
    const clips = settledClips(st, { around: v.items });
    const end = clips.at(-1).items(1);
    for (const it of v.items) {
      const got = end.find((q) => q.id === it.id);
      assert.ok(got, it.id);
      assert.ok(
        near(got.x, it.x, 1e-6) && near(got.y, it.y, 1e-6),
        `${it.id} where the view has it`,
      );
    }
  }
});

test("after a restore there is no settled list: the kubbs already stand", async () => {
  const e = await autoMatch();
  const [first] = settledNeeds(e, 1);
  assert.ok(first);
  const r = await Engine.create({ sources: bundleLua() });
  r.call("useTune", { name: "pointer" });
  r.restore(first.snap);
  const n = r.view().need;
  assert.equal(n.kind, "throw");
  assert.equal(n.setup?.settled, undefined);
  assert.deepEqual(settledClips(n.setup?.settled), []);
});

test("a punishment kubb the engine placed is stood up where it was put, and nothing else is a clip", () => {
  // the shape docs/SESSION.md gives (the computer seldom throws a kubb out twice, so
  // this one is written out): { kind: "punish", id, side, pose }
  const st = {
    raised: 1,
    punished: 1,
    list: [
      {
        kind: "raise",
        id: "b1",
        side: "A",
        which: 1,
        lying: { x: 0.5, y: 2, angle: 0, standing: false },
        standing: { x: 0.61, y: 2, angle: 0, standing: true },
      },
      {
        kind: "punish",
        id: "b2",
        side: "A",
        pose: { x: -1, y: 3.5, angle: 0.3, standing: true },
      },
    ],
  };
  // (written without the 0.17 surroundings: the list's own kubbs are drawn round)
  const clips = settledClips(st);
  assert.equal(clips.length, 2);
  // the punishment kubb is not on the pitch while the raise before it plays
  assert.equal(
    clips[0].items(0.5).some((it) => it.id === "b2"),
    false,
  );
  const placed = clips[1].items(1).find((it) => it.id === "b2");
  assert.ok(near(placed.x, -1) && near(placed.y, 3.5) && placed.z > 0.07);
  assert.ok(clips[1].items(0).find((it) => it.id === "b2").z < 0.05);
  // the raised kubb stands while the punishment kubb is placed
  assert.ok(clips[1].items(0.5).find((it) => it.id === "b1").z > 0.07);
  // nothing to show: no clips
  assert.deepEqual(settledClips(undefined), []);
  assert.deepEqual(settledClips({ raised: 0, punished: 0, list: [] }), []);
  assert.deepEqual(settledClips({ list: [{ kind: "raise", id: "x" }] }), []);
});
