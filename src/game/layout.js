// Where things go on the screen: the dial, the minimap, the plan buttons' side
// (and on a wide canvas the plan block's rect) and the world's framing, from
// the canvas size and the safe-area insets.
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

import {
  linearGeometry,
  knobHit,
  bodyHit,
  tabRect,
  tune as linearTune,
} from "../render/linear.js";
import { dialGeometry, tune as dialTune } from "../render/dial.js";
import { minimapGeometry, tune as mapTune } from "../render/minimap.js";

export const tune = {
  tallFrom: 1.05, // H / W above this is a tall canvas
  tallZoom: 1.3, // of the width-fit scale
  // The far baseline (frame y `anchorY`: the aim camera's own, Game.farFrameY, else
  // 96, a throw from the baseline's) is placed `anchorAt` of the way down a tall
  // canvas: 0.41 since web 0.17.0 (the owner, 2026-11-22: "I wonder if our camera view
  // should be a touch lower so the kubbs we are aiming at are a little lower on the
  // screen"). Before, frame y 112 stood at 0.33, which put the far baseline at 30% of
  // the height from the baseline and 41% from a Kid match's line; now it is 41% from
  // anywhere, and the band under the header holds the minimap and the verdict
  // (verdictBox).
  anchorY: 96,
  anchorAt: 0.41,
  stillAt: 0.42, // a tall canvas's raise and punishment scenes
  // a short wide canvas (a phone on its side): the raise and punishment panel
  // is a bar along the bottom (public/game.css, max-height 460px), at most
  // stillBar px tall with its 8 px off the safe area, and the near baseline
  // stays stillClear px above it (stillFit)
  stillShort: 460,
  stillBar: 80,
  stillClear: 8,
  margin: 14, // px from the edges (plus the safe area)
  railH: 46,
  // CSS px from the top that the header's own box (top left) takes, with its
  // 10 px off the edge: a meter at the left edge starts below it. The 1.0
  // header holds MENU (48 tall to a finger), so it is 82 px tall there, 78
  // with a mouse: 10 + 82.
  railBox: 92,
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
  // showing is short), so a thumb's fling is neither cramped nor out of
  // reach. A quarter shorter than the first build (0.6, 460, 600; a tester,
  // 2026-11-19: "Make it 1/4 shorter"): about 340 px of travel on a phone
  // held upright, never under linear.js minTravel. Its foot stays where it
  // was, so the shortening comes off the top.
  linearH: 0.47,
  linearHMin: 390,
  linearHMax: 450,
  // a phone held upright with a touchscreen (B, the finger track): the clock
  // is shrunk by this and raised so a finger can go round outside its rim
  // all the way (dial.js tune.trackOut), 6 o'clock included
  trackShrink: 0.87,
  // The tray (the 1.0 design, "Aim layout"; layoutFor, trayAt): ARC, TILT
  // and STAND as three plates of one size, 86 by 60 on a phone and 104 by 70
  // wider, stacked with plateGap between, at the screen's edge away from the
  // meter, trayEdge inside the safe area (the header's left edge), its foot
  // trayFoot above the meter's box's foot (upright beside the clock: above
  // the face, or its finger track, trayClear off it, and above the prompt).
  // layout.js measures nothing: these are the plates' CSS size, and
  // tests/game/plan-client.test.mjs holds the page to them.
  plateW: { phone: 86, wide: 104 },
  plateH: { phone: 60, wide: 70 },
  plateGap: 8,
  trayEdge: 12,
  trayFoot: 10,
  trayClear: 6,
  shadow: 3, // a plate's hard shadow
  // the touch size a plate never goes under where a short screen squeezes
  // the column (the 1.0 design: 48 to a finger, never under 44)
  touchMin: 48,
  mouseMin: 44,
  // the clock's prompt plate with the distance tab beside it, as wide as its
  // longest words could make it: this many of the plate's heights
  promptAllow: 9,
  // An open plate grows up from its place (the column's foot stays): ARC to
  // openArcH, TILT or SPIN to openSideH and STAND to openStandH, the last two
  // also in toward the middle to openSideW (never nearer the throwing line,
  // the screen's centre, than planClear). Where the room under the tray's
  // ceiling leaves an open plate under openMin with the other two showing, it
  // covers them instead.
  openArcH: { phone: 256, wide: 300 },
  openSideW: { phone: 200, wide: 240 },
  openSideH: 84,
  openStandH: { phone: 150, wide: 180 },
  openMin: 100,
  planClear: 24,
  // the header (headerBox): railTop under the safe top; on a wide canvas
  // headerW of its width, railMinW to headerMaxW; the minimap mapGap under it
  railTop: 10,
  // the verdict's box (verdictBox): px off what it keeps clear of, and the most it
  // grows to upright (the flag and two rows of chips) and on a wide canvas
  verdictGap: 8,
  verdictTall: 132,
  verdictTallWide: 104,
  verdictAdv: 34, // px the box moves down under the line's chip, upright
  headerW: 0.4,
  headerMaxW: 400,
  mapGap: 8,
  // A wide canvas's linear meter (a phone on its side: the player's choice of
  // meter holds when the phone turns; Jamie, 2026-11-19: "Bug: On iPhone if I
  // turn on linear and then rotate it goes back to the circular swing."). Its
  // box takes the whole safe height at its edge, from linearTopWide under the
  // safe top to half a margin over the safe bottom (at most linearHMax, so a
  // taller window's stands on the bottom as before), and its track needs
  // linear.js wideMinTravel. Where it comes up into the header row, the plates
  // at that top corner (MENU and the practice tray at the right, the rail and
  // the shouts at the left) move in beside it, meterGap off its body
  // (`meterRoom`). The iPhone app's WideLayout keeps the same numbers, all
  // but the track's floor (the web's is lower: linear.js wideMinTravel).
  linearTopWide: 10,
  meterGap: 10,
  // the header row's plates in CSS px (headerPlates), measured in the
  // browser (tests/game/client.test.mjs holds the page to them). Since the 1.0
  // design MENU (64) is a word inside the header's plate at the top left, and
  // the header has a fixed width (headerBox); the right corner holds SKIP
  // (skipW, a plain button of normal size since stage 3) alone, at plateEdge
  // from the right, or the tray, its right edge at trayRight: practice's
  // BATONS | KUBBS and RESET (230) or the watch view's THROWER'S VIEW (93);
  // headerGap px kept between the header and the right corner's row
  plateEdge: 12,
  menuW: 64,
  skipW: 80,
  trayRight: 12,
  trayW: { practice: 232, watch: 95 },
  railMinW: 260,
  railPracticeW: 218, // practice's header: "BATONS · 5 BASE KUBBS" over Practice and MENU
  headerGap: 8,
};

