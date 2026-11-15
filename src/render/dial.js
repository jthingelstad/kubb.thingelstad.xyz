// The throw dial: the Playdate's crank clock (render/hud.lua hud.clock) as a
// control you grab. drawDial(ctx, rect, st) draws it in rect (CSS px, in the
// ctx's current transform); the geometry helpers turn a pointer into the arm.
//
// Angles are arm degrees: 0 = 6 o'clock (the arm hanging down), the backswing
// negative and drawn up the left side (-90 = 9 o'clock), the forward swing
// positive up the right (+90 = 3), +-180 = 12.
//
// st (the session's dial state, DESIGN 5):
//   phase      'idle' | 'winding' | 'swinging' | 'cooldown'
//   arm        the arm, arm degrees (while winding or swinging)
//   crank      the idle arm (where the pointer left it), arm degrees
//   back       the farthest backswing so far (positive degrees), or 0
//   powerLo, powerHi      the power target, backswing degrees (positive)
//   releaseLo, releaseHi  the release target, forward degrees
//   deadDeg, overDeg      6 o'clock to -deadDeg is dead; past -overDeg is overpowered
//   lastBack, lastStop    the last throw's peak and stop (or null): hollow dots
//   prompt     WIND BACK, FLICK!, EASE OFF, CRANK DOWN, WATCH (or null);
//              one ending in "!" is drawn paper on ink
//   grabbed    true while the pointer holds the arm
import { INK, PAPER, HUD, FONT } from "./palette.js";

export const tune = {
  frame: 0.075, // the ink frame, of the radius
  ring: 0.2, // the ring's width, of the radius
  sliceIn: 0.3, // targets and zones start this far out from the hub
  tick: 0.09,
  tickLong: 0.16,
  hand: 0.86, // the hand's length (to the knob's centre), of the radius
  knob: 0.15, // the knob's radius, of the radius
  hub: 0.07,
  dot: 0.065, // a last-throw dot's radius
  shadow: 0.06, // the hard drop shadow, of the radius
  promptH: 0.3, // the prompt plate's height, of the radius
  grabSlop: 1.25, // a press within this many radii of the centre grabs the dial
};

// ---------- geometry (also for input) ----------

// The dial's centre and radius in rect: the largest circle that fits with
// room for the prompt plate above it and the shadow.
export function dialGeometry(rect) {
  const pad = Math.min(rect.width, rect.height) * 0.04;
  const promptRoom = 0.42; // of r, above the dial
  const r = Math.max(
    4,
    Math.min(
      (rect.width - 2 * pad) / 2.12,
      (rect.height - 2 * pad) / (2.12 + promptRoom),
    ),
  );
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height - pad - r * 1.06;
  return { cx, cy, r };
}

// The point at radius R for an arm angle (degrees).
export function armPoint(g, arm, R = g.r) {
  const a = (arm * Math.PI) / 180;
  return [g.cx + R * Math.sin(a), g.cy + R * Math.cos(a)];
}

// The pointer's angle about the centre as arm degrees, in -180..180.
export function armAt(g, px, py) {
  return (Math.atan2(px - g.cx, py - g.cy) * 180) / Math.PI;
}

// Is a press at (px, py) on the dial?
export function hitTest(g, px, py) {
  return Math.hypot(px - g.cx, py - g.cy) <= g.r * tune.grabSlop;
}

// Unwrap a raw pointer angle against the previous arm so the arm moves
// continuously through 12 o'clock: the result is within 180 of prev.
export function unwrapArm(prev, raw) {
  let a = raw;
  while (a - prev > 180) a -= 360;
  while (a - prev < -180) a += 360;
  return a;
}

// ---------- drawing ----------

function slicePath(ctx, g, r0, r1, a0, a1) {
  // canvas angle for an arm angle: the point (sin a, cos a) is at canvas
  // angle 90 - a degrees (y down)
  const c = (a) => ((90 - a) * Math.PI) / 180;
  ctx.beginPath();
  ctx.arc(g.cx, g.cy, r1, c(a0), c(a1), true);
  ctx.arc(g.cx, g.cy, r0, c(a1), c(a0), false);
  ctx.closePath();
}

function hatch(ctx, g, r0, r1, a0, a1, color, step) {
  ctx.save();
  slicePath(ctx, g, r0, r1, a0, a1);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = step * 0.35;
  ctx.beginPath();
  for (let d = -g.r * 2; d < g.r * 2; d += step) {
    ctx.moveTo(g.cx + d - g.r, g.cy - g.r);
    ctx.lineTo(g.cx + d + g.r, g.cy + g.r);
  }
  ctx.stroke();
  ctx.restore();
}

