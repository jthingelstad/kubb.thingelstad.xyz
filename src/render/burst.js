// The hit bursts (render/burst.lua, docs/design "Hit effects") as vectors:
// clean "TOK!", double "KLAK KLAK!" (the second star three frames after the
// first), king "KING!" wearing the crown.
//
// drawBurst(ctx, x, y, kind, phaseTime, opts) draws the burst for a hit at
// (x, y) (CSS px, the ctx's current transform) phaseTime seconds after it
// started: the flash, then the burst with its word, then the break-up into
// chips. The burst sits up and to the left of the hit with its long spike's
// tip on it. opts.size is the star's width in px (default 150). Returns
// false once the burst is over. The king's flash inverts the whole canvas.
import { INK, BURST, FONT } from "./palette.js";

export const tune = {
  flash: 2 / 30, // s (the Playdate's 2 frames at 30 fps)
  burst: 12 / 30,
  breakup: 4 / 30,
  second: 3 / 30, // the double's second star, after the first
  points: 11, // the star's spikes
  chips: 9,
  pop: 0.06, // s: the star grows in over this
};

export const BURSTS = {
  clean: { words: ["TOK!"] },
  double: { words: ["KLAK", "KLAK!"] },
  king: { words: ["KING!"], crown: true },
};

export function burstLength(kind) {
  return (
    tune.flash +
    tune.burst +
    tune.breakup +
    (kind === "double" ? tune.second : 0)
  );
}

function rnd(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

// A star's outline: spikes of varying length round (cx, cy), one long spike
// pointing down and right (toward the hit) whose tip is at (tx, ty).
function starPoints(cx, cy, w, h, seed, tipX, tipY) {
  const r = rnd(seed);
  const n = tune.points;
  const pts = [];
  const tipA = Math.atan2(tipY - cy, tipX - cx);
  for (let i = 0; i < n * 2; i++) {
    const a = tipA + (i / (n * 2)) * Math.PI * 2;
    let x, y;
    if (i === 0) {
      x = tipX;
      y = tipY;
    } else if (i % 2) {
      const k = 0.58 + r() * 0.08;
      x = cx + Math.cos(a) * (w / 2) * k;
      y = cy + Math.sin(a) * (h / 2) * k;
    } else {
      const k = 0.86 + r() * 0.16;
      x = cx + Math.cos(a) * (w / 2) * k;
      y = cy + Math.sin(a) * (h / 2) * k;
    }
    pts.push([x, y]);
  }
  return pts;
}

function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function crown(ctx, cx, by, w) {
  // a three-point crown standing on by
  const h = w * 0.55;
  const pts = [
    [cx - w / 2, by],
    [cx - w / 2, by - h],
    [cx - w / 4, by - h * 0.5],
    [cx, by - h * 1.1],
    [cx + w / 4, by - h * 0.5],
    [cx + w / 2, by - h],
    [cx + w / 2, by],
  ];
  ctx.lineJoin = "round";
  ctx.fillStyle = INK;
  poly(
    ctx,
    pts.map(([x, y]) => [x + w * 0.05, y + w * 0.05]),
  );
  ctx.fill();
  ctx.fillStyle = BURST.crown;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.5, w * 0.06);
  poly(ctx, pts);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  for (const [x, y] of [pts[1], pts[3], pts[5]]) {
    ctx.beginPath();
    ctx.arc(x, y, w * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }
}

// One star with its word, its long spike's tip at (tx, ty).
function star(ctx, tx, ty, size, word, seed, grow, kind) {
  const w = size * grow,
    h = size * 0.78 * grow;
  const cx = tx - size * 0.42,
    cy = ty - size * 0.5;
  const pts = starPoints(cx, cy, w, h, seed, tx, ty);
  const lw = Math.max(2, size * 0.035);
  // the hard shadow, the ink star, the coloured inside
  ctx.lineJoin = "miter";
  ctx.fillStyle = INK;
  poly(
    ctx,
    pts.map(([x, y]) => [x + lw * 1.6, y + lw * 1.6]),
  );
  ctx.fill();
  poly(ctx, pts);
  ctx.fill();
  const inner = pts.map(([x, y]) => [
    cx + (x - cx) * 0.84,
    cy + (y - cy) * 0.84,
  ]);
  ctx.fillStyle = kind === "king" ? BURST.kingInner : BURST.inner;
  poly(ctx, inner);
  ctx.fill();
  // the word, upright Londrina Solid Black, white in an ink edge
  let fs = size * 0.27;
  ctx.font = `900 ${fs}px ${FONT.display}`;
  const maxW = w * 0.66;
  const mw = ctx.measureText(word).width;
  if (mw > maxW) {
    fs *= maxW / mw;
    ctx.font = `900 ${fs}px ${FONT.display}`;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.strokeStyle = INK;
  ctx.lineWidth = fs * 0.13;
  ctx.strokeText(word, cx, cy + fs * 0.06);
  ctx.fillStyle = BURST.word;
  ctx.fillText(word, cx, cy + fs * 0.06);
  if (kind === "king") crown(ctx, cx, cy - fs * 0.5, size * 0.3 * grow);
  return { cx, cy, w, h, pts };
}

function chips(ctx, tx, ty, size, t, seed) {
  // the break-up: the star gone, chips of wood and ink flying out
  const r = rnd(seed * 7 + 3);
  const cx = tx - size * 0.42,
    cy = ty - size * 0.5;
  const k = t; // 0..1 through the break-up
  for (let i = 0; i < tune.chips; i++) {
    const a = r() * Math.PI * 2;
    const d = size * (0.25 + r() * 0.35) * (0.5 + k);
    const s = size * (0.05 + r() * 0.05) * (1 - k * 0.6);
    const x = cx + Math.cos(a) * d,
      y = cy + Math.sin(a) * d * 0.8 + k * k * size * 0.25;
    const rot = r() * Math.PI + k * (r() - 0.5) * 6;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.fillStyle = INK;
    ctx.fillRect(-s / 2 + 1.5, -s * 0.35 + 1.5, s, s * 0.7);
    ctx.fillStyle = BURST.chip[i % BURST.chip.length];
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, s * 0.12);
    ctx.fillRect(-s / 2, -s * 0.35, s, s * 0.7);
    ctx.strokeRect(-s / 2, -s * 0.35, s, s * 0.7);
    ctx.restore();
  }
}

function flash(ctx, x, y, size, t) {
  // a pale disc with ink rays round the hit
  const r = size * (0.25 + 0.35 * t);
  ctx.fillStyle = BURST.flash;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, size * 0.03);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    ctx.moveTo(x + Math.cos(a) * r * 1.15, y + Math.sin(a) * r * 1.15);
    ctx.lineTo(x + Math.cos(a) * r * 1.6, y + Math.sin(a) * r * 1.6);
  }
  ctx.stroke();
}

