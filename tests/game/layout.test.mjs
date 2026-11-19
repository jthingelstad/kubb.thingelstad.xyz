// src/game/layout.js and the pure parts of src/game/sound.js and
// src/game/scenes.js: where the dial (or the linear meter) and minimap go, the tall-canvas framing
// (its un-projection must match its projection), and the knock take choice.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  layoutFor,
  worldFit,
  stillFit,
  panFor,
  isTall,
  tune,
} from "../../src/game/layout.js";
import { pickTake } from "../../src/game/sound.js";
import {
  lookAt,
  teamOf,
  raiseCamera,
  punishCamera,
  punishNearY,
} from "../../src/game/scenes.js";
import {
  project,
  projectView,
  unprojectView,
} from "../../src/render/camera.js";
import { linearGeometry, tune as linearTune } from "../../src/render/linear.js";
import { dialGeometry, tune as dialTune } from "../../src/render/dial.js";

const overlaps = (a, b) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

const SIZES = [
  [1280, 768],
  [390, 844],
  [844, 390],
  [768, 1024],
  [360, 640],
];

test("tall canvases are the upright ones", () => {
  assert.equal(isTall(390, 844), true);
  assert.equal(isTall(1280, 768), false);
  assert.equal(isTall(844, 390), false);
  assert.equal(isTall(500, 500), false);
});

test("the dial sits inside the screen, lower right wide and lower centre tall", () => {
  for (const [W, H] of SIZES) {
    const L = layoutFor(W, H, { bottom: 20, right: 10 });
    const d = L.dial;
    assert.ok(d.x >= 0 && d.y >= 0, `${W}x${H} dial on screen`);
    assert.ok(d.x + d.width <= W && d.y + d.height <= H - 20 + 0.01);
    assert.ok(d.width >= 120, `${W}x${H} dial big enough to swing`);
    const mid = d.x + d.width / 2;
    if (isTall(W, H)) assert.ok(Math.abs(mid - W / 2) < 1, "centred");
    else assert.ok(mid > W / 2, "to the right");
    const m = L.minimap;
    assert.ok(
      m.x >= 0 && m.x + m.width <= W && m.y >= 0 && m.y + m.height <= H,
    );
  }
});

test("the linear meter is a long strip at the right edge, clear of the minimap", () => {
  const notch = { top: 47, bottom: 34, right: 0, left: 0 };
  for (const [W, H, safe] of [
    [1280, 768, {}],
    [390, 844, notch], // a phone, the page on its own
    [390, 664, {}], // the same phone's browser with its bars showing
    [768, 1024, {}],
    [360, 640, {}],
  ]) {
    const s = { top: 0, bottom: 0, ...safe };
    const L = layoutFor(W, H, safe, false, "linear");
    const d = L.dial;
    assert.equal(L.meter, "linear", `${W}x${H}`);
    assert.ok(d.x + d.width <= W && d.x + d.width > W - 20, "at the right");
    assert.ok(d.y + d.height <= H - s.bottom, "above the home bar");
    assert.ok(d.y >= s.top + tune.railH, "below the rail's row");
    assert.ok(d.width >= tune.linearWMin && d.width <= tune.linearWMax);
    const g = linearGeometry(d);
    assert.ok(g.travel >= linearTune.minTravel, `${W}x${H} room: ${g.travel}`);
    if (L.tall) {
      const m = L.minimap;
      assert.ok(d.y >= m.y + m.height, "under the minimap");
      assert.equal(L.side, "both", "the plan buttons split, the line between");
    } else assert.equal(L.side, "left");
  }
  // a phone held upright has about 0.9 px a degree or more: the straight
  // trial's 150 px for the whole backswing, 0.8, was the cramp this meter is
  // not to have
  const scale = (W, H, safe) =>
    linearGeometry(layoutFor(W, H, safe, false, "linear").dial).scale;
  assert.ok(scale(390, 844, notch) > 0.9, `${scale(390, 844, notch)}`);
  assert.ok(scale(390, 664, {}) > 0.9, `${scale(390, 664, {})}`);
  // and no more than a thumb reaches: a quarter shorter than the first
  // build's (a tester, 2026-11-19: "Make it 1/4 shorter"), about 340 px of
  // travel on a phone held upright, where it had 447
  const travel = (W, H, safe) =>
    linearGeometry(layoutFor(W, H, safe, false, "linear").dial).travel;
  assert.ok(scale(390, 844, notch) < 1.0);
  const t = travel(390, 844, notch);
  assert.ok(t > 320 && t < 350, `${t}`);
});

