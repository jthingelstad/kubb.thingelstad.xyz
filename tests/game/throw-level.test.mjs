// src/game/throw-level.js: the device's throw level, and moving a device's
// older choices across so nobody's level resets.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadThrowLevel,
  soloOptions,
  levelLine,
  LEVEL_NOTE,
} from "../../src/game/throw-level.js";

const store = (init) => {
  const m = new Map(Object.entries(init));
  return {
    m,
    get: (k, f = null) => (m.has(k) ? m.get(k) : f),
    set: (k, v) => m.set(k, v),
  };
};

test("the device's level is the level pref when it has one", () => {
  const p = store({ level: "pro", solo: { level: "beginner" } });
  assert.equal(loadThrowLevel(p), "pro");
});

test("a device with only the solo card's level keeps it, stored once", () => {
  const p = store({ solo: { level: "beginner", wind: "light" } });
  assert.equal(loadThrowLevel(p), "beginner");
  assert.equal(p.m.get("level"), "beginner");
});

test("a new device throws at Club; a value it does not know is Club too", () => {
  assert.equal(loadThrowLevel(store({})), "club");
  assert.equal(loadThrowLevel(store({ level: "expert" })), "club");
});

test("the solo card's older level becomes its computer level", () => {
  assert.deepEqual(soloOptions({ level: "pro", wind: "off" }), {
    computer: "pro",
    wind: "off",
  });
  assert.deepEqual(soloOptions({ level: "pro", computer: "beginner" }), {
    computer: "beginner",
  });
  assert.deepEqual(soloOptions(null), { computer: "club" });
});

test("the words", () => {
  assert.equal(levelLine("pro"), "Throwing at Pro.");
  assert.equal(levelLine(undefined), "Throwing at Club.");
  assert.equal(LEVEL_NOTE, "A change applies from your next throw.");
});
