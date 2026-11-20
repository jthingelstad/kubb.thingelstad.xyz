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
  meterRoom,
  headerPlates,
  linearFirst,
  inLinearZone,
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
import {
  linearGeometry,
  tabRect,
  tune as linearTune,
} from "../../src/render/linear.js";
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
  // a small phone's browser held upright has no height for it
  assert.equal(layoutFor(375, 553, {}, false, "linear").meter, "clock");
  // nor a wide canvas whose track would be under wideMinTravel (210): with
  // no insets the box needs a canvas 299 px high (17 px of margins, the
  // body's 71.7 px of caps and shadow), with a 6.1-inch iPhone's insets 320
  for (const [W, H, safe] of [
    [740, 290, {}],
    [740, 298, {}],
    [844, 319, { left: 47, right: 47, bottom: 21 }],
    [852, 393, { top: 0, bottom: 120, left: 59, right: 59 }],
  ]) {
    for (const side of ["right", "left"]) {
      const L = layoutFor(W, H, safe, false, "linear", { side });
      assert.equal(L.meter, "clock", `${W}x${H} ${side}`);
      assert.deepEqual(
        L.dial,
        layoutFor(W, H, safe, false, "clock", { side }).dial,
      );
      assert.deepEqual(L.meterRoom, { left: 0, right: 0 });
    }
  }
  // the boundary, every header, both sides, mouse and touch
  for (const [W, H, safe] of [
    [740, 299, {}],
    [844, 320, { left: 47, right: 47, bottom: 21 }],
  ])
    for (const header of [null, "practice", "watch"])
      for (const side of ["right", "left"])
        for (const coarse of [false, true])
          assert.equal(
            layoutFor(W, H, safe, false, "linear", { side, coarse, header })
              .meter,
            "linear",
            `${W}x${H} ${header} ${side} ${coarse}`,
          );
  // and the touch trial keeps the clock it was built on
  assert.equal(layoutFor(390, 844, {}, true, "linear").meter, "clock");
  // the clock is the default
  assert.equal(layoutFor(390, 844).meter, "clock");
  assert.equal(layoutFor(390, 844, {}, false, "clock").side, "both");
});

// The phones on their side the iPhone app checks, and browsers' sizes of
// them (the bars take some height), and short desktop windows. Safari with
// its bars showing (the heights Playwright's device list gives, the page's
// viewport-fit=cover width and the home indicator's inset): the 6.1-inch
// phones at 844 x 342 and 340 and 852 x 343, the mini at 812 x 327 and 325,
// and the widths without cover (750 x 342, 734 x 343, 712 x 325).
const NOTCH_61 = { left: 47, right: 47, bottom: 21, top: 0 };
const ISLAND_61 = { left: 59, right: 59, bottom: 21, top: 0 };
const MINI = { left: 50, right: 50, bottom: 21, top: 0 };
const SIDEWAYS = [
  [844, 390, {}],
  [844, 342, NOTCH_61],
  [844, 340, NOTCH_61],
  [852, 343, ISLAND_61],
  [812, 327, MINI],
  [812, 325, MINI],
  [750, 342, {}],
  [734, 343, {}],
  [712, 325, {}],
  [852, 393, { left: 59, right: 59, bottom: 21, top: 0 }],
  [932, 430, { left: 59, right: 59, bottom: 21, top: 0 }],
  [667, 375, {}],
  [740, 350, {}],
  [1280, 400, {}],
  [600, 380, {}],
  [600, 420, {}],
];

