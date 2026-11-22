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
  // read once: the card's other saved options stay, its name goes
  assert.deepEqual(p.m.get("solo"), { wind: "light" });
});

test("a name cleared in Settings stays cleared: the solo card's does not come back", () => {
  const p = store({ solo: { name: "Aspen", wind: "light" } });
  assert.equal(loadName(p), "Aspen");
  assert.equal(saveName(p, ""), "");
  assert.equal(loadName(p), "");
  // cleared before the old name was ever read
  const never = store({ solo: { name: "Aspen" } });
  saveName(never, "");
  assert.equal(loadName(never), "");
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
  // no level of your own since engine 0.13 (src/game/throw-level.js): the page
  // neither shows nor writes one
  assert.equal("level" in d, false);
  assert.equal(d.meter, "linear");
  assert.equal(d.meterSide, "right");
  assert.equal(d.muted, true);
  d.setName("Oak");
  d.setMeter("clock");
  d.setMeterSide("left");
  d.setMuted(false);
  assert.deepEqual(
    ["name", "level", "meter", "meterSide", "muted"].map((k) => p.m.get(k)),
    ["Oak", undefined, "clock", "left", false],
  );
});
