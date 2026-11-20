// The throw's nudge (src/game/nudge.js): when it starts and stops, and the
// ghost's throw on its timeline.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NudgeTrigger,
  timeline,
  swingOf,
  captionFor,
  loopLength,
  tune,
} from "../../src/game/nudge.js";

const SWING = { back: 120, release: 90 };
const close = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

// Run the trigger for s seconds in 1/60 s steps; true if it showed at the end.
function run(n, s, eligible = true) {
  let r;
  for (let i = 0; i < Math.round(s * 60); i++) r = n.step(1 / 60, eligible);
  return r.show && n.showing;
}

test("a new device is nudged after 8 s in the aim without touching the meter", () => {
  const n = new NudgeTrigger();
  n.aimBegan();
  assert.equal(run(n, tune.wait - 0.1), false);
  assert.equal(run(n, 0.2), true);
});

test("taps on the pitch do not hold off a new device's nudge", () => {
  const n = new NudgeTrigger();
  n.aimBegan();
  for (let i = 0; i < 7; i++) {
    run(n, 1);
    n.input(); // a tap that moves the target
  }
  assert.equal(run(n, 1.1), true);
});

test("the wait runs only while it may show (a card, someone else's turn)", () => {
  const n = new NudgeTrigger();
  n.aimBegan();
  run(n, 5);
  assert.equal(run(n, 20, false), false);
  assert.equal(run(n, 2.9), false);
  assert.equal(run(n, 0.2), true);
});

test("a press on the meter stops it at once and starts the wait again", () => {
  const n = new NudgeTrigger();
  n.aimBegan();
  assert.equal(run(n, tune.wait + 0.1), true);
  n.meterPressed();
  assert.equal(n.showing, false);
  // held: not eligible; the ghost fades out quickly
  const r = n.step(tune.fadeOut / 2, false);
  assert.ok(r.alpha > 0 && r.alpha < 1, "fading");
  assert.equal(n.step(tune.fadeOut, false).show, false, "gone");
  n.pressEnded(false);
  assert.equal(run(n, 1), false);
});

test("two fumbles in a row bring it on a new device without the 8 s", () => {
  const n = new NudgeTrigger();
  n.aimBegan();
  run(n, 1);
  n.meterPressed();
  n.pressEnded(false);
  run(n, 1);
  assert.equal(n.showing, false);
  n.meterPressed();
  n.pressEnded(false);
  assert.equal(run(n, tune.fumbleDelay - 0.05), false);
  assert.equal(run(n, 0.1), true);
});

test("after 3 throws a device is learned: no nudge on the 8 s wait", () => {
  const n = new NudgeTrigger();
  for (let i = 0; i < tune.learnedAt; i++) {
    n.aimBegan();
    n.meterPressed();
    n.pressEnded(true);
  }
  assert.equal(n.learned, true);
  n.aimBegan();
  assert.equal(run(n, tune.wait + 1), false);
});

test("a learned device: two fumbles, then 0.8 s", () => {
  const n = new NudgeTrigger({ throws: 3 });
  n.aimBegan();
  n.meterPressed();
  n.pressEnded(false);
  assert.equal(run(n, 2), false, "one is no nudge");
  n.meterPressed();
  n.pressEnded(false);
  assert.equal(run(n, tune.fumbleDelay - 0.05), false);
  assert.equal(run(n, 0.1), true);
  // a third fumble in a row brings it back as well
  n.meterPressed();
  n.pressEnded(false);
  assert.equal(n.showing, false);
  assert.equal(run(n, tune.fumbleDelay + 0.05), true);
});

test("a learned device: 30 s with no input of any kind", () => {
  const n = new NudgeTrigger({ throws: 5 });
  n.aimBegan();
  run(n, 20);
  n.input();
  assert.equal(run(n, tune.idle - 0.1), false);
  assert.equal(run(n, 0.2), true);
});

test("a throw clears the fumbles", () => {
  const n = new NudgeTrigger({ throws: 3 });
  n.aimBegan();
  n.meterPressed();
  n.pressEnded(false);
  n.meterPressed();
  n.pressEnded(true);
  assert.equal(n.fumbles, 0);
  n.aimBegan();
  n.meterPressed();
  n.pressEnded(false);
  assert.equal(run(n, 2), false);
});

test("the throw count is capped", () => {
  const n = new NudgeTrigger({ throws: tune.learnCap });
  n.meterPressed();
  n.pressEnded(true);
  assert.equal(n.throws, tune.learnCap);
});

test("a tap in the throw zone stops it and keeps it away a moment", () => {
  const n = new NudgeTrigger();
  n.aimBegan();
  assert.equal(run(n, tune.wait + 0.1), true);
  n.zonePressed();
  assert.equal(n.showing, false);
  assert.equal(run(n, tune.tapResume - 0.1), false);
  assert.equal(run(n, 0.2), true, "a tap is no fumble and no progress");
  assert.equal(n.fumbles, 0);
});