test("a phone on its side keeps the linear meter: the whole safe height at its edge", () => {
  // Jamie, 2026-11-19: "Bug: On iPhone if I turn on linear and then rotate
  // it goes back to the circular swing."
  for (const [W, H, safe] of SIDEWAYS) {
    const s = { top: 0, right: 0, bottom: 0, left: 0, ...safe };
    for (const side of ["right", "left"]) {
      for (const coarse of [true, false]) {
        const tag = `${W}x${H} ${side} ${coarse ? "touch" : "mouse"}`;
        const L = layoutFor(W, H, safe, false, "linear", { side, coarse });
        assert.equal(L.meter, "linear", tag);
        assert.equal(L.meterSide, side, tag);
        const d = L.dial;
        const top = s.top + tune.linearTopWide;
        const foot = H - s.bottom - tune.margin * 0.5;
        assert.ok(
          Math.abs(d.y + d.height - foot) < 1e-9,
          `${tag}: on the bottom`,
        );
        assert.ok(
          Math.abs(d.y - Math.max(top, foot - tune.linearHMax)) < 1e-9,
          `${tag}: top`,
        );
        if (side === "right")
          assert.ok(
            Math.abs(d.x + d.width - (W - s.right - tune.margin * 0.5)) < 1e-9,
            tag,
          );
        else assert.equal(d.x, s.left + tune.margin * 0.5, tag);
        const g = linearGeometry(d, side);
        assert.ok(g.travel >= linearTune.wideMinTravel, `${tag}: ${g.travel}`);
      }
    }
  }
  const travel = (W, H, safe = {}) =>
    linearGeometry(layoutFor(W, H, safe, false, "linear").dial).travel;
  assert.equal(Math.round(travel(844, 390) * 10) / 10, 301.3);
  assert.equal(Math.round(travel(740, 350) * 10) / 10, 261.3);
  // Safari with its bars showing (Jamie, 2026-11-20: "Yes lower the linear
  // track for that one. It doesn't have to be same size for all."): a
  // 6.1-inch phone's track is 230 to 233 px, 20 over wideMinTravel; the
  // mini's 215 to 217
  assert.equal(Math.round(travel(844, 342, NOTCH_61) * 10) / 10, 232.3);
  assert.equal(Math.round(travel(844, 340, NOTCH_61) * 10) / 10, 230.3);
  assert.equal(Math.round(travel(852, 343, ISLAND_61) * 10) / 10, 233.3);
  assert.equal(Math.round(travel(812, 325, MINI) * 10) / 10, 215.3);
  assert.ok(travel(844, 340, NOTCH_61) - linearTune.wideMinTravel >= 20);
  // the iPhone's 375 pt phones with the home indicator: 265.3, as the app
  assert.equal(
    Math.round(travel(812, 375, { left: 50, right: 50, bottom: 21 }) * 10) / 10,
    265.3,
  );
});

test("a desktop window keeps its linear meter where it was", () => {
  // tall enough for the 450 px box to stand under the header row: the same
  // box, the plan beside it, nothing moves
  for (const [W, H] of [
    [1280, 768],
    [1440, 900],
    [1024, 600],
    [1280, 560],
  ]) {
    for (const side of ["right", "left"]) {
      const L = layoutFor(W, H, {}, false, "linear", { side });
      const tag = `${W}x${H} ${side}`;
      const d = L.dial;
      assert.equal(d.height, tune.linearHMax, tag);
      assert.equal(d.y, H - tune.margin * 0.5 - tune.linearHMax, tag);
      assert.deepEqual(L.meterRoom, { left: 0, right: 0 }, tag);
      assert.equal(L.planEdge, null, `${tag}: beside the meter`);
      if (side === "right")
        assert.equal(L.plan.x + L.plan.width, d.x - tune.planBeside, tag);
      else assert.equal(L.plan.x, d.x + d.width + tune.planBeside, tag);
    }
  }
  const d = layoutFor(1280, 768, {}, false, "linear").dial;
  assert.deepEqual(
    [d.x, d.y, d.width, d.height].map((v) => Math.round(v * 10) / 10),
    [1177, 311, 96, 450],
  );
});

