// src/game/plan-sliders.js, the pure part: the sliders' scales both ways and
// their words. The sliders in a real browser are in plan-client.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  limits,
  releaseAt,
  arcFraction,
  sideStepAt,
  sideStepOf,
  sideFraction,
  arcLabel,
  sideLabel,
  sideValueText,
  CAPTIONS,
  captionOf,
  leanOf,
} from "../../src/game/plan-sliders.js";

test("ARC: the track is the engine's release range, up is higher", () => {
  assert.equal(releaseAt(0), limits.releaseMin);
  assert.equal(releaseAt(1), limits.releaseMax);
  assert.equal(releaseAt(-1), limits.releaseMin, "clamped");
  assert.equal(releaseAt(2), limits.releaseMax, "clamped");
  for (const r of [15, 47.3, 90, 164])
    assert.ok(Math.abs(releaseAt(arcFraction(r)) - r) < 1e-9);
  assert.equal(arcFraction(undefined), arcFraction(90), "no plan: the middle");
});

test("TILT: detents of 5 to 20 either way, the middle 0", () => {
  assert.equal(sideStepAt(0.5, false), 0);
  assert.equal(sideStepAt(0, false), -4);
  assert.equal(sideStepAt(1, false), 4);
  assert.equal(sideStepAt(0.6, false), 1);
  assert.equal(sideStepAt(0.56, false), 0, "the nearest detent");
  assert.equal(sideStepOf({ tilt: -15 }, false), -3);
  assert.equal(sideFraction(4, false), 1);
  assert.equal(sideFraction(-4, false), 0);
});

test("SPIN: detents of 1 to 3 either way", () => {
  assert.equal(sideStepAt(0, true), -3);
  assert.equal(sideStepAt(1, true), 3);
  assert.equal(sideStepAt(0.5, true), 0);
  assert.equal(sideStepOf({ spin: 2 }, true), 2);
  assert.equal(sideFraction(0, true), 0.5);
});

test("the words read as the buttons did", () => {
  assert.equal(arcLabel({ loft: 31.6 }), "ARC 32°");
  assert.equal(sideLabel({ tilt: 10 }, false), "TILT 10R");
  assert.equal(sideLabel({ tilt: -5 }, false), "TILT 5L");
  assert.equal(sideLabel({ tilt: 0 }, false), "TILT 0");
  assert.equal(sideLabel({ spin: -2 }, true), "SPIN 2L");
  assert.equal(sideValueText({ tilt: -20 }, false), "Tilt 20 degrees left");
  assert.equal(sideValueText({ spin: 3 }, true), "Spin 3 right");
});

test("the held slider's caption: the iPhone's words, TILT or SPIN by the piece", () => {
  assert.equal(
    captionOf("arc", false).text,
    "A higher arc drops in steeper. A lower one skids in.",
  );
  assert.equal(captionOf("arc", true).text, CAPTIONS.arc);
  assert.equal(
    captionOf("side", false).text,
    "Tilt leans the baton to steer it through a group.",
  );
  assert.equal(
    captionOf("side", true).text,
    "Spin keeps a drilled kubb steady in the air.",
  );
  assert.equal(captionOf(null, false), null);
});

test("the caption's baton leans by the plan's tilt, in the engine's range", () => {
  assert.equal(leanOf({ tilt: 10 }), 10);
  assert.equal(leanOf({ tilt: -15 }), -15);
  assert.equal(leanOf({}), 0);
  assert.equal(leanOf({ tilt: 45 }), limits.tiltMax);
});
