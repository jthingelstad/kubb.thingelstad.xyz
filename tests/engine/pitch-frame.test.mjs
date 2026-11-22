// The frame the Tournament's neighbours are drawn in is the frame of whatever the Game
// is drawing (pitchFrameOf in src/game/neighbours.js, Game.pitchFrame), checked against
// the engine itself: a match walked through throws by both sides, their playbacks,
// raises, punishment kubbs, the end and a restored snapshot, in the thrower's view and
// the wide view. At each step the poses the Game draws on that path are compared with
// the same pieces in the world frame (the engine's wide view): where they agree the
// pitch is in Team A's frame, where they stand turned about (0, 4) it is Team B's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../../src/engine/index.js";
import { bundleLua } from "../../tools/lua-bundle.mjs";
import { pitchFrameOf } from "../../src/game/neighbours.js";

const sources = bundleLua();
const START = { year: 2026, month: 11, day: 16, hour: 9, min: 5 };
const BOX = { left: 0, top: 0, right: 400, bottom: 240 };

// The frame `drawn` (poses { id, x, y }) is in, against `world` (id -> { x, y }).
function frameOf(drawn, world, what) {
  let a = 0,
    b = 0;
  const near = (p, q) => Math.abs(p - q) < 0.02;
  for (const d of drawn) {
    const w = world.get(d.id);
    if (!w) continue;
    // a piece on the turn's centre tells nothing
    if (Math.abs(w.x) < 0.05 && Math.abs(w.y - 4) < 0.05) continue;
    if (near(d.x, w.x) && near(d.y, w.y)) a++;
    else if (near(d.x, -w.x) && near(d.y, 8 - w.y)) b++;
  }
  assert.ok(a + b > 0, `${what}: no piece to judge by`);
  assert.ok(a === 0 || b === 0, `${what}: ${a} pieces say A, ${b} say B`);
  return a > 0 ? "A" : "B";
}

const posesOf = (items) =>
  (items || [])
    .filter((it) => it.kind !== "stake")
    .map((it) => ({ id: it.id, x: it.x, y: it.y }));
const needPoses = (n) =>
  (n.others || []).map((o) => ({ id: o.id, x: o.pose.x, y: o.pose.y }));

// The computer's throws, to replay as both sides' throws in a match of people (so
// both sides raise and place punishment kubbs by hand).
// seed 8 since engine 0.18.0 (the baton's blow): a match that walks through every step
async function computerThrows() {
  const e = await Engine.create({ sources });
  e.newMatch({ seed: 8, cpu: "both", start: START, maxTurns: 10 });
  const log = [];
  for (let g = 0; g < 300 && e.need().kind !== "over"; g++) {
    const n = e.need();
    if (n.kind === "raise") e.apply({ type: "raise", choice: n.default });
    else if (n.kind === "punish")
      e.apply({ type: "punish", x: n.cursor.x, y: n.cursor.y });
    else {
      let o;
      for (let i = 0; i < 600 && !o?.action; i++) o = e.frame({ dt: 1 / 60 });
      log.push({ proj: n.setup.projectile, action: o.action });
    }
  }
  return log;
}

