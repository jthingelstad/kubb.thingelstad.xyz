// src/game/hud.js verdictChips: which verdict chips show, which are off
// target and in what order (Tyler's report, 2026-11-16: three throws he took
// for perfect had been judged long). The browser check that the chips draw
// is in client.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verdictChips,
  verdictSpeech,
  verdictIconSvg,
  VERDICT_ICON,
  mapSummary,
  railCount,
} from "../../src/game/hud.js";

const on = {
  power: "ON",
  release: "ON",
  steady: "STEADY",
  side: "STRAIGHT",
};

test("an on-target throw keeps the labelled chips, none off", () => {
  assert.deepEqual(verdictChips(on), [
    { text: "POWER ON", off: false },
    { text: "ARC ON", off: false },
    { text: "STEADY", off: false },
    { text: "STRAIGHT", off: false },
  ]);
});

test("a long throw shows LONG first, as an off chip", () => {
  const chips = verdictChips({ ...on, power: "LONG" });
  assert.deepEqual(chips[0], { text: "LONG", off: true, icon: "up" });
  assert.equal(chips.filter((c) => c.off).length, 1);
  assert.deepEqual(
    chips.slice(1).map((c) => c.text),
    ["ARC ON", "STEADY", "STRAIGHT"],
  );
});

test("every off verdict is the plain word, ahead of the on ones", () => {
  const chips = verdictChips({
    power: "SHORT",
    release: "HIGH",
    steady: "SHAKY",
    side: "PULLED LEFT",
  });
  assert.deepEqual(chips, [
    { text: "SHORT", off: true, icon: "down" },
    { text: "HIGH", off: true, icon: "up" },
    { text: "SHAKY", off: true, icon: "wavy" },
    { text: "PULLED LEFT", off: true, icon: "left" },
  ]);
  const mixed = verdictChips({ ...on, release: "LOW", side: "PULLED RIGHT" });
  assert.deepEqual(
    mixed.map((c) => [c.text, c.off]),
    [
      ["LOW", true],
      ["PULLED RIGHT", true],
      ["POWER ON", false],
      ["STEADY", false],
    ],
  );
  assert.deepEqual(verdictChips({ ...on, power: "SLOW" })[0], {
    text: "SLOW",
    off: true,
    icon: "clock",
  });
});

test("no verdicts, or a match saved before the side verdict", () => {
  assert.deepEqual(verdictChips(null), []);
  const { side, ...noSide } = on;
  assert.equal(side, "STRAIGHT");
  assert.equal(verdictChips(noSide).length, 3);
});

// The rail's counts said "BASE 5", which a new player read as a level.
test("the rail counts kubbs in plain words", () => {
  assert.equal(railCount("BASE 5"), "5 BASE KUBBS");
  assert.equal(railCount("FIELD 1"), "1 FIELD KUBB");
  assert.equal(railCount("KING"), "AT THE KING");
  assert.equal(railCount("2.3 M"), "TARGET 2.3 M");
  assert.equal(railCount(""), "");
});

// The 1.0 design ("Verdict"): the off word with an arrow, so it is not told by
// inversion alone: down for SHORT and LOW, up for LONG and HIGH, left and right
// for PULLED, a wavy line for SHAKY, a clock hand for SLOW.
test("each off word has its arrow, and every arrow is drawn", () => {
  assert.deepEqual(VERDICT_ICON, {
    SHORT: "down",
    LOW: "down",
    LONG: "up",
    HIGH: "up",
    "PULLED LEFT": "left",
    "PULLED RIGHT": "right",
    SHAKY: "wavy",
    SLOW: "clock",
  });
  for (const icon of new Set(Object.values(VERDICT_ICON))) {
    const svg = verdictIconSvg(icon);
    assert.match(svg, /^<svg class="verdict-icon"/, icon);
    assert.match(svg, /aria-hidden="true"/, icon);
    assert.match(svg, /stroke="currentColor"/, icon);
  }
  assert.equal(verdictIconSvg("nothing"), "");
  // on-target chips carry none
  assert.ok(verdictChips(on).every((c) => !c.icon));
});

test("a screen reader hears the verdict once, the off word first", () => {
  assert.equal(
    verdictSpeech("MISS", { ...on, power: "SHORT" }),
    "Short. Miss. Arc on, steady, straight.",
  );
  assert.equal(
    verdictSpeech("2 DOWN!", on),
    "2 down. Power on, arc on, steady, straight.",
  );
  assert.equal(
    verdictSpeech("MISS", {
      power: "SLOW",
      release: "HIGH",
      steady: "SHAKY",
      side: "PULLED RIGHT",
    }),
    "Slow. High. Shaky. Pulled right. Miss.",
  );
  // another player's throw: the flag alone
  assert.equal(verdictSpeech("MISS", null), "Miss.");
});

test("the minimap's spoken summary: the kubbs standing by team, the target", () => {
  const need = {
    standing: { A: 5, B: 1 },
    teams: { A: "Mighty Maple", B: "Computer" },
  };
  assert.equal(
    mapSummary({ need }, "8 metres"),
    "Map of the pitch: Mighty Maple 5 kubbs standing, Computer 1. The target is 8 metres out.",
  );
  assert.equal(mapSummary({ need, practice: true }), "Map of the pitch.");
  assert.equal(mapSummary({ need: null }), "Map of the pitch.");
});
