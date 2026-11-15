// The dial's geometry helpers (src/render/dial.js): arm angles are the
// Playdate crank's, 0 at six o'clock, -90 at nine (wound back), 90 at three,
// +-180 at twelve.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dialGeometry,
  armPoint,
  armAt,
  hitTest,
  unwrapArm,
} from "../../src/render/dial.js";

const close = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test("the arm angles point where the crank does", () => {
  const g = { cx: 100, cy: 100, r: 50 };
  const at = (arm) => armPoint(g, arm).map((v) => Math.round(v * 1e6) / 1e6);
  assert.deepEqual(at(0), [100, 150]); // six o'clock, screen y down
  assert.deepEqual(at(-90), [50, 100]); // nine
  assert.deepEqual(at(90), [150, 100]); // three
  assert.deepEqual(at(180), [100, 50]); // twelve
  close(armAt(g, 100, 170), 0);
  close(armAt(g, 20, 100), -90);
  close(armAt(g, 180, 100), 90);
  close(Math.abs(armAt(g, 100, 10)), 180);
});

test("armAt undoes armPoint at any radius", () => {
  const g = { cx: 37.5, cy: 211.25, r: 80 };
  for (let arm = -179; arm < 180; arm += 7.5) {
    for (const R of [5, 40, 80, 130]) {
      const [x, y] = armPoint(g, arm, R);
      close(armAt(g, x, y), arm, 1e-9);
    }
  }
});

test("unwrapArm keeps the arm continuous through twelve", () => {
  close(unwrapArm(-170, 175), -185);
  close(unwrapArm(-185, 170), -190);
  close(unwrapArm(170, -175), 185);
  close(unwrapArm(10, 20), 20);
  close(unwrapArm(-90, -100), -100);
  // a slow wind past twelve, sampled every 20 degrees, never jumps
  let arm = 0;
  for (let a = 0; a > -400; a -= 20) {
    const raw = ((((a + 180) % 360) + 360) % 360) - 180;
    const next = unwrapArm(arm, raw);
    assert.ok(Math.abs(next - arm) <= 20 + 1e-9);
    close(next, a);
    arm = next;
  }
});

test("the dial fits its rect with room for the prompt above", () => {
  for (const rect of [
    { x: 0, y: 0, width: 300, height: 300 },
    { x: 900, y: 420, width: 330, height: 330 },
    { x: 10, y: 600, width: 200, height: 120 },
    { x: 0, y: 0, width: 120, height: 400 },
  ]) {
    const g = dialGeometry(rect);
    assert.ok(
      g.cx - g.r >= rect.x - 1e-9 && g.cx + g.r <= rect.x + rect.width + 1e-9,
      "inside across",
    );
    assert.ok(g.cy + g.r <= rect.y + rect.height + 1e-9, "inside below");
    assert.ok(g.cy - g.r * 1.4 >= rect.y - 1e-9, "room above for the prompt");
    close(g.cx, rect.x + rect.width / 2);
  }
});

test("a press grabs the dial within its slop", () => {
  const g = { cx: 100, cy: 100, r: 40 };
  assert.ok(hitTest(g, 100, 100));
  assert.ok(hitTest(g, 140, 100));
  assert.ok(hitTest(g, 100, 149));
  assert.ok(!hitTest(g, 100, 151));
  assert.ok(!hitTest(g, 0, 0));
});
