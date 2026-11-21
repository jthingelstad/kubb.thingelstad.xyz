// src/game/player-name.js: the player's name is the device's, typed once, and a
// device's older names (the solo card's, the lobby's) move across so nobody's resets.
// src/ui/settings.js prefsDevice: the /settings/ page writes the prefs the game reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadName,
  saveName,
  tidyName,
  NAME_MAX,
} from "../../src/game/player-name.js";
import { prefsDevice } from "../../src/ui/settings.js";

const store = (init = {}) => {
  const m = new Map(Object.entries(init));
  return {
    m,
    get: (k, f = null) => (m.has(k) ? m.get(k) : f),
    set: (k, v) => m.set(k, v),
  };
};

test("the device's name is the name pref when it has one", () => {
  const p = store({ name: "Birch", solo: { name: "Aspen" } });
  assert.equal(loadName(p), "Birch");
});

test("a device with only the solo card's name keeps it, stored once", () => {
  const p = store({ solo: { name: "Aspen", wind: "light" } });
  assert.equal(loadName(p), "Aspen");
  assert.equal(p.m.get("name"), "Aspen");
});

test("the solo card's placeholder is no name: the card asks once", () => {
  const p = store({ solo: { name: "You" } });
  assert.equal(loadName(p), "");
  assert.equal(p.m.has("name"), false);
  assert.equal(loadName(store()), "");
});

test("a name is tidied: one space, trimmed, at most 16 units, no half character", () => {
  assert.equal(tidyName("  Big   Birch \n"), "Big Birch");
  assert.equal(tidyName("x".repeat(30)).length, NAME_MAX);
  // an emoji is two UTF-16 units: never cut in half
  const cut = tidyName("a".repeat(15) + "\u{1F333}");
  assert.equal(cut, "a".repeat(15));
  assert.equal(tidyName(null), "");
});

test("saveName keeps the tidy name, and an empty one forgets it", () => {
  const p = store({ name: "Birch" });
  assert.equal(saveName(p, " Elm "), "Elm");
  assert.equal(p.m.get("name"), "Elm");
  assert.equal(saveName(p, "   "), "");
  assert.equal(loadName(p), "");
});

test("the settings page reads and writes the device's prefs, the game's keys", () => {
  const p = store({
    solo: { name: "Aspen", level: "pro" },
    meter: "linear",
    muted: true,
  });
  const d = prefsDevice(p);
  assert.equal(d.name, "Aspen");
  assert.equal(d.level, "pro");
  assert.equal(d.meter, "linear");
  assert.equal(d.meterSide, "right");
  assert.equal(d.muted, true);
  d.setName("Oak");
  d.setLevel("beginner");
  d.setMeter("clock");
  d.setMeterSide("left");
  d.setMuted(false);
  assert.deepEqual(
    ["name", "level", "meter", "meterSide", "muted"].map((k) => p.m.get(k)),
    ["Oak", "beginner", "clock", "left", false],
  );
});
