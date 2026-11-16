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

export const tune = {
  tallFrom: 1.05, // H / W above this is a tall canvas
  tallZoom: 1.3, // of the width-fit scale
  anchorY: 112, // frame y that the target half sits round
  anchorAt: 0.33, // ... placed this far down a tall canvas
  stillAt: 0.42, // a tall canvas's raise and punishment scenes
  margin: 14, // px from the edges (plus the safe area)
  railH: 46,
  // the wide view's box (wideBox): CSS px kept clear at the top for the rail,
  // the status pill and the menu (more on a tall screen, where the pill sits
  // under the rail), and at the other edges
  wideTop: 70,
  wideTopTall: 132,
  wideEdge: 16,
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

// The screen's regions in CSS px. safe = { top, right, bottom, left }.
export function layoutFor(W, H, safe = {}) {
  const s = { top: 0, right: 0, bottom: 0, left: 0, ...safe };
  const m = tune.margin;
  const tall = isTall(W, H);
  const phone = Math.min(W, H) < 520;
  let dial, minimap, side;
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
  } else {
    const S = Math.min(W * 0.28, H * (phone ? 0.5 : 0.46), 380);
    const h = S * 1.2;
    dial = {
      x: W - s.right - m - S,
      y: H - s.bottom - m * 0.5 - h,
      width: S,
      height: h,
    };
    const mw = Math.max(56, Math.min(118, W * 0.085, H * 0.16));
    minimap = {
      x: s.left + m,
      y: H - s.bottom - m - mw * 1.95,
      width: mw,
      height: mw * 1.95,
    };
    side = "left";
  }
  return { W, H, safe: s, tall, phone, dial, minimap, side };
}

// The wide view's box: where the whole pitch is fitted (lua/web/wide.lua), in
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
