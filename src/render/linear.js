// The linear meter: the throw dial unrolled into a straight track, for a
// player who would sooner draw back and fling than circle a clock (a
// preference: MENU, Meter). It shows and takes exactly what the dial does:
// the same arm in degrees goes to the engine, so the two throw alike.
//
// The clock's 6 is the middle of the track, the knob's home. The backswing
// (the clock's left side) runs down from it, toward the player; the forward
// swing (the right side) runs up, toward the target. One scale both ways:
// the flick's speed is degrees a second on either meter.
//
// The body is two columns in one ink frame: the lane on the left carries the
// targets, the last throw's dots and the peak (the dial's ring), and the
// channel on the right carries the knob, so the knob and the finger on it
// never hide a target. The body is the whole height of its box: the prompt
// is beside it, not above, because the track's length is the meter's room.
//
// st is the dial's state (render/dial.js).
import { INK, PAPER, HUD, FONT } from "./palette.js";

export const tune = {
  range: 180, // degrees each way: the ends are 12 o'clock
  bodyMax: 88, // px: the body is never wider than this
  lane: 0.3, // the lane's width, of the body's
  knob: 0.4, // the knob's radius, of the channel's width
  frame: 0.07, // the ink frame, of the body's width (the dial's is as heavy)
  shadow: 0.075, // the hard drop shadow, of the body's width
  corner: 0.12, // the body's corner radius, of its width
  endPad: 0.02, // past the knob at either end, inside the frame, of the width
  slot: 0.17, // the slot the knob runs in, of the channel's width
  tick: 0.2, // an hour's tick, of the channel's width
  tickLong: 0.36, // 6, 3, 9 and 12
  dot: 0.26, // a last-throw dot's radius, of the lane's width
  hub: 0.95, // home's hub, of the slot's width
  promptH: 0.3, // the prompt plate's height, of the body's width
  promptMin: 18,
  grabTouch: 46, // px up or down from the knob that a finger grabs it
  grabMouse: 34,
  // px: a track shorter than this is cramped (the straight trial of 2026-11
  // had 300 for the whole swing and was), so the clock is used instead
  minTravel: 320,
};

// ---------- geometry (also for input) ----------

// The body and the track in rect. yF and yB are the forward and the back
// end (arm +range and -range), y0 the knob's home; scale is px a degree.
// side is the screen edge the meter sits at (MENU, Side): the body is
// mirrored so the lane (laneLeft..divX) is always toward the screen's
// centre and the channel (chanX..chanX + chanW) toward its edge, and the
// prompt tab hangs toward the centre (tabDir -1: to the body's left).
export function linearGeometry(rect, side = "right") {
  const w = Math.min(tune.bodyMax, rect.width * 0.92);
  const sh = w * tune.shadow;
  const fr = Math.max(1.5, w * tune.frame);
  const onLeft = side === "left";
  // the hard shadow falls right and down: on the left edge the body starts
  // at the box's edge, on the right it stops short of it by the shadow
  const right = onLeft ? rect.x + w : rect.x + rect.width - sh;
  const left = right - w;
  const laneW = w * tune.lane;
  const chanW = w - laneW;
  const laneLeft = onLeft ? right - laneW : left;
  const chanX = onLeft ? left : left + laneW;
  const divX = onLeft ? laneLeft : chanX;
  const kr = chanW * tune.knob;
  const promptH = Math.max(tune.promptMin, w * tune.promptH);
  const top = rect.y;
  const bottom = rect.y + rect.height - sh;
  // the knob at either end just meets the frame
  const cap = kr + fr + w * tune.endPad;
  const yF = top + cap;
  const yB = bottom - cap;
  return {
    side: onLeft ? "left" : "right",
    left,
    right,
    top,
    bottom,
    w,
    sh,
    fr,
    laneW,
    laneLeft,
    chanX,
    chanW,
    divX,
    tabDir: onLeft ? 1 : -1,
    cx: chanX + chanW / 2,
    laneX: laneLeft + laneW / 2,
    kr,
    promptH,
    yF,
    yB,
    y0: (yF + yB) / 2,
    travel: Math.max(0, yB - yF),
    scale: Math.max(0.01, (yB - yF) / (2 * tune.range)),
  };
}

// The y of an arm angle (degrees), and the arm at a y, kept on the track.
export function armY(g, arm) {
  return g.y0 - arm * g.scale;
}

export function armAtY(g, y) {
  const a = (g.y0 - y) / g.scale;
  return Math.max(-tune.range, Math.min(tune.range, a));
}

