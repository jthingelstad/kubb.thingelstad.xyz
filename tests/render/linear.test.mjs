// The linear meter's geometry (src/render/linear.js): the dial's arm angles
// on a straight track. 0 (six o'clock) is the middle, the backswing
// (negative) runs down the screen and the forward swing up, one scale both
// ways, so the engine is fed the same degrees as from the dial.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  linearGeometry,
  armY,
  armAtY,
  knobHit,
  bodyHit,
  tune,
} from "../../src/render/linear.js";

const close = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

const BOX = { x: 305, y: 297, width: 78, height: 540 };

test("the track is inside its box, home in the middle, back below", () => {
  const g = linearGeometry(BOX);
  assert.ok(g.left >= BOX.x && g.right <= BOX.x + BOX.width);
  // the body is the whole height of its box: the track's length is its room
  assert.ok(g.top >= BOX.y && g.bottom <= BOX.y + BOX.height);
  assert.ok(g.travel > BOX.height * 0.8);
  assert.ok(g.yF > g.top && g.yB < g.bottom, "the knob stays in the body");
  close(g.y0, (g.yF + g.yB) / 2);
  close(armY(g, 0), g.y0);
  close(armY(g, -tune.range), g.yB);
  close(armY(g, tune.range), g.yF);
  assert.ok(armY(g, -120) > g.y0, "wound back is down the screen");
  assert.ok(armY(g, 90) < g.y0, "the release is up the screen");
  assert.ok(
    g.cx > g.chanX && g.laneX < g.chanX,
    "the lane is left of the knob",
  );
});

test("armAtY undoes armY, one scale both ways, and stops at the ends", () => {
  const g = linearGeometry(BOX);
  for (const a of [-180, -150, -120, -30, -1, 0, 12, 90, 135, 180])
    close(armAtY(g, armY(g, a)), a, 1e-9);
  close(armY(g, 0) - armY(g, 30), armY(g, -30) - armY(g, 0));
  close(armY(g, 0) - armY(g, 30), 30 * g.scale);
  assert.equal(armAtY(g, g.yB + 500), -tune.range);
  assert.equal(armAtY(g, g.yF - 500), tune.range);
});

test("a press grabs the knob at home; the rest of the body only keeps it", () => {
  const g = linearGeometry(BOX);
  assert.equal(knobHit(g, g.cx, g.y0, tune.grabMouse), true);
  assert.equal(
    knobHit(g, g.cx, g.y0 + tune.grabTouch - 1, tune.grabTouch),
    true,
  );
  assert.equal(
    knobHit(g, g.cx, g.y0 + tune.grabMouse + 2, tune.grabMouse),
    false,
  );
  assert.equal(knobHit(g, g.left - 40, g.y0, tune.grabTouch), false);
  assert.equal(bodyHit(g, g.cx, g.yB), true);
  assert.equal(bodyHit(g, g.cx, g.top - 20), false, "above it is not the body");
  assert.equal(bodyHit(g, g.left - 40, g.y0), false);
});