function dots(ctx, g, r0, r1, a0, a1, color, step) {
  ctx.save();
  slicePath(ctx, g, r0, r1, a0, a1);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.beginPath();
  let row = 0;
  for (let y = g.cy - g.r; y < g.cy + g.r; y += step, row++) {
    for (
      let x = g.cx - g.r + (row % 2 ? step / 2 : 0);
      x < g.cx + g.r;
      x += step
    ) {
      ctx.moveTo(x + step * 0.14, y);
      ctx.arc(x, y, step * 0.14, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  ctx.restore();
}

function target(ctx, g, ri, ro, rm, ringW, a0, a1, fill, deep, lw) {
  slicePath(ctx, g, g.r * tune.sliceIn, ro, a0, a1);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.stroke();
  // solid across the ring, so the hand never hides it
  slicePath(ctx, g, ri, ro, a0, a1);
  ctx.fillStyle = deep;
  ctx.fill();
  ctx.stroke();
}

function plate(ctx, x, y, h, text, inverted) {
  ctx.font = `900 ${Math.round(h * 0.78)}px ${FONT.display}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const w = ctx.measureText(text).width + h * 0.9;
  const sh = h * 0.12;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.roundRect(x - w / 2 + sh, y - h / 2 + sh, w, h, h * 0.18);
  ctx.fill();
  ctx.fillStyle = inverted ? INK : HUD.prompt;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.5, h * 0.09);
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h * 0.18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = inverted ? PAPER : HUD.promptInk;
  ctx.fillText(text, x, y + h * 0.04);
}

export function drawDial(ctx, rect, st) {
  const g = dialGeometry(rect);
  const { cx, cy, r } = g;
  const ro = r * (1 - tune.frame);
  const ri = ro - r * tune.ring;
  const rm = (ro + ri) / 2;
  const lw = Math.max(1, r * 0.022);
  const live = st.phase === "winding" || st.phase === "swinging";
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // the face: hard shadow, ink frame, paper
  const sh = r * tune.shadow;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(cx + sh, cy + sh, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = st.grabbed ? HUD.knobGrab : HUD.face;
  ctx.beginPath();
  ctx.arc(cx, cy, ro, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = HUD.ring;
  slicePath(ctx, g, ri, ro, -180, 180);
  ctx.fill();

  // the zones
  if (st.deadDeg > 0) {
    slicePath(ctx, g, r * tune.sliceIn, ro, -st.deadDeg, 0);
    ctx.fillStyle = HUD.faceShade;
    ctx.fill();
    dots(
      ctx,
      g,
      r * tune.sliceIn,
      ro,
      -st.deadDeg,
      0,
      HUD.dead,
      Math.max(3, r * 0.09),
    );
  }
  if (st.overDeg != null && st.overDeg < 180) {
    hatch(
      ctx,
      g,
      r * tune.sliceIn,
      ro,
      -180,
      -st.overDeg,
      HUD.over,
      Math.max(3, r * 0.1),
    );
    slicePath(ctx, g, ri, ro, -180, -st.overDeg);
    ctx.fillStyle = HUD.over;
    ctx.fill();
  }
  // the targets: power on the back side, release on the forward side
  if (st.powerHi > st.powerLo)
    target(
      ctx,
      g,
      ri,
      ro,
      rm,
      ro - ri,
      -st.powerHi,
      -st.powerLo,
      HUD.power,
      HUD.powerDeep,
      lw,
    );
  if (st.releaseHi > st.releaseLo)
    target(
      ctx,
      g,
      ri,
      ro,
      rm,
      ro - ri,
      st.releaseLo,
      st.releaseHi,
      HUD.release,
      HUD.releaseDeep,
      lw,
    );

  // the ring's inner edge and the hours
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(cx, cy, ri, 0, Math.PI * 2);
  ctx.stroke();
  for (let h = 0; h < 12; h++) {
    const long = h % 3 === 0;
    const [x0, y0] = armPoint(g, h * 30, ri - lw);
    const [x1, y1] = armPoint(
      g,
      h * 30,
      ri - r * (long ? tune.tickLong : tune.tick),
    );
    ctx.lineWidth = long ? lw * 2 : lw;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  // the last throw's dots
  for (const a of [st.lastBack != null ? -st.lastBack : null, st.lastStop]) {
    if (a == null) continue;
    const [x, y] = armPoint(g, a, rm);
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    ctx.arc(x, y, r * tune.dot + lw, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw * 1.4;
    ctx.beginPath();
    ctx.arc(x, y, r * tune.dot, 0, Math.PI * 2);
    ctx.stroke();
  }
  // the live peak
  if (live && st.back > 0) {
    const [x, y] = armPoint(g, -st.back, rm);
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    ctx.arc(x, y, r * tune.dot + lw, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = HUD.peak;
    ctx.beginPath();
    ctx.arc(x, y, r * tune.dot - lw * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // the hand and its knob: the thing you grab
  const arm = st.phase === "idle" ? (st.crank ?? 0) : (st.arm ?? 0);
  const [hx, hy] = armPoint(g, arm, r * tune.hand);
  const kr = r * tune.knob * (st.grabbed ? 1.12 : 1);
  if (st.grabbed) {
    ctx.fillStyle = HUD.glow;
    ctx.beginPath();
    ctx.arc(hx, hy, kr * 1.7, 0, Math.PI * 2);
    ctx.fill();
  }
  const handW = live || st.grabbed ? r * 0.07 : r * 0.045;
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = handW + lw * 2.4;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = handW + lw * 1.2;
  ctx.stroke();
  ctx.strokeStyle = HUD.hand;
  ctx.lineWidth = handW - lw * 0.4;
  ctx.stroke();
  // the knob: a little baton end, wood with an ink rim and end-grain rings
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(hx + kr * 0.18, hy + kr * 0.18, kr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = st.grabbed ? HUD.knobGrab : HUD.knob;
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw * 1.6;
  ctx.beginPath();
  ctx.arc(hx, hy, kr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = HUD.hand;
  ctx.lineWidth = lw * 0.8;
  ctx.beginPath();
  ctx.arc(hx, hy, kr * 0.55, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = HUD.hand;
  ctx.beginPath();
  ctx.arc(hx, hy, kr * 0.16, 0, Math.PI * 2);
  ctx.fill();
  // the hub
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(cx, cy, r * tune.hub, 0, Math.PI * 2);
  ctx.fill();

  // the prompt over the dial
  if (st.prompt) {
    const h = Math.max(14, r * tune.promptH);
    plate(ctx, cx, cy - r - h * 0.85, h, st.prompt, st.prompt.endsWith("!"));
  }
  ctx.restore();
  return g;
}