test("the timeline: one good throw, step by step", () => {
  const T = tune;
  // pressed at home
  let f = timeline(0, SWING);
  assert.equal(f.step, "press");
  assert.equal(f.arm, 0);
  assert.equal(f.alpha, 0);
  assert.ok(f.ring.k > 2, "the ring starts wide");
  f = timeline(T.press - 1e-6, SWING);
  assert.equal(f.press, 1, "down by the end of the press");
  assert.ok(f.ring.k < 1.2, "the ring has closed in");
  // drawn back, eased, to the middle of the back band
  f = timeline(T.press + 1e-9, SWING);
  assert.equal(f.step, "back");
  close(f.arm, 0, 1e-3);
  f = timeline(T.press + T.back / 2, SWING);
  close(f.arm, -60, 1e-6);
  f = timeline(T.press + T.back - 1e-9, SWING);
  close(f.arm, -120, 1e-3);
  // a beat at the back
  f = timeline(T.press + T.back + T.hold / 2, SWING);
  assert.equal(f.step, "hold");
  assert.equal(f.arm, -120);
  // the flick: fast, to the release band
  const f0 = T.press + T.back + T.hold;
  f = timeline(f0 + 1e-9, SWING);
  assert.equal(f.step, "flick");
  close(f.arm, -120, 1e-3);
  f = timeline(f0 + T.flick - 1e-9, SWING);
  close(f.arm, 90, 1e-3);
  // the release: let go, a ring opens out, the ghost fades
  const r0 = f0 + T.flick;
  f = timeline(r0 + 1e-9, SWING);
  assert.equal(f.step, "release");
  assert.equal(f.arm, 90);
  close(f.press, 1, 1e-3);
  f = timeline(r0 + T.release - 1e-9, SWING);
  assert.equal(f.press, 0, "lifted");
  assert.ok(f.ring.k > 2.5, "the ring has opened out");
  assert.ok(f.alpha < 0.01);
  // rest, then it loops
  f = timeline(r0 + T.release + T.rest / 2, SWING);
  assert.equal(f.step, "rest");
  assert.equal(f.alpha, 0);
  const L = loopLength();
  close(L, T.press + T.back + T.hold + T.flick + T.release + T.rest);
  assert.ok(Math.abs(T.rest - 1) < 0.3, "about a second of rest");
  for (const t of [0.1, 0.7, 1.4, 1.75, 2.0, 2.6])
    assert.deepEqual(
      timeline(t + L, SWING),
      timeline(t, SWING),
      `loop at ${t}`,
    );
  // the flick is much faster than the draw back
  assert.ok(210 / T.flick > (120 / T.back) * 4);
});

test("reduced motion: a still picture at the back, no tween", () => {
  for (const t of [0, 0.5, 1.3, 2.9]) {
    const f = timeline(t, SWING, { reduced: true });
    assert.deepEqual(f, {
      arm: -120,
      step: "still",
      press: 1,
      ring: null,
      alpha: 1,
    });
  }
});

test("the swing comes from the meter's bands", () => {
  assert.deepEqual(
    swingOf({ powerLo: 112, powerHi: 128, releaseLo: 80, releaseHi: 100 }),
    { back: 120, release: 90 },
  );
  assert.deepEqual(swingOf({}), {
    back: tune.defaultBack,
    release: tune.defaultRelease,
  });
});

test("the captions are the plate's own words", () => {
  assert.equal(captionFor("press"), "WIND BACK");
  assert.equal(captionFor("back"), "WIND BACK");
  assert.equal(captionFor("hold"), "FLICK!");
  assert.equal(captionFor("flick"), "FLICK!");
  assert.equal(captionFor("release"), null);
  assert.equal(captionFor("rest"), null);
});

test("on a phone on its side the fingertip strokes in the meter's half, under the header", async () => {
  const { layoutFor, tune: lt } = await import("../../src/game/layout.js");
  const { fingerAt } = await import("../../src/render/nudge.js");
  const { linearGeometry, tabRect } =
    await import("../../src/render/linear.js");
  const swing = { back: 120, release: 60 };
  for (const [W, H] of [
    [844, 390],
    [740, 350],
  ]) {
    for (const side of ["right", "left"]) {
      const L = layoutFor(W, H, {}, false, "linear", { side, coarse: true });
      const g = linearGeometry(L.dial, side);
      const t = tabRect(g);
      const ceiling = lt.railH + lt.margin * 1.5;
      const opts = { swing, finger: "touch", ceiling };
      const tag = `${W}x${H} ${side}`;
      const at = (arm) => fingerAt(L, { arm, step: "back" }, opts);
      const top = at(swing.release);
      const foot = at(-swing.back);
      const R = 19;
      for (const p of [top, foot]) {
        if (side === "right") {
          assert.ok(p.x - R >= W / 2, `${tag}: in the meter's half`);
          assert.ok(p.x + R <= t.x, `${tag}: clear of the tab`);
        } else {
          assert.ok(p.x + R <= W / 2, `${tag}: in the meter's half`);
          assert.ok(p.x - R >= t.x + t.width, `${tag}: clear of the tab`);
        }
      }
      assert.ok(top.y - R >= ceiling, `${tag}: under the header`);
      assert.ok(foot.y + R <= H, `${tag}: on the screen`);
    }
  }
});
