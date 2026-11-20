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
  tabRect,
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

test("on the left edge the body is mirrored: the lane toward the centre", () => {
  const R = linearGeometry(BOX); // the default is the right edge
  assert.equal(R.side, "right");
  assert.equal(R.tabDir, -1, "the prompt hangs left, toward the centre");
  close(R.laneLeft, R.left);
  close(R.divX, R.chanX);
  close(R.chanX, R.left + R.laneW);
  const box = { ...BOX, x: 7 };
  const g = linearGeometry(box, "left");
  assert.equal(g.side, "left");
  assert.equal(g.tabDir, 1, "the prompt hangs right, toward the centre");
  close(g.left, box.x);
  assert.ok(g.right + g.sh <= box.x + box.width + 1e-9, "shadow in the box");
  close(g.chanX, g.left, 1e-9);
  close(g.laneLeft, g.right - g.laneW);
  close(g.divX, g.laneLeft);
  assert.ok(g.laneX > g.cx, "the lane is right of the knob");
  close(g.cx, g.chanX + g.chanW / 2);
  // the track itself is the same: the same arm at the same height
  for (const k of ["w", "laneW", "chanW", "kr", "y0", "yF", "yB", "scale"])
    close(g[k], R[k]);
  for (const a of [-120, 0, 90]) close(armY(g, a), armY(R, a));
  assert.equal(knobHit(g, g.cx, g.y0, tune.grabTouch), true);
  assert.equal(bodyHit(g, g.laneX, g.yB), true);
});

test("on a wide touchscreen only the knob's channel grabs, either side", () => {
  for (const side of ["right", "left"]) {
    const g = linearGeometry(BOX, side);
    const r = tune.grabTouch;
    const lane = g.laneLeft + g.laneW / 2;
    const chan = g.chanX + g.chanW / 2;
    // across the body as before
    assert.equal(knobHit(g, lane, g.y0, r), true, side);
    // the channel only: the lane is not the knob's
    assert.equal(knobHit(g, chan, g.y0, r, true), true, side);
    assert.equal(knobHit(g, lane, g.y0, r, true), false, side);
    // up to chanOuter past the body's outer edge, never past its inner one
    const outer = side === "right" ? g.right : g.left;
    const dir = side === "right" ? 1 : -1;
    assert.equal(
      knobHit(g, outer + dir * tune.chanOuter, g.y0, r, true),
      true,
      side,
    );
    assert.equal(
      knobHit(g, outer + dir * (tune.chanOuter + 1), g.y0, r, true),
      false,
      side,
    );
    assert.equal(knobHit(g, chan, g.y0 + r + 1, r, true), false, side);
  }
});

test("the prompt tab hangs toward the centre at home, clear of the body", () => {
  for (const side of ["right", "left"]) {
    const g = linearGeometry(BOX, side);
    const t = tabRect(g);
    close(t.y + g.promptH / 2, g.y0);
    assert.equal(t.width, g.promptH * 5);
    if (side === "right") close(t.x + t.width, g.left);
    else close(t.x, g.right + g.sh);
  }
  // the wide floor is under the upright one: a phone on its side has no
  // taller track to give
  assert.ok(tune.wideMinTravel < tune.minTravel);
  // and lower than the iPhone app's 260 by Jamie's word (2026-11-20), with
  // 20 px under a 6.1-inch iPhone's Safari with its bars showing (230)
  assert.equal(tune.wideMinTravel, 210);
});
