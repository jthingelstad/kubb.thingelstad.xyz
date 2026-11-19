// The throw's nudge drawn over the meter on the screen (src/game/nudge.js
// says when and what): a ghost of the knob making one good throw, and a
// ghost fingertip (or a mouse pointer) showing where the finger goes and
// when it presses and lets go. Drawn from the meters' public geometry, over
// the real meter, whose own knob stays at home under it. Drawing only.
//
// drawNudge(ctx, L, f, opts)
//   L     the Game's layout (layoutFor): meter, dial (the meter's box),
//         meterSide, track, H
//   f     the timeline's frame { arm, step, press, ring, alpha } with the
//         trigger's fade folded into alpha
//   opts  { swing: { back, release }, finger: "touch" | "mouse",
//           zoneFrom: the throw zone's top, of the canvas height,
//           caption: the plate's words, for its width }
import { INK, PAPER, HUD, FONT } from "./palette.js";
import { dialGeometry, armPoint, tune as dialTune } from "./dial.js";
import { linearGeometry, armY, tune as linearTune } from "./linear.js";

export const tune = {
  ghostFill: 0.45, // the ghost knob's paper, alpha
  ghostLine: 0.85, // its dashed ink rim and arm, alpha
  dash: [5, 4], // px: the ghost's dashes
  finger: 19, // px: the fingertip's radius on touch (a finger pad, about 10 mm across)
  pointer: 26, // px: the mouse pointer's height
  fingerFill: 0.82, // the fingertip's paper, alpha
  lift: 0.7, // the fingertip's rise before it presses, of its radius
  shadow: 0.22, // the fingertip's hard shadow when down, of its radius
  zoneGap: 12, // px between the plate (or the plan buttons) and the fingertip's path
  planBlock: 206, // px: a wide canvas's plan (sliders, SIDE VIEW, STAND), a block beside the meter (hud.js, game.css)
  arrow: 3, // px: the still picture's arrows
};

// Where the fingertip is for the frame, in CSS px: { x, y }.
export function fingerAt(L, f, opts) {
  if (L.meter === "linear") {
    const g = linearGeometry(L.dial, L.meterSide);
    // a mouse grabs the knob: its pointer rides the ghost. (The still
    // picture keeps the zone's, where its arrows have room.)
    if (opts.finger === "mouse" && f.step !== "still")
      return { x: g.cx, y: armY(g, clampArm(f.arm)) };
    const z = zonePath(L, g, opts);
    return { x: z.x, y: z.y0 + (armY(g, clampArm(f.arm)) - g.y0) };
  }
  const g = dialGeometry(L.dial);
  const R = L.track
    ? (g.r * (dialTune.trackIn + dialTune.trackOut)) / 2
    : g.r * dialTune.hand;
  const [x, y] = armPoint(g, f.arm, R);
  return { x, y };
}

const clampArm = (a) =>
  Math.max(-linearTune.range, Math.min(linearTune.range, a));

// The fingertip's path on the linear meter: in the throw zone, on the
// meter's inner side, clear of the prompt tab at the knob's home and of the
// plan buttons (DOM, over the canvas: hud.js place), starting low enough
// that the whole draw back fits on the screen. On a tall canvas the plan
// buttons hug the edges of what the meter leaves, so the path is in the
// middle of it (where a thumb strokes); on a wide one they stand in a block
// beside the meter, so the path is past them.
function zonePath(L, g, opts) {
  const R = tune.finger;
  const d = L.dial;
  const safe = L.safe || {};
  const right = g.tabDir < 0; // the meter at the right edge
  const plateW = opts.plateW ?? g.promptH * 5;
  // the tab's far edge, which the fingertip keeps clear of
  const tab = right
    ? g.left - g.fr * 2 - plateW - tune.zoneGap - R
    : g.right + g.sh + g.fr * 2 + plateW + tune.zoneGap + R;
  let x;
  if (L.tall) {
    x = right
      ? ((safe.left || 0) + 8 + d.x - 6) / 2
      : (d.x + d.width + 6 + L.W - (safe.right || 0) - 8) / 2;
  } else {
    x = right
      ? d.x - 6 - tune.planBlock - tune.zoneGap - R
      : d.x + d.width + 6 + tune.planBlock + tune.zoneGap + R;
  }
  x = right ? Math.min(x, tab) : Math.max(x, tab);
  const backPx = Math.abs(opts.swing.back) * g.scale;
  const zoneTop = L.H * (opts.zoneFrom ?? 0.6);
  let y0 = Math.max(zoneTop + R + 4, g.y0);
  y0 = Math.min(y0, L.H - R - 8 - backPx);
  return { x, y0: Math.max(zoneTop + 2, y0) };
}