export function isTall(W, H) {
  return H > W * tune.tallFrom;
}

// The world's mapping { k, ox, oy } for a W x H canvas, the frame's x
// centred on centerX (a tall canvas pans; elsewhere null: the renderer's rule).
// anchorY: the far baseline's frame y in the aim camera (Game.farFrameY), else the
// usual one.
export function worldFit(W, H, centerX = 200, anchorY = null) {
  if (!isTall(W, H)) return null;
  const k = (W / 400) * tune.tallZoom;
  const half = W / k / 2; // frame px either side of the centre
  const cx = Math.max(half, Math.min(400 - half, centerX));
  const ay = Number.isFinite(anchorY) ? anchorY : tune.anchorY;
  return { k, ox: W / 2 - cx * k, oy: H * tune.anchorAt - ay * k };
}

// The mapping for the raise and punishment scenes on a tall canvas: the
// whole frame across (zoom 1: a half of the pitch must fit; the raise zooms in on its kubb), its middle at
// `stillAt` of the height, above the panel at the bottom.
//
// On a short wide canvas the renderer's rule holds unless the scene's lowest
// ground the player works on (`lowest`, a frame y: the punishment scene's near
// baseline) would come down to the bar at the bottom (`bottom`: the safe
// area's bottom inset); then the same scale, lifted just enough. Elsewhere
// null: the renderer's rule.
export function stillFit(W, H, zoom = 1, { lowest = null, bottom = 0 } = {}) {
  if (isTall(W, H)) {
    const k = (W / 400) * zoom;
    return { k, ox: W / 2 - 200 * k, oy: H * tune.stillAt - 120 * k };
  }
  if (lowest == null || H > tune.stillShort) return null;
  const k = Math.min(W / 400, H / 240);
  const oy = (H - 240 * k) / 2;
  const over = oy + k * lowest - (H - bottom - tune.stillBar - tune.stillClear);
  if (over <= 0) return null;
  return { k, ox: (W - 400 * k) / 2, oy: oy - over };
}

