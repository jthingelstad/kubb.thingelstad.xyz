// The throw's distance on the meter's tab (distanceWords in src/game/game.js) and
// spoken (spokenMetres in src/game/hud.js): to the tenth close in, where a half metre
// is much of the throw (a QA note, 2026-11-22: 1.5 m read "2 M"), to the whole metre
// from 5 m out.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  distanceWords,
  metresWords,
  tenthsUnder,
} from "../../src/game/game.js";
import { spokenMetres } from "../../src/game/hud.js";

test("the tab reads tenths under 5 m and whole metres from there", () => {
  assert.equal(tenthsUnder, 5);
  assert.equal(metresWords(1.5), "1.5 M");
  assert.equal(metresWords(1.46), "1.5 M");
  assert.equal(metresWords(2), "2.0 M");
  assert.equal(metresWords(3.24), "3.2 M");
  assert.equal(metresWords(4.94), "4.9 M");
  // a distance that rounds to 5.0 is past the tenths
  assert.equal(metresWords(4.96), "5 M");
  assert.equal(metresWords(5.4), "5 M");
  assert.equal(metresWords(7.6), "8 M");
  assert.equal(metresWords(8.49), "8 M");
  assert.equal(metresWords(0.02), "0.1 M");
  for (const d of [0, -1, NaN, null, undefined])
    assert.equal(metresWords(d), null);
});

test("the plan's distance, else the stance to the circle", () => {
  assert.equal(distanceWords({ plan: { dist: 1.5 } }), "1.5 M");
  assert.equal(
    distanceWords({ marker: { x: 0, y: 1.5 }, thrower: { x: 0, y: 0 } }),
    "1.5 M",
  );
  assert.equal(distanceWords({ plan: { dist: 8 } }), "8 M");
  assert.equal(distanceWords(null), null);
});

test("spoken: the tab's number in metres, a tenth plural", () => {
  assert.equal(spokenMetres("1.5 M"), "1.5 metres");
  assert.equal(spokenMetres("8 M"), "8 metres");
  assert.equal(spokenMetres("1.0 M"), "1 metre");
  assert.equal(spokenMetres("2.0 M"), "2 metres");
});
