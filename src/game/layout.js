// Where things go on the screen: the dial, the minimap, the plan buttons' side
// and the world's framing, from the canvas size and the safe-area insets.
// Pure: tested in tests/game/layout.test.mjs.
//
// The world's framing (docs/CLIENT.md "Framing"). On a landscape screen the
// renderer's own rule holds: the 400 x 240 frame scaled by
// k = min(W / 400, H / 240) and centred. A tall canvas (a phone held upright)
// would show the frame as a thin band, the pieces tiny; there the client
// zooms in by `tallZoom` (the frame's sides are cropped: the far end of the
// pitch is narrow and sits in the middle), pans across to keep the target
// circle in view, and anchors the frame's target height (frame y `anchorY`)
// at `anchorAt` of the height, so the target half reads in the upper middle
// and the near pitch below carries the dial. The mapping travels as
// view.fit, which drawWorld and every un-projection use.

import { linearGeometry, tune as linearTune } from "../render/linear.js";
import { dialGeometry, tune as dialTune } from "../render/dial.js";
import { minimapGeometry, tune as mapTune } from "../render/minimap.js";

export const tune = {
  tallFrom: 1.05, // H / W above this is a tall canvas
  tallZoom: 1.3, // of the width-fit scale
  anchorY: 112, // frame y that the target half sits round
  anchorAt: 0.33, // ... placed this far down a tall canvas
  stillAt: 0.42, // a tall canvas's raise and punishment scenes
  margin: 14, // px from the edges (plus the safe area)
  railH: 46,
  // CSS px from the top that the rail's own box (top left) takes, with its
  // 10 px off the edge: a meter at the left edge starts below it
  railBox: 84,
  // the wide view's box (wideBox): CSS px kept clear at the top for the rail,
  // the status pill and the menu (more on a tall screen, where the pill sits
  // under the rail), and at the other edges
  wideTop: 70,
  wideTopTall: 132,
  wideEdge: 16,
  // the linear meter's box (MENU, Meter): a tall strip at the right edge
  linearW: 0.2, // its width, of the canvas's
  linearWMin: 64,
  linearWMax: 96,
  // its height on a tall canvas: this much of the canvas's, but never under
  // linearHMin where there is the room (a phone's browser with its bars
  // showing is short), so a thumb's fling is neither cramped nor out of reach
  linearH: 0.6,
  linearHMin: 460,
  linearHMax: 600,
  // a phone held upright with a touchscreen (B, the finger track): the clock
  // is shrunk by this and raised so a finger can go round outside its rim
  // all the way (dial.js tune.trackOut), 6 o'clock included
  trackShrink: 0.87,
  // CSS px a column of plan buttons takes beside the screen's edge (the
  // buttons are about 86 wide, 8 off the edge): they sit above the track
  planColW: 100,
};

export function isTall(W, H) {
  return H > W * tune.tallFrom;
}

// The world's mapping { k, ox, oy } for a W x H canvas, the frame's x
// centred on centerX (a tall canvas pans; elsewhere null: the renderer's rule).
export function worldFit(W, H, centerX = 200) {
  if (!isTall(W, H)) return null;
  const k = (W / 400) * tune.tallZoom;
  const half = W / k / 2; // frame px either side of the centre
  const cx = Math.max(half, Math.min(400 - half, centerX));
  return { k, ox: W / 2 - cx * k, oy: H * tune.anchorAt - tune.anchorY * k };
}

// The mapping for the raise and punishment scenes on a tall canvas: the
// whole frame across (zoom 1: a half of the pitch must fit; the raise zooms in on its kubb), its middle at
// `stillAt` of the height, above the panel at the bottom.
export function stillFit(W, H, zoom = 1) {
  if (!isTall(W, H)) return null;
  const k = (W / 400) * zoom;
  return { k, ox: W / 2 - 200 * k, oy: H * tune.stillAt - 120 * k };
}

// The frame x the view should centre on to keep frame x `fx` in sight with
// `room` frame px to spare (a tall canvas; 200 elsewhere).
export function panFor(W, H, fx, room = 40) {
  if (!isTall(W, H) || fx == null || !Number.isFinite(fx)) return 200;
  const k = (W / 400) * tune.tallZoom;
  const half = W / k / 2;
  const lo = fx - (half - room),
    hi = fx + (half - room);
  return Math.max(lo, Math.min(hi, 200));
}

// The linear meter's box, or null where its track would be cramped (a phone
// on its side): the right edge (or the left, MENU, Side), under the minimap
// on a tall canvas and under the rail's row on a wide one, down to the
// bottom.
function linearBox(W, H, s, tall, minimap, side) {
  const m = tune.margin;
  const w = Math.max(
    tune.linearWMin,
    Math.min(tune.linearWMax, W * tune.linearW),
  );
  // on the left of a wide canvas the rail's box is above it, on the right
  // the MENU's row; a tall canvas keeps the top for the rail, the practice
  // tray and the minimap, so either side starts under the minimap
  const top = tall
    ? minimap.y + minimap.height + m * 0.7
    : side === "left"
      ? s.top + tune.railBox + m * 0.7
      : s.top + tune.railH + m * 1.5;
  const bottom = H - s.bottom - m * 0.5;
  const h = Math.min(
    bottom - top,
    tall ? Math.max(H * tune.linearH, tune.linearHMin) : tune.linearHMax,
    tune.linearHMax,
  );
  const box = {
    x: side === "left" ? s.left + m * 0.5 : W - s.right - m * 0.5 - w,
    y: bottom - h,
    width: w,
    height: h,
  };
  // under the minimap (a tall canvas, the right edge) its body's outer edge
  // lines up with the minimap plaque's (on a phone the two are as wide)
  if (tall && side !== "left") {
    const p = minimapGeometry(minimap);
    box.x +=
      p.x + p.w + p.pad + mapTune.frame - linearGeometry(box, side).right;
  }
  return h > 0 && linearGeometry(box, side).travel >= linearTune.minTravel
    ? box
    : null;
}

