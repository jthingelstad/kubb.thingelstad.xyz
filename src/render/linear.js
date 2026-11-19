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
import { INK, PAPER, HUD } from "./palette.js";
import { plate } from "./dial.js";

export const tune = {
  range: 180, // degrees each way: the ends are 12 o'clock
  bodyMax: 88, // px: the body is never wider than this
  lane: 0.3, // the lane's width, of the body's
  knob: 0.4, // the knob's radius, of the channel's width
  frame: 0.045, // the ink frame, of the body's width
  shadow: 0.06, // the hard drop shadow, of the body's width
  corner: 0.2, // the body's corner radius, of its width
  tick: 0.2, // an hour's tick, of the channel's width
  tickLong: 0.36, // 6, 3, 9 and 12
  dot: 0.26, // a last-throw dot's radius, of the lane's width
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
export function linearGeometry(rect) {
  const w = Math.min(tune.bodyMax, rect.width * 0.92);
  const sh = w * tune.shadow;
  const fr = Math.max(1.5, w * tune.frame);
  const right = rect.x + rect.width - sh;
  const left = right - w;
  const laneW = w * tune.lane;
  const chanX = left + laneW;
  const chanW = w - laneW;
  const kr = chanW * tune.knob;
  const promptH = Math.max(tune.promptMin, w * tune.promptH);
  const top = rect.y;
  const bottom = rect.y + rect.height - sh;
  const cap = kr + fr * 2;
  const yF = top + cap;
  const yB = bottom - cap;
  return {
    left,
    right,
    top,
    bottom,
    w,
    sh,
    fr,
    laneW,
    chanX,
    chanW,
    cx: chanX + chanW / 2,
    laneX: left + laneW / 2,
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

function body(ctx, g, dx = 0, dy = 0, inset = 0) {
  ctx.beginPath();
  ctx.roundRect(
    g.left + inset + dx,
    g.top + inset + dy,
    g.w - 2 * inset,
    g.bottom - g.top - 2 * inset,
    Math.max(1, g.w * tune.corner - inset),
  );
}

// A band from arm a0 to a1 across x..x+w.
function band(ctx, g, x, w, a0, a1) {
  const y1 = armY(g, a0);
  const y0 = armY(g, a1);
  ctx.beginPath();
  ctx.rect(x, Math.min(y0, y1), w, Math.abs(y1 - y0));
}

function dots(ctx, g, a0, a1, color, step) {
  ctx.save();
  band(ctx, g, g.chanX, g.chanW, a0, a1);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.beginPath();
  let row = 0;
  for (let y = g.top; y < g.bottom; y += step, row++) {
    for (let x = g.chanX + (row % 2 ? step / 2 : 0); x < g.right; x += step) {
      ctx.moveTo(x + step * 0.14, y);
      ctx.arc(x, y, step * 0.14, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  ctx.restore();
}

function hatch(ctx, g, a0, a1, color, step) {
  ctx.save();
  band(ctx, g, g.chanX, g.chanW, a0, a1);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = step * 0.35;
  ctx.beginPath();
  const h = g.bottom - g.top;
  for (let d = -h; d < g.chanW + h; d += step) {
    ctx.moveTo(g.chanX + d, g.top);
    ctx.lineTo(g.chanX + d + h, g.bottom);
  }
  ctx.stroke();
  ctx.restore();
}

// A target: light across the channel, deep across the lane, ink edges.
function target(ctx, g, a0, a1, fill, deep, lw) {
  band(ctx, g, g.chanX, g.chanW, a0, a1);
  ctx.fillStyle = fill;
  ctx.fill();
  band(ctx, g, g.left, g.laneW, a0, a1);
  ctx.fillStyle = deep;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.beginPath();
  for (const a of [a0, a1]) {
    ctx.moveTo(g.left, armY(g, a));
    ctx.lineTo(g.right, armY(g, a));
  }
  ctx.stroke();
}

export function drawLinear(ctx, rect, st) {
  const g = linearGeometry(rect);
  const R = tune.range;
  const lw = Math.max(1, g.w * 0.024);
  const live = st.phase === "winding" || st.phase === "swinging";
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // the body: hard shadow, ink frame, the lane and the channel
  ctx.fillStyle = INK;
  body(ctx, g, g.sh, g.sh);
  ctx.fill();
  body(ctx, g);
  ctx.fill();
  ctx.save();
  body(ctx, g, 0, 0, g.fr);
  ctx.clip();
  ctx.fillStyle = st.grabbed ? HUD.knobGrab : HUD.face;
  ctx.fillRect(g.left, g.top, g.w, g.bottom - g.top);
  ctx.fillStyle = HUD.ring;
  ctx.fillRect(g.left, g.top, g.laneW, g.bottom - g.top);

  // the zones
  if (st.deadDeg > 0) {
    band(ctx, g, g.chanX, g.chanW, -st.deadDeg, 0);
    ctx.fillStyle = HUD.faceShade;
    ctx.fill();
    dots(ctx, g, -st.deadDeg, 0, HUD.dead, Math.max(3, g.chanW * 0.14));
  }
  if (st.overDeg != null && st.overDeg < R) {
    hatch(ctx, g, -R - 20, -st.overDeg, HUD.over, Math.max(3, g.chanW * 0.16));
    band(ctx, g, g.left, g.laneW, -R - 20, -st.overDeg);
    ctx.fillStyle = HUD.over;
    ctx.fill();
  }
  // the targets: power behind the knob's home, release ahead of it
  if (st.powerHi > st.powerLo)
    target(ctx, g, -st.powerHi, -st.powerLo, HUD.power, HUD.powerDeep, lw);
  if (st.releaseHi > st.releaseLo)
    target(
      ctx,
      g,
      st.releaseLo,
      st.releaseHi,
      HUD.release,
      HUD.releaseDeep,
      lw,
    );

  // the lane's edge and the hours
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(g.chanX, g.top);
  ctx.lineTo(g.chanX, g.bottom);
  ctx.stroke();
  for (let a = -R; a <= R; a += 30) {
    if (a === 0) continue;
    const long = a % 90 === 0;
    const y = armY(g, a);
    ctx.lineWidth = long ? lw * 2 : lw;
    ctx.beginPath();
    ctx.moveTo(g.chanX + lw, y);
    ctx.lineTo(g.chanX + g.chanW * (long ? tune.tickLong : tune.tick), y);
    ctx.stroke();
  }
  // the knob's home: the line a throw is flung through
  ctx.lineWidth = lw * 2.4;
  ctx.beginPath();
  ctx.moveTo(g.left, g.y0);
  ctx.lineTo(g.right, g.y0);
  ctx.stroke();

  // the last throw's dots and the live peak, in the lane
  const dr = g.laneW * tune.dot;
  for (const a of [st.lastBack != null ? -st.lastBack : null, st.lastStop]) {
    if (a == null) continue;
    const y = armY(g, Math.max(-R, Math.min(R, a)));
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    ctx.arc(g.laneX, y, dr + lw, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = lw * 1.4;
    ctx.beginPath();
    ctx.arc(g.laneX, y, dr, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (live && st.back > 0) {
    const y = armY(g, -Math.min(R, st.back));
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    ctx.arc(g.laneX, y, dr + lw, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = HUD.peak;
    ctx.beginPath();
    ctx.arc(g.laneX, y, dr - lw * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore(); // the body's clip

  // the arm and its knob: the thing you grab. At rest the knob is home;
  // held, it is where the pointer has it, the dead zone included.
  const raw = live ? (st.arm ?? 0) : st.grabbed ? (st.crank ?? 0) : 0;
  const arm = Math.max(-R, Math.min(R, raw));
  const ky = armY(g, arm);
  const kr = g.kr * (st.grabbed ? 1.08 : 1);
  if (st.grabbed) {
    // the glow stays in the channel: the lane beside it is for reading
    ctx.save();
    ctx.beginPath();
    ctx.rect(
      g.chanX,
      g.top + g.fr,
      g.right - g.fr - g.chanX,
      g.bottom - g.top - 2 * g.fr,
    );
    ctx.clip();
    ctx.fillStyle = HUD.glow;
    ctx.beginPath();
    ctx.arc(g.cx, ky, kr * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (Math.abs(ky - g.y0) > 1) {
    const armW = live || st.grabbed ? g.chanW * 0.13 : g.chanW * 0.09;
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = armW + lw * 2.4;
    ctx.beginPath();
    ctx.moveTo(g.cx, g.y0);
    ctx.lineTo(g.cx, ky);
    ctx.stroke();
    ctx.strokeStyle = INK;
    ctx.lineWidth = armW + lw * 1.2;
    ctx.stroke();
    ctx.strokeStyle = HUD.hand;
    ctx.lineWidth = armW - lw * 0.4;
    ctx.stroke();
  }
  // home's pin
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(g.cx, g.y0, g.chanW * 0.08, 0, Math.PI * 2);
  ctx.fill();
  // the knob: a little baton end, wood with an ink rim and end-grain rings
  ctx.beginPath();
  ctx.arc(g.cx + kr * 0.14, ky + kr * 0.14, kr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = st.grabbed ? HUD.knobGrab : HUD.knob;
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw * 1.6;
  ctx.beginPath();
  ctx.arc(g.cx, ky, kr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = HUD.hand;
  ctx.lineWidth = lw * 0.8;
  ctx.beginPath();
  ctx.arc(g.cx, ky, kr * 0.55, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = HUD.hand;
  ctx.beginPath();
  ctx.arc(g.cx, ky, kr * 0.16, 0, Math.PI * 2);
  ctx.fill();

  // the prompt: a tab on the meter's left at the knob's home, where the eye
  // is and a thumb on the knob is not (it takes none of the track's length)
  if (st.prompt) {
    plate(
      ctx,
      g.left,
      g.y0,
      g.promptH,
      st.prompt,
      st.prompt.endsWith("!"),
      g.left - g.fr * 2,
    );
  }
  ctx.restore();
  return g;
}