function plateWidth(ctx, g, text) {
  if (!text) return 0;
  ctx.save();
  ctx.font = `900 ${Math.round(g.promptH * 0.78)}px ${FONT.display}`;
  const w = ctx.measureText(text).width + g.promptH * 0.9;
  ctx.restore();
  return w;
}

export function drawNudge(ctx, L, f, opts) {
  if (!(f.alpha > 0)) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, f.alpha);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const still = f.step === "still";
  if (L.meter === "linear") {
    const g = linearGeometry(L.dial, L.meterSide);
    const o = { ...opts, plateW: plateWidth(ctx, g, opts.caption) };
    linearGhost(ctx, g, f.arm);
    if (still) linearArrows(ctx, L, g, o);
    fingertip(ctx, fingerAt(L, f, o), f, opts.finger);
  } else {
    const g = dialGeometry(L.dial);
    clockGhost(ctx, g, f.arm);
    if (still) clockArrows(ctx, g, opts.swing, L.track);
    fingertip(ctx, fingerAt(L, f, opts), f, opts.finger);
  }
  ctx.restore();
}

// ---------- the ghost knob ----------

function ghostKnob(ctx, x, y, kr, lw) {
  ctx.fillStyle = PAPER;
  ctx.globalAlpha *= tune.ghostFill;
  ctx.beginPath();
  ctx.arc(x, y, kr, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha /= tune.ghostFill;
  ctx.save();
  ctx.globalAlpha *= tune.ghostLine;
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.setLineDash(tune.dash);
  ctx.beginPath();
  ctx.arc(x, y, kr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(x, y, kr * 0.16, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.restore();
}

function ghostArm(ctx, x0, y0, x1, y1, lw) {
  ctx.save();
  ctx.globalAlpha *= tune.ghostLine;
  ctx.strokeStyle = INK;
  ctx.lineWidth = lw;
  ctx.setLineDash(tune.dash);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

function clockGhost(ctx, g, arm) {
  const lw = Math.max(1.5, g.r * 0.03);
  const kr = g.r * dialTune.knob;
  const [hx, hy] = armPoint(g, arm, g.r * dialTune.hand);
  const [ex, ey] = armPoint(g, arm, g.r * dialTune.hand - kr);
  ghostArm(ctx, g.cx, g.cy, ex, ey, lw);
  ghostKnob(ctx, hx, hy, kr, lw);
}

function linearGhost(ctx, g, arm) {
  const lw = Math.max(1.5, g.w * 0.03);
  const ky = armY(g, clampArm(arm));
  if (Math.abs(ky - g.y0) > g.kr)
    ghostArm(ctx, g.cx, g.y0, g.cx, ky + Math.sign(g.y0 - ky) * g.kr, lw);
  ghostKnob(ctx, g.cx, ky, g.kr, lw);
}

// ---------- the fingertip ----------

// A fingertip (touch) or a mouse pointer at p. f.press: 0 lifted, 1 down;
// f.ring: the press cue's ring round it.
function fingertip(ctx, p, f, finger) {
  const R = tune.finger;
  const up = 1 - (f.press ?? 1);
  const x = p.x + up * R * tune.lift * 0.5;
  const y = p.y - up * R * tune.lift;
  if (f.ring && f.ring.a > 0) {
    ctx.save();
    ctx.globalAlpha *= f.ring.a;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, R * f.ring.k, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }
  // the hard shadow falls right and down, farther while lifted
  const sh = R * (tune.shadow + up * 0.5);
  if (finger === "mouse") return pointer(ctx, x, y, sh);
  ctx.save();
  ctx.globalAlpha *= 0.35;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(x + sh, y + sh, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.globalAlpha *= tune.fingerFill;
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI * 2);
  ctx.stroke();
  // the nail's edge, so it reads as a fingertip, not a button
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y - R * 0.18, R * 0.5, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
}

// The classic arrow pointer with its tip at (x, y).
function pointer(ctx, x, y, sh) {
  const s = tune.pointer / 22;
  const pts = [
    [0, 0],
    [0, 18],
    [4.5, 14],
    [8, 21],
    [11, 19.6],
    [7.6, 12.8],
    [13, 12.8],
  ];
  const path = (dx, dy) => {
    ctx.beginPath();
    pts.forEach(([a, b], i) =>
      ctx[i ? "lineTo" : "moveTo"](x + dx + a * s, y + dy + b * s),
    );
    ctx.closePath();
  };
  ctx.save();
  ctx.globalAlpha *= 0.35;
  ctx.fillStyle = INK;
  path(sh * 0.4, sh * 0.4);
  ctx.fill();
  ctx.restore();
  path(0, 0);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.8;
  ctx.stroke();
}

// ---------- the still picture's arrows (reduced motion) ----------

function arrowHead(ctx, x, y, angle, size) {
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(angle) * size, y + Math.sin(angle) * size);
  ctx.lineTo(
    x + Math.cos(angle + 2.5) * size,
    y + Math.sin(angle + 2.5) * size,
  );
  ctx.lineTo(
    x + Math.cos(angle - 2.5) * size,
    y + Math.sin(angle - 2.5) * size,
  );
  ctx.closePath();
  ctx.fill();
}

// An arrow along the dial from arm a0 to a1 at radius R.
function arcArrow(ctx, g, R, a0, a1, color) {
  const c = (a) => ((90 - a) * Math.PI) / 180;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = tune.arrow;
  ctx.beginPath();
  ctx.arc(g.cx, g.cy, R, c(a0), c(a1), a1 > a0);
  ctx.stroke();
  const [x, y] = armPoint(g, a1, R);
  // the tangent in the direction of travel
  const s = a1 > a0 ? 1 : -1;
  const t = c(a1) - (s * Math.PI) / 2;
  arrowHead(ctx, x, y, t, tune.arrow * 3);
}

function clockArrows(ctx, g, swing, track) {
  const back = -Math.abs(swing.back);
  const fwd = Math.abs(swing.release);
  const R1 = g.r * (track ? 1.05 : 1.08);
  const R2 = g.r * (track ? 1.62 : 1.2);
  arcArrow(ctx, g, R1, -6, back + 4, HUD.powerDeep);
  arcArrow(ctx, g, R2, back, fwd - 4, HUD.releaseDeep);
}

function lineArrow(ctx, x, y0, y1, color) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = tune.arrow;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.stroke();
  arrowHead(ctx, x, y1, y1 > y0 ? Math.PI / 2 : -Math.PI / 2, tune.arrow * 3);
}

function linearArrows(ctx, L, g, opts) {
  const z = zonePath(L, g, opts);
  const R = tune.finger;
  const back = z.y0 + Math.abs(opts.swing.back) * g.scale;
  const fwd = z.y0 - Math.abs(opts.swing.release) * g.scale;
  lineArrow(ctx, z.x - R * 1.7, z.y0, back - 4, HUD.powerDeep);
  lineArrow(ctx, z.x + R * 1.7, back, fwd + 4, HUD.releaseDeep);
}
