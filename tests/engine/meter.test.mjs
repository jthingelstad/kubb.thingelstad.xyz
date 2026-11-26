// The person's meter on the newest engine (kubb-engine 0.13, its docs/notes/throw.md
// "The person's meter", and 1.3's "The honest meter"): the bars the page draws (the aim
// view's plan and the dial's powerLo..powerHi, releaseLo..releaseHi) go by the throw's
// distance, change as the circle moves, are the same whatever computer level is named,
// and are as wide as the person's throw level (Easy, Standard, Hard). The page draws
// them from every frame's dial (src/game/game.js aimFrame), never once a throw.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../../src/engine/index.js";
import { bundleLua } from "../../tools/lua-bundle.mjs";

const engine = await Engine.create({ sources: bundleLua() });

const bars = (o) => ({
  power: +(o.powerHi - o.powerLo).toFixed(3),
  release: +(o.releaseHi - o.releaseLo).toFixed(3),
});

test("a person's bars go by the throw's distance and redraw as the circle moves", () => {
  engine.newPractice({ surface: "grass" });
  const at = {};
  for (const y of [4, 6, 8]) {
    const r = engine.setTarget(0, y, false);
    const dial = engine.frame({ dt: 1 / 60 }).dial;
    // the aim view's plan and this frame's dial agree
    assert.deepEqual(bars(dial), bars(r.aim.plan), `${y} m`);
    at[y] = bars(dial);
  }
  // full widths on the standard meter (1.3: the release bar is narrower than 0.13's)
  assert.deepEqual(at[4], { power: 11.2, release: 28 });
  assert.deepEqual(at[6], { power: 7.6, release: 19 });
  assert.deepEqual(at[8], { power: 4, release: 10 });
});

test("a person's throw level is the width of the bars: wider on Easy, narrower on Hard", () => {
  const at8 = (level) => {
    engine.newPractice({ surface: "grass", throw: level });
    engine.setTarget(0, 8, false);
    return bars(engine.frame({ dt: 1 / 60 }).dial);
  };
  assert.deepEqual(at8(undefined), at8("standard"));
  assert.deepEqual(at8("easy"), { power: 10, release: 24 });
  assert.deepEqual(at8("standard"), { power: 4, release: 10 });
  assert.deepEqual(at8("hard"), { power: 4, release: 7 });
});

test("the level named changes nothing in a person's bars", () => {
  engine.newPractice({ surface: "grass" });
  const seen = new Set();
  for (const level of ["beginner", "club", "pro"]) {
    engine.setLevel(level);
    const r = engine.setTarget(0, 8, false);
    seen.add(JSON.stringify(bars(r.aim.plan)));
    assert.equal(r.aim.plan.level, level, "the level is still kept");
  }
  assert.equal(seen.size, 1);
});
