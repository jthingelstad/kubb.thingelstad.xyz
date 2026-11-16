// Who acts in a shared match (src/net/seats.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actorsFor,
  mayAct,
  shownActor,
  controlFor,
  sameControl,
  playingSide,
  nextHost,
} from "../../src/net/seats.js";

const ctx = (connected, extra = {}) => ({
  players: {
    A: [{ id: "a1" }, { id: "a2" }],
    B: [{ id: "b1" }],
  },
  cpu: null,
  host: "a1",
  connected: new Set(connected),
  ...extra,
});
const throwBy = (side, key) => ({
  kind: "throw",
  side,
  setup: { thrower: { key } },
});

test("a throw is its owner's", () => {
  const c = ctx(["a1", "a2", "b1"]);
  assert.deepEqual(actorsFor(throwBy("A", "a2"), c), ["a2"]);
  assert.equal(mayAct(throwBy("A", "a2"), c, "a2"), true);
  assert.equal(mayAct(throwBy("A", "a2"), c, "a1"), false);
  assert.equal(mayAct(throwBy("A", "a2"), c, "b1"), false);
});

test("an absent owner's throw falls to a teammate, then the host", () => {
  assert.deepEqual(actorsFor(throwBy("A", "a2"), ctx(["a1", "b1"])), ["a1"]);
  assert.deepEqual(actorsFor(throwBy("B", "b1"), ctx(["a1", "a2"])), ["a1"]);
  assert.deepEqual(actorsFor(throwBy("B", "b1"), ctx(["a2"], { host: "a2" })), [
    "a2",
  ]);
  assert.deepEqual(actorsFor(throwBy("B", "b1"), ctx([], { host: null })), []);
});

test("raises and punishment kubbs are any connected defender's", () => {
  const raise = { kind: "raise", side: "A" };
  assert.deepEqual(actorsFor(raise, ctx(["a1", "a2", "b1"])), ["a1", "a2"]);
  assert.deepEqual(actorsFor({ kind: "punish", side: "B" }, ctx(["a1"])), [
    "a1",
  ]);
  assert.equal(mayAct(raise, ctx(["a2", "b1"]), "b1"), false);
});

test("the computer is the host's browser's, never a human input", () => {
  const c = ctx(["a1"], { players: { A: [{ id: "a1" }], B: [] }, cpu: "B" });
  const t = { kind: "throw", side: "B", cpu: true };
  assert.deepEqual(actorsFor(t, c), ["a1"]);
  assert.equal(mayAct(t, c, "a1"), false);
  assert.equal(shownActor(t, c), "cpu");
  assert.deepEqual(controlFor(c, "a1"), { sides: ["A"], cpu: true });
});

test("control: own side, and every human side for the host", () => {
  const c = ctx(["a1", "a2", "b1"]);
  assert.deepEqual(controlFor(c, "a1"), { sides: ["A", "B"], cpu: true });
  assert.deepEqual(controlFor(c, "a2"), { sides: ["A"], cpu: false });
  assert.deepEqual(controlFor(c, "b1"), { sides: ["B"], cpu: false });
  assert.deepEqual(controlFor(c, "watcher"), { sides: [], cpu: false });
  assert.ok(sameControl(controlFor(c, "a2"), { sides: ["A"], cpu: false }));
  assert.ok(!sameControl(controlFor(c, "a2"), null));
  assert.equal(playingSide(c, "b1"), "B");
  assert.equal(playingSide(c, "watcher"), null);
});

test("practice and the end need nobody", () => {
  assert.deepEqual(actorsFor({ kind: "over" }, ctx(["a1"])), []);
  assert.deepEqual(
    actorsFor({ kind: "throw", practice: true }, ctx(["a1"])),
    [],
  );
  assert.equal(mayAct(null, ctx([]), "a1"), false);
});

test("the next host is the earliest-joined connected member", () => {
  const ms = [
    { id: "h", connected: false },
    { id: "x", connected: false },
    { id: "y", connected: true },
    { id: "z", connected: true },
  ];
  assert.equal(nextHost(ms, "h"), "y");
  assert.equal(nextHost(ms, "gone"), "y");
  assert.equal(nextHost([{ id: "h", connected: true }], "h"), null);
});
