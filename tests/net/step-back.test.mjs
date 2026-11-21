import test from "node:test";
import assert from "node:assert/strict";
import { StepBack, stepBackDelay } from "../../src/net/step-back.js";

const TUNE = { stepBackMs: 20000, stepBackMaxMs: 300000 };

test("the wait doubles from 20 s to a cap of 5 minutes", () => {
  const waits = [1, 2, 3, 4, 5, 6, 7].map((n) => stepBackDelay(n, TUNE));
  assert.deepEqual(
    waits,
    [20000, 40000, 80000, 160000, 300000, 300000, 300000],
  );
  assert.equal(stepBackDelay(0, TUNE), 0);
});

// Two observers alone on an abandoned pitch, each stepping back whenever it is due:
// over an hour they step back a bounded number of times, not every 20 s.
test("two observers alone back off instead of churning", () => {
  const a = new StepBack(TUNE);
  const ids = ["a", "b"];
  a.see(ids);
  let steps = 0;
  for (let t = 0; t <= 3600_000; t += 200) {
    a.see(ids); // the other observer rejoins with the same id: never an arrival
    if (a.due(t)) {
      a.took(t);
      steps += 1;
    }
  }
  // 0, 20, 60, 140, 300, 600 s, then every 300 s: 16 in the hour (180 at a fixed 20 s)
  assert.equal(steps, 16);
});

test("a connected host starts the back-off again", () => {
  const s = new StepBack(TUNE);
  s.see(["a", "b"]);
  s.took(0);
  s.took(20000);
  s.took(60000);
  assert.equal(s.waitAt(60000), 80000);
  s.reset();
  assert.ok(
    s.due(60001),
    "after a host was here the first step back is at once",
  );
});

test("someone new arriving lets the observer step back at once", () => {
  const s = new StepBack(TUNE);
  assert.equal(s.see(["me", "b"]), false, "the first look is not an arrival");
  s.took(0);
  s.took(20000);
  s.took(60000);
  assert.equal(s.due(61000), false);
  assert.equal(s.see(["me", "b"]), false);
  assert.equal(s.see(["me", "b", "player"]), true);
  assert.ok(s.due(61000), "a player who came is not kept waiting minutes");
  // and someone who was here before and comes back is not new
  s.took(61000);
  assert.equal(s.see(["me", "player"]), false);
  assert.equal(s.see(["me", "b", "player"]), false);
  assert.equal(s.due(62000), false);
});

test("the tune is read at each call, so a test's tune applies", () => {
  const tune = { ...TUNE };
  const s = new StepBack(tune);
  s.took(0);
  tune.stepBackMs = 1000;
  assert.ok(s.due(1000));
});
