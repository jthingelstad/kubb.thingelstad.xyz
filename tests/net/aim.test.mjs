// Aim on the wire (src/net/aim.js): the sender's rate and its release frame, and the
// watcher's maths: the clock offset, drawing 100 ms behind between samples, the arm's
// short way round, never across a new throw, and an action held for its aim.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AimBuffer, AimSender, aimTune, lerpAim } from "../../src/net/aim.js";

const aim = (seq, x, extra = {}) => ({
  seq,
  x,
  y: 0,
  arm: 0,
  phase: "back",
  ...extra,
});
const cast = (from, ts, s, k) => ({ from, ts, d: { t: "aim", s, k, c: ts } });

test("aim: the sender sends at most 15 a second, only what changed, and the release always", () => {
  const out = new AimSender();
  assert.equal(aimTune.hz, 15);
  const sent = [];
  for (let t = 0; t <= 1000; t += 10) {
    const d = out.sample(aim(1, t), t);
    if (d) sent.push(d);
  }
  assert.ok(sent.length <= 16 && sent.length >= 14, `${sent.length} sent`);
  assert.deepEqual(
    sent.map((d) => d.k),
    sent.map((_, i) => i + 1),
  );
  assert.equal(sent[0].t, "aim");
  // nothing new: nothing sent
  assert.ok(out.sample(aim(1, 1000), 1500));
  assert.equal(out.sample(aim(1, 1000), 2000), null);
  // the release goes at once, changed or not
  assert.ok(out.sample(aim(1, 1000), 2001, { force: true }));
  // a shout used the slot
  out.spend(3000);
  assert.equal(out.sample(aim(1, 5), 3010), null);
  assert.ok(out.sample(aim(1, 6), 3070));
});

test("aim: straight lines between samples, the arm the short way, the rest from the earlier", () => {
  const a = aim(1, 0, { arm: 350, back: 0, phase: "back", stanceSet: false });
  const b = aim(1, 10, { arm: 10, back: 1, phase: "flick", stanceSet: true });
  const m = lerpAim(a, b, 0.5);
  assert.equal(m.x, 5);
  assert.equal(m.back, 0.5);
  assert.equal(m.arm, 0); // 350 -> 10 through 0, not through 180
  assert.equal(m.phase, "back");
  assert.equal(m.stanceSet, false);
  assert.equal(lerpAim(a, b, 0), a);
  assert.equal(lerpAim(a, b, 1), b);
  // half a turn or more is a jump, not a swing: the earlier
  const far = lerpAim(aim(1, 0, { arm: 0 }), aim(1, 0, { arm: 180 }), 0.5);
  assert.equal(far.arm, 0);
});

test("aim: the watcher draws 100 ms behind the newest the network could bring, between samples", () => {
  const buf = new AimBuffer();
  // the page's clock is 5000 ms ahead of the server's; the network takes 30 to 60 ms
  const skew = 5000;
  const arrive = [30, 60, 35, 50, 45, 30];
  for (let i = 0; i < arrive.length; i++) {
    const ts = 1000 + i * 66;
    buf.push(cast("m1", ts, aim(1, i * 10), i + 1), ts + skew + arrive[i]);
  }
  assert.equal(buf.offset, skew + 30); // the smallest gap
  // at page time T the render time is T - offset - 100, on the server's clock
  const now = 1000 + 2 * 66 + 33 + skew + 30 + aimTune.delayMs; // half way, sample 2 to 3
  const s = buf.at(now);
  assert.ok(Math.abs(s.x - 25) < 1e-9, `x ${s.x}`);
  assert.equal(buf.drawn, s);
  // before the first sample: the first; past the last: the last, held
  assert.equal(buf.at(0).x, 0);
  assert.equal(buf.at(1e12).x, 50);
});

test("aim: never drawn between two throws or two senders", () => {
  const buf = new AimBuffer({ delayMs: 0 });
  buf.push(cast("m1", 1000, aim(1, 0), 1), 1000);
  buf.push(cast("m1", 1100, aim(2, 100), 2), 1100);
  assert.equal(buf.at(1050).x, 0, "the earlier throw's, held");
  buf.push(cast("m2", 1200, aim(2, 500), 1), 1200);
  assert.equal(buf.at(1150).x, 100);
  // a late sample from the same sender is dropped
  assert.equal(buf.push(cast("m2", 1150, aim(2, 9), 1), 1250), false);
});

test("aim: an action waits for the aim before it to be drawn, at most 250 ms", () => {
  const buf = new AimBuffer();
  assert.equal(buf.holdFor(1000, 1000), 0, "no aim: no wait");
  buf.push(cast("m1", 1000, aim(1, 0), 1), 1040);
  // the action was relayed 10 ms after the last aim and arrives 40 ms later
  const wait = buf.holdFor(1010, 1050);
  assert.equal(wait, 1010 + 40 + aimTune.delayMs - 1050);
  assert.ok(wait > 0 && wait <= aimTune.holdMaxMs);
  assert.equal(buf.holdFor(1010, 2000), 0, "already drawn");
  assert.equal(
    buf.holdFor(1000 + 10_000, 11_040),
    0,
    "a stale aim is not waited for",
  );
  const slow = new AimBuffer({ delayMs: 1000 });
  slow.push(cast("m1", 1000, aim(1, 0), 1), 1000);
  assert.equal(slow.holdFor(1000, 1000), aimTune.holdMaxMs);
});
