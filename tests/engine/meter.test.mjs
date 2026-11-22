// The person's meter on the newest engine (kubb-engine 0.13, its docs/notes/throw.md
// "The person's meter"): the bars the page draws (the aim view's plan and the dial's
// powerLo..powerHi, releaseLo..releaseHi) go by the throw's distance, change as the
// circle moves, and are the same whatever level is named. The page draws them from
// every frame's dial (src/game/game.js aimFrame), never once a throw.
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
  // full widths, twice the half widths: 5.6 and 21 degrees at 4 m, 3.8 and 14.2 at
  // 6 m, 2 and 7.5 at 8 m (the engine's VERSIONING.md 0.13.0)
  assert.deepEqual(at[4], { power: 11.2, release: 42 });
  assert.deepEqual(at[6], { power: 7.6, release: 28.5 });
  assert.deepEqual(at[8], { power: 4, release: 15 });
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