// Is a press at (px, py) on the knob at its home? `reach` is how far up or
// down from it counts (tune.grabTouch, tune.grabMouse).
export function knobHit(g, px, py, reach) {
  return px >= g.left - 6 && px <= g.right + 6 && Math.abs(py - g.y0) <= reach;
}

// Is it anywhere on the meter's body? (The body keeps a press from the
// pitch behind it.)
export function bodyHit(g, px, py) {
  return px >= g.left - 6 && px <= g.right + 6 && py >= g.top && py <= g.bottom;
}

// ---------- drawing ----------
//
// The same instrument as the clock, laid out straight: a heavy ink frame with
// a hard shadow, the lane as the clock's ring (targets solid across it, ink
// edges), the channel as its face, with the hours ticked in from both sides.
// Down the channel runs the slot the knob slides in; the wooden stem fills it
// from home to the knob, so the swing reads as a gauge from across the
// screen. Home is a hub in the groove (the clock's), marked across the body
// and by an index in the lane, and the prompt is a tab hung off the body there.
// Each end is a stop: past it the face is shaded and the lane carries a peg.

// Every x the drawing uses, once, from the geometry: the lane may be on
// either side of the channel, and the tab hangs on the lane's side.
function columns(g) {
  const laneFirst = g.side !== "left"; // the lane is on the left, toward the centre
  const in0 = g.left + g.fr;
  const in1 = g.right - g.fr;
  return {
    in0,
    in1,
    div: g.divX,
    lane: laneFirst ? [in0, g.divX] : [g.divX, in1],
    chan: laneFirst ? [g.divX, in1] : [in0, g.divX],
    laneC: laneFirst ? (in0 + g.divX) / 2 : (g.divX + in1) / 2, // inside the frame
    kc: g.cx,
    // the side of the channel away from the lane, and the way out of the
    // body on the lane's side (the tab's)
    far: laneFirst ? in1 : in0,
    out: g.tabDir < 0 ? g.left : g.right,
    dir: g.tabDir,
  };
}

function inner(ctx, g) {
  ctx.beginPath();
  ctx.roundRect(
    g.left + g.fr,
    g.top + g.fr,
    g.w - 2 * g.fr,
    g.bottom - g.top - 2 * g.fr,
    Math.max(1, g.w * tune.corner - g.fr),
  );
}

// A band from arm a0 to a1 across the span [x0, x1].
function band(ctx, g, [x0, x1], a0, a1) {
  const y0 = armY(g, a0);
  const y1 = armY(g, a1);
  ctx.beginPath();
  ctx.rect(x0, Math.min(y0, y1), x1 - x0, Math.abs(y1 - y0));
}