test("the shorter linear meter keeps its foot: the quarter comes off the top", () => {
  const notch = { top: 47, bottom: 34, right: 0, left: 0 };
  for (const [W, H, safe] of [
    [390, 844, notch],
    [390, 664, {}],
    [1280, 768, {}],
  ]) {
    const d = layoutFor(W, H, safe, false, "linear").dial;
    const bottom = H - (safe.bottom || 0) - tune.margin * 0.5;
    assert.ok(Math.abs(d.y + d.height - bottom) < 1e-9, `${W}x${H} foot`);
    assert.ok(d.height <= tune.linearHMax, `${W}x${H} height`);
  }
});

test("the linear meter gives way to the clock where it would be cramped", () => {
  // a phone on its side has no height for it, nor a small phone's browser
  const L = layoutFor(844, 390, {}, false, "linear");
  assert.equal(L.meter, "clock");
  assert.deepEqual(L.dial, layoutFor(844, 390).dial);
  assert.equal(layoutFor(375, 553, {}, false, "linear").meter, "clock");
  // and the touch trial keeps the clock it was built on
  assert.equal(layoutFor(390, 844, {}, true, "linear").meter, "clock");
  // the clock is the default
  assert.equal(layoutFor(390, 844).meter, "clock");
  assert.equal(layoutFor(390, 844, {}, false, "clock").side, "both");
});

test("the meter's side: the linear meter at the left edge, mirrored", () => {
  const notch = { top: 47, bottom: 34, right: 0, left: 0 };
  for (const [W, H, safe] of [
    [1280, 768, {}],
    [1280, 600, {}],
    [390, 844, notch],
    [390, 664, {}],
    [768, 1024, {}],
  ]) {
    const s = { top: 0, bottom: 0, left: 0, ...safe };
    const L = layoutFor(W, H, safe, false, "linear", { side: "left" });
    const R = layoutFor(W, H, safe, false, "linear");
    const d = L.dial;
    assert.equal(L.meter, "linear", `${W}x${H}`);
    assert.equal(L.meterSide, "left");
    assert.equal(R.meterSide, "right", "the right is the default");
    assert.ok(d.x >= s.left && d.x < s.left + 20, "at the left");
    assert.equal(d.width, R.dial.width);
    assert.ok(d.y + d.height <= H - s.bottom, "above the home bar");
    const g = linearGeometry(d, "left");
    assert.ok(g.travel >= linearTune.minTravel, `${W}x${H} room`);
    assert.ok(overlaps(L.minimap, d) === false, "clear of the minimap");
    if (L.tall) {
      // the rail and the practice tray (BATONS | KUBBS, RESET) are top left, the
      // minimap top right: the meter starts under all of them
      assert.ok(d.y >= L.minimap.y + L.minimap.height, "under the minimap");
      assert.ok(d.y >= s.top + 134, "under the practice tray");
      assert.equal(L.side, "both");
      assert.deepEqual(L.minimap, R.minimap);
    } else {
      assert.ok(d.y >= s.top + tune.railBox, "under the rail's box");
      assert.equal(L.side, "right", "the plan buttons on its inner side");
      assert.ok(L.minimap.x > W / 2, "the minimap moved to the other corner");
    }
  }
});

test("the meter's side: a wide canvas's clock goes lower left, a tall one's stays centred", () => {
  for (const [W, H] of [
    [1280, 768],
    [844, 390],
    [1024, 768],
  ]) {
    const L = layoutFor(W, H, {}, false, "clock", { side: "left" });
    const R = layoutFor(W, H);
    assert.equal(L.meter, "clock");
    assert.equal(L.meterSide, "left");
    assert.ok(L.dial.x + L.dial.width / 2 < W / 2, `${W}x${H} to the left`);
    // mirrored: the same size, the same height, as far in from the edge
    assert.equal(L.dial.width, R.dial.width);
    assert.equal(L.dial.y, R.dial.y);
    assert.ok(Math.abs(L.dial.x - (W - R.dial.x - R.dial.width)) < 1e-9);
    assert.ok(L.minimap.x > W / 2 && R.minimap.x < W / 2);
    assert.equal(overlaps(L.minimap, L.dial), false);
    assert.equal(L.side, "right");
    assert.equal(R.side, "left");
  }
  for (const [W, H] of [
    [390, 844],
    [390, 664],
  ]) {
    for (const coarse of [false, true]) {
      const L = layoutFor(W, H, {}, false, "clock", { side: "left", coarse });
      const R = layoutFor(W, H, {}, false, "clock", { coarse });
      assert.deepEqual(L.dial, R.dial, "the tall clock is centred either way");
      assert.equal(L.meterSide, "centre");
    }
  }
});

