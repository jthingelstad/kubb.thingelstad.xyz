// src/game/player-name.js: the device's name is a generated one. The first run rolls it,
// a typed name kept from before is replaced (never shown), and only a generated name is
// kept. src/game/names.js: the door to the engine's names.* calls, Shuffle with locks,
// the display check and the lobby's "II".
// src/ui/settings.js prefsDevice: the /settings/ page writes the prefs the game reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { engine } from "../net/room-engine.mjs";
import { loadName, saveName } from "../../src/game/player-name.js";
import {
  Names,
  apartNames,
  badNames,
  namesOf,
  playerDefault,
  teamDefault,
} from "../../src/game/names.js";
import { prefsDevice } from "../../src/ui/settings.js";

const store = (init = {}) => {
  const m = new Map(Object.entries(init));
  return {
    m,
    get: (k, f = null) => (m.has(k) ? m.get(k) : f),
    set: (k, v) => m.set(k, v),
  };
};

// a door with a fixed run of seeds, so a test knows what it rolls
const seeded = (...seeds) => {
  let i = 0;
  return new Names(engine, { seed: () => seeds[i++ % seeds.length] });
};
const names = namesOf(engine);

test("the first run rolls a generated name and keeps it", () => {
  const p = store();
  const n = loadName(p, seeded(42));
  assert.equal(n, "Midsummer Myrtle"); // the engine's documented roll for seed 42
  assert.equal(p.m.get("name"), n);
  assert.equal(names.valid("player", n).ok, true);
  // kept: the next load reads it, rolls nothing
  assert.equal(loadName(p, seeded(1)), n);
});

test("a typed name kept from before is replaced, never shown", () => {
  for (const typed of [
    "Birch",
    "Anna",
    "big birch",
    "Player 1",
    "Computer",
    "",
  ]) {
    const p = store({ name: typed });
    const n = loadName(p, names);
    assert.notEqual(n, typed);
    assert.equal(names.valid("player", n).ok, true, typed);
    assert.equal(p.m.get("name"), n);
  }
  // the solo card's old name goes unread
  const p = store({ solo: { name: "Aspen", wind: "light" } });
  const n = loadName(p, names);
  assert.notEqual(n, "Aspen");
  assert.deepEqual(p.m.get("solo"), { wind: "light" });
});

test("a kept text with list words in it is still rolled afresh: none of it is kept", () => {
  // "Mighty Yew" (Yew was taken out for safety) and "Big Birch" (typed, Birch a wood)
  for (const typed of ["Mighty Yew", "Big Birch"]) {
    let same = 0;
    for (let i = 0; i < 20; i++) {
      const p = store({ name: typed });
      const n = loadName(p, names);
      assert.equal(names.valid("player", n).ok, true);
      if (n.split(" ").some((w) => typed.split(" ").includes(w))) same++;
    }
    assert.ok(
      same < 10,
      `${typed}: drawn afresh, not kept (${same} of 20 share a word)`,
    );
  }
});

test("saveName keeps only a generated name", () => {
  const p = store({ name: "Mighty Maple" });
  assert.equal(saveName(p, names, "Lucky Larch"), "Lucky Larch");
  assert.equal(p.m.get("name"), "Lucky Larch");
  assert.equal(saveName(p, names, "Typed Words"), "Lucky Larch");
  assert.equal(saveName(p, names, ""), "Lucky Larch");
});

test("Shuffle with a lock keeps the locked word; the others are drawn again", () => {
  for (let i = 0; i < 40; i++) {
    const r = names.roll("player", { shape: "adj", words: [null, "Maple"] });
    assert.equal(r.parts.words[1], "Maple");
    assert.equal(names.valid("player", r.text).ok, true);
    const t = names.roll("team", { shape: "adj", words: ["Wobbly", null] });
    assert.equal(t.parts.words[0], "Wobbly");
    assert.equal(names.valid("team", t.text).ok, true);
  }
  // each word's picker: every choice makes a name, and step goes round
  const parts = { shape: "adj", words: ["Mighty", "Maple"] };
  const words = names.choices("player", parts, 1);
  assert.ok(words.length > 3 && words.includes("Maple"));
  const s = names.step("player", parts, 1, 1);
  assert.equal(s.moved, true);
  assert.equal(s.parts.words[0], "Mighty");
});

test("the display check: a generated name or a default passes, typed text does not", () => {
  assert.equal(
    names.shown("player", "Mighty Maple", "Player 1"),
    "Mighty Maple",
  );
  assert.equal(names.shown("player", "Player 3", "Player 1"), "Player 3");
  assert.equal(names.shown("player", "Anna", playerDefault(2)), "Player 2");
  assert.equal(names.shown("team", "Birch Batons", "x"), "Birch Batons");
  assert.equal(names.shown("team", "North", teamDefault("B")), "Team B");
  // a side of one is named after its player
  assert.equal(names.teamPasses("Mighty Maple", 1), true);
  assert.equal(names.teamPasses("Mighty Maple", 2), false);
  const ok = {
    teams: {
      A: { name: "Mighty Maple", players: [{ name: "Mighty Maple" }] },
      B: { name: "Computer", players: [{ name: "Computer" }] },
    },
  };
  assert.deepEqual(badNames(names, ok), []);
  const typed = {
    teams: {
      A: {
        name: "Riverside",
        players: [{ name: "Ann" }, { name: "Lucky Larch" }],
      },
      B: { name: "Team B", players: [{ name: "Player 1" }] },
    },
  };
  assert.deepEqual(badNames(names, typed), ["Riverside", "Ann"]);
});

test("two members with one name: the second shows II, never a changed name", () => {
  const shown = apartNames([
    { id: "a", name: "Mighty Maple" },
    { id: "b", name: "Lucky Larch" },
    { id: "c", name: "Mighty Maple" },
    { id: "d", name: "Mighty Maple" },
  ]);
  assert.equal(shown.get("a"), "Mighty Maple");
  assert.equal(shown.get("b"), "Lucky Larch");
  assert.equal(shown.get("c"), "Mighty Maple II");
  assert.equal(shown.get("d"), "Mighty Maple III");
});

test("the settings page reads and writes the device's prefs, the game's keys", () => {
  const p = store({
    name: "Aspen",
    solo: { name: "Aspen", level: "pro" },
    meter: "linear",
    muted: true,
  });
  const d = prefsDevice(p, names);
  // a typed name from before is replaced at once
  assert.notEqual(d.name, "Aspen");
  assert.equal(names.valid("player", d.name).ok, true);
  assert.equal(d.meter, "linear");
  assert.equal(d.muted, true);
  d.setName("Lucky Larch");
  assert.equal(p.m.get("name"), "Lucky Larch");
  d.setMeter("clock");
  d.setMeterSide("left");
  d.setMuted(false);
  assert.equal(p.m.get("meter"), "clock");
  assert.equal(p.m.get("meterSide"), "left");
  assert.equal(p.m.get("muted"), false);
  // no level of your own since engine 0.13: the page writes none, and keeps the old
  assert.deepEqual(p.m.get("solo"), { level: "pro" });
  assert.equal(p.m.has("level"), false);
});