// The last throw's verdict (the flag and its chips, game.css .center): where it
// stands so it is never over the place the next throw is aimed at, the tray, the
// minimap or the meter (the owner, 2026-11-22, of a verdict over the target on a short
// Safari window: "the display stays on the screen for a while keeping the player from
// being able to aim at times"). { x, y, width }: the box's top left and width, CSS px;
// it is as tall as its chips wrap to (verdictTall at most, upright).
// - Upright: the band under the header (from the minimap's top), from the left
//   margin to verdictGap short of the minimap; a tray column that starts within
//   verdictTall of the band's top keeps it verdictGap off the column's inner edge.
//   The thrower's view is fitted so the far baseline is below the band (anchorAt).
// - Wide: the header's own row, from verdictGap past the header's end to the right
//   margin, or verdictGap short of a meter at the right edge that reaches the row;
//   centred on the screen where that leaves it room. Everything aimed at is below it.
// null where there is no layout or no minimap (the wide view: the CSS default).
export function verdictBox(L, { adv = false } = {}) {
  if (!L?.minimap || !L.header) return null;
  const t = tune;
  const s = L.safe;
  if (L.tall) {
    // under the Kid or advantage line's chip when it shows (game.css .adv, hud.js)
    const y = L.minimap.y + (adv ? t.verdictAdv : 0);
    let left = s.left + t.plateEdge;
    let right = L.minimap.x - t.verdictGap;
    const tr = L.tray;
    if (tr && tr.y < y + t.verdictTall) {
      if (tr.edge === "left") left = Math.max(left, tr.x + tr.width + t.verdictGap);
      else right = Math.min(right, tr.x - t.verdictGap);
    }
    return { x: left, y, width: Math.max(0, right - left) };
  }
  const y = L.header.y;
  const a = L.header.x + L.header.width + t.verdictGap;
  let b = L.W - s.right - t.plateEdge;
  const d = L.dial;
  if (L.meterSide === "right" && d && d.y < y + t.verdictTallWide)
    b = Math.min(b, d.x - t.verdictGap);
  const half = L.W / 2 - a;
  const width = half >= 160 && a + 2 * half <= b ? 2 * half : b - a;
  return { x: a, y, width: Math.max(0, width) };
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

// The linear meter's box, or null where its track would be cramped: the
// right edge (or the left, MENU, Side). On a tall canvas under the minimap,
// 47% of the height (linearH) and a track of at least minTravel; on a wide
// one the whole safe height (linearTopWide under the safe top, at most
// linearHMax) and a track of at least wideMinTravel. Both stand on the bottom.
function linearBox(W, H, s, tall, minimap, side) {
  const m = tune.margin;
  const w = Math.max(
    tune.linearWMin,
    Math.min(tune.linearWMax, W * tune.linearW),
  );
  // a tall canvas keeps the top for the rail, the practice tray and the
  // minimap, so either side starts under the minimap
  const top = tall
    ? minimap.y + minimap.height + m * 0.7
    : s.top + tune.linearTopWide;
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
  const least = tall ? linearTune.minTravel : linearTune.wideMinTravel;
  return h > 0 && linearGeometry(box, side).travel >= least - 1e-9 ? box : null;
}

// The header row's foot at either top corner of a wide canvas: MENU's row
// at the right, the rail's box at the left. A linear meter whose box comes
// up past it (less meterGap) moves that corner's plates in beside it.
function headerFoot(s, side) {
  return side === "left"
    ? s.top + tune.railBox
    : s.top + tune.railH + tune.margin * 1.5 - tune.meterGap;
}

// How far in from their usual place the top corner's plates move to stand
// meterGap off a wide canvas's linear meter: { left, right } in CSS px (0
// where the meter's box stays under the header row, as on a desktop).
// public/game.css reads them as --meter-l and --meter-r.
export function meterRoom(L) {
  const room = { left: 0, right: 0 };
  if (!L || L.tall || L.meter !== "linear") return room;
  const s = L.safe;
  const d = L.dial;
  if (d.y >= headerFoot(s, L.meterSide) + tune.meterGap) return room;
  const g = linearGeometry(d, L.meterSide);
  const plate = 12; // the plates' px off the safe edge (game.css)
  if (L.meterSide === "left")
    room.left = Math.max(0, g.right + g.sh + tune.meterGap - (s.left + plate));
  else
    room.right = Math.max(0, L.W - s.right - plate - (g.left - tune.meterGap));
  return room;
}

// The header row's two plates as the page places them, with meterRoom's
// shift: `rail` (the header, top left) and `row` (top right: SKIP, or the tray
// in practice or while watching).
// `header` is what the page's header holds: "practice", "watch" or null (a
// match). In CSS px.
export function headerPlates(L, header = null) {
  const t = tune;
  const s = L.safe;
  const r = L.meterRoom || { left: 0, right: 0 };
  // the header's fixed box (headerBox), at its place after meterRoom's shift
  const head =
    L.header ||
    headerBox(L.W, s, L.tall, t.railBox - 10, r.left, header, r.right);
  // MENU is in the header's plate since the 1.0 design: the right corner holds
  // SKIP alone, or the tray
  const reach = t.trayW[header]
    ? t.trayRight + t.trayW[header]
    : t.plateEdge + t.skipW;
  const top = s.top + 10;
  return {
    rail: { ...head },
    row: {
      x: L.W - s.right - r.right - reach,
      y: top,
      width: reach - t.plateEdge,
      height: t.railH,
    },
  };
}

// Does a wide canvas's linear meter leave the header row room once its top
// corner's plates have moved in beside it (meterRoom)? The rail at its
// widest must end headerGap short of the right corner's row. Where it does
// not the clock is drawn instead.
function headerFits(L, header) {
  const r = L.meterRoom;
  if (!r.left && !r.right) return true;
  const { rail, row } = headerPlates(L, header);
  return rail.x + rail.width + tune.headerGap <= row.x;
}

// The header's box (the 1.0 design: one plate at the top left, railTop under
// the safe top, `railH` tall as the page measures it). Its width is fixed for
// the layout, so the minimap under its right end never moves: across the whole
// safe width on a tall canvas; on a wide one headerW of the canvas, kept between
// railMinW and headerMaxW and, where it can, planClear short of the throwing
// line; in practice (one count, no numbers: mode "practice") the same where
// its corner's row (BATONS | KUBBS, RESET) leaves it room, else down to
// railPracticeW.
// game.css reads it as --rail-w. `left` is meterRoom's shift.
function headerBox(W, s, tall, railH, left = 0, mode = null, right = 0) {
  const t = tune;
  const x = s.left + t.plateEdge + left;
  // practice's corner row (BATONS | KUBBS and RESET) at the top right
  const row = W - s.right - right - t.trayRight - t.trayW.practice;
  const wide = Math.max(
    t.railMinW,
    Math.min(t.headerMaxW, W * t.headerW, W / 2 - t.planClear - x),
  );
  const width = tall
    ? W - s.left - s.right - 2 * t.plateEdge
    : mode === "practice"
      ? Math.min(wide, Math.max(t.railPracticeW, row - t.headerGap - x))
      : wide;
  return { x, y: s.top + t.railTop, width, height: railH };
}

// The minimap (the 1.0 design: "Its place is under the header's right end in
// every layout; it does not move while a control is held"): its right edge
// with the header's, mapGap under it. Its size is as before: min(78, 19%) of
// a tall canvas's width, 8.5% of a wide one's (56 to 118, at most 16% of the
// height), twice as tall less a twentieth.
function minimapBox(W, H, tall, header) {
  const mw = tall
    ? Math.min(78, W * 0.19)
    : Math.max(56, Math.min(118, W * 0.085, H * 0.16));
  return {
    x: header.x + header.width - mw,
    y: header.y + header.height + tune.mapGap,
    width: mw,
    height: mw * 1.95,
  };
}

// The screen's regions in CSS px. safe = { top, right, bottom, left }.
// `meter` is the player's ("clock" or "linear"); the layout's own `meter` is
// the one drawn, the clock where the linear one has no room.
// opts.side ("right", the default, or "left": MENU, Side) is the edge the
// meter sits at: the linear meter at either edge, the clock lower right or
// lower left on a wide canvas; a tall canvas's clock is centred either way.
// opts.coarse: the screen is a touchscreen, so a tall canvas's clock leaves
// room for a finger to go round outside its rim (the layout's `track`).
// opts.header: what the page's header row holds, "practice", "watch" or null
// (headerPlates). opts.railH: the header's height as the page measures it
// (railBox less its 10 px before it is measured).
//
// The throw's set-up is the tray (the 1.0 design, "Aim layout"): ARC, TILT and
// STAND as three plates of one size in a column at the screen's edge away from
// the meter (trayAt), `L.tray`; `L.plan` is its closed column and `L.planEdge`
// ("left" or "right") the edge it stands at. `L.header` is the header's box and
// `L.minimap` the minimap under its right end.
export function layoutFor(
  W,
  H,
  safe = {},
  swipe = false,
  meter = "clock",
  { side: edge = "right", coarse = false, header = null, railH = null } = {},
) {
  const s = { top: 0, right: 0, bottom: 0, left: 0, ...safe };
  const m = tune.margin;
  const tall = isTall(W, H);
  const phone = Math.min(W, H) < 520;
  const onLeft = edge === "left";
  const meterSide = onLeft ? "left" : "right";
  const rh = Number.isFinite(railH) && railH > 0 ? railH : tune.railBox - 10;
  const head = headerBox(W, s, tall, rh, 0, header);
  const minimap = minimapBox(W, H, tall, head);
  let dial;
  let track = false;
  if (tall) {
    const S = Math.min(W * 0.6, H * 0.32, 300);
    const h = S * 1.2;
    dial = {
      x: (W - S) / 2,
      y: H - s.bottom - m * 0.5 - h,
      width: S,
      height: h,
    };
    if (coarse && !swipe) {
      // the finger track: shrink the clock a little and raise it until the
      // track's outer edge clears the bottom (and the sides), so a finger
      // can go all the way round outside the rim
      const S2 = S * tune.trackShrink;
      const h2 = S2 * 1.2;
      dial = { x: (W - S2) / 2, y: dial.y + h - h2, width: S2, height: h2 };
      const g = dialGeometry(dial);
      const out = g.r * dialTune.trackOut;
      const floor = H - s.bottom - m * 0.5;
      dial.y -= Math.max(0, g.cy + out - floor);
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
  }
  const base = { W, H, safe: s, tall, phone, coarse: !!coarse, railH: rh };
  const linear =
    meter === "linear" && !swipe
      ? linearBox(W, H, s, tall, minimap, meterSide)
      : null;
  // The linear meter where it has room: the tray clear of its prompt tab, and
  // the header row clear once its top corner's plates move in beside it
  // (meterRoom, headerFits); otherwise the clock is drawn. This is the one
  // place the meter drawn is decided.
  if (linear) {
    const L = {
      ...base,
      dial: linear,
      meter: "linear",
      meterSide,
      track: false,
    };
    L.meterRoom = meterRoom(L);
    L.header = headerBox(
      W,
      s,
      tall,
      rh,
      L.meterRoom.left,
      header,
      L.meterRoom.right,
    );
    L.minimap = tall ? minimap : minimapBox(W, H, tall, L.header);
    Object.assign(L, trayAt(L));
    if (L.tray && linearClear(L) && headerFits(L, header)) return L;
  }
  const L = {
    ...base,
    dial,
    // a tall canvas's clock is centred whichever side is chosen
    meter: "clock",
    meterSide: tall ? "centre" : meterSide,
    edgeSide: meterSide,
    track,
    meterRoom: { left: 0, right: 0 },
    header: head,
    minimap,
  };
  Object.assign(L, trayAt(L));
  delete L.edgeSide;
  // The resting knob is at six. Leave a finger room below it for a full
  // downstroke, clear of the bottom safe area, in the touch trial.
  if (swipe) dial.y -= Math.min(W, H) * 0.2;
  return L;
}

// The plates' size for a layout: 86 by 60 on a phone (a canvas whose short
// side is under 520 px, upright or on its side), 104 by 70 wider.
export function plateSize(phone) {
  return phone
    ? { width: tune.plateW.phone, height: tune.plateH.phone }
    : { width: tune.plateW.wide, height: tune.plateH.wide };
}

// The clock's shapes the tray keeps clear of: the face (with its finger track
// on a touchscreen held upright) as a circle, and the prompt plate with the
// distance tab beside it, as wide as their longest words could make them
// (promptAllow of its heights).
export function clockShapes(L) {
  const g = dialGeometry(L.dial);
  const R = L.track
    ? g.r * dialTune.trackOut
    : g.r * (1 + dialTune.shadow) + tune.trayClear;
  const ph = Math.max(14, g.r * dialTune.promptH);
  const pw = ph * tune.promptAllow;
  const py = g.cy - g.r - ph * 0.85;
  return {
    circle: { cx: g.cx, cy: g.cy, r: R },
    prompt: { x: g.cx - pw / 2, y: py - ph / 2, width: pw, height: ph * 1.12 },
  };
}

// The tray (the 1.0 design, "Aim layout"): ARC, TILT and STAND as three
// plates of one size (plateSize), stacked top to bottom with plateGap between,
// at the screen's edge away from the meter, trayEdge inside the safe area:
// upright at the left edge beside the clock (mirrored, the right edge, with
// Meter side, Left), on a wide canvas the left edge with the meter at the
// right and the right edge with it at the left. Mouse and touch alike: the
// plates no longer sit beside the clock in the middle of the pitch, and a
// mouse's block beside the meter went with them.
//
// Its foot is trayFoot above the meter's box's foot. Upright beside the clock
// it stands above the clock's face (and, on a touchscreen, its finger track:
// the throwing thumb's ground stays clear) where the column's inner edge is,
// and above the clock's prompt and distance where the two would meet.
//
// An open plate (hud.js) grows up from its place, the column's foot staying
// where it is; `open` says how big each may grow: ARC up into its slider
// (openArcH), TILT or SPIN and STAND also in toward the middle (openSideW, at
// most planClear short of the throwing line). Each grows only as far as the
// room under the tray's ceiling (the header, the minimap or a corner's plates
// above it) leaves with the other two plates still showing; where that is
// under openMin it covers them instead (`cover`), up to the ceiling.
// Returns { tray, plan, planEdge }, or { tray: null } where no place clears.
function trayAt(L) {
  const t = tune;
  const { W, H, safe: s, tall } = L;
  const sz = plateSize(L.phone);
  const meterAt = L.meter === "linear" ? L.meterSide : L.edgeSide;
  const edge = meterAt === "left" ? "right" : "left";
  const x =
    edge === "left" ? s.left + t.trayEdge : W - s.right - t.trayEdge - sz.width;
  let colH = 3 * sz.height + 2 * t.plateGap;
  let foot = L.dial.y + L.dial.height - t.trayFoot;
  if (L.meter === "clock" && tall) {
    // above the face (and the track) where the column's inner edge is
    const { circle: c, prompt } = clockShapes(L);
    const inner = edge === "left" ? x + sz.width + t.shadow : x;
    const dx = Math.abs(c.cx - inner);
    if (dx < c.r) foot = Math.min(foot, c.cy - Math.sqrt(c.r * c.r - dx * dx));
    // and above the prompt where the column would meet it
    const col = { x, y: foot - colH, width: sz.width + t.shadow, height: colH };
    if (meets(col, prompt)) foot = Math.min(foot, prompt.y - t.trayClear);
  }
  // the room above: whatever stands over the column (the header, the minimap,
  // a corner's plates); an open plate's width toward the middle stops short
  // of what stands lower than that beside it (the minimap under a practice
  // header, which is narrower)
  const over = [L.header, L.minimap];
  // a corner's plates: practice's or the view tray at the top right (upright:
  // practice's under the header, at the left)
  if (!tall)
    over.push({
      x: W - s.right - t.trayRight - t.trayW.practice,
      y: s.top + t.railTop,
      width: t.trayW.practice,
      height: t.railH,
    });
  else
    over.push({
      x: s.left + t.plateEdge,
      y: L.header.y + L.header.height + t.mapGap,
      width: t.trayW.practice,
      height: t.railH,
    });
  const across = (r, x0, w) => r && r.x < x0 + w && x0 < r.x + r.width;
  let ceiling = s.top + t.railTop;
  for (const r of over)
    if (across(r, x, sz.width + t.shadow))
      ceiling = Math.max(ceiling, r.y + r.height + t.mapGap);
  let sideW = Math.max(
    sz.width,
    Math.min(
      t.openSideW[L.phone ? "phone" : "wide"],
      edge === "left"
        ? W / 2 - t.planClear - x
        : x + sz.width - (W / 2 + t.planClear),
    ),
  );
  for (const r of over) {
    if (!r || r.y + r.height + t.mapGap <= ceiling) continue;
    const x0 = edge === "left" ? x : x + sz.width - sideW;
    if (!across(r, x0, sideW + t.shadow)) continue;
    sideW =
      edge === "left"
        ? r.x - t.mapGap - t.shadow - x
        : x + sz.width - (r.x + r.width + t.mapGap);
  }
  sideW = Math.max(sz.width, sideW);
  // A short screen (a phone on its side with its browser's bars showing):
  // the column comes down toward the safe bottom (trayClear off it, never
  // upright, where the clock's track is under it), then its plates grow
  // shorter, never under the touch size (48 to a finger, 44 with a mouse).
  // Where even that does not fit, there is no tray: the linear meter gives
  // way to the clock, and the clock's tray stands from the ceiling.
  if (foot - colH < ceiling && !tall)
    foot = Math.min(H - s.bottom - t.trayClear, ceiling + colH);
  if (foot - colH < ceiling) {
    const least = L.coarse ? t.touchMin : t.mouseMin;
    const ph = Math.max(least, (foot - ceiling - 2 * t.plateGap) / 3);
    sz.height = ph;
    colH = 3 * ph + 2 * t.plateGap;
    if (foot - colH < ceiling - 1e-9) {
      if (L.meter === "linear")
        return { tray: null, plan: null, planEdge: null };
      foot = ceiling + colH;
    }
  }
  const y = foot - colH;
  const room = foot - ceiling;
  const rest = 2 * (sz.height + t.plateGap);
  const grow = (want) => {
    const pushed = Math.min(want, room - rest);
    return pushed >= Math.min(want, t.openMin)
      ? { height: pushed, cover: false }
      : { height: Math.min(want, room), cover: true };
  };
  const k = L.phone ? "phone" : "wide";
  const open = {
    arc: { width: sz.width, ...grow(t.openArcH[k]) },
    side: { width: sideW, ...grow(t.openSideH) },
    stand: { width: sideW, ...grow(t.openStandH[k]) },
  };
  const plan = { x, y, width: sz.width, height: colH };
  return {
    tray: {
      edge,
      ...plan,
      foot,
      ceiling,
      plateW: sz.width,
      plateH: sz.height,
      gap: t.plateGap,
      open,
    },
    plan,
    planEdge: edge,
  };
}

const meets = (a, b) =>
  !!a &&
  !!b &&
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

// Does what the linear meter brings keep apart: the tray, the minimap, the
// header and the meter with its prompt tab?
function linearClear(L) {
  const tab = tabRect(linearGeometry(L.dial, L.meterSide));
  const head = { ...L.header, width: L.header.width + tune.headerGap };
  const rects = [L.dial, tab, L.plan, L.minimap, head];
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      if (i === 0 && j === 1) continue; // the meter's own tab
      if (meets(rects[i], rects[j])) return false;
    }
  return true;
}

// What a press claims of the linear meter (L.meter "linear", g its
// geometry), in the press order of Game.down. `first` comes before the
// target circle and the thrower: "dial" (the knob, grabbed), "none" (the
// body away from the knob: kept from the pitch, nothing happens) or null.
// On a wide canvas a finger (`touch`) grabs only across the knob's channel
// and the rest of the body is "zone" (a tap aims, a drag strokes): the
// whole-height box stands over the far baseline's outer kubb, which a tap
// there must still reach. A mouse, and every pointer on a tall canvas, are
// as before.
export function linearFirst(L, g, x, y, { touch = false, reach }) {
  const wideTouch = touch && !L.tall;
  if (knobHit(g, x, y, reach, wideTouch)) return "dial";
  if (bodyHit(g, x, y)) return wideTouch ? "zone" : "none";
  return null;
}

// Is a press (that nothing else took) in the linear meter's throw zone,
// where a drag strokes the knob and a tap still aims? The canvas below
// `zoneFrom` of its height; on a wide canvas with a finger the meter's half
// of it, top to bottom (the lower 40% of a phone on its side, about 156 px,
// is too shallow for a whole draw back and flick; the plan block and the
// minimap are on the other half). A mouse keeps the lower band.
export function inLinearZone(L, x, y, { touch = false, zoneFrom = 0.6 } = {}) {
  if (touch && !L.tall)
    return L.meterSide === "left" ? x <= L.W / 2 : x >= L.W / 2;
  return y >= L.H * zoneFrom;
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