test("a touchscreen held upright leaves room for a finger round the clock's rim", () => {
  const notch = { top: 47, bottom: 34, right: 0, left: 0 };
  for (const [W, H, safe] of [
    [390, 844, notch],
    [390, 844, {}],
    [390, 664, {}],
    [360, 640, {}],
    [768, 1024, {}],
  ]) {
    const s = { top: 0, bottom: 0, left: 0, right: 0, ...safe };
    const L = layoutFor(W, H, safe, false, "clock", { coarse: true });
    const M = layoutFor(W, H, safe); // a mouse: as before
    assert.equal(L.track, true, `${W}x${H}`);
    assert.equal(M.track, false);
    const g = dialGeometry(L.dial),
      gm = dialGeometry(M.dial);
    // shrunk by no more than about 15%
    assert.ok(g.r >= gm.r * 0.85 && g.r < gm.r, `${g.r} vs ${gm.r}`);
    assert.ok(Math.abs(g.cx - W / 2) < 1e-9, "still centred");
    // the whole track is on the screen: 6 o'clock clears the bottom
    const out = g.r * dialTune.trackOut;
    assert.ok(g.cy + out <= H - s.bottom + 1e-9, `${W}x${H} bottom`);
    assert.ok(g.cx - out >= s.left && g.cx + out <= W - s.right, "sides");
    // the plan buttons stand above the track where their inner edge is
    const dx = g.cx - (s.left + tune.planColW);
    const top = g.cy - Math.sqrt(Math.max(0, out * out - dx * dx));
    assert.ok(L.plansFoot != null && L.plansFoot <= top, "above the track");
    assert.ok(L.plansFoot > L.minimap.y + L.minimap.height + 140, "room");
  }
  // a phone on its side, the swipe trial and the linear meter: no track
  assert.equal(
    layoutFor(844, 390, {}, false, "clock", { coarse: true }).track,
    false,
  );
  assert.equal(
    layoutFor(390, 844, {}, true, "clock", { coarse: true }).track,
    false,
  );
  assert.deepEqual(
    layoutFor(390, 844, {}, true, "clock", { coarse: true }).dial,
    layoutFor(390, 844, {}, true).dial,
  );
  assert.equal(
    layoutFor(390, 844, {}, false, "linear", { coarse: true }).track,
    false,
  );
});

test("a wide canvas keeps the renderer's framing", () => {
  assert.equal(worldFit(1280, 768), null);
  assert.equal(stillFit(844, 390), null);
  assert.equal(panFor(1280, 768, 30), 200);
});

// A phone on its side (Jamie's two-hands ask, 2026-11-19, and the panel that
// followed it): the raise and punishment panel is a bar along the bottom, at
// most tune.stillBar px with its gap, and must cover neither the kubb being
// raised (both end numbers, r 17 px) nor the near baseline of the half a
// punishment kubb goes in.
const PHONES = [
  [852, 393, 21],
  [932, 430, 21],
  [844, 390, 21],
  [667, 375, 0],
  [568, 320, 0],
  [800, 360, 24],
];
const barTop = (H, bottom) => H - bottom - tune.stillBar;

test("the punishment scene's lowest ground is the near baseline", () => {
  const cam = punishCamera();
  assert.ok(Math.abs(punishNearY() - project(cam, 0, 0, 0)[1]) < 1e-9);
  // the camera looks straight down the pitch: the baseline is level on screen
  for (const x of [-2.5, -1, 1, 2.5])
    assert.ok(Math.abs(project(cam, x, 0, 0)[1] - punishNearY()) < 1e-9);
  // and the rest of the half is above it
  assert.ok(project(cam, 0, 4, 0)[1] < punishNearY());
});

