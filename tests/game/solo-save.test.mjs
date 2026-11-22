// src/game/solo-save.js, the pure part: what is kept of a match against the computer,
// whose it is, what is offered back, and the records waiting to be sent. The browser
// half (reloads, RESUME, NEW MATCH, PLAY NOW, REMATCH mid-send, two tabs, blocked
// storage) is in client.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  saveOf,
  readSave,
  keepSave,
  clearSave,
  matchId,
  addPending,
  dropPending,
  pendingRecords,
  RESUME_WORDS,
  SAVE_VERSION,
} from "../../src/game/solo-save.js";

const memory = () => {
  const m = new Map();
  return {
    get: (k, f = null) => (m.has(k) ? JSON.parse(m.get(k)) : f),
    set: (k, v) => m.set(k, JSON.stringify(v)),
  };
};
const startOf = (seed, min = 5) =>
  JSON.stringify({
    v: 1,
    opts: { seed, start: { year: 2026, month: 11, day: 22, hour: 14, min } },
  });
// over: the engine's need (the page's may still be the throw before, mid-playback)
const game = ({ seed = 7, over = false } = {}) => ({
  mode: "match",
  need: { kind: "throw", turn: 3 },
  engine: { need: () => ({ kind: over ? "over" : "throw" }) },
  viewData: { scene: "beach" },
  trail: {
    kind: "match",
    start: startOf(seed),
    actions: [{ type: "throw" }],
    hashes: ["h1"],
    now: "{snap}",
  },
});

test("a match's identity is its seed and start", () => {
  assert.equal(matchId(startOf(7)), "7@2026-11-22T14:5");
  assert.notEqual(matchId(startOf(7)), matchId(startOf(8)));
  assert.notEqual(matchId(startOf(7, 5)), matchId(startOf(7, 6)));
  assert.equal(matchId("not json"), null);
});

test("a match is kept as it is played, with its id, and marked over by the engine", () => {
  const s = saveOf(game(), "0.15");
  assert.equal(s.v, SAVE_VERSION);
  assert.equal(s.id, "7@2026-11-22T14:5");
  assert.equal(s.over, false);
  assert.equal(s.turn, 3);
  assert.equal(saveOf(game({ over: true }), "0.15").over, true);
  assert.equal(saveOf({ ...game(), mode: "practice" }, "0.15"), null);
});

test("one slot, the newest wins: a claim takes it, a later write only while it is its own", () => {
  const store = memory();
  const a = saveOf(game({ seed: 1 }), "0.15");
  const b = saveOf(game({ seed: 2 }), "0.15");
  assert.equal(keepSave(a, { claim: true }, store), true);
  assert.equal(keepSave(a, {}, store), true, "its own");
  assert.equal(
    keepSave(b, { claim: true }, store),
    true,
    "a newer match claims it",
  );
  assert.equal(keepSave(a, {}, store), false, "the older one yields");
  assert.equal(readSave("0.15", store).id, b.id);
  // clearing is by id: the older match's end never clears the newer one's save
  assert.equal(clearSave(a.id, store), false);
  assert.equal(readSave("0.15", store).id, b.id);
  assert.equal(clearSave(b.id, store), true);
  assert.equal(readSave("0.15", store), null);
  assert.equal(keepSave(a, {}, store), true, "an empty slot is anyone's");
});

test("only a whole save on this engine is offered; anything else is dropped", () => {
  const store = memory();
  keepSave(saveOf(game(), "0.15"), { claim: true }, store);
  assert.ok(readSave("0.15", store));
  assert.equal(readSave("0.16", store), null, "another engine");
  assert.equal(store.get("soloMatch"), null, "and dropped");
  keepSave({ ...saveOf(game(), "0.15"), hashes: [] }, { claim: true }, store);
  assert.equal(readSave("0.15", store), null, "a hash short");
  keepSave({ ...saveOf(game(), "0.15"), id: "other" }, { claim: true }, store);
  assert.equal(readSave("0.15", store), null, "an id that is not its start's");
});

test("records waiting: by id, the try counted before each send", () => {
  const store = memory();
  assert.equal(addPending("a", { g: 1 }, store), 1);
  assert.equal(addPending("b", { g: 2 }, store), 1);
  assert.equal(addPending("a", { g: 1 }, store), 2);
  assert.deepEqual(
    pendingRecords(store).map((p) => [p.id, p.tries]),
    [
      ["a", 2],
      ["b", 1],
    ],
  );
  dropPending("a", store);
  assert.deepEqual(
    pendingRecords(store).map((p) => p.id),
    ["b"],
  );
});

test("storage that throws never stops play", () => {
  const was = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("full");
    },
  };
  try {
    assert.doesNotThrow(() =>
      keepSave(saveOf(game(), "0.15"), { claim: true }),
    );
    assert.equal(readSave("0.15"), null);
    assert.doesNotThrow(() => clearSave("x"));
    assert.doesNotThrow(() => addPending("x", {}));
    assert.deepEqual(pendingRecords(), []);
  } finally {
    globalThis.localStorage = was;
  }
});

test("the resume card's words", () => {
  assert.equal(RESUME_WORDS.title, "Your match is waiting");
  assert.equal(
    RESUME_WORDS.text({ turn: 4 }, "Park"),
    "A match against the computer is kept on this device (Park, turn 4). Carry on where you left off, or start a new one.",
  );
});
