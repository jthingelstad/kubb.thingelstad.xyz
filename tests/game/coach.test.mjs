// The throw's coach line (src/game/coach.js): who it shows for and the line
// for each part of the stroke.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coachFor,
  stageOf,
  slowVerdict,
  LINES,
  tune,
} from "../../src/game/coach.js";

const BAND = { powerLo: 112, powerHi: 128 };

test("the stroke's stage: rest, winding short of the band, then the band and the flick", () => {
  assert.equal(stageOf({ phase: "idle", ...BAND }), "rest");
  assert.equal(stageOf({ phase: "cooldown", ...BAND }), "rest");
  assert.equal(stageOf({ phase: "winding", back: 0, ...BAND }), "winding");
  assert.equal(stageOf({ phase: "winding", back: 111.9, ...BAND }), "winding");
  assert.equal(stageOf({ phase: "winding", back: 112, ...BAND }), "band");
  // past the band is still the flick's turn (the meter says EASE OFF)
  assert.equal(stageOf({ phase: "winding", back: 140, ...BAND }), "band");
  assert.equal(stageOf({ phase: "swinging", back: 120, ...BAND }), "band");
  // no band known: winding is winding
  assert.equal(stageOf({ phase: "winding", back: 90 }), "winding");
  assert.equal(stageOf(), "rest");
});

test("a learner is coached until the device has made 3 throws", () => {
  const dial = { phase: "idle", ...BAND };
  for (let n = 0; n < tune.learnedAt; n++)
    assert.deepEqual(coachFor({ throws: n, dial }), {
      stage: "rest",
      lead: null,
      line: LINES.rest,
    });
  assert.equal(coachFor({ throws: tune.learnedAt, dial }), null);
  assert.equal(coachFor({ throws: 9, dial }), null);
});

test("the lines follow the stroke and use the meter's own words", () => {
  const at = (dial) => coachFor({ throws: 0, dial: { ...BAND, ...dial } }).line;
  assert.equal(at({ phase: "idle" }), "PULL BACK TO THE STRIPES");
  assert.equal(at({ phase: "winding", back: 60 }), "NO RUSH GOING BACK");
  assert.equal(
    at({ phase: "winding", back: 120 }),
    "NOW FLICK FAST AND STOP ON THE SOLID MARK",
  );
  assert.equal(
    at({ phase: "swinging", back: 120 }),
    "NOW FLICK FAST AND STOP ON THE SOLID MARK",
  );
});

test("after a SLOW verdict the next throw is coached, learned or not, led by the verdict", () => {
  const c = coachFor({ throws: 9, slow: true, dial: { phase: "idle" } });
  assert.deepEqual(c, {
    stage: "rest",
    lead: "SLOW FLICK. FLICK FASTER.",
    line: LINES.rest,
  });
  const w = coachFor({
    throws: 9,
    slow: true,
    dial: { phase: "winding", back: 120, ...BAND },
  });
  assert.equal(w.lead, LINES.slow);
  assert.equal(w.line, LINES.band);
});

test("only the engine's SLOW power verdict counts as a slow flick", () => {
  assert.equal(slowVerdict({ power: "SLOW", release: "ON" }), true);
  for (const power of ["ON", "SHORT", "LONG", undefined])
    assert.equal(slowVerdict({ power, release: "ON" }), false);
  assert.equal(slowVerdict(null), false);
  assert.equal(slowVerdict(undefined), false);
});

// The 1.0 design (the owner's decision of 2026-11-21, with the iPhone's
// Coach.swift): the meter's marks are named by their shape, never their colour.
test("the coach names the marks by shape: the stripes and the solid mark", () => {
  assert.deepEqual(LINES, {
    rest: "PULL BACK TO THE STRIPES",
    winding: "NO RUSH GOING BACK",
    band: "NOW FLICK FAST AND STOP ON THE SOLID MARK",
    slow: "SLOW FLICK. FLICK FASTER.",
  });
  for (const line of Object.values(LINES))
    assert.doesNotMatch(line, /ORANGE|BLUE|RED|COLOU?R/, line);
});