test("a phone on its side: the panel's bar stays under the near baseline", () => {
  for (const [W, H, bottom] of PHONES) {
    const fit = stillFit(W, H, 1, { lowest: punishNearY(), bottom });
    // these phones keep the renderer's rule: the baseline is already clear
    assert.equal(fit, null, `${W}x${H}`);
    const view = { width: W, height: H, fit };
    const y = projectView(view, punishCamera(), 0, 0, 0)[1];
    assert.ok(
      y + tune.stillClear <= barTop(H, bottom) + 1e-9,
      `${W}x${H}: baseline ${y.toFixed(1)}, bar ${barTop(H, bottom)}`,
    );
  }
});

test("a window too short for the bar lifts the punishment scene, not the bar", () => {
  const W = 640,
    H = 300,
    bottom = 21;
  const fit = stillFit(W, H, 1, { lowest: punishNearY(), bottom });
  const k = Math.min(W / 400, H / 240);
  assert.ok(fit, "lifted");
  assert.ok(
    Math.abs(fit.k - k) < 1e-9 && Math.abs(fit.ox - (W - 400 * k) / 2) < 1e-9,
  );
  const view = { width: W, height: H, fit };
  const cam = punishCamera();
  const y = projectView(view, cam, 0, 0, 0)[1];
  assert.ok(Math.abs(y + tune.stillClear - barTop(H, bottom)) < 1e-6);
  // the king and the centre line stay on the screen
  assert.ok(projectView(view, cam, 0, 4, 0.3)[1] > 0);
  // a finger still lands where it points
  const back = unprojectView(view, cam, W / 2, y - 20);
  const there = projectView(view, cam, back.x, back.y, 0);
  assert.ok(Math.abs(there[1] - (y - 20)) < 1e-6);
});

test("a phone on its side: the kubb being raised and both its numbers clear the bar", () => {
  const need = { pose: { x: 0.7, y: 2.3, angle: 0.35, standing: false } };
  const cam = raiseCamera(need);
  const { x, y, angle } = need.pose;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  for (const [W, H, bottom] of PHONES) {
    // the raise passes no lowest: the renderer's rule
    assert.equal(stillFit(W, H, 1.8), null);
    const view = { width: W, height: H, fit: null };
    for (const k of [1, -1]) {
      // the number, 7 cm past the footprint, and its 17 px circle
      const label = projectView(
        view,
        cam,
        x + k * c * 0.18,
        y + k * s * 0.18,
        0,
      );
      assert.ok(
        label[1] + 17 < barTop(H, bottom) - tune.stillClear,
        `${W}x${H}`,
      );
      assert.ok(label[0] - 17 > 0 && label[0] + 17 < W, `${W}x${H} across`);
      // the kubb's near corners
      for (const sd of [1, -1]) {
        const p = projectView(
          view,
          cam,
          x + k * c * 0.075 - sd * s * 0.035,
          y + k * s * 0.075 + sd * c * 0.035,
          0,
        );
        assert.ok(p[1] < barTop(H, bottom) - tune.stillClear);
      }
    }
  }
});

test("tall screens and taller windows keep their framing", () => {
  const opt = { lowest: punishNearY(), bottom: 34 };
  assert.deepEqual(stillFit(393, 852, 1, opt), stillFit(393, 852, 1));
  assert.deepEqual(stillFit(390, 844, 1.8, opt), stillFit(390, 844, 1.8));
  for (const [W, H] of [
    [1440, 900],
    [1180, 820],
    [1024, 500],
  ])
    assert.equal(stillFit(W, H, 1, opt), null, `${W}x${H}`);
});

test("a tall canvas zooms in, keeps the frame's edges and pans to the target", () => {
  const W = 390,
    H = 844;
  const f = worldFit(W, H, 200);
  assert.ok(Math.abs(f.k - (W / 400) * tune.tallZoom) < 1e-9);
  // the frame's centre stays in the middle of the screen
  assert.ok(Math.abs(f.ox + 200 * f.k - W / 2) < 1e-9);
  // panned to an edge, the frame never leaves a gap
  const l = worldFit(W, H, -500),
    r = worldFit(W, H, 900);
  assert.ok(l.ox <= 1e-9 && l.ox + 400 * l.k >= W - 1e-9);
  assert.ok(r.ox <= 1e-9 && r.ox + 400 * r.k >= W - 1e-9);
  // a target near the frame's left edge pulls the pan left, never past it
  const p = panFor(W, H, 60);
  assert.ok(p < 200);
  const fp = worldFit(W, H, p);
  const sx = fp.ox + 60 * fp.k;
  assert.ok(sx > 0 && sx < W);
});

