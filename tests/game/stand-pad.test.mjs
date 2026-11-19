// src/game/stand-pad.js, the pure part: STAND's picture of the line maps
// to the ground the engine's setStance takes and back, and its words. The
// browser checks are in stand-client.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  standSpan,
  groundAt,
  fractionOf,
  standText,
  standCaption,
  tune,
} from "../../src/game/stand-pad.js";

const baton = {
  projectile: "baton",
  lineY: 0,
  forwardY: 0,
  halfWidth: 2.5,
  backMax: 3,
};

test("the plate shows the line's width, backMax behind it, a little in front", () => {
  const s = standSpan(baton);
  assert.deepEqual(
    [s.x0, s.x1, s.yBack, s.yFront, s.lineY, s.limit],
    [-2.5, 2.5, -3, tune.front, 0, 0],
  );
});

test("with an advantage line a baton may stand up to it; a kubb may not", () => {
  const adv = { ...baton, forwardY: 2 };
  assert.equal(standSpan(adv).limit, 2);
  assert.equal(standSpan(adv).yFront, 2 + tune.front);
  assert.equal(standSpan({ ...adv, projectile: "kubb" }).limit, 0);
});

test("a place on the plate is a place on the ground, and back", () => {
  const s = standSpan(baton);
  assert.deepEqual(groundAt(s, 0.5, tune.front / (3 + tune.front)), {
    x: 0,
    y: 0,
  });
  assert.deepEqual(groundAt(s, 0, 1), { x: -2.5, y: -3 });
  assert.deepEqual(groundAt(s, 1, 0), { x: 2.5, y: tune.front });
  // off the plate is held to its edges
  assert.deepEqual(groundAt(s, -0.4, 1.7), { x: -2.5, y: -3 });
  const f = fractionOf(s, 1.25, -1.5);
  const g = groundAt(s, f.fx, f.fy);
  assert.ok(Math.abs(g.x - 1.25) < 1e-9 && Math.abs(g.y + 1.5) < 1e-9);
});

test("STAND says where the thrower is in plain words", () => {
  assert.equal(standText({ x: 0, y: 0 }, baton), "MIDDLE, ON THE LINE");
  assert.equal(
    standText({ x: -1.23, y: -0.5 }, baton),
    "1.2 M LEFT, 0.5 M BACK",
  );
  assert.equal(standText({ x: 0.8, y: 1.5 }, baton), "0.8 M RIGHT, 1.5 M UP");
  assert.match(
    standCaption({ x: 0, y: 0 }, baton).text,
    /on your line or behind it/,
  );
  assert.match(
    standCaption({ x: 0, y: 0 }, { ...baton, forwardY: 2 }).text,
    /advantage line/,
  );
});
