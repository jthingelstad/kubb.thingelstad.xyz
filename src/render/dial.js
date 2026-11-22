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
//   lastBack, lastStop    the last throw's peak and stop (or null): ghosts
//   prompt     WIND BACK, FLICK!, EASE OFF, CRANK DOWN, WATCH (or null);
//              one ending in "!" is drawn paper on ink
//   grabbed    true while the pointer holds the arm
//   track      draw the finger track round the rim (a touchscreen: a finger
//              may go round outside the ring, where it hides nothing)
//   finger     [x, y] of a finger holding the dial from beside the ring, or
//              null: a spoke from the knob out to it
//   distance   the throw's distance in words ("8 M"), or null: an inverted
//              tab beside the prompt (the 1.0 design, "Meter marks and distance")
//   promptFill, promptInk  the prompt's own colours (the computer's WATCH, on
//              its team's colour), or null
//   faded      drawn at half strength (a turn this player only watches)
//
// The marks are told apart by pattern as well as colour (the 1.0 design,
// "Meter"): the power band is striped, the release band solid, both with ink
// end-marks, on the face, across the ring and on the finger track.
import { UI, HUD, FONT } from "./palette.js";

export const tune = {
  frame: 0.075, // the ink frame, of the radius
  ring: 0.2, // the ring's width, of the radius
  sliceIn: 0.3, // targets and zones start this far out from the hub
  tick: 0.09,
  tickLong: 0.16,
  hand: 0.86, // the hand's length (to the knob's centre), of the radius
  knob: 0.15, // the knob's radius, of the radius
  hub: 0.07,
  // the last throw's back and stop: a faded ghost of the arm's tip and its
  // knob, this much of the knob's size and drawn at this opacity, so it reads
  // as where the last throw went, never as a mark to aim for (a tester,
  // 2026-11-19: "the target dot is in the red")
  ghost: 0.6,
  ghostAlpha: 0.45,
  dot: 0.065, // the live peak's radius
  shadow: 0.06, // the hard drop shadow, of the radius
  promptH: 0.3, // the prompt plate's height, of the radius
  grabSlop: 1.25, // a press within this many radii of the centre grabs the dial
  // a finger may press and go round outside the ring (touch only: Jamie,
  // 2026-11-19, "be able to touch outside the ring so that you can see
  // where the movement is"). The arm is still the angle about the centre.
  // The track drawn for it runs trackIn..trackOut radii (a fingertip's
  // width outside the rim); a touch within touchReach radii grabs the dial.
  trackIn: 1.1,
  trackOut: 1.55,
  touchReach: 2.1,
  trackPast: 14, // the rail runs this many degrees past the release band
  stripe: 0.075, // the power band's stripes: one every this much of the radius
  endMark: 1.8, // the bands' ink end-marks, of the line width
  fade: 0.5, // a watched turn's meter, at this strength
};

// ---------- geometry (also for input) ----------

// The dial's centre and radius in rect: the largest circle that fits with
// room for the prompt plate above it and the shadow.
// Where the red overpowered zone starts, in backswing degrees: the session's
// fixed overDeg (11 o'clock), or past the power target where the target
// reaches further. The engine's overpower cost counts from the target's far
// edge (throwplan.lua: past = back - powerHi), so red never covers the
// target band (a tester, 2026-11-19: "the target dot is in the red").
// null: no red zone.
export function overFrom(st) {
  if (st.overDeg == null) return null;
  return Number.isFinite(st.powerHi)
    ? Math.max(st.overDeg, st.powerHi)
    : st.overDeg;
}

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