test("framed views un-project to the points they project", () => {
  const cam = lookAt([0.4, -1.5, 1.6], [0, 4, 0], 600);
  for (const [W, H] of SIZES) {
    for (const fit of [null, worldFit(W, H, 150), stillFit(W, H, 1.8)]) {
      const view = { width: W, height: H, fit };
      for (const [x, y] of [
        [0, 2],
        [-1.5, 6],
        [2, 7.5],
      ]) {
        const s = projectView(view, cam, x, y, 0);
        if (!s) continue;
        const back = unprojectView(view, cam, s[0], s[1]);
        assert.ok(back, `${W}x${H} un-projects`);
        assert.ok(Math.abs(back.x - x) < 1e-6 && Math.abs(back.y - y) < 1e-6);
      }
    }
  }
});

test("the raise camera sees the lying kubb from the defender's side", () => {
  const need = { pose: { x: 1.93, y: 3.26, angle: -1.559, standing: false } };
  const cam = raiseCamera(need);
  const view = { width: 1280, height: 768, fit: null };
  const s = projectView(view, cam, need.pose.x, need.pose.y, 0.035);
  assert.ok(s, "the kubb is in front of the camera");
  assert.ok(s[0] > 0 && s[0] < 1280 && s[1] > 0 && s[1] < 768 * 0.7);
});

test("pieces belong to a team by their id", () => {
  assert.equal(teamOf("a3"), "A");
  assert.equal(teamOf("b10"), "B");
  assert.equal(teamOf("king"), undefined);
});

