// The free camera's controls (src/game/free-camera.js, docs/OBSERVER.md): the default
// view is the engine's camera untouched, the mouse, fingers, wheel and keys move it,
// RESET VIEW eases back (at once with Reduce Motion), and a new lens keeps the view.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FreeCamera } from "../../src/game/free-camera.js";
import {
  lookAt,
  orbitOf,
  sameOrbit,
  freeTune,
} from "../../src/render/freecam.js";

const lens = (f = 610) =>
  Object.assign(lookAt({}, 6.5, 4, 7, 0, 4, 0.2), { f, cx: 203, cy: 131 });

function cam(reduced = false) {
  const c = new FreeCamera({ reduced: { matches: reduced } });
  c.setLens(lens());
  const changes = [];
  c.onChange = (m) => changes.push(m);
  return { c, changes };
}

test("the default view is the engine's camera itself", () => {
  const { c } = cam();
  const base = lens();
  assert.equal(c.moved, false);
  assert.equal(c.camera(base), base);
  // no lens (the thrower's view): nothing moves, nothing is taken
  const off = new FreeCamera();
  assert.equal(off.down({ id: 1, x: 0, y: 0 }), false);
  assert.equal(off.wheel(100), false);
  off.turnBy(1, 0);
  assert.equal(off.moved, false);
});

test("a drag turns, a right drag moves, and the first move says so once", () => {
  const { c, changes } = cam();
  const o0 = orbitOf(lens());
  assert.equal(c.down({ id: 1, x: 100, y: 100 }), true);
  c.move({ id: 1, x: 140, y: 100 });
  assert.ok(c.moved);
  assert.ok(c.orbit.yaw < o0.yaw, "a drag right turns by -dx");
  c.move({ id: 1, x: 140, y: 130 });
  assert.ok(c.orbit.pitch > o0.pitch, "a drag down raises the eye");
  c.up({ id: 1 });
  const turned = c.orbit;
  c.down({ id: 2, x: 0, y: 0, button: 2 });
  c.move({ id: 2, x: 50, y: 0 });
  assert.equal(c.orbit.yaw, turned.yaw, "a right drag only moves");
  assert.notEqual(c.orbit.tx, turned.tx);
  c.up({ id: 2 });
  assert.deepEqual(changes, [true]);
  // a camera drawn from the orbit, kept while nothing moves
  const a = c.camera(lens());
  assert.equal(c.camera(lens()), a);
  assert.notEqual(a.px, lens().px);
});

test("a touch drag turns (no pan button on a finger); two fingers pinch, twist and slide", () => {
  const { c } = cam();
  c.down({ id: 1, x: 100, y: 200, button: 2, mouse: false });
  c.move({ id: 1, x: 120, y: 200 });
  const o1 = c.orbit;
  assert.ok(o1.yaw < orbitOf(lens()).yaw);
  c.down({ id: 2, x: 300, y: 200, mouse: false });
  // spread apart: closer
  c.move({ id: 2, x: 400, y: 200 });
  assert.ok(c.orbit.dist < o1.dist);
  const o2 = c.orbit;
  // twist clockwise round the first finger
  c.move({ id: 2, x: 120, y: 480 });
  assert.ok(c.orbit.yaw > o2.yaw || c.orbit.yaw < o2.yaw - Math.PI);
  c.up({ id: 2 });
  c.up({ id: 1 });
  assert.equal(c.pointers.size, 0);
});

test("the wheel: down is farther, up is closer, within the limits", () => {
  const { c } = cam();
  const d0 = orbitOf(lens()).dist;
  c.wheel(-100);
  assert.ok(c.orbit.dist < d0);
  for (let i = 0; i < 100; i++) c.wheel(400, 0);
  assert.equal(c.orbit.dist, freeTune.maxDist);
  for (let i = 0; i < 100; i++) c.wheel(-3, 1); // lines
  assert.equal(c.orbit.dist, freeTune.minDist);
});

test("keys: held, they turn, move and zoom; 0 and Home go back", () => {
  const { c } = cam(true);
  assert.equal(c.key("KeyQ", true), false, "not the camera's");
  assert.equal(c.key("ArrowLeft", true), true);
  c.tick(0.5);
  assert.ok(c.orbit.yaw > orbitOf(lens()).yaw);
  c.key("ArrowLeft", false);
  const o = c.orbit;
  c.key("KeyW", true);
  c.tick(0.5);
  c.key("KeyW", false);
  assert.ok(c.orbit.tx < o.tx, "W moves away from the eye (on the +x side)");
  c.key("Equal", true);
  c.tick(0.5);
  c.key("Equal", false);
  assert.ok(c.orbit.dist < o.dist);
  assert.equal(c.key("Home", true), true);
  assert.equal(c.moved, false, "Reduce Motion: back at once");
});

test("RESET VIEW eases back over resetTime, then hands the engine's camera back", () => {
  const { c, changes } = cam(false);
  c.turnBy(1, 0.3);
  c.zoomBy(0.5);
  c.reset();
  assert.ok(c.moved, "still easing");
  const mid = (freeTune.resetTime / 2) * 0.999;
  c.tick(mid);
  assert.ok(c.moved);
  c.tick(freeTune.resetTime);
  assert.equal(c.moved, false);
  const base = lens();
  assert.equal(c.camera(base), base);
  assert.deepEqual(changes, [true, false]);
  // a move during the ease takes over from where it is
  c.turnBy(0.5, 0);
  c.reset();
  c.tick(0.05);
  c.turnBy(0.1, 0);
  assert.equal(c.ease, null);
  assert.ok(c.moved);
});

test("a new lens (a turned phone) keeps the orbit; no lens lets go of the pointers", () => {
  const { c } = cam();
  c.turnBy(0.4, 0.1);
  const o = c.orbit;
  c.setLens(lens(420));
  assert.ok(sameOrbit(c.orbit, o));
  assert.equal(c.camera(lens(420)).f, 420);
  c.down({ id: 1, x: 0, y: 0 });
  c.setLens(null);
  assert.equal(c.pointers.size, 0);
  assert.equal(c.camera("base"), "base");
});