// Is a touch at (px, py) beside the dial: outside the grab of hitTest, out
// to touchReach radii? (The finger track.)
export function trackHit(g, px, py) {
  const d = Math.hypot(px - g.cx, py - g.cy);
  return d > g.r * tune.grabSlop && d <= g.r * tune.touchReach;
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

// Diagonal lines across a slice: `weight` of each step inked, falling right
// (dir 1) or rising (dir -1).
function hatch(ctx, g, r0, r1, a0, a1, color, step, weight = 0.35, dir = 1) {
  ctx.save();
  slicePath(ctx, g, r0, r1, a0, a1);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = step * weight;
  ctx.beginPath();
  for (let d = -g.r * 2; d < g.r * 2; d += step) {
    ctx.moveTo(g.cx + d - g.r, g.cy - dir * g.r);
    ctx.lineTo(g.cx + d + g.r, g.cy + dir * g.r);
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

// A target band from arm a0 to a1: solid (the release band), or striped (the
// power band: its colour in wide stripes on the face's paper, the deep colour
// across the ring the same way, so the two read apart without colour), with
// heavy ink end-marks across face and ring at both edges.
function target(ctx, g, ri, ro, a0, a1, fill, deep, lw, striped = false) {
  const r0 = g.r * tune.sliceIn;
  const step = Math.max(4, g.r * tune.stripe);
  slicePath(ctx, g, r0, ro, a0, a1);
  ctx.fillStyle = striped ? UI.paper : fill;
  ctx.fill();
  if (striped) hatch(ctx, g, r0, ro, a0, a1, fill, step, 0.5, -1);
  ctx.strokeStyle = UI.ink;
  ctx.lineWidth = lw;
  slicePath(ctx, g, r0, ro, a0, a1);
  ctx.stroke();
  // across the ring, so the hand never hides it
  slicePath(ctx, g, ri, ro, a0, a1);
  ctx.fillStyle = striped ? UI.paper : deep;
  ctx.fill();
  if (striped) hatch(ctx, g, ri, ro, a0, a1, deep, step, 0.5, -1);
  slicePath(ctx, g, ri, ro, a0, a1);
  ctx.stroke();
  endMarks(ctx, g, r0, ro, [a0, a1], lw);
}

// Heavy ink lines across a band's edges, from r0 out to r1.
function endMarks(ctx, g, r0, r1, angles, lw) {
  ctx.save();
  ctx.strokeStyle = UI.ink;
  ctx.lineWidth = lw * tune.endMark;
  ctx.lineCap = "butt";
  ctx.beginPath();
  for (const a of angles) {
    const [x0, y0] = armPoint(g, a, r0);
    const [x1, y1] = armPoint(g, a, r1);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
  ctx.restore();
}

// A prompt plate's width at height h (it sets the plate's font).
function plateWidth(ctx, h, text) {
  ctx.font = `900 ${Math.round(h * 0.78)}px ${FONT.display}`;
  return ctx.measureText(text).width + h * 0.9;
}

// A prompt plate centred on (x, y). With `right`, it is moved left so it and
// its shadow stay inside that x (a meter at the screen's right edge); with
// `left`, moved right so it starts at that x (a meter at the left edge).
export function plate(
  ctx,
  x,
  y,
  h,
  text,
  inverted,
  right = null,
  left = null,
  colors = null,
) {
  const w = plateWidth(ctx, h, text);
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const sh = h * 0.12;
  if (right != null) x = Math.min(x, right - sh - w / 2);
  if (left != null) x = Math.max(x, left + w / 2);
  ctx.fillStyle = UI.drop;
  ctx.beginPath();
  ctx.roundRect(x - w / 2 + sh, y - h / 2 + sh, w, h, h * 0.18);
  ctx.fill();
  ctx.fillStyle = colors?.fill || (inverted ? UI.ink : HUD.prompt);
  ctx.strokeStyle = UI.ink;
  ctx.lineWidth = Math.max(1.5, h * 0.09);
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, h * 0.18);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colors?.ink || (inverted ? UI.paper : HUD.promptInk);
  ctx.fillText(text, x, y + h * 0.04);
}

// The prompt over the clock with the distance tab beside it (the 1.0 design:
// "Beside the prompt (WIND BACK, DRAW BACK) show the throw's distance to the
// nearest metre on an inverted tab"), the pair centred over the clock:
// { h, y, x0, x1, items: [{ x, w, text, inverted, colors }] }, or null.
export function promptGroup(ctx, g, st) {
  if (!st.prompt) return null;
  const h = Math.max(14, g.r * tune.promptH);
  const y = g.cy - g.r - h * 0.85;
  const items = [
    {
      text: st.prompt,
      inverted: st.prompt.endsWith("!"),
      colors:
        st.promptFill || st.promptInk
          ? { fill: st.promptFill, ink: st.promptInk }
          : null,
    },
  ];
  if (st.distance) items.push({ text: st.distance, inverted: true });
  for (const it of items) it.w = plateWidth(ctx, h, it.text);
  const gap = h * 0.3;
  const total = items.reduce((a, it) => a + it.w, 0) + gap * (items.length - 1);
  let x = g.cx - total / 2;
  for (const it of items) {
    it.x = x + it.w / 2;
    x += it.w + gap;
  }
  return { h, y, x0: g.cx - total / 2, x1: g.cx + total / 2, items };
}

// The finger track's rail (drawDial, st.track): an arc at the middle of
// trackIn..trackOut from 12 o'clock down the back side, round 6 and up the
// forward side a little past the release band.
function trackRail(ctx, g, st, lw) {
  const rt = (g.r * (tune.trackIn + tune.trackOut)) / 2;
  const c = (a) => ((90 - a) * Math.PI) / 180;
  const end = Math.min(180, Math.max(st.releaseHi || 0, 90) + tune.trackPast);
  const arc = (a0, a1) => {
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, rt, c(a0), c(a1), true);
  };
  ctx.save();
  ctx.lineCap = "round";
  // the casing, then the rail
  ctx.strokeStyle = UI.paper;
  ctx.lineWidth = lw * 3.4;
  arc(-180, end);
  ctx.stroke();
  // the targets on it: a fat stroke in the target's colour, edged in ink;
  // the power band's in dashes on paper (its stripes), the release band's solid
  const seg = (a0, a1, fill, striped = false) => {
    ctx.lineCap = "butt";
    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = lw * 3.4;
    arc(a0 - 1.2, a1 + 1.2);
    ctx.stroke();
    ctx.strokeStyle = striped ? UI.paper : fill;
    ctx.lineWidth = lw * 1.6;
    arc(a0, a1);
    ctx.stroke();
    if (striped) {
      ctx.strokeStyle = fill;
      ctx.setLineDash([lw * 1.6, lw * 1.6]);
      arc(a0, a1);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };
  ctx.strokeStyle = UI.ink;
  ctx.lineWidth = lw;
  arc(-180, end);
  ctx.stroke();
  if (st.powerHi > st.powerLo) seg(-st.powerHi, -st.powerLo, HUD.power, true);
  if (st.releaseHi > st.releaseLo) seg(st.releaseLo, st.releaseHi, HUD.release);
  // the hour pips
  ctx.lineCap = "round";
  ctx.strokeStyle = UI.ink;
  ctx.lineWidth = lw * 1.2;
  ctx.beginPath();
  for (let a = -150; a < end; a += 30) {
    if (a === 0) continue;
    const [x0, y0] = armPoint(g, a, rt - lw * 2.2);
    const [x1, y1] = armPoint(g, a, rt + lw * 2.2);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
  // 6 o'clock, where every swing starts: a solid pip
  const [x6, y6] = armPoint(g, 0, rt);
  ctx.fillStyle = UI.ink;
  ctx.beginPath();
  ctx.arc(x6, y6, lw * 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// A ghost of the arm at `a`: the outer part of the hand and the knob at
// radius kr, faded, with no ink rim, so it reads as the arm where it was and
// not as a hole or a target to put the knob in. Also the linear meter's
// (render/linear.js ghostKnob).
function ghostArm(ctx, g, a, kr, lw) {
  const [hx, hy] = armPoint(g, a, g.r * tune.hand);
  const [sx, sy] = armPoint(g, a, g.r * 0.5);
  ctx.save();
  ctx.globalAlpha = tune.ghostAlpha;
  ctx.lineCap = "round";
  ctx.strokeStyle = HUD.hand;
  ctx.lineWidth = g.r * 0.045;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ghostKnob(ctx, hx, hy, kr, lw);
  ctx.restore();
}

// The knob's ghost at (x, y), radius kr: its wood and its end-grain pip,
// edged in the stem's brown, never ink. The caller sets the opacity.
export function ghostKnob(ctx, x, y, kr, lw) {
  ctx.fillStyle = HUD.knob;
  ctx.strokeStyle = HUD.hand;
  ctx.lineWidth = Math.max(1, lw * 0.9);
  ctx.beginPath();
  ctx.arc(x, y, kr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = HUD.hand;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.8, kr * 0.22), 0, Math.PI * 2);
  ctx.fill();
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
  if (st.faded) ctx.globalAlpha = tune.fade;

  // the finger track beside the rim: only the way a finger goes (6 o'clock
  // up the back side to 12, and forward past the release band), drawn as a
  // thin ink rail on a paper casing with an hour pip every 30 degrees and the
  // two targets laid on it. It is line, not a wash, so the pitch shows
  // through; the prompt plate is drawn over its top.
  if (st.track) {
    // it yields to the prompt plate: a gap round the plate's box
    ctx.save();
    const pg = promptGroup(ctx, g, st);
    if (pg) {
      const { h, y: py } = pg;
      const m = h * 0.3;
      ctx.beginPath();
      ctx.rect(rect.x - r, rect.y - r, rect.width + 2 * r, rect.height + 2 * r);
      ctx.roundRect(
        pg.x0 - m,
        py - h / 2 - m,
        pg.x1 - pg.x0 + 2 * m,
        h + 2 * m,
        m,
      );
      ctx.clip("evenodd");
    }
    trackRail(ctx, g, st, lw);
    ctx.restore();
  }

  // the face: hard shadow, ink frame, paper
  const sh = r * tune.shadow;
  ctx.fillStyle = UI.drop;
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
  const over = overFrom(st);
  if (over != null && over < 180) {
    // cross-hatched, so the stripes stay the power band's alone (the coach
    // says "pull back to the stripes")
    for (const dir of [1, -1])
      hatch(
        ctx,
        g,
        r * tune.sliceIn,
        ro,
        -180,
        -over,
        HUD.over,
        Math.max(3, r * 0.1),
        0.3,
        dir,
      );
    slicePath(ctx, g, ri, ro, -180, -over);
    ctx.fillStyle = HUD.over;
    ctx.fill();
  }
  // the targets: power on the back side (striped), release on the forward
  // side (solid)
  if (st.powerHi > st.powerLo)
    target(
      ctx,
      g,
      ri,
      ro,
      -st.powerHi,
      -st.powerLo,
      HUD.power,
      HUD.powerDeep,
      lw,
      true,
    );
  if (st.releaseHi > st.releaseLo)
    target(
      ctx,
      g,
      ri,
      ro,
      st.releaseLo,
      st.releaseHi,
      HUD.release,
      HUD.releaseDeep,
      lw,
    );

  // the ring's inner edge and the hours
  ctx.strokeStyle = UI.ink;
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

  // the last throw's back and stop: ghosts of the arm's tip and knob
  for (const a of [st.lastBack != null ? -st.lastBack : null, st.lastStop]) {
    if (a == null) continue;
    ghostArm(ctx, g, a, r * tune.knob * tune.ghost, lw);
  }
  // the live peak
  if (live && st.back > 0) {
    const [x, y] = armPoint(g, -st.back, rm);
    ctx.fillStyle = UI.paper;
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
  // a finger held beside the ring: a thin spoke from the knob out to it,
  // and a ring where it is, so what the finger covers can be read past it
  if (st.finger) {
    const [fx, fy] = st.finger;
    ctx.strokeStyle = UI.paper;
    ctx.lineWidth = lw * 2.6;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = lw * 1.1;
    ctx.stroke();
    const fr = r * 0.11;
    ctx.fillStyle = UI.paper;
    ctx.beginPath();
    ctx.arc(fx, fy, fr + lw * 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = lw * 1.5;
    ctx.beginPath();
    ctx.arc(fx, fy, fr, 0, Math.PI * 2);
    ctx.stroke();
  }
  const handW = live || st.grabbed ? r * 0.07 : r * 0.045;
  ctx.strokeStyle = UI.paper;
  ctx.lineWidth = handW + lw * 2.4;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.strokeStyle = UI.ink;
  ctx.lineWidth = handW + lw * 1.2;
  ctx.stroke();
  ctx.strokeStyle = HUD.hand;
  ctx.lineWidth = handW - lw * 0.4;
  ctx.stroke();
  // the knob: a little baton end, wood with an ink rim and end-grain rings
  ctx.fillStyle = UI.ink;
  ctx.beginPath();
  ctx.arc(hx + kr * 0.18, hy + kr * 0.18, kr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = st.grabbed ? HUD.knobGrab : HUD.knob;
  ctx.strokeStyle = UI.ink;
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
  ctx.fillStyle = UI.ink;
  ctx.beginPath();
  ctx.arc(cx, cy, r * tune.hub, 0, Math.PI * 2);
  ctx.fill();

  // the prompt over the dial, the distance beside it, at full strength
  ctx.globalAlpha = 1;
  const pg = promptGroup(ctx, g, st);
  if (pg)
    for (const it of pg.items)
      plate(ctx, it.x, pg.y, pg.h, it.text, it.inverted, null, null, it.colors);
  ctx.restore();
  return g;
}