function invertCanvas(ctx) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "difference";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

// One star's phases at time t since it began.
function one(ctx, x, y, size, kind, word, t, seed) {
  if (t < 0) return;
  if (t < tune.flash) {
    flash(ctx, x, y, size, t / tune.flash);
    return;
  }
  t -= tune.flash;
  if (t < tune.burst) {
    const grow =
      t < tune.pop
        ? 0.7 + 0.3 * (t / tune.pop) + 0.08 * Math.sin((t / tune.pop) * Math.PI)
        : 1;
    star(ctx, x, y, size, word, seed, grow, kind);
    return;
  }
  t -= tune.burst;
  if (t < tune.breakup) chips(ctx, x, y, size, t / tune.breakup, seed);
}

export function drawBurst(ctx, x, y, kind, phaseTime, opts = {}) {
  const B = BURSTS[kind] || BURSTS.clean;
  const size = opts.size || 150;
  const t = phaseTime;
  if (t < 0 || t >= burstLength(kind)) return false;
  ctx.save();
  if (kind === "king" && t < tune.flash) invertCanvas(ctx);
  if (kind === "double") {
    // KLAK on the first kubb, KLAK! up and to its right a beat later
    one(ctx, x, y, size * 0.82, kind, B.words[0], t, 11);
    one(
      ctx,
      x + size * 0.5,
      y - size * 0.3,
      size * 0.82,
      kind,
      B.words[1],
      t - tune.second,
      23,
    );
  } else {
    one(ctx, x, y, size, kind, B.words[0], t, kind === "king" ? 31 : 7);
  }
  ctx.restore();
  return true;
}
