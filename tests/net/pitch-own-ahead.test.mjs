// A full snapshot after a reconnect (Pitch.onState): this browser's own actions the
// pitch has not answered, which the pitch client sends again, are kept on top of the
// head rather than undone (Pitch.ownAhead).
import assert from "node:assert/strict";
import { test } from "node:test";
import { Pitch } from "../../src/net/pitch.js";

const pitchWith = (pending) => {
  const p = Object.create(Pitch.prototype);
  p.room = { pending };
  return p;
};
const own = (n, seq, h) => ({ id: `a${seq}`, n, seq, msg: { h } });

test("pitch: own unanswered actions that follow the head are kept on top of it", () => {
  const p = pitchWith([own(1, 2, "h2"), own(1, 1, "h1")]);
  assert.deepEqual(p.ownAhead({ n: 1, seq: 0 }), [
    { seq: 1, h: "h1" },
    { seq: 2, h: "h2" },
  ]);
  // the head already holds the first: only the second is ahead
  assert.deepEqual(p.ownAhead({ n: 1, seq: 1 }), [{ seq: 2, h: "h2" }]);
  // another match's, or a gap, keeps nothing
  assert.deepEqual(p.ownAhead({ n: 2, seq: 0 }), []);
  assert.deepEqual(pitchWith([own(1, 3, "h3")]).ownAhead({ n: 1, seq: 1 }), []);
  assert.deepEqual(pitchWith([]).ownAhead({ n: 1, seq: 1 }), []);
});
