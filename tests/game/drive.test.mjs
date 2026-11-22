// Engine 0.16's drive as the web draws it (docs/SYSTEM.md "The drive"): at 1.5 m from a
// group off the advantage line the default plan leaves the hand going down; the arc the
// side view, the peek and the main view draw is the engine's own, falling from the
// start; the baton does not turn end over end, so the spin drawing never ghosts it; and
// the ARC plate's picture of a drive falls into the kubb.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Engine } from "../../src/engine/index.js";
import { bundleLua } from "../../tools/lua-bundle.mjs";
import { arcInAir } from "../../src/render/world.js";
import { spinAmount } from "../../src/render/scenes.js";
import { platePicture, plateWords } from "../../src/game/tray.js";

const ADVANTAGE = fs.readFileSync("tests/fixtures/snap-advantage.json", "utf8");

async function at(d) {
  const e = await Engine.create({ sources: bundleLua() });
  e.call("useTune", { name: "pointer" });
  e.restoreChecked(ADVANTAGE);
  const v = e.view();
  assert.equal(v.need.side, "A");
  assert.equal(v.need.cpu, false, "a person's throw");
  const t = v.need.setup.targets
    .map((id) => v.items.find((i) => i.id === id))
    .sort((a, b) => a.y - b.y)[0];
  e.setStance(t.x, Math.max(0, Math.min(v.aim.forwardY, t.y - d)));
  const r = e.setTarget(t.x, t.y, true);
  return { e, aim: r.aim, target: t };
}

// a swing that makes the plan: back to the middle of the power band, a fast flick to
// the release, then the frame after the finger lifts
function throwPlan(e, p) {
  const arms = [0];
  for (let a = 0; a > -p.back;) arms.push((a = Math.max(-p.back, a - 7.5)));
  for (let i = 0; i < 3; i++) arms.push(-p.back);
  for (let a = -p.back; a < p.release;)
    arms.push((a = Math.min(p.release, a + 30)));
  let out;
  for (const arm of arms) out = e.frame({ dt: 1 / 60, arm });
  for (let i = 0; i < 10 && out.event !== "release"; i++)
    out = e.frame({ dt: 1 / 60 });
  return out;
}

test("the default at 1.5 m is a drive whose arc falls from the hand to the kubb's face", async () => {
  const { aim } = await at(1.5);
  const c = aim.controls.arc;
  assert.ok(Math.abs(aim.plan.dist - 1.5) < 1e-9);
  assert.ok(c.min < 1, `the floor ${c.min}`);
  assert.equal(c.knee, 15);
  assert.ok(aim.plan.release < c.knee, "under the knee");
  assert.ok(aim.plan.loft < 0, "leaves the hand going down");
  const arc = aim.arc.map((q) => [q.x, q.y, q.z]);
  assert.ok(arc.length > 10);
  for (let i = 1; i < arc.length; i++)
    assert.ok(arc[i][2] < arc[i - 1][2], `falls at point ${i}`);
  assert.ok(arc.at(-1)[2] > 0.05, "meets the kubb's face, not the ground");
  // the air part the views draw is the engine's points, cut short along the ground
  // only: a falling arc keeps its fall
  const air = arcInAir(arc);
  assert.ok(air.length >= arc.length / 2);
  assert.deepEqual(air.slice(0, 5), arc.slice(0, 5));
  for (let i = 1; i < air.length; i++) assert.ok(air[i][2] < air[i - 1][2]);
});

test("a close drive does not flip: no spin drawing through its flight, the baton upright at release", async () => {
  for (const floor of [false, true]) {
    const { e, aim } = await at(1.5);
    let p = aim.plan;
    if (floor) p = e.setArc(aim.controls.arc.min).aim.plan;
    const out = throwPlan(e, p);
    assert.equal(out.event, "release");
    const rec = out.recording;
    const pid = rec.projectile.id;
    let prev = null;
    let first = null;
    const tHit = rec.timeline?.touches?.[0]?.t ?? 0.15;
    for (let t = 0; t <= tHit; t += 1 / 60) {
      const b = e.showAt(t).items.find((i) => i.id === pid);
      if (!b) continue;
      first ??= b;
      if (prev)
        assert.equal(
          spinAmount(prev, b, "baton"),
          0,
          `no ghost at ${t.toFixed(2)} s`,
        );
      prev = b;
    }
    // its long axis within 25 degrees of upright as it leaves the hand
    const az = 1 - 2 * (first.qx * first.qx + first.qy * first.qy);
    assert.ok(
      (Math.acos(Math.min(1, az)) * 180) / Math.PI < 25,
      `${floor ? "floor" : "default"}: upright at release`,
    );
  }
});

test("the ARC plate's picture of a drive falls into the kubb; a lob rises", async () => {
  const { aim } = await at(1.5);
  const pic = platePicture("arc", aim);
  const m = /M6 (\d+) Q35 ([\d.-]+) 60 (\d+)/.exec(pic);
  assert.ok(m, pic);
  assert.ok(Number(m[3]) > Number(m[1]), "ends lower than it starts");
  assert.ok(Number(m[2]) > Number(m[1]), "falls from the start (loft under 0)");
  assert.match(pic, /<rect /, "into a kubb");
  assert.match(plateWords("arc", aim).head, /^DRIVE /);
  const lob = { ...aim, plan: { ...aim.plan, release: 60, loft: 22 } };
  assert.match(platePicture("arc", lob), /^<path d="M6 28 Q35 /);
  assert.equal(plateWords("arc", lob).head, "ARC 22°");
});

test("the meter at a drive: the power band far round, short of the overpowered zone, never past 12 o'clock", async () => {
  const { overFrom } = await import("../../src/render/dial.js");
  for (const [d, floor] of [
    [4, false],
    [4, true],
    [1.5, true],
  ]) {
    const { e, aim } = await at(d);
    if (floor) e.setArc(aim.controls.arc.min);
    const dial = e.view().dial;
    const tag = `${d} m${floor ? " at the floor" : ""}`;
    assert.ok(dial.powerLo >= 120, `${tag}: a long backswing ${dial.powerLo}`);
    assert.ok(dial.powerHi < 180, `${tag}: no wrap past 12 o'clock`);
    const over = overFrom(dial);
    assert.ok(over >= dial.powerHi, `${tag}: the zone starts past the band`);
    assert.ok(over < 180, `${tag}: the zone is drawn`);
  }
});