test("a knock never repeats the last take and prefers a quiet one", () => {
  const seq = [0, 0.13, 0.5, 0.99, 0.42, 0.77];
  let last = null;
  for (const r of seq) {
    const t = pickTake(9, last, new Set(), () => r);
    assert.ok(t >= 0 && t < 9 && t !== last);
    last = t;
  }
  const busy = new Set([0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(
    pickTake(9, null, busy, () => 0.5),
    8,
  );
  // all busy: still a take, still not the last
  assert.notEqual(
    pickTake(2, 1, new Set([0, 1]), () => 0.9),
    1,
  );
});

// The plan block on a wide touchscreen (Jamie, 2026-11-19: "in landscape the
// tilt, arc, stand controls should be pushed to the left hand side of the
// screen so the user can control those with the left hand and the throw
// with the right hand"): at the edge away from the meter, the minimap on its
// inner side, nothing on the throwing line. The iPhone app ports these.
test("a wide touchscreen puts the plan block at the edge away from the meter", () => {
  const notch = { left: 59, right: 59, bottom: 21, top: 0 };
  const cases = [
    [852, 393, notch, "clock"], // a phone on its side
    [932, 430, notch, "clock"], // a big one
    [667, 375, {}, "clock"], // a small one, no notch
    [844, 390, {}, "clock"],
    [1180, 820, { top: 24, bottom: 20 }, "clock"], // a tablet on its side
    [1180, 820, { top: 24, bottom: 20 }, "linear"],
    [1024, 768, {}, "linear"],
  ];
  for (const [W, H, safe, meter] of cases) {
    const s = { top: 0, right: 0, bottom: 0, left: 0, ...safe };
    for (const side of ["right", "left"]) {
      const tag = `${W}x${H} ${meter} meter ${side}`;
      const L = layoutFor(W, H, safe, false, meter, { side, coarse: true });
      assert.equal(L.meter, meter, tag);
      const edge = side === "right" ? "left" : "right";
      assert.equal(L.planEdge, edge, tag);
      // the block's side of the meter is as before (hud.js mirrors by it)
      assert.equal(L.side, side === "right" ? "left" : "right", tag);
      const p = L.plan;
      assert.equal(p.width, tune.planW);
      assert.equal(p.height, tune.planH);
      if (edge === "left")
        assert.equal(p.x, s.left + tune.planEdge, `${tag}: at the left`);
      else
        assert.equal(
          p.x + p.width,
          W - s.right - tune.planEdge,
          `${tag}: at the right`,
        );
      // its foot level with the meter's, as it was beside it
      const d = L.dial;
      assert.ok(
        Math.abs(p.y + p.height - (d.y + d.height - tune.planFoot)) < 1e-9,
        tag,
      );
      assert.ok(p.y >= s.top + tune.railBox, `${tag}: under the rail`);
      // the minimap on its inner side, its foot where it was
      const m = L.minimap;
      const was = layoutFor(W, H, safe, false, meter, { side });
      assert.equal(m.y, was.minimap.y, tag);
      assert.equal(m.width, was.minimap.width, tag);
      if (edge === "left") assert.equal(m.x, p.x + p.width + tune.planGap);
      else assert.equal(m.x + m.width, p.x - tune.planGap);
      // nothing overlaps, nothing on the throwing line, all inside the safe area
      const mid = W / 2;
      const meterBox =
        meter === "clock"
          ? (() => {
              const g = dialGeometry(d);
              const reach = g.r * dialTune.touchReach;
              // the clock and its touch zone beside the ring
              return {
                x: g.cx - reach,
                y: g.cy - reach,
                width: 2 * reach,
                height: 2 * reach,
              };
            })()
          : d;
      for (const [name, r] of [
        ["block", p],
        ["minimap", m],
      ]) {
        assert.ok(
          r.x + r.width <= mid - tune.planClear || r.x >= mid + tune.planClear,
          `${tag}: the ${name} is off the throwing line`,
        );
        assert.ok(!overlaps(r, meterBox), `${tag}: the ${name} and the meter`);
        assert.ok(r.x >= s.left && r.x + r.width <= W - s.right, tag);
        assert.ok(r.y + r.height <= H - s.bottom, tag);
      }
      assert.ok(!overlaps(p, m), `${tag}: the block and the minimap`);
      // the meter itself is where it was
      assert.deepEqual(d, was.dial, tag);
    }
  }
});

test("the plan block's numbers on the phones the iPhone app ports", () => {
  const notch = { left: 59, right: 59, bottom: 21, top: 0 };
  const rect = (r) =>
    [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10);
  const at = (W, H, safe, side) => {
    const L = layoutFor(W, H, safe, false, "clock", { side, coarse: true });
    return { plan: rect(L.plan), minimap: rect(L.minimap) };
  };
  assert.deepEqual(at(852, 393, notch, "right"), {
    plan: [67, 187, 202, 168],
    minimap: [281, 235.4, 62.9, 122.6],
  });
  assert.deepEqual(at(852, 393, notch, "left"), {
    plan: [583, 187, 202, 168],
    minimap: [508.1, 235.4, 62.9, 122.6],
  });
  assert.deepEqual(at(932, 430, notch, "right"), {
    plan: [67, 224, 202, 168],
    minimap: [281, 260.8, 68.8, 134.2],
  });
  assert.deepEqual(at(667, 375, {}, "right"), {
    plan: [8, 190, 202, 168],
    minimap: [222, 250.4, 56.7, 110.6],
  });
});

test("a mouse keeps the plan block beside the meter, a tall canvas has none", () => {
  for (const [W, H] of [
    [1440, 900],
    [1280, 768],
    [852, 393],
  ]) {
    for (const side of ["right", "left"]) {
      const L = layoutFor(W, H, {}, false, "clock", { side });
      assert.equal(L.planEdge, null);
      const d = L.dial;
      if (side === "right") {
        assert.equal(L.plan.x + L.plan.width, d.x - tune.planBeside);
        assert.ok(L.minimap.x < W / 2, "the minimap keeps its corner");
        assert.equal(L.minimap.x, tune.margin);
      } else {
        assert.equal(L.plan.x, d.x + d.width + tune.planBeside);
        assert.ok(L.minimap.x > W / 2);
      }
    }
  }
  for (const coarse of [false, true]) {
    const L = layoutFor(393, 852, { top: 59, bottom: 34 }, false, "clock", {
      coarse,
    });
    assert.equal(L.plan, null);
    assert.equal(L.planEdge, null);
    assert.equal(L.side, "both");
  }
  // a touchscreen too narrow to keep the block and the minimap off the
  // throwing line keeps them by the meter
  const N = layoutFor(560, 520, {}, false, "clock", { coarse: true });
  assert.equal(N.tall, false);
  assert.equal(N.planEdge, null);
});
