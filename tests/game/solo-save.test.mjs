// src/game/solo-save.js, the pure part: what is kept of a match against the computer,
// what is offered back, and what is dropped. The browser half (reload, RESUME, NEW
// MATCH, PLAY NOW, blocked storage) is in client.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  saveOf,
  readSave,
  writeSave,
  clearSave,
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
const game = (over = false) => ({
  mode: "match",
  need: { kind: over ? "over" : "throw", turn: 3 },
  viewData: { scene: "beach" },
  trail: {
    kind: "match",
    start: "{start}",
    actions: [{ type: "throw" }],
    hashes: ["h1"],
    now: "{snap}",
  },
});

test("a match being played is kept; a finished one, practice or watching is not", () => {
  const s = saveOf(game(), "0.15");
  assert.equal(s.v, SAVE_VERSION);
  assert.equal(s.engine, "0.15");
  assert.equal(s.start, "{start}");
  assert.equal(s.snap, "{snap}");
  assert.deepEqual(s.hashes, ["h1"]);
  assert.equal(s.turn, 3);
  assert.equal(saveOf(game(true), "0.15"), null, "over: never offered");
  assert.equal(saveOf({ ...game(), mode: "practice" }, "0.15"), null);
});

test("only a whole save on this engine is offered; anything else is dropped", () => {
  const store = memory();
  writeSave(saveOf(game(), "0.15"), store);
  assert.ok(readSave("0.15", store));
  assert.equal(readSave("0.16", store), null, "another engine");
  assert.equal(store.get("soloMatch"), null, "and dropped");
  writeSave({ ...saveOf(game(), "0.15"), hashes: [] }, store);
  assert.equal(readSave("0.15", store), null, "a hash short");
  writeSave({ ...saveOf(game(), "0.15"), v: 99 }, store);
  assert.equal(readSave("0.15", store), null, "another version");
  writeSave(saveOf(game(), "0.15"), store);
  clearSave(store);
  assert.equal(readSave("0.15", store), null);
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
    assert.doesNotThrow(() => writeSave(saveOf(game(), "0.15")));
    assert.equal(readSave("0.15"), null);
    assert.doesNotThrow(() => clearSave());
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
  assert.equal(RESUME_WORDS.resume, "RESUME");
  assert.equal(RESUME_WORDS.fresh, "NEW MATCH");
});