test("beside a wide canvas's linear meter MENU or the rail moves in, 10 px off its body", () => {
  for (const [W, H, safe] of SIDEWAYS) {
    const s = { top: 0, right: 0, bottom: 0, left: 0, ...safe };
    for (const side of ["right", "left"]) {
      const L = layoutFor(W, H, safe, false, "linear", { side, coarse: true });
      const g = linearGeometry(L.dial, side);
      const r = L.meterRoom;
      const tag = `${W}x${H} ${side}`;
      if (L.dial.y >= s.top + tune.railBox + tune.meterGap) {
        assert.deepEqual(r, { left: 0, right: 0 }, tag);
        continue;
      }
      if (side === "right") {
        assert.equal(r.left, 0, tag);
        // MENU's right edge (game.css: 12 px off the safe edge, plus --meter-r)
        const menuRight = W - s.right - 12 - r.right;
        assert.ok(Math.abs(menuRight - (g.left - tune.meterGap)) < 1e-9, tag);
      } else {
        assert.equal(r.right, 0, tag);
        const railLeft = s.left + 12 + r.left;
        assert.ok(
          Math.abs(railLeft - (g.right + g.sh + tune.meterGap)) < 1e-9,
          tag,
        );
      }
    }
  }
  const r = layoutFor(844, 390, {}, false, "linear").meterRoom;
  assert.equal(Math.round(r.right * 10) / 10, 99.6);
  // a tall canvas and the clock move nothing
  assert.deepEqual(layoutFor(390, 844, {}, false, "linear").meterRoom, {
    left: 0,
    right: 0,
  });
  assert.deepEqual(layoutFor(844, 390).meterRoom, { left: 0, right: 0 });
  assert.deepEqual(meterRoom(null), { left: 0, right: 0 });
});

test("beside the linear meter the plan block never goes over the prompt tab", () => {
  for (const [W, H, safe] of SIDEWAYS) {
    const s = { top: 0, right: 0, bottom: 0, left: 0, ...safe };
    for (const side of ["right", "left"]) {
      for (const coarse of [true, false]) {
        const tag = `${W}x${H} ${side} ${coarse ? "touch" : "mouse"}`;
        const L = layoutFor(W, H, safe, false, "linear", { side, coarse });
        const g = linearGeometry(L.dial, side);
        const t = tabRect(g);
        const p = L.plan;
        assert.ok(!overlaps(p, t), `${tag}: the block and the tab`);
        assert.ok(!overlaps(p, L.dial), `${tag}: the block and the meter`);
        assert.ok(p.x >= s.left && p.x + p.width <= W - s.right, tag);
        assert.ok(p.y >= s.top + tune.railBox, `${tag}: under the rail`);
        assert.ok(p.y + p.height <= H - s.bottom, tag);
        // at the edge away from the meter on a phone on its side
        if (coarse)
          assert.equal(L.planEdge, side === "right" ? "left" : "right", tag);
        const m = L.minimap;
        if (m) {
          assert.ok(!overlaps(m, p), `${tag}: the minimap and the block`);
          assert.ok(!overlaps(m, L.dial), `${tag}: the minimap and the meter`);
          assert.ok(!overlaps(m, t), `${tag}: the minimap and the tab`);
          assert.ok(
            m.y >= s.top + tune.railBox,
            `${tag}: the minimap under the rail`,
          );
          assert.ok(m.x >= s.left && m.x + m.width <= W - s.right, tag);
        } else assert.ok(L.mapStacked, `${tag}: only a stacked minimap goes`);
        // at the far edge, the block and the minimap are off the meter's half
        for (const r of L.planEdge ? [p, m].filter(Boolean) : []) {
          const mid = W / 2;
          if (side === "right")
            assert.ok(r.x + r.width <= mid - tune.planClear, tag);
          else assert.ok(r.x >= mid + tune.planClear, tag);
        }
      }
    }
  }
  // a short window with a mouse: beside, the block would cover the tab, so it
  // goes to the far edge as on a touchscreen
  const M = layoutFor(1280, 400, {}, false, "linear");
  assert.equal(M.planEdge, "left");
  assert.equal(M.mapStacked, false);
  // a narrow one: the minimap over the block where the header row leaves room
  const N = layoutFor(600, 420, {}, false, "linear", { coarse: true });
  assert.equal(N.mapStacked, true);
  assert.ok(N.minimap, "drawn");
  assert.equal(N.minimap.x, N.plan.x + N.plan.width - N.minimap.width);
  assert.equal(N.minimap.y + N.minimap.height, N.plan.y - tune.planGap);
  // and none where it would meet the header row
  const O = layoutFor(600, 380, {}, false, "linear", { coarse: true });
  assert.equal(O.mapStacked, true);
  assert.equal(O.minimap, null);
  // the clock beside a narrow canvas's block is as before
  assert.equal(
    layoutFor(600, 420, {}, false, "clock", { coarse: true }).planEdge,
    null,
  );
});

