// The observer's free camera (src/render/freecam.js, docs/OBSERVER.md): its lookAt is
// the core's (vendor/engine/core/camera.lua under wasmoon), an orbit made from a camera
// gives that camera back, every move stays inside the limits, and each control moves
// the picture the way the hand does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCore, JSON_LUA, runJSON } from "../../dev/fixtures/core.mjs";
import { project } from "../../src/render/camera.js";
import * as fc from "../../src/render/freecam.js";

const lua = await loadCore(["core/camera"]);
await lua.doString(JSON_LUA);

const FIELDS = ["px", "py", "pz", "fx", "fy", "fz", "rx", "ry", "rz"].concat([
  "ux",
  "uy",
  "uz",
  "lx",
  "ly",
  "lz",
]);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// eye and target pairs: the wide view's two cameras (session/wide.lua) and a few more
const PAIRS = [
  [6.5, 4, 7, 0, 4, 0.2],
  [0, -6, 12, 0, 4.4, 0],
  [-3, 12, 2, 1, 2, 0],
  [2, -1, 0.5, -1, 8, 0.3],
];

// the side camera the wide view starts from, with the core's lens
const WIDE = await runJSON(
  lua,
  `local c = tw.camera.new(); tw.camera.lookAt(c, 6.5, 4, 7, 0, 4, 0.2)
   c.f = 610; c.cx = 203; c.cy = 131
   return json.encode(c)`,
);

test("lookAt is the core's camera.lookAt", async () => {
  for (const p of PAIRS) {
    const want = await runJSON(
      lua,
      `local c = tw.camera.new(); tw.camera.lookAt(c, ${p.join(",")}); return json.encode(c)`,
    );
    const got = fc.lookAt({}, ...p);
    for (const k of FIELDS) assert.ok(near(got[k], want[k]), `${k} of ${p}`);
  }
});

test("an orbit made from a camera gives the same camera back (the default view)", () => {
  const o = fc.orbitOf(WIDE);
  const c = fc.cameraOf(o, WIDE);
  for (const k of FIELDS) assert.ok(near(c[k], WIDE[k], 1e-9), k);
  assert.equal(c.f, WIDE.f);
  assert.equal(c.cx, WIDE.cx);
  assert.equal(c.cy, WIDE.cy);
  // and the wide view is inside the limits as it is: clamping changes nothing
  assert.ok(fc.sameOrbit(fc.clampOrbit(o), o));
});

test("every move stays inside the limits: over the grass, near the pitch", () => {
  const t = fc.freeTune;
  let o = fc.orbitOf(WIDE);
  const moves = [
    (x) => fc.turn(x, 0.7, -2), // as low as it goes
    (x) => fc.zoom(x, 0.01), // as close as it goes
    (x) => fc.zoom(x, 1e6), // as far
    (x) => fc.move(x, 500, -500), // miles away
    (x) => fc.turn(x, 9, 9), // round and over the top
    (x) => fc.drag(x, -4000, 9000, WIDE.f),
  ];
  for (let i = 0; i < 60; i++) {
    o = moves[i % moves.length](o);
    const [, , ez] = fc.eyeOf(o);
    assert.ok(ez >= t.minEyeZ - 1e-9, `eye ${ez} above the grass`);
    assert.ok(o.dist >= t.minDist && o.dist <= t.maxDist, `dist ${o.dist}`);
    assert.ok(o.pitch >= t.minPitch - 1e-9 && o.pitch <= t.maxPitch + 1e-9);
    assert.ok(o.tx >= t.box.x0 && o.tx <= t.box.x1, `tx ${o.tx}`);
    assert.ok(o.ty >= t.box.y0 && o.ty <= t.box.y1, `ty ${o.ty}`);
    assert.ok(o.yaw > -Math.PI - 1e-9 && o.yaw <= Math.PI + 1e-9);
    // never straight down: lookAt needs a level right vector
    const c = fc.cameraOf(o, WIDE);
    assert.ok(Number.isFinite(c.rx) && Number.isFinite(c.uz));
    assert.ok(c.uz > 0, "the picture is never upside down");
  }
});

test("a low view close in is lifted, not put under the ground", () => {
  const o = fc.clampOrbit({
    yaw: 0,
    pitch: fc.freeTune.minPitch,
    dist: fc.freeTune.minDist,
    tx: 0,
    ty: 4,
    tz: 0,
  });
  assert.ok(near(fc.eyeOf(o)[2], fc.freeTune.minEyeZ, 1e-9));
});

// where a world point is on the screen through an orbit
const at = (o, x, y, z = 0) => project(fc.cameraOf(o, WIDE), x, y, z);

