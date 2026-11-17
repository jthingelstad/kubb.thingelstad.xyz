// src/game/hud.js verdictChips: which verdict chips show, which are off
// target and in what order (Tyler's report, 2026-11-16: three throws he took
// for perfect had been judged long). The browser check that the chips draw
// is in client.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { verdictChips } from "../../src/game/hud.js";

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
  assert.deepEqual(chips[0], { text: "LONG", off: true });
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
    { text: "SHORT", off: true },
    { text: "HIGH", off: true },
    { text: "SHAKY", off: true },
    { text: "PULLED LEFT", off: true },
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
  });
});

test("no verdicts, or a match saved before the side verdict", () => {
  assert.deepEqual(verdictChips(null), []);
  const { side, ...noSide } = on;
  assert.equal(side, "STRAIGHT");
  assert.equal(verdictChips(noSide).length, 3);
});
