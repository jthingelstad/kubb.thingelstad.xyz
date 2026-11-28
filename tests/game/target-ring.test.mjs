// A press on the target's ring is always the aim, and the upright throw zone narrows to
// the meter's half while the ring is in it (the owner, 2026-11-27, of the iPhone app on
// an iPad: "On iPad I'm trying to move the drill target and when I tap it is activating
// the throw instead. I can't find a tap target to move the drill location.").
// src/game/target-ring.js and layout.js inLinearZone, the iPhone app's numbers
// (TargetRing.swift, its TargetRingTests). The page's own presses on a real pitch are in
// tests/game/target-ring-client.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  targetRing,
  onRing,
  zoneNarrows,
  tune,
} from "../../src/game/target-ring.js";
import { layoutFor, inLinearZone } from "../../src/game/layout.js";

const ellipse = (cx, cy, rx, ry, n = 48) => ({
  center: { x: cx, y: cy },
  outline: Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  }),
});

test("the ring's touch target is its drawn shape and 10 px round it, never under 44 px across", () => {
  assert.equal(tune.margin, 10);
  assert.equal(tune.least, 44);
  // a ring drawn 120 x 40 (a ground circle seen from the thrower)
  const ring = ellipse(200, 600, 60, 20);
  assert.ok(onRing(ring, 200, 600) && onRing(ring, 255, 600));
  assert.ok(onRing(ring, 269, 600) && !onRing(ring, 271, 600));
  // 40 tall: the least, 44, holds at its centre, and the margin beyond
  assert.ok(onRing(ring, 200, 629) && !onRing(ring, 200, 631));
  // a ring drawn tiny is still 44 across
  const tiny = {
    center: { x: 200, y: 600 },
    outline: Array.from({ length: 8 }, (_, i) => ({
      x: 200 + 3 * Math.cos(i),
      y: 600 + Math.sin(i),
    })),
  };
  assert.ok(onRing(tiny, 221.9, 600) && onRing(tiny, 200, 578.1));
  assert.ok(!onRing(tiny, 223, 600) && !onRing(tiny, 200, 623));
  assert.equal(onRing(null, 200, 600), false);
});

test("the ring on the screen: the marker's ground circle cast through the camera", () => {
  // a camera that only scales: 100 px a metre, y down the screen
  const project = (x, y) => [100 * x, 1000 - 100 * y];
  const ring = targetRing({ x: 2, y: 7, r: 0.5 }, project);
  assert.deepEqual(ring.center, { x: 200, y: 300 });
  assert.equal(ring.outline.length, 48);
  assert.ok(onRing(ring, 249, 300) && onRing(ring, 259, 300));
  assert.ok(!onRing(ring, 261, 300));
  // none drawn: no ring
  assert.equal(targetRing({ x: 2, y: 7, r: 0.5, shown: false }, project), null);
  assert.equal(targetRing({ x: 2, y: 7 }, project), null);
  assert.equal(targetRing(null, project), null);
  assert.equal(
    targetRing({ x: 2, y: 7, r: 0.5 }, () => null),
    null,
    "behind the camera",
  );
});

test("the upright zone narrows to the meter's half while the ring's centre is in it", () => {
  for (const [W, H, safe] of [
    [834, 1194, { top: 24, bottom: 20 }], // the 11-inch iPad the report came from
    [744, 1133, { top: 32, bottom: 20 }],
    [390, 844, { top: 47, bottom: 34 }],
  ])
    for (const side of ["right", "left"]) {
      const L = layoutFor(W, H, safe, false, "linear", { side, coarse: true });
      assert.equal(L.meter, "linear", `${W}x${H}`);
      const tag = `${W}x${H} ${side}`;
      const low = ellipse(W / 2, H * 0.72, 60, 20);
      const high = ellipse(W / 2, H * 0.4, 60, 20);
      assert.equal(zoneNarrows(L, low), true, tag);
      assert.equal(zoneNarrows(L, high), false, tag);
      assert.equal(zoneNarrows(L, null), false, tag);
      const y = H - safe.bottom - 4;
      const far = side === "right" ? W * 0.1 : W * 0.9;
      const near = side === "right" ? W * 0.5 + 2 : W * 0.5 - 2;
      for (const touch of [true, false]) {
        // narrowed: the other half aims, the meter's half strokes
        const narrow = { touch, narrow: zoneNarrows(L, low) };
        assert.equal(inLinearZone(L, far, y, narrow), false, tag);
        assert.equal(inLinearZone(L, near, y, narrow), true, tag);
        // above the zone nothing changed
        assert.equal(inLinearZone(L, near, H * 0.6 - 1, narrow), false, tag);
        // the ring high on the screen: the whole lower band, as before
        const whole = { touch, narrow: zoneNarrows(L, high) };
        assert.equal(inLinearZone(L, far, y, whole), true, tag);
      }
    }
  // never the clock's, never a wide canvas's (its zone is the meter's half already)
  const C = layoutFor(834, 1194, {}, false, "clock", { coarse: true });
  assert.equal(zoneNarrows(C, ellipse(417, 900, 60, 20)), false);
  const Wd = layoutFor(1194, 834, {}, false, "linear", { coarse: true });
  assert.equal(zoneNarrows(Wd, ellipse(597, 800, 60, 20)), false);
});
