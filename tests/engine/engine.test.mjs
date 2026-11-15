// The session under wasmoon through src/engine (docs/ENGINE.md): a practice
// throw, and the multiplayer proof: one browser acts through a whole match,
// others only apply its actions, and every recording and hash agrees.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../../src/engine/index.js";
import { bundleLua } from "../../tools/lua-bundle.mjs";

const sources = await bundleLua();
const START = { year: 2026, month: 11, day: 15, hour: 10, min: 0 };

// The arm angles of a swing as a pointer gives them, a frame each: back to
// `back` degrees, a quick flick forward to `stop`, held there.
function swingArms(back, stop) {
  const arms = [0, -5];
  for (let a = -5; a > -back;) {
    a = Math.max(-back, a - 400 / 60);
    arms.push(a);
  }
  for (let a = -back; a < stop;) {
    a = Math.min(stop, a + 2400 / 60);
    arms.push(a);
  }
  for (let i = 0; i < 6; i++) arms.push(stop);
  return arms;
}

test("a practice throw gives a sane recording", async () => {
  const e = await Engine.create({ sources });
  const v = e.newPractice({ surface: "grass" });
  assert.equal(v.need.kind, "throw");
  assert.equal(v.items.length, 17);
  const plan = v.aim.plan;
  let out;
  for (const arm of swingArms(
    (plan.powerLo + plan.powerHi) / 2,
    plan.release,
  )) {
    out = e.frame({ dt: 1 / 60, arm });
    if (out.event) break;
  }
  assert.equal(out.event, "release");
  const rec = out.recording;
  assert.ok(rec.frames > 30 && rec.frames < 12 * 60);
  assert.equal(rec.frameDt, 1 / 60);
  assert.equal(rec.projectile.how, "baton");
  assert.ok(
    ["MISS", "HELICOPTER"].includes(rec.result.flag) ||
      /DOWN$/.test(rec.result.flag),
  );
  for (const b of rec.bodies) {
    assert.equal(b.poses.length, b.frames * 7);
    assert.ok(b.start >= 0 && b.start + b.frames - 1 <= rec.frames);
  }
  const p = e.showAt(rec.duration / 2);
  assert.ok(p.camera.f > 0);
  assert.equal(p.items.length, 18, "the pitch, the baton and the stakes");
  const after = e.view();
  assert.equal(after.need.kind, "throw");
  assert.ok(after.aim.verdicts && after.aim.verdicts.power);
});

test("two browsers play a whole match in step; a third joins mid-match", async () => {
  const actor = await Engine.create({ sources });
  const watcher = await Engine.create({ sources });
  actor.newMatch({
    seed: 42,
    cpu: "B",
    start: START,
    wind: "light",
    raising: "hand",
    maxTurns: 30,
    teams: {
      A: { name: "Home", players: [{ name: "Ann" }, { name: "Bo" }] },
      B: { name: "Away", players: [{ name: "Cy" }] },
    },
  });
  watcher.restore(actor.snapshot());
  watcher.setControl({ sides: [], cpu: false });
  assert.equal(watcher.hash().hash, actor.hash().hash);

  let late = null;
  let actions = 0;
  let humanThrows = 0;
  let guard = 0;
  const check = (action, rec) => {
    const w = watcher.apply(action);
    if (rec) assert.equal(JSON.stringify(w.recording), JSON.stringify(rec));
    assert.equal(
      watcher.hash().hash,
      actor.hash().hash,
      `hash after action ${actions}`,
    );
    if (late) {
      const l = late.apply(action);
      if (rec) assert.equal(JSON.stringify(l.recording), JSON.stringify(rec));
      assert.equal(late.hash().hash, actor.hash().hash);
    }
    actions++;
  };

  while (guard++ < 2000) {
    const n = actor.need();
    if (n.kind === "over") break;
    if (actions === 25 && !(late instanceof Engine)) {
      late = await Engine.create({ sources });
      late.restore(actor.snapshot());
      late.setControl({ sides: [], cpu: false });
      assert.equal(late.hash().hash, actor.hash().hash);
    }
    if (n.kind === "raise") {
      const action = { type: "raise", choice: n.default };
      actor.apply(action);
      check(action);
    } else if (n.kind === "punish") {
      const action = { type: "punish", x: n.cursor.x, y: n.cursor.y };
      assert.equal(actor.apply(action).ok, true);
      check(action);
    } else if (n.cpu) {
      let out;
      for (let i = 0; i < 600 && !out?.action; i++)
        out = actor.frame({ dt: 1 / 60 });
      assert.ok(out.action, "the computer threw");
      check(out.action, out.recording);
    } else {
      // a human swing on the dial at the plan's power and release
      const plan = actor.aim().aim.plan;
      const stop = plan.release + ((humanThrows % 3) - 1) * 8;
      let out;
      for (const arm of swingArms(plan.back, stop)) {
        out = actor.frame({ dt: 1 / 60, arm });
        if (out.event) break;
      }
      if (!out.action) out = actor.frame({ dt: 1 / 60 }); // let go: the release
      assert.ok(out.action, `the human threw (${out.event})`);
      assert.equal(out.action.scripted, false);
      humanThrows++;
      check(out.action, out.recording);
    }
  }
  const n = actor.need();
  assert.equal(n.kind, "over");
  assert.equal(watcher.need().kind, "over");
  assert.equal(watcher.need().file.text, n.file.text);
  assert.ok(late instanceof Engine, "the late browser joined");
  assert.ok(humanThrows > 5);
  console.log(
    `      ${actions} actions (${humanThrows} by hand), ${n.turn} turns, ${n.how}; snapshot ${actor.hash().bytes} bytes`,
  );
});