// The screen's regions in CSS px. safe = { top, right, bottom, left }.
// `meter` is the player's ("clock" or "linear"); the layout's own `meter` is
// the one drawn, the clock where the linear one has no room.
// opts.side ("right", the default, or "left": MENU, Side) is the edge the
// meter sits at: the linear meter at either edge, the clock lower right or
// lower left on a wide canvas (the minimap takes the other bottom corner);
// a tall canvas's clock is centred either way. opts.coarse: the screen is
// a touchscreen, so a tall canvas's clock leaves room for a finger to go
// round outside its rim (the layout's `track`).
// The layout's `side` is where the plan buttons go: "left" or "right" of
// the meter, or "both" (split either side of the throwing line).
export function layoutFor(
  W,
  H,
  safe = {},
  swipe = false,
  meter = "clock",
  { side: edge = "right", coarse = false } = {},
) {
  const s = { top: 0, right: 0, bottom: 0, left: 0, ...safe };
  const m = tune.margin;
  const tall = isTall(W, H);
  const phone = Math.min(W, H) < 520;
  const onLeft = edge === "left";
  const meterSide = onLeft ? "left" : "right";
  let dial, minimap, side;
  let track = false;
  let plansFoot = null;
  if (tall) {
    const S = Math.min(W * 0.6, H * 0.32, 300);
    const h = S * 1.2;
    dial = {
      x: (W - S) / 2,
      y: H - s.bottom - m * 0.5 - h,
      width: S,
      height: h,
    };
    const mw = Math.min(78, W * 0.19);
    minimap = {
      x: W - s.right - m - mw,
      y: s.top + tune.railH + m + 4,
      width: mw,
      height: mw * 1.95,
    };
    side = "both";
    if (coarse && !swipe) {
      // the finger track: shrink the clock a little and raise it until the
      // track's outer edge clears the bottom (and the sides), so a finger
      // can go all the way round outside the rim; the plan buttons go
      // above the track, where it is narrower than the screen
      const S2 = S * tune.trackShrink;
      const h2 = S2 * 1.2;
      dial = { x: (W - S2) / 2, y: dial.y + h - h2, width: S2, height: h2 };
      const g = dialGeometry(dial);
      const out = g.r * dialTune.trackOut;
      const floor = H - s.bottom - m * 0.5;
      dial.y -= Math.max(0, g.cy + out - floor);
      // the buttons' inner edge is planColW in from the screen's edge: the
      // track's top there is `rise` above the dial's centre
      const dx = g.cx - (s.left + tune.planColW);
      const rise = dx < out ? Math.sqrt(out * out - dx * dx) : 0;
      plansFoot = dialGeometry(dial).cy - rise - m * 0.5;
      track = true;
    }
  } else {
    const S = Math.min(W * 0.28, H * (phone ? 0.5 : 0.46), 380);
    const h = S * 1.2;
    dial = {
      x: onLeft ? s.left + m : W - s.right - m - S,
      y: H - s.bottom - m * 0.5 - h,
      width: S,
      height: h,
    };
    const mw = Math.max(56, Math.min(118, W * 0.085, H * 0.16));
    minimap = {
      x: onLeft ? W - s.right - m - mw : s.left + m,
      y: H - s.bottom - m - mw * 1.95,
      width: mw,
      height: mw * 1.95,
    };
    side = onLeft ? "right" : "left";
  }
  const linear =
    meter === "linear" && !swipe
      ? linearBox(W, H, s, tall, minimap, meterSide)
      : null;
  if (linear) {
    // the plan buttons sit on its inner side, their feet level with its
    // foot: in one block on a wide canvas, split either side of the
    // throwing line on a tall one (hud.js place)
    return {
      W,
      H,
      safe: s,
      tall,
      phone,
      dial: linear,
      plansY: linear.y,
      plansFoot: null,
      minimap,
      side: tall ? "both" : onLeft ? "right" : "left",
      meter: "linear",
      meterSide,
      track: false,
    };
  }
  const plansY = dial.y; // keep the side buttons in reach, beside the downstroke
  // The resting knob is at six. Leave a finger room below it for a full
  // downstroke, clear of the bottom safe area, in the touch trial.
  if (swipe) dial.y -= Math.min(W, H) * 0.2;
  return {
    W,
    H,
    safe: s,
    tall,
    phone,
    dial,
    plansY,
    plansFoot,
    minimap,
    side,
    meter: "clock",
    // a tall canvas's clock is centred whichever side is chosen
    meterSide: tall ? "centre" : meterSide,
    track,
  };
}

// The wide view's box: where the whole pitch is fitted (vendor/engine/session/wide.lua), in
// frame coordinates by the renderer's scale rule (k = min(W / 400, H / 240),
// centred; the canvas shows the world beyond the 400 x 240 frame, so the box
// is the whole window less the HUD's margins). With k, for sizes in CSS px.
export function wideBox(W, H, safe = {}) {
  const s = { top: 0, right: 0, bottom: 0, left: 0, ...safe };
  const k = Math.min(W / 400, H / 240);
  const ox = (W - 400 * k) / 2,
    oy = (H - 240 * k) / 2;
  const e = tune.wideEdge;
  const top = (isTall(W, H) ? tune.wideTopTall : tune.wideTop) + s.top;
  return {
    left: (s.left + e - ox) / k,
    right: (W - s.right - e - ox) / k,
    top: (top - oy) / k,
    bottom: (H - s.bottom - e - oy) / k,
    k,
  };
}
