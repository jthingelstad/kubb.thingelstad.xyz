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
  controlOf,
  valueAt,
  fractionOf,
  controlMarks,
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

// Engine 0.9's aim.controls, as the engine gives them
const CONTROLS = {
  arc: {
    min: 15,
    max: 165,
    default: 90,
    tick: 5,
    step: 15,
    unit: "deg",
    scope: "throw",
  },
  tilt: {
    min: -20,
    max: 20,
    default: 0,
    tick: 1,
    step: 5,
    unit: "deg",
    scope: "throw",
  },
  spin: {
    min: -3,
    max: 3,
    default: 0,
    tick: 0.25,
    step: 1,
    unit: "taps",
    scope: "turn",
  },
};

test("0.9 controls: the slider's control by piece, none on an older engine", () => {
  assert.equal(controlOf(CONTROLS, "arc", false), CONTROLS.arc);
  assert.equal(controlOf(CONTROLS, "side", false), CONTROLS.tilt);
  assert.equal(controlOf(CONTROLS, "side", true), CONTROLS.spin);
  assert.equal(controlOf(undefined, "side", true), null, "0.8 and 0.7: steps");
  assert.equal(controlOf({ tilt: { min: 1, max: 1 } }, "side", false), null);
});

test("0.9 controls: any value on the track, between the ticks too", () => {
  const t = CONTROLS.tilt;
  assert.equal(valueAt(t, 0), -20);
  assert.equal(valueAt(t, 1), 20);
  assert.equal(valueAt(t, 2), 20, "clamped");
  const off = valueAt(t, 0.6789);
  assert.ok(Math.abs(off - 7.156) < 1e-9, "not snapped to a tick or a step");
  assert.ok(Math.abs(fractionOf(t, off) - 0.6789) < 1e-9);
  assert.equal(
    fractionOf(CONTROLS.spin, undefined),
    0.5,
    "no value: the default",
  );
  assert.equal(sideLabel({}, false, { ...t, value: off }), "TILT 7R");
  assert.equal(
    sideLabel({}, true, { ...CONTROLS.spin, value: -1.27 }),
    "SPIN 1.3L",
  );
  assert.equal(
    sideLabel({}, true, { ...CONTROLS.spin, value: 0.04 }),
    "SPIN 0",
  );
  assert.equal(
    sideValueText({}, false, { ...t, value: -7.4 }),
    "Tilt 7 degrees left",
  );
  assert.equal(
    sideValueText({}, true, { ...CONTROLS.spin, value: 2.25 }),
    "Spin 2.3 right",
  );
});

test("0.9 controls: a mark at every tick, full ones at the steps, the middle long", () => {
  const m = controlMarks(CONTROLS.tilt, "side");
  assert.equal(m.length, 41);
  assert.equal(m.filter((x) => !x.minor).length, 9, "-20, -15 ... 20");
  const mid = m.filter((x) => x.long);
  assert.deepEqual(mid, [{ f: 0.5, long: true, centre: true, minor: false }]);
  const s = controlMarks(CONTROLS.spin, "side");
  assert.equal(s.length, 25);
  assert.equal(s.filter((x) => !x.minor).length, 7);
  const a = controlMarks(CONTROLS.arc, "arc");
  assert.equal(a.length, 31);
  assert.equal(a.filter((x) => x.long).length, 1, "the normal throw");
  assert.equal(a.filter((x) => x.centre).length, 0);
});
