// Touch the kubb to raise it (src/game/raise-touch.js): the pure geometry, against the
// raise camera the game draws with.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  raiseGeometry,
  onKubb,
  nearerEnd,
  dragOf,
  allowedEnd,
  tiltItem,
  pickEnd,
  tune,
} from "../../src/game/raise-touch.js";
import {
  raiseCamera,
  poseItem,
  lookAt,
  tune as sceneTune,
} from "../../src/game/scenes.js";

const pose = { x: 0.7, y: 2.3, angle: 0.35, standing: false };
const foot = (k) => ({
  x: pose.x + k * Math.cos(pose.angle) * 0.11,
  y: pose.y + k * Math.sin(pose.angle) * 0.11,
  standing: true,
  angle: pose.angle,
});
const need = {
  kind: "raise",
  kubb: "a3",
  pose,
  ends: [
    { which: 1, ok: true, pose: foot(1) },
    { which: 2, ok: false, pose: foot(-1) },
  ],
};
const view = { width: 390, height: 844, dpr: 2, fit: { ox: 0, oy: 200, k: 2 } };

test("the kubb's outline takes taps on it and a finger's width round it, and says the nearer end", () => {
  const g = raiseGeometry(view, raiseCamera(need), need);
  assert.ok(g, "drawn");
  const [a, b] = g.caps;
  const mx = (a.x + b.x) / 2,
    my = (a.y + b.y) / 2;
  assert.ok(onKubb(g, mx, my));
  const ys = g.outline.map((p) => p[1]);
  const top = Math.min(...ys);
  assert.ok(onKubb(g, mx, top - 20), "20 px above the kubb");
  assert.ok(!onKubb(g, mx, top - tune.margin - 4), "but not far above it");
  assert.equal(nearerEnd(g, a.x * 0.8 + b.x * 0.2, a.y * 0.8 + b.y * 0.2), 0);
  assert.equal(nearerEnd(g, a.x * 0.2 + b.x * 0.8, a.y * 0.2 + b.y * 0.8), 1);
  assert.equal(
    raiseGeometry(view, raiseCamera(need), { ...need, ends: [] }),
    null,
  );
});

test("a drag says the end it moves toward and how far up", () => {
  const g = raiseGeometry(view, raiseCamera(need), need);
  const [a, b] = g.caps;
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const travel = Math.max(tune.travelMin, L * tune.travelK);
  const ux = (a.x - b.x) / L,
    uy = (a.y - b.y) / L;
  const d = dragOf(g, 0, 0, ux * travel * 0.5, uy * travel * 0.5);
  assert.equal(d.i, 0);
  assert.ok(Math.abs(d.t - 0.5) < 1e-9);
  assert.equal(dragOf(g, 0, 0, -ux * travel * 3, -uy * travel * 3).t, 1);
  assert.equal(dragOf(g, 0, 0, -ux, -uy).i, 1);
});

test("a refused end gives the allowed one", () => {
  assert.deepEqual(allowedEnd(need, 0), { i: 0, ok: true });
  assert.deepEqual(allowedEnd(need, 1), { i: 0, ok: false });
  const none = { ends: [{ ok: false }, { ok: false }] };
  assert.deepEqual(allowedEnd(none, 0), { i: null, ok: false });
});

test("tipped up: lying at 0, on the end's footprint at 1, pivoting on that end's edge", () => {
  const lying = poseItem("a3", "kubb", pose);
  const t0 = tiltItem(need, 0, 0);
  assert.deepEqual(t0, lying);
  // at the top it stands on end 1's footprint, its long axis upright
  const top = tiltItem(need, 0, 1);
  const f = need.ends[0].pose;
  assert.ok(Math.hypot(top.x - f.x, top.y - f.y) < 1e-9, "on the footprint");
  assert.ok(Math.abs(top.z - 0.075) < 1e-9, "its middle at half its length");
  // the body's long axis (local z) turned by the item's quaternion: upright
  const { qw: w, qx: x, qy: y } = top;
  const zz = 1 - 2 * (x * x + y * y);
  assert.ok(Math.abs(Math.abs(zz) - 1) < 1e-9, "upright");
  // half way: the middle has risen and moved toward end 1
  const half = tiltItem(need, 0, 0.5);
  assert.ok(half.z > lying.z);
  const toward = (it) =>
    (it.x - pose.x) * Math.cos(pose.angle) +
    (it.y - pose.y) * Math.sin(pose.angle);
  assert.ok(toward(half) > toward(lying));
  assert.ok(
    toward(tiltItem(need, 1, 0.5)) < toward(lying),
    "end 2 the other way",
  );
});

