// The depth order of pieces (src/render/world.js frontOf and depthOrder):
// pieces in a line, a kubb lying against a standing one, a baton across a
// kubb, and every overlapping pair of a real crowded field turn.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { solid, frontOf, depthOrder } from "../../src/render/world.js";
import { project } from "../../src/render/camera.js";

// A camera in the core's table shape looking from (px, py, pz) at (tx, ty, tz).
function lookAt(px, py, pz, tx, ty, tz, f = 400) {
  let fx = tx - px,
    fy = ty - py,
    fz = tz - pz;
  const l = Math.hypot(fx, fy, fz);
  fx /= l;
  fy /= l;
  fz /= l;
  // right = forward x up(z), up = right x forward
  let rx = fy,
    ry = -fx,
    rz = 0;
  const rl = Math.hypot(rx, ry);
  rx /= rl;
  ry /= rl;
  const ux = ry * fz - rz * fy,
    uy = rz * fx - rx * fz,
    uz = rx * fy - ry * fx;
  return {
    px,
    py,
    pz,
    fx,
    fy,
    fz,
    rx,
    ry,
    rz,
    ux,
    uy,
    uz,
    f,
    cx: 200,
    cy: 120,
    lx: 0,
    ly: 0,
    lz: 0,
  };
}

// Quaternions: standing (identity); lying with the long axis along y (a
// quarter turn about x); lying along x (a quarter turn about y).
const STAND = { qw: 1, qx: 0, qy: 0, qz: 0 };
const ALONG_Y = { qw: Math.SQRT1_2, qx: Math.SQRT1_2, qy: 0, qz: 0 };
const ALONG_X = { qw: Math.SQRT1_2, qx: 0, qy: Math.SQRT1_2, qz: 0 };

const behind = lookAt(0, -1, 1.6, 0, 4.5, 0); // the thrower's side
const beyond = lookAt(0.2, 10, 1.4, 0, 4.5, 0); // the far side, looking back
const above = lookAt(0.05, 4.4, 2.5, 0, 5, 0); // nearly straight down

const kubb = (x, y, pose = STAND, z = 0.075) => ({
  id: `k${x},${y}`,
  kind: "kubb",
  x,
  y,
  z,
  ...pose,
});

// +1: b in front of a (a is drawn first)
const order = (a, b, cam) => frontOf(solid(a, cam), solid(b, cam), cam);

test("two kubbs in a line: the nearer is in front, from either end", () => {
  const near = kubb(0, 4),
    far = kubb(0, 5);
  assert.equal(order(far, near, behind), 1);
  assert.equal(order(near, far, behind), -1);
  assert.equal(order(far, near, beyond), -1);
  assert.equal(order(near, far, beyond), 1);
});

test("a kubb lying against a standing one", () => {
  const standing = kubb(0, 5);
  // lying along y, touching the standing kubb's near face
  const front = kubb(0, 5 - 0.035 - 0.075, ALONG_Y, 0.035);
  // and one touching its far face
  const back = kubb(0, 5 + 0.035 + 0.075, ALONG_Y, 0.035);
  assert.equal(order(standing, front, behind), 1, "the near one lies in front");
  assert.equal(order(standing, back, behind), -1, "the far one lies behind");
  assert.equal(
    order(standing, back, beyond),
    1,
    "seen from the far side, it is in front",
  );
  // and seen nearly straight down
  assert.equal(order(standing, front, above), 1);
});

test("a baton lying across a kubb is drawn over it", () => {
  const k = kubb(0, 5, ALONG_X, 0.035);
  const baton = {
    id: "b",
    kind: "baton",
    x: 0,
    y: 5,
    z: 0.07 + 0.022,
    ...ALONG_Y,
  };
  for (const cam of [behind, beyond, above]) {
    assert.equal(order(k, baton, cam), 1);
    assert.equal(order(baton, k, cam), -1);
  }
});

test("depthOrder agrees with frontOf for every overlapping pair of a real turn", () => {
  for (const name of ["field-impact", "king-impact", "field-turn"]) {
    const f = JSON.parse(
      fs.readFileSync(
        new URL(`../../dev/fixtures/${name}.json`, import.meta.url),
      ),
    );
    const cam = f.camera;
    const solids = f.scene.items
      .map((it) => solid(it, cam))
      .filter((s) =>
        [...Array(8).keys()].every((k) =>
          project(cam, s.W[3 * k], s.W[3 * k + 1], s.W[3 * k + 2]),
        ),
      );
    const boxes = solids.map((s) => {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (let k = 0; k < 8; k++) {
        const [x, y] = project(cam, s.W[3 * k], s.W[3 * k + 1], s.W[3 * k + 2]);
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      return [x0, y0, x1, y1];
    });
    const out = depthOrder(solids, cam, boxes);
    assert.deepEqual(
      [...out].sort((a, b) => a - b),
      [...solids.keys()],
      `${name}: a permutation`,
    );
    const at = new Array(out.length);
    out.forEach((i, r) => (at[i] = r));
    let pairs = 0;
    for (let i = 0; i < solids.length; i++)
      for (let j = i + 1; j < solids.length; j++) {
        const A = boxes[i],
          B = boxes[j];
        if (A[2] < B[0] || B[2] < A[0] || A[3] < B[1] || B[3] < A[1]) continue;
        pairs++;
        const f = frontOf(solids[i], solids[j], cam);
        assert.equal(
          f > 0 ? at[i] < at[j] : at[j] < at[i],
          true,
          `${name}: ${solids[i].item.id} and ${solids[j].item.id}`,
        );
      }
    assert.ok(pairs > 0, `${name}: some pieces overlap on screen`);
  }
});