// Codex on web PR #71: a canvas where no placement keeps the plan block, the
// tab and every header plate apart must draw the clock, never a linear meter
// with a known collision. Each header row: a match (MENU, SKIP), practice
// (its tray) and watching (the view tray).
test("wherever the linear meter is drawn, nothing it brings overlaps", () => {
  const SAFES = [
    {},
    { left: 47, right: 47, bottom: 21 },
    { top: 24, bottom: 20 },
    { left: 59, right: 59, bottom: 21 },
  ];
  const count = {};
  for (const header of [null, "practice", "watch"]) {
    const n = (count[header] = { linear: 0, clock: 0 });
    for (const safe of SAFES) {
      const s = { top: 0, right: 0, bottom: 0, left: 0, ...safe };
      for (let W = 360; W <= 1400; W += 20) {
        for (let H = 280; H <= 900; H += 10) {
          for (const side of ["right", "left"]) {
            for (const coarse of [false, true]) {
              const tag = `${header} ${JSON.stringify(safe)} ${W}x${H} ${side} ${coarse ? "touch" : "mouse"}`;
              const opts = { side, coarse, header };
              const L = layoutFor(W, H, safe, false, "linear", opts);
              if (L.meter !== "linear") {
                // the whole clock layout, nothing left of the meter
                n.clock++;
                assert.deepEqual(
                  L,
                  layoutFor(W, H, safe, false, "clock", opts),
                  tag,
                );
                continue;
              }
              n.linear++;
              assert.deepEqual(L.meterRoom, meterRoom(L), tag);
              const rects = {
                meter: L.dial,
                tab: tabRect(linearGeometry(L.dial, L.meterSide)),
                plan: L.plan,
                minimap: L.minimap,
              };
              if (!L.tall) {
                // the rail at its widest (with the gap kept after it) and the
                // right corner's row, where meterRoom put them
                const { rail, row } = headerPlates(L, header);
                rects.rail = { ...rail, width: rail.width + tune.headerGap };
                rects.row = row;
              }
              const names = Object.keys(rects).filter((k) => rects[k]);
              for (const [i, a] of names.entries()) {
                const q = rects[a];
                assert.ok(
                  q.x >= s.left - 1e-9 &&
                    q.y >= s.top - 1e-9 &&
                    q.x + q.width <= W - s.right + 1e-9 &&
                    q.y + q.height <= H - s.bottom + 1e-9,
                  `${tag}: ${a} inside the safe canvas`,
                );
                for (const b of names.slice(i + 1)) {
                  if (a === "meter" && b === "tab") continue; // the meter's own
                  // the rail and the row meet on a narrow window whatever the
                  // meter (practice's tray, as with the clock): only a meter
                  // that moves them in is held to keeping them apart
                  const moved = L.meterRoom.left || L.meterRoom.right;
                  if (a === "rail" && b === "row" && !moved) continue;
                  assert.ok(!overlaps(q, rects[b]), `${tag}: ${a} and ${b}`);
                }
              }
            }
          }
        }
      }
    }
  }
  // most of the sweep keeps the linear meter; small windows give way
  for (const [h, n] of Object.entries(count))
    assert.ok(n.linear > 13000 && n.clock > 0, `${h}: ${JSON.stringify(n)}`);
  const meterAt = (W, H, header, side = "right", safe = {}) =>
    layoutFor(W, H, safe, false, "linear", { side, coarse: true, header })
      .meter;
  // the size Codex found first: a touchscreen 400 x 350 draws the clock
  assert.equal(meterAt(400, 350, null), "clock");
  // and second: practice's tray at 480 x 350 would cover the rail
  assert.equal(meterAt(480, 350, "practice"), "clock");
  assert.equal(meterAt(480, 350, null), "linear");
  // every phone on its side keeps it, in every mode
  for (const [W, H, safe] of SIDEWAYS)
    for (const header of [null, "practice", "watch"])
      for (const side of ["right", "left"])
        assert.equal(meterAt(W, H, header, side, safe), "linear", `${W}x${H}`);
});