async function walk(log, wide) {
  const e = await Engine.create({ sources });
  if (wide) e.setWide(BOX);
  // the world frame: the wide view's pieces
  const world = () => {
    if (!wide) e.setWide(BOX);
    const v = e.view();
    if (!wide) e.setWide(null);
    return new Map(posesOf(v.items).map((p) => [p.id, p]));
  };
  e.newMatch({
    seed: 8,
    cpu: "none",
    start: START,
    maxTurns: 6,
    raising: "hand",
  });
  const seen = new Set();
  let thrower = "A",
    k = 0,
    boosted = 0,
    snapAtRaise = null;
  const check = (drawn, need, what) => {
    const want = frameOf(drawn, world(), what);
    assert.equal(
      pitchFrameOf({ need, wide, mode: "match", thrower }),
      want,
      `${wide ? "wide" : "thrower's view"}: ${what}`,
    );
    seen.add(`${what.split(" ")[0]}${want}`);
  };
  for (let g = 0; g < 400; g++) {
    const v = e.view();
    const n = v.need;
    if (n.kind === "over") {
      check(posesOf(v.items), n, "over");
      break;
    }
    if (n.kind === "raise" || n.kind === "punish") {
      // the raise and punishment screens draw the need's poses (Game.drawStill)
      check(needPoses(n), n, `${n.kind} ${n.side}`);
      if (n.kind === "raise" && n.side === "B" && !snapAtRaise)
        snapAtRaise = { snap: e.snapshot(), thrower };
      e.apply(
        n.kind === "raise"
          ? { type: "raise", choice: n.default }
          : { type: "punish", x: n.cursor.x, y: n.cursor.y },
      );
      continue;
    }
    // aiming: the pitch as the view has it; the hand-off is over the same picture
    check(posesOf(v.items), n, `aim ${n.side}`);
    const before = world();
    let j = k;
    while (log[j % log.length].proj !== n.setup.projectile) j++;
    k = j + 1;
    const action = structuredClone(log[j % log.length].action);
    action.seq = n.throws;
    // Team B's first three kubbs thrown out (twice for one of them): Team A places
    // punishment kubbs, and the next lands for Team A to raise. Engine 1.0.0 (the seat):
    // with six thrown out, as on 0.18, Team B's later kubbs came only after the six were
    // spent on its first two turns of kubbs, so Team A never raised one.
    if (n.setup.projectile === "kubb" && n.side === "B" && boosted < 3) {
      action.launch.speed *= 3;
      boosted++;
    }
    const r = e.apply(action);
    assert.notEqual(r.ok, false, JSON.stringify(r));
    // the playback: its first frame, before anything has moved, while the need the
    // Game holds is still the throw's
    const shown = e.showAt(0);
    const want = frameOf(posesOf(shown.items), before, "play");
    assert.equal(
      pitchFrameOf({ need: n, wide, mode: "match", thrower }),
      want,
      `${wide ? "wide" : "thrower's view"}: play ${n.side}`,
    );
    thrower = n.side;
  }
  for (const s of wide
    ? ["aimA", "raiseA", "raiseB", "punishA", "over"]
    : ["aimA", "aimB", "raiseA", "raiseB", "punishA", "over"])
    assert.ok(
      [...seen].some((x) => x.startsWith(s)),
      `walked through ${s}: ${[...seen]}`,
    );
  return snapAtRaise;
}

test("the field's frame is the pitch's at every step, in the thrower's view and the wide view", async () => {
  const log = await computerThrows();
  const kept = await walk(log, false);
  await walk(log, true);

  // a restored match (a pitch's snapshot adopted mid-turn): its raise screen is the
  // defender's frame, and once the raises are done the next throw's
  assert.ok(kept, "a raise by Team B to restore at");
  const e = await Engine.create({ sources });
  e.restore(kept.snap);
  const side = JSON.parse(kept.snap).side; // what Game.adopt keeps as the last thrower
  const v = e.view();
  assert.equal(v.need.kind, "raise");
  const world = () => {
    e.setWide(BOX);
    const w = e.view();
    e.setWide(null);
    return new Map(posesOf(w.items).map((p) => [p.id, p]));
  };
  assert.equal(
    pitchFrameOf({ need: v.need, mode: "match", thrower: side }),
    frameOf(needPoses(v.need), world(), "restored raise"),
  );
});

test("practice is Team A's frame; the wide view's throws and end are the world's", () => {
  assert.equal(
    pitchFrameOf({ need: { kind: "throw" }, mode: "practice" }),
    "A",
  );
  assert.equal(
    pitchFrameOf({ need: { kind: "throw", side: "B" }, wide: true }),
    "A",
  );
  assert.equal(
    pitchFrameOf({ need: { kind: "over" }, wide: true, thrower: "B" }),
    "A",
  );
  assert.equal(
    pitchFrameOf({ need: { kind: "punish", side: "B" }, wide: true }),
    "B",
  );
  assert.equal(pitchFrameOf({ need: { kind: "over" }, thrower: "B" }), "B");
});