test("a drag across turns the pitch the way the hand goes (the near grass follows)", () => {
  const o = fc.orbitOf(WIDE);
  // a point on the grass between the eye and the point turned about
  const [ex, ey] = fc.eyeOf(o);
  const nx = (ex + o.tx) / 2,
    ny = (ey + o.ty) / 2;
  const before = at(o, nx, ny);
  // FreeCamera turns by -dx * turnPerPx for a drag of dx: a drag to the right
  const after = at(fc.turn(o, -40 * fc.freeTune.turnPerPx, 0), nx, ny);
  assert.ok(after[0] > before[0], `${before[0]} -> ${after[0]}`);
  // and the point turned about stays where it was on the screen
  assert.ok(near(at(o, o.tx, o.ty, o.tz)[0], WIDE.cx, 1e-6));
});

test("a drag down raises the eye and looks more from above", () => {
  const o = fc.orbitOf(WIDE);
  const n = fc.turn(o, 0, 30 * fc.freeTune.tiltPerPx);
  assert.ok(fc.eyeOf(n)[2] > fc.eyeOf(o)[2]);
});

test("moving the pitch: the grass under the pointer goes with it", () => {
  const o = fc.orbitOf(WIDE);
  for (const [dx, dy] of [
    [30, 0],
    [-30, 0],
    [0, 20],
    [0, -20],
  ]) {
    const before = at(o, o.tx, o.ty, o.tz);
    const after = at(fc.drag(o, dx, dy, WIDE.f), o.tx, o.ty, o.tz);
    const mx = after[0] - before[0],
      my = after[1] - before[1];
    // the same way, and about as far (a vertical drag is spread by the slant)
    if (dx)
      assert.ok(
        Math.sign(mx) === Math.sign(dx) && near(mx, dx, 0.2 * Math.abs(dx)),
        `x ${mx}`,
      );
    if (dy) assert.ok(Math.sign(my) === Math.sign(dy), `y ${my}`);
  }
});

test("closer and farther: a dolly along the line of sight", () => {
  const o = fc.orbitOf(WIDE);
  const closer = fc.zoom(o, 0.5);
  assert.ok(near(closer.dist, o.dist * 0.5));
  assert.equal(closer.yaw, o.yaw);
  // a point off the middle moves away from it when closer
  const p = at(o, 0, 0);
  const q = at(closer, 0, 0);
  assert.ok(Math.abs(q[0] - WIDE.cx) > Math.abs(p[0] - WIDE.cx));
});

test("two fingers: spread, twist and slide", () => {
  const g = fc.twoFingers([0, 0], [100, 0], [-50, 10], [150, 10]);
  assert.ok(near(g.scale, 2));
  assert.ok(near(g.angle, 0));
  assert.ok(near(g.dx, 0) && near(g.dy, 10));
  const t = fc.twoFingers([0, 0], [100, 0], [0, 0], [0, 100]);
  assert.ok(
    near(t.angle, Math.PI / 2),
    "a quarter turn clockwise on the screen",
  );
  // fingers too close to measure: no spread
  assert.equal(fc.twoFingers([0, 0], [0.5, 0], [0, 0], [40, 0]).scale, 1);
});

test("a twist of two fingers turns the pitch with them, as a map on a table", () => {
  // from high up, the pitch is nearly a map
  const o = fc.clampOrbit({ ...fc.orbitOf(WIDE), pitch: 1.3 });
  const centre = at(o, o.tx, o.ty, o.tz);
  // a point off the middle, and where it is after a small clockwise twist
  const tx = o.tx + 1.5,
    ty = o.ty + 1.0;
  const angleOf = (p) => Math.atan2(p[1] - centre[1], p[0] - centre[0]);
  const a0 = angleOf(at(o, tx, ty));
  const a1 = angleOf(at(fc.turn(o, 0.2, 0), tx, ty));
  // FreeCamera turns by the fingers' angle; screen angles grow clockwise (y down)
  assert.ok(fc.wrap(a1 - a0) > 0, `${a0} -> ${a1}`);
});

test("the way back turns the short way round", () => {
  const a = { yaw: 3, pitch: 0.5, dist: 10, tx: 0, ty: 4, tz: 0 };
  const b = { yaw: -3, pitch: 0.7, dist: 12, tx: 1, ty: 5, tz: 0 };
  const m = fc.mixOrbit(a, b, 0.5);
  assert.ok(Math.abs(Math.abs(m.yaw) - Math.PI) < 1e-9, `yaw ${m.yaw}`);
  assert.ok(near(m.dist, 11) && near(m.pitch, 0.6));
  assert.ok(fc.sameOrbit(fc.mixOrbit(a, b, 1), { ...b, yaw: fc.wrap(b.yaw) }));
});