function dots(ctx, g, span, a0, a1, color, step) {
  ctx.save();
  band(ctx, g, span, a0, a1);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.beginPath();
  const y0 = Math.min(armY(g, a0), armY(g, a1));
  const y1 = Math.max(armY(g, a0), armY(g, a1));
  let row = 0;
  for (let y = y0 + step / 2; y < y1 + step; y += step, row++) {
    for (
      let x = span[0] + (row % 2 ? step / 2 : 0);
      x < span[1] + step;
      x += step
    ) {
      ctx.moveTo(x + step * 0.14, y);
      ctx.arc(x, y, step * 0.14, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  ctx.restore();
}

function hatch(ctx, g, span, a0, a1, color, step, weight) {
  ctx.save();
  band(ctx, g, span, a0, a1);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = step * weight;
  ctx.beginPath();
  const y0 = Math.min(armY(g, a0), armY(g, a1));
  const y1 = Math.max(armY(g, a0), armY(g, a1));
  const h = y1 - y0;
  for (let d = -h; d < span[1] - span[0] + h; d += step) {
    ctx.moveTo(span[0] + d, y0);
    ctx.lineTo(span[0] + d + h, y1);
  }
  ctx.stroke();
  ctx.restore();
}

// An ink line across the whole inside at arm a.
function across(ctx, g, c, a, lw) {
  const y = armY(g, a);
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(c.in0, y);
  ctx.lineTo(c.in1, y);
  ctx.stroke();
}

// A target: light across the channel, deep across the lane, ink edges.
function target(ctx, g, c, a0, a1, fill, deep, lw) {
  band(ctx, g, c.chan, a0, a1);
  ctx.fillStyle = fill;
  ctx.fill();
  band(ctx, g, c.lane, a0, a1);
  ctx.fillStyle = deep;
  ctx.fill();
  ctx.strokeStyle = INK;
  across(ctx, g, c, a0, lw);
  across(ctx, g, c, a1, lw);
}

// A dot in the lane: hollow (the last throw) or solid (the live peak).
function laneDot(ctx, g, c, a, r, lw, solid) {
  const y = armY(g, Math.max(-tune.range, Math.min(tune.range, a)));
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.arc(c.laneC, y, r + lw, 0, Math.PI * 2);
  ctx.fill();
  if (solid) {
    ctx.fillStyle = HUD.peak;
    ctx.beginPath();
    ctx.arc(c.laneC, y, r - lw * 0.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw * 1.4;
    ctx.beginPath();
    ctx.arc(c.laneC, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// The prompt: a tab hung off the body on the lane's side at home, its inner
// end tucked under the frame so it is one piece with the body.
function tab(ctx, g, c, y, h, text, inverted) {
  ctx.font = `900 ${Math.round(h * 0.74)}px ${FONT.display}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  const w = ctx.measureText(text).width + h * 0.8;
  const x1 = c.out - c.dir * g.fr * 0.5; // the end under the frame
  const x0 = x1 + c.dir * (w + g.fr * 0.5); // the free end
  const left = Math.min(x0, x1);
  const r = h * 0.22;
  const radii = c.dir < 0 ? [r, 0, 0, r] : [0, r, r, 0];
  const sh = g.sh * 0.8;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.roundRect(left + sh, y - h / 2 + sh, Math.abs(x1 - x0), h, radii);
  ctx.fill();
  ctx.fillStyle = inverted ? INK : HUD.prompt;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.5, h * 0.1);
  ctx.beginPath();
  ctx.roundRect(left, y - h / 2, Math.abs(x1 - x0), h, radii);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = inverted ? PAPER : HUD.promptInk;
  ctx.fillText(text, (x0 + x1) / 2 + (c.dir * g.fr) / 4, y + h * 0.05);
}

export function drawLinear(ctx, rect, st, side = "right") {
  const g = linearGeometry(rect, side);
  const c = columns(g);
  const R = tune.range;
  const lw = Math.max(1, g.w * 0.024);
  const live = st.phase === "winding" || st.phase === "swinging";
  const top = g.top + g.fr;
  const bottom = g.bottom - g.fr;
  const slotW = Math.max(4, g.chanW * tune.slot);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // the body: hard shadow, ink frame
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.roundRect(
    g.left + g.sh,
    g.top + g.sh,
    g.w,
    g.bottom - g.top,
    g.w * tune.corner,
  );
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(g.left, g.top, g.w, g.bottom - g.top, g.w * tune.corner);
  ctx.fill();
  ctx.save();
  inner(ctx, g);
  ctx.clip();

  // the face and the ring
  ctx.fillStyle = st.grabbed ? HUD.knobGrab : HUD.face;
  ctx.fillRect(c.chan[0], top, c.chan[1] - c.chan[0], bottom - top);
  ctx.fillStyle = HUD.ring;
  ctx.fillRect(c.lane[0], top, c.lane[1] - c.lane[0], bottom - top);

  // the zones
  if (st.deadDeg > 0) {
    band(ctx, g, c.chan, -st.deadDeg, 0);
    ctx.fillStyle = HUD.faceShade;
    ctx.fill();
    dots(ctx, g, c.chan, -st.deadDeg, 0, HUD.dead, Math.max(3, g.chanW * 0.14));
  }
  if (st.overDeg != null && st.overDeg < R) {
    hatch(
      ctx,
      g,
      c.chan,
      -R,
      -st.overDeg,
      HUD.over,
      Math.max(3, g.chanW * 0.16),
      0.28,
    );
    band(ctx, g, c.lane, -R, -st.overDeg);
    ctx.fillStyle = HUD.over;
    ctx.fill();
    ctx.strokeStyle = INK;
    across(ctx, g, c, -st.overDeg, lw);
  }
  // the targets: power behind the knob's home, release ahead of it
  if (st.powerHi > st.powerLo)
    target(ctx, g, c, -st.powerHi, -st.powerLo, HUD.power, HUD.powerDeep, lw);
  if (st.releaseHi > st.releaseLo)
    target(
      ctx,
      g,
      c,
      st.releaseLo,
      st.releaseHi,
      HUD.release,
      HUD.releaseDeep,
      lw,
    );

  // the ends: past each stop the face is shaded, with a peg in the lane
  for (const [y0, y1] of [
    [top, g.yF],
    [g.yB, bottom],
  ]) {
    ctx.fillStyle = HUD.faceShade;
    ctx.fillRect(c.in0, y0, c.in1 - c.in0, y1 - y0);
    const py = (y0 + y1) / 2 + (y0 === top ? g.fr * 0.25 : -g.fr * 0.25);
    const pr = Math.min((c.lane[1] - c.lane[0]) * 0.28, (y1 - y0) * 0.28);
    // a wooden peg: the knob's end grain, small
    ctx.fillStyle = HUD.knob;
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(c.laneC, py, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = HUD.hand;
    ctx.beginPath();
    ctx.arc(c.laneC, py, Math.max(0.8, pr * 0.3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = INK;
  across(ctx, g, c, R, lw * 1.6);
  across(ctx, g, c, -R, lw * 1.6);

  // the lane's edge and the hours: ticked in from the lane to the slot, the
  // quarters (3, 9 and the 6 below) right across the face
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(c.div, top);
  ctx.lineTo(c.div, bottom);
  ctx.stroke();
  const inward = Math.sign(c.kc - c.div);
  const rail = c.kc - (inward * slotW) / 2; // the slot's near side
  for (let a = -R + 30; a < R; a += 30) {
    if (a === 0) continue;
    const long = a % 90 === 0;
    const y = armY(g, a);
    ctx.lineWidth = long ? lw * 2 : lw;
    ctx.beginPath();
    ctx.moveTo(c.div, y);
    ctx.lineTo(c.div + (rail - c.div) * (long ? 0.78 : 0.5), y);
    ctx.stroke();
  }

  // the slot the knob runs in, stop to stop: an ink groove
  const sw = slotW;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.roundRect(c.kc - sw / 2, g.yF - sw / 2, sw, g.yB - g.yF + sw, sw / 2);
  ctx.fill();

  // home: the line a throw is flung through and the six's index in the lane
  ctx.strokeStyle = INK;
  across(ctx, g, c, 0, lw * 2.4);
  const ix = (c.lane[1] - c.lane[0]) * 0.42;
  const iTip = c.div;
  const iBase = c.div - inward * ix;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(iTip, g.y0);
  ctx.lineTo(iBase, g.y0 - ix * 0.85);
  ctx.lineTo(iBase, g.y0 + ix * 0.85);
  ctx.closePath();
  ctx.fill();
  // the hub: the groove widens round home, where the stem starts
  ctx.beginPath();
  ctx.arc(c.kc, g.y0, slotW * tune.hub, 0, Math.PI * 2);
  ctx.fill();

  // the last throw's dots and the live peak, in the lane
  const dr = g.laneW * tune.dot;
  if (st.lastBack != null) laneDot(ctx, g, c, -st.lastBack, dr, lw, false);
  if (st.lastStop != null) laneDot(ctx, g, c, st.lastStop, dr, lw, false);
  if (live && st.back > 0)
    laneDot(ctx, g, c, -Math.min(R, st.back), dr, lw, true);

  // the arm and its knob: the thing you grab. At rest the knob is home;
  // held, it is where the pointer has it, the dead zone included.
  const raw = live ? (st.arm ?? 0) : st.grabbed ? (st.crank ?? 0) : 0;
  const arm = Math.max(-R, Math.min(R, raw));
  const ky = armY(g, arm);
  const kr = g.kr * (st.grabbed ? 1.08 : 1);
  if (st.grabbed) {
    // the glow lights the channel round the knob, its full width and
    // rounded at the ends: it stays out of the lane, which is for reading
    const cw = c.chan[1] - c.chan[0];
    ctx.fillStyle = HUD.glow;
    ctx.beginPath();
    ctx.roundRect(c.chan[0], ky - kr * 1.7, cw, kr * 3.4, cw * 0.5);
    ctx.fill();
  }
  // the stem: wood in the slot from home to the knob
  if (Math.abs(ky - g.y0) > 1) {
    const stW = sw - lw * 1.3;
    ctx.fillStyle = HUD.hand;
    ctx.beginPath();
    ctx.roundRect(
      c.kc - stW / 2,
      Math.min(ky, g.y0) - stW / 2,
      stW,
      Math.abs(ky - g.y0) + stW,
      stW / 2,
    );
    ctx.fill();
  }
  ctx.restore(); // the body's clip

  // the knob: a little baton end, wood with an ink rim and end-grain rings
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(c.kc + kr * 0.18, ky + kr * 0.18, kr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = st.grabbed ? HUD.knobGrab : HUD.knob;
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw * 1.8;
  ctx.beginPath();
  ctx.arc(c.kc, ky, kr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = HUD.hand;
  ctx.lineWidth = lw * 0.8;
  ctx.beginPath();
  ctx.arc(c.kc, ky, kr * 0.62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c.kc, ky, kr * 0.36, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = HUD.hand;
  ctx.beginPath();
  ctx.arc(c.kc, ky, kr * 0.14, 0, Math.PI * 2);
  ctx.fill();

  if (st.prompt)
    tab(ctx, g, c, g.y0, g.promptH, st.prompt, st.prompt.endsWith("!"));
  ctx.restore();
  return g;
}
