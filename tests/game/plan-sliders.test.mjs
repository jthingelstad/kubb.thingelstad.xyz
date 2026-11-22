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
  arcValueText,
  drive,
  driveShare,
  kneeOf,
  isDrive,
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
  // engine 0.16: a baton's lower arc drives in; a kubb has no drive
  assert.equal(
    captionOf("arc", false).text,
    "A higher arc drops in steeper. A lower arc drives in harder.",
  );
  assert.equal(
    captionOf("arc", true).text,
    "A higher arc drops in steeper. A lower one skids in.",
  );
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

// Engine 0.16's drive: ARC's floor moves (aim.controls.arc.min) and the knee (15) is
// where the drive begins (the engine's docs/SESSION.md "The controls").
const ARC16 = (min) => ({
  min,
  max: 165,
  default: 60,
  value: Math.max(min, 60),
  knee: 15,
  tick: 5,
  step: 15,
  unit: "deg",
  scope: "throw",
});

test("0.16 ARC: the drive takes the foot of the track, more the lower the floor", () => {
  // 1.5 m: the floor is 0.3; the drive is under 30% of the track
  const near = ARC16(0.3);
  assert.equal(kneeOf(near), 15);
  assert.ok(Math.abs(driveShare(near) - drive.share * (14.7 / 15)) < 1e-9);
  assert.equal(valueAt(near, 0), 0.3, "the foot is the floor, never under it");
  assert.equal(valueAt(near, 1), 165);
  assert.ok(Math.abs(valueAt(near, driveShare(near)) - 15) < 1e-9, "the knee");
  for (const v of [0.3, 4, 14.9, 15, 32, 90, 165])
    assert.ok(Math.abs(valueAt(near, fractionOf(near, v)) - v) < 1e-9, `${v}`);
  assert.equal(fractionOf(near, -5), 0, "under the floor: the foot");
  // 4 m: the floor is about 12.3, a sliver
  const four = ARC16(12.3);
  assert.ok(driveShare(four) > 0 && driveShare(four) < 0.06);
  // 8 m: the floor is the knee; nothing under it is offered and the track is linear
  const far = ARC16(15);
  assert.equal(kneeOf(far), null);
  assert.equal(driveShare(far), 0);
  assert.equal(valueAt(far, 0), 15);
  assert.ok(Math.abs(valueAt(far, 0.5) - 90) < 1e-9);
  // a kubb's ARC (no knee) and the tilt keep their straight track
  assert.equal(kneeOf(CONTROLS.arc), null);
  assert.ok(Math.abs(valueAt(CONTROLS.tilt, 0.6789) - 7.156) < 1e-9);
});

test("0.16 ARC: marks on the clock's degrees from the floor up, the knee heavy", () => {
  const near = controlMarks(ARC16(0.3), "arc");
  // 5, 10 ... 165 (0 is under the floor)
  assert.equal(near.length, 33);
  assert.deepEqual(
    near.filter((m) => m.knee).map((m) => m.f),
    [fractionOf(ARC16(0.3), 15)],
  );
  assert.equal(near.filter((m) => m.drive).length, 2, "5 and 10");
  assert.equal(near.filter((m) => m.long).length, 1, "3 o'clock");
  // 4 m: the knee is still marked, no drive ticks under it but the floor's own
  const four = controlMarks(ARC16(12.3), "arc");
  assert.equal(four.filter((m) => m.knee).length, 1);
  assert.equal(four.filter((m) => m.drive).length, 0);
  // 8 m: no knee and no drive
  const far = controlMarks(ARC16(15), "arc");
  assert.equal(far.filter((m) => m.knee || m.drive).length, 0);
  assert.equal(far.length, 31);
});

test("0.16 ARC: a release under the knee is a DRIVE, said so on the plate and to a screen reader", () => {
  const c = ARC16(0.3);
  const lob = { release: 60, loft: 22 };
  const low = { release: 12, loft: 2.7 };
  const down = { release: 6, loft: -4.6 };
  assert.equal(isDrive(lob, c), false);
  assert.equal(isDrive(low, c), true);
  assert.equal(
    isDrive(down, null),
    false,
    "an engine with no knee has no drive",
  );
  assert.equal(arcLabel(lob, c), "ARC 22°");
  assert.equal(arcLabel(low, c), "DRIVE 3°");
  assert.equal(arcLabel(down, c), "DRIVE \u22125°");
  assert.equal(arcValueText(lob, c), "Arc, 22 degrees");
  assert.equal(arcValueText(low, c), "Arc, 3 degrees, drive");
  assert.equal(arcValueText(down, c), "Arc, 5 degrees down, drive");
  assert.equal(arcValueText(down, c, " "), "Arc 5 degrees down, drive");
  assert.equal(captionOf("arc", false, down, c).text, CAPTIONS.drive);
  assert.equal(captionOf("arc", false, down, c).key, "drive");
  assert.equal(captionOf("arc", false, lob, c).text, CAPTIONS.arc);
  assert.equal(captionOf("arc", true, down, c).text, CAPTIONS.kubbArc);
});
