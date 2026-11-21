import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ObserverThinner,
  ROOM_CODE,
  decideAct,
  relayAct,
} from "../src/logic.js";

test("act in sequence is accepted", () => {
  assert.deepEqual(decideAct(4, { seq: 5 }, null), { kind: "accept", seq: 5 });
});

test("out-of-sequence act is refused", () => {
  assert.equal(decideAct(4, { seq: 4 }, null).kind, "refuse");
  assert.equal(decideAct(4, { seq: 7 }, null).kind, "refuse");
  assert.equal(decideAct(4, { seq: "5" }, null).kind, "refuse");
});

test("duplicate act id is acked with its stored seq, whatever seq it now claims", () => {
  assert.deepEqual(decideAct(9, { seq: 3 }, 3), { kind: "dup", seq: 3 });
});

test("two acts for the same seq: first accepted, second refused", () => {
  let head = 2;
  const a = decideAct(head, { seq: 3 }, null);
  if (a.kind === "accept") head = a.seq;
  const b = decideAct(head, { seq: 3 }, null);
  assert.equal(a.kind, "accept");
  assert.equal(b.kind, "refuse");
});

test("observer thinning: at most one per 100 ms per sender, no timers", () => {
  const t = new ObserverThinner(100);
  const kept = [];
  for (let ms = 0; ms < 1000; ms += 1000 / 15)
    if (t.allow("p1", ms)) kept.push(ms);
  for (let i = 1; i < kept.length; i++) assert.ok(kept[i] - kept[i - 1] >= 100);
  assert.ok(kept.length >= 7 && kept.length <= 10, `kept ${kept.length}`);
  assert.equal(t.allow("p2", 50), true, "senders are thinned separately");
});

test("act relay form drops the snapshot", () => {
  const r = relayAct(
    "p1",
    { s: 1, ts: 2, e: 3 },
    { id: "x", seq: 1, a: "aa", h: "hh", snap: "big", st: 0 },
  );
  assert.equal("snap" in r, false);
  assert.equal(r.seq, 1);
});

test("room codes as the live rooms accept them", () => {
  assert.ok(ROOM_CODE.test("k7mpq2rstw"));
  assert.ok(!ROOM_CODE.test("short"));
  assert.ok(!ROOM_CODE.test("has-ilo10000"));
});
