// Keeping a match in step (src/net/sync.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, rider, asciiSize, aimKey } from "../../src/net/sync.js";

const doc = (n, seq, started = true) => ({
  started,
  match: started ? { n, seq, snap: "s", hash: "h" } : null,
});
const w = (n, seq) => ({ n, seq, a: { type: "throw" } });

test("no match: the lobby", () => {
  assert.equal(decide({ n: null, seq: 0 }, null).kind, "lobby");
  assert.equal(decide({ n: 1, seq: 3 }, doc(1, 3, false)).kind, "lobby");
});

test("another match: take it", () => {
  assert.equal(decide({ n: null, seq: 0 }, doc(1, 0)).kind, "start");
  assert.equal(decide({ n: 1, seq: 9 }, doc(2, 4)).kind, "start");
});

test("the next action is applied; anything else adopts", () => {
  const l = { n: 1, seq: 3 };
  const d = decide(l, doc(1, 4), w(1, 4));
  assert.equal(d.kind, "apply");
  assert.deepEqual(d.action, { type: "throw" });
  assert.equal(decide(l, doc(1, 3)).kind, "same");
  assert.equal(decide(l, doc(1, 2)).kind, "old");
  assert.equal(decide(l, doc(1, 5), w(1, 5)).why, "gap");
  assert.equal(decide(l, doc(1, 4)).why, "no-action");
  assert.equal(decide(l, doc(1, 4), w(1, 5)).why, "no-action");
  assert.equal(decide(l, doc(1, 4), w(1, 4), true).why, "own");
});

test("an action too big to ride along is left off", () => {
  assert.deepEqual(rider(1, 2, { a: 1 }), {
    n: 1,
    seq: 2,
    a: { a: 1 },
    c: "web",
  });
  assert.equal(rider(1, 2, { a: "x".repeat(5000) }), undefined);
  assert.equal(asciiSize({ a: "é" }), JSON.stringify({ a: "x" }).length + 5);
});

test("aim keys change only when the aim does", () => {
  assert.equal(aimKey(null), "");
  assert.equal(aimKey({ a: 1 }), aimKey({ a: 1 }));
  assert.notEqual(aimKey({ a: 1 }), aimKey({ a: 2 }));
});