test("the raise camera stands twice as far off: the kubb drawn half as big, twice the ground each way", () => {
  // the camera before web 0.17.0: 1.15 m back, 1.05 m up, looking 0.12 m toward it
  const p = need.pose;
  const a = p.angle;
  let nx = -Math.sin(a),
    ny = Math.cos(a);
  if (ny > 0.05) [nx, ny] = [-nx, -ny];
  const old = lookAt(
    [p.x + nx * 1.15, p.y + ny * 1.15, 1.05],
    [p.x + nx * 0.12, p.y + ny * 0.12, 0],
    sceneTune.raiseF,
  );
  const span = (cam) => {
    const g = raiseGeometry(view, cam, need);
    return Math.hypot(g.caps[1].x - g.caps[0].x, g.caps[1].y - g.caps[0].y);
  };
  const k = span(raiseCamera(need)) / span(old);
  assert.ok(Math.abs(k - 0.5) < 0.02, `drawn ${k.toFixed(3)} as long`);
  assert.equal(sceneTune.raiseBack, 2.3);
  assert.equal(sceneTune.raiseUp, 2.1);
  // the drawn kubb with the slop is still a finger's target, 44 px or more each way
  const g = raiseGeometry(view, raiseCamera(need), need);
  const xs = g.outline.map((q) => q[0]),
    ys = g.outline.map((q) => q[1]);
  assert.ok(Math.max(...xs) - Math.min(...xs) + 2 * tune.margin >= 44);
  assert.ok(Math.max(...ys) - Math.min(...ys) + 2 * tune.margin >= 44);
});

// Engine 1.4.1's held raise camera draws a kubb 20 to 40 px long, where both numbers'
// reaches (labelR, 40 px) cover it: a tap on the drawn kubb is the end drawn nearer it
// before a number's reach, and only a tap on a number's own circle comes first (the
// iPhone app's raisePick, its PR 65).
test("the tap order: a number's own circle, the drawn kubb, a number's reach, a finger's width round it", () => {
  // a kubb drawn 30 px long, end 0 at the left; its numbers 21 px past each face, the
  // right one moved down and in (as a label kept clear of the footprint can be)
  const g = {
    outline: [
      [185, 195],
      [215, 195],
      [215, 205],
      [185, 205],
    ],
    caps: [
      { x: 185, y: 200 },
      { x: 215, y: 200 },
    ],
  };
  const labels = [
    { lx: 164, ly: 200 },
    { lx: 196, ly: 226 },
  ];
  // on a number's own circle (its 17 px and 2 more): that end
  assert.equal(pickEnd(g, labels, 164, 210), 0);
  assert.equal(pickEnd(g, labels, 196, 244), 1);
  // on the kubb's left half, nearer end 1's moved number than end 0's: still end 0,
  // the end drawn nearer (before 1.4.1 the nearer number's reach took it: end 1)
  const x = 198,
    y = 204;
  assert.ok(
    Math.hypot(labels[1].lx - x, labels[1].ly - y) <
      Math.hypot(labels[0].lx - x, labels[0].ly - y),
  );
  assert.equal(pickEnd(g, labels, x, y), 0);
  assert.equal(pickEnd(g, labels, 212, 198), 1, "the right half");
  // off the kubb, within a number's reach: the nearest number
  assert.equal(pickEnd(g, labels, 150, 225), 0);
  // a finger's width round the kubb, out of every number's reach: its nearer end
  assert.equal(pickEnd(g, labels, 222, 180), 1);
  // nowhere near: none (the game then tries the ground)
  assert.equal(pickEnd(g, labels, 300, 300), null);
  // no labels drawn (a camera that cannot): the kubb alone
  assert.equal(pickEnd(g, [null, null], 190, 200), 0);
  assert.equal(pickEnd(null, labels, 164, 200), 0);
});