test("a finger on a wide canvas: the knob's channel grabs, the body and the meter's half are throw zone", () => {
  for (const side of ["right", "left"]) {
    const L = layoutFor(844, 390, {}, false, "linear", { side, coarse: true });
    const g = linearGeometry(L.dial, side);
    const reach = linearTune.grabTouch;
    const touch = { touch: true, reach };
    const mouse = { touch: false, reach: linearTune.grabMouse };
    const chanMid = g.chanX + g.chanW / 2;
    const laneMid = g.laneLeft + g.laneW / 2;
    const outer = side === "right" ? g.right + 4 : g.left - 4;
    const tag = side;
    // the knob's channel, and a little past the body's outer edge
    assert.equal(linearFirst(L, g, chanMid, g.y0 + 30, touch), "dial", tag);
    assert.equal(linearFirst(L, g, outer, g.y0, touch), "dial", tag);
    // the lane beside the knob, and the body away from it: a tap aims, a drag strokes
    assert.equal(linearFirst(L, g, laneMid, g.y0, touch), "zone", tag);
    assert.equal(linearFirst(L, g, chanMid, g.yF + 4, touch), "zone", tag);
    // a mouse grabs across the body and the body keeps its press, as before
    assert.equal(linearFirst(L, g, laneMid, g.y0, mouse), "dial", tag);
    assert.equal(linearFirst(L, g, chanMid, g.yF + 4, mouse), "none", tag);
    // off the meter: nothing claimed first
    assert.equal(linearFirst(L, g, L.W / 2, g.y0, touch), null, tag);
    // the zone: the meter's half, top to bottom, for a finger
    const near = side === "right" ? L.W * 0.75 : L.W * 0.25;
    const far = side === "right" ? L.W * 0.25 : L.W * 0.75;
    assert.equal(inLinearZone(L, near, 20, { touch: true }), true, tag);
    assert.equal(inLinearZone(L, far, L.H - 5, { touch: true }), false, tag);
    // a mouse keeps the lower band
    assert.equal(inLinearZone(L, near, 20), false, tag);
    assert.equal(inLinearZone(L, far, L.H * 0.7), true, tag);
  }
  // upright, a finger is as before: across the body, the body swallowed,
  // the lower 40% the zone
  const T = layoutFor(390, 844, {}, false, "linear", { coarse: true });
  const g = linearGeometry(T.dial, "right");
  const touch = { touch: true, reach: linearTune.grabTouch };
  assert.equal(linearFirst(T, g, g.laneLeft + 2, g.y0, touch), "dial");
  assert.equal(linearFirst(T, g, g.cx, g.yF + 4, touch), "none");
  assert.equal(inLinearZone(T, 100, 844 * 0.65, { touch: true }), true);
  assert.equal(inLinearZone(T, 300, 844 * 0.5, { touch: true }), false);
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
