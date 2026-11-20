// What the reel writes over the pitch, in the game's own look ("Woodcut in color",
// docs/DESIGN.md section 6; the share image in src/site/art.mjs): ink plates with a hard
// ink shadow, paper and wood type, the team colours of src/render/palette.js, Londrina
// Solid Black for display and Inter for the address. Never italic.
//
// Every function draws on a 2D context in output pixels for one format's layout
// (`layoutFor`), which keeps text out of the parts of a tall frame that TikTok, Shorts
// and Reels cover with their own buttons and captions: the top 14% and the bottom 20%,
// and the right edge where the like and share buttons stand.
import { TEAM, INK, PAPER } from "../../src/render/palette.js";
import { COLORS } from "../../src/site/art.mjs";

export const DISPLAY = '"Londrina Solid"';
export const LABEL = "Inter";

export function layoutFor(format, W, H) {
  if (format === "tall")
    return {
      W,
      H,
      left: Math.round(W * 0.06),
      right: Math.round(W * 0.84), // the platforms' buttons stand to the right of this
      top: Math.round(H * 0.14) + 24,
      bottom: Math.round(H * 0.8) - 28,
      caption: 74,
      kicker: 38,
      score: 58,
      tag: 42,
      unit: W / 1080,
    };
  return {
    W,
    H,
    left: Math.round(W * 0.05),
    right: Math.round(W * 0.95),
    top: Math.round(H * 0.07),
    bottom: Math.round(H * 0.91),
    caption: 72,
    kicker: 36,
    score: 52,
    tag: 38,
    unit: W / 1920,
  };
}

const font = (size, face = DISPLAY, weight = 900) =>
  `${weight} ${Math.round(size)}px ${face}`;

// Split text into lines no wider than `width`.
export function wrap(ctx, text, width) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// A plate: the ink shadow, the fill, an ink edge.
export function plate(ctx, x, y, w, h, fill, { shadow = 8, edge = 4 } = {}) {
  ctx.fillStyle = INK;
  ctx.fillRect(x + shadow, y + shadow, w, h);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  if (edge) {
    ctx.lineWidth = edge;
    ctx.strokeStyle = INK;
    ctx.strokeRect(x + edge / 2, y + edge / 2, w - edge, h - edge);
  }
}

// Text on a plate sized to it; returns the plate's box.
export function textPlate(ctx, text, x, y, size, fill, ink, opts = {}) {
  ctx.font = font(size, opts.face, opts.weight);
  const padX = size * 0.4;
  const h = Math.round(size * 1.28);
  const w = Math.round(ctx.measureText(text).width + padX * 2);
  const left =
    opts.align === "center" ? x - w / 2 : opts.align === "right" ? x - w : x;
  plate(ctx, left, y, w, h, fill, opts);
  ctx.fillStyle = ink;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillText(text, left + padX, y + h * 0.78);
  return { x: left, y, w, h };
}

// Type cut from wood: an ink outline and a hard shadow round a wood fill.
export function woodText(
  ctx,
  text,
  x,
  y,
  size,
  fill = COLORS.wood,
  align = "center",
) {
  ctx.font = font(size);
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  const s = size * 0.06;
  ctx.lineWidth = size * 0.1;
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.strokeText(text, x + s, y + s);
  ctx.fillText(text, x + s, y + s);
  ctx.lineWidth = size * 0.08;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

const team = (side) => TEAM[side] || { fill: PAPER, text: INK };
const up = (s) => String(s ?? "").toUpperCase();

// The caption of a moment: its team's colour on the left, the words on paper, and the
// turn above. Sits on the lower edge of the safe area. `a` fades it in (0..1).
export function caption(ctx, L, { text, side, turn, a = 1 }) {
  if (!text) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, a));
  const size = L.caption;
  ctx.font = font(size);
  const chip = Math.round(size * 0.32);
  const pad = size * 0.42;
  const maxW = L.right - L.left - chip - pad * 2;
  const lines = wrap(ctx, up(text), maxW);
  const lineH = size * 1.06;
  const h = Math.round(lines.length * lineH + size * 0.42);
  const w = Math.round(
    Math.max(...lines.map((l) => ctx.measureText(l).width)) + chip + pad * 2,
  );
  const y = L.bottom - h;
  // the kicker: the turn
  if (turn != null)
    textPlate(
      ctx,
      `TURN ${turn}`,
      L.left,
      y - L.kicker * 1.28 - 14,
      L.kicker,
      INK,
      PAPER,
      {
        shadow: 0,
        edge: 0,
      },
    );
  plate(ctx, L.left, y, w, h, PAPER);
  ctx.fillStyle = team(side).fill;
  ctx.fillRect(L.left + 4, y + 4, chip, h - 8);
  ctx.fillStyle = INK;
  ctx.fillRect(L.left + 4 + chip, y + 4, 4, h - 8);
  ctx.font = font(size);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  lines.forEach((l, i) =>
    ctx.fillText(
      l,
      L.left + chip + pad,
      y + size * 0.2 + lineH * i + size * 0.86,
    ),
  );
  ctx.restore();
}

// The running score: the kubbs still standing in each team's half (fewer is better:
// a team must topple every kubb in the other half before the king).
export function scoreLine(ctx, L, { teams, standing }) {
  if (!standing) return;
  const size = L.score;
  let x = L.left;
  const y = L.top;
  const label = textPlate(ctx, "STANDING", x, y, size * 0.72, INK, PAPER, {
    shadow: 0,
    edge: 0,
  });
  x += label.w + 12;
  for (const side of ["A", "B"]) {
    const t = team(side);
    const box = textPlate(
      ctx,
      `${up(teams?.[side] ?? side)} ${standing[side]}`,
      x,
      y - (size - size * 0.72) * 0.64,
      size,
      t.fill,
      t.text,
      { shadow: 6 },
    );
    x += box.w + 18;
  }
}

// SLOW MOTION, REPLAY: a small ink tag under the score line.
export function tag(ctx, L, text) {
  if (!text) return;
  textPlate(
    ctx,
    text,
    L.left,
    L.top + L.score * 1.28 + 22,
    L.tag,
    INK,
    COLORS.wood,
    {
      shadow: 0,
      edge: 0,
    },
  );
}

// A wash of paper over the pitch for the cards.
export function wash(ctx, L, a = 0.78) {
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, L.W, L.H);
  ctx.restore();
}

// The title card: the game's name, the two teams, HIGHLIGHTS.
export function titleCard(ctx, L, { teams, a = 1 }) {
  wash(ctx, L, 0.8 * a);
  ctx.save();
  ctx.globalAlpha = a;
  const cx = L.W / 2;
  const u = L.unit;
  const tall = L.H > L.W;
  const top = tall ? L.top + 40 * u : L.top + 30 * u;
  textPlate(
    ctx,
    "KUBB: THROWING WOOD",
    cx,
    top,
    (tall ? 62 : 58) * u,
    INK,
    PAPER,
    {
      align: "center",
    },
  );
  const big = (tall ? 200 : 190) * u;
  const hy = top + (tall ? 330 : 280) * u;
  woodText(ctx, "HIGHLIGHTS", cx, hy, big);
  const ny = hy + (tall ? 120 : 90) * u;
  const nsize = (tall ? 96 : 84) * u;
  if (tall) {
    textPlate(
      ctx,
      up(teams?.A ?? "Team A"),
      cx,
      ny,
      nsize,
      TEAM.A.fill,
      TEAM.A.text,
      {
        align: "center",
      },
    );
    woodText(ctx, "VS", cx, ny + nsize * 2.25, nsize * 0.8, PAPER);
    textPlate(
      ctx,
      up(teams?.B ?? "Team B"),
      cx,
      ny + nsize * 2.6,
      nsize,
      TEAM.B.fill,
      TEAM.B.text,
      {
        align: "center",
      },
    );
  } else {
    ctx.font = font(nsize);
    const gap = nsize * 1.3;
    textPlate(
      ctx,
      up(teams?.A ?? "Team A"),
      cx - gap / 2,
      ny,
      nsize,
      TEAM.A.fill,
      TEAM.A.text,
      {
        align: "right",
      },
    );
    woodText(ctx, "VS", cx, ny + nsize * 0.98, nsize * 0.7, PAPER);
    textPlate(
      ctx,
      up(teams?.B ?? "Team B"),
      cx + gap / 2,
      ny,
      nsize,
      TEAM.B.fill,
      TEAM.B.text,
    );
  }
  ctx.restore();
}

// The end card's QR plate: the symbol's modules in ink on a paper plate, a quiet zone
// of four modules inside its ink edge, every module a whole number of pixels. Its box.
export const QR_QUIET = 4;
export function qrPlateSize(qr, px, edge = 4) {
  return (qr.size + QR_QUIET * 2) * px + edge * 2;
}

export function qrPlate(ctx, qr, x, y, px, { edge = 4, shadow = 8 } = {}) {
  if (!(Number.isInteger(px) && px > 0)) throw new Error("QR module size");
  x = Math.round(x);
  y = Math.round(y);
  const S = qrPlateSize(qr, px, edge);
  plate(ctx, x, y, S, S, PAPER, { shadow, edge });
  ctx.fillStyle = INK;
  const o = edge + QR_QUIET * px;
  for (let r = 0; r < qr.size; r++)
    for (let c = 0; c < qr.size; c++)
      if (qr.modules[r][c])
        ctx.fillRect(x + o + c * px, y + o + r * px, px, px);
  return { x, y, w: S, h: S };
}

// Pixels per module: as many as fit `target` pixels across the symbol and its quiet
// zone, never under `min` (docs/REEL.md "The end card").
export const qrModule = (qr, target, min = 10) =>
  Math.max(min, Math.floor(target / (qr.size + QR_QUIET * 2)));

// The QR plate's side in each format, as a target (qrModule rounds it down to whole
// modules): about 410 px across a tall frame's 1080, 460 px of a wide frame's 1080 high.
export const QR_TARGET = { tall: 410, wide: 460 };

// Shrinks a size so `text` in `face` fits `width`.
function fitSize(ctx, text, size, width, face, weight) {
  ctx.font = font(size, face, weight);
  const w = ctx.measureText(text).width;
  return w > width ? (size * width) / w : size;
}

// The end card: who won and how, and where to watch the whole match. With `qr` (an
// encodeQr symbol of the address's https:// link), its code beside the address in a
// wide frame and above it in a tall one; without one, the card as it was.
export function endCard(ctx, L, { winner, teams, line, address, qr, a = 1 }) {
  if (qr)
    return endCardWithCode(ctx, L, { winner, teams, line, address, qr, a });
  wash(ctx, L, 0.84 * a);
  ctx.save();
  ctx.globalAlpha = a;
  const cx = L.W / 2;
  const u = L.unit;
  const tall = L.H > L.W;
  let y = tall ? L.top + 60 * u : L.top + 20 * u;
  textPlate(
    ctx,
    "KUBB: THROWING WOOD",
    cx,
    y,
    (tall ? 58 : 54) * u,
    INK,
    PAPER,
    {
      align: "center",
    },
  );
  y += (tall ? 300 : 250) * u;
  const t = team(winner);
  const name = winner ? up(teams?.[winner] ?? winner) : "";
  if (name) {
    woodText(ctx, name, cx, y, (tall ? 190 : 180) * u, t.fill);
    y += (tall ? 150 : 140) * u;
    woodText(ctx, "WINS", cx, y, (tall ? 140 : 120) * u, COLORS.wood);
  }
  y += (tall ? 70 : 50) * u;
  if (line)
    textPlate(ctx, up(line), cx, y, (tall ? 54 : 50) * u, PAPER, INK, {
      align: "center",
    });
  y += (tall ? 190 : 150) * u;
  ctx.font = font((tall ? 40 : 38) * u);
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.fillText("WATCH THE WHOLE MATCH", cx, y);
  y += (tall ? 30 : 26) * u;
  textPlate(ctx, address, cx, y, (tall ? 50 : 48) * u, INK, PAPER, {
    align: "center",
    face: LABEL,
    weight: 700,
  });
  ctx.restore();
}

// The end card with its QR code. Tall: the card a little higher, the code between the
// line and the address. Wide: the words centred in the room left of the code, which
// stands at the right with its foot level with the address plate's.
function endCardWithCode(ctx, L, { winner, teams, line, address, qr, a }) {
  wash(ctx, L, 0.84 * a);
  ctx.save();
  try {
    drawWithCode(ctx, L, { winner, teams, line, address, qr, a });
  } finally {
    ctx.restore();
  }
}

function drawWithCode(ctx, L, { winner, teams, line, address, qr, a }) {
  ctx.globalAlpha = a;
  const u = L.unit;
  const tall = L.H > L.W;
  const px = qrModule(qr, tall ? QR_TARGET.tall : QR_TARGET.wide);
  const S = qrPlateSize(qr, px);
  const gap = 48 * u;
  const cx = tall ? L.W / 2 : (L.left + (L.right - S - gap)) / 2;
  const room = tall ? L.right - L.left : L.right - S - gap - L.left;
  let y = tall ? L.top + 10 * u : L.top + 20 * u;
  textPlate(
    ctx,
    "KUBB: THROWING WOOD",
    cx,
    y,
    (tall ? 58 : 54) * u,
    INK,
    PAPER,
    {
      align: "center",
    },
  );
  y += (tall ? 300 : 250) * u;
  const t = team(winner);
  const name = winner ? up(teams?.[winner] ?? winner) : "";
  if (name) {
    const size = fitSize(ctx, name, (tall ? 190 : 180) * u, room, DISPLAY, 900);
    woodText(ctx, name, cx, y, size, t.fill);
    y += (tall ? 150 : 140) * u;
    woodText(ctx, "WINS", cx, y, (tall ? 140 : 120) * u, COLORS.wood);
  }
  y += (tall ? 70 : 50) * u;
  if (line) {
    const size = fitSize(
      ctx,
      up(line),
      (tall ? 54 : 50) * u,
      room * 0.9,
      DISPLAY,
      900,
    );
    textPlate(ctx, up(line), cx, y, size, PAPER, INK, { align: "center" });
  }
  const watch = (tall ? 40 : 38) * u;
  const asize = fitSize(
    ctx,
    address,
    (tall ? 50 : 48) * u,
    // the plate's padding is 0.8 of the size; a tall frame's address may use its width
    (tall ? L.W - 2 * L.left : room) - (tall ? 50 : 48) * u * 0.8,
    LABEL,
    700,
  );
  const ah = Math.round(asize * 1.28);
  let wy; // the WATCH line's baseline
  if (tall) {
    const qy = y + (54 * 1.28 + 36) * u;
    qrPlate(ctx, qr, L.W / 2 - S / 2, qy, px);
    wy = qy + S + 64 * u;
  } else {
    wy = y + 150 * u;
    const foot = wy + 26 * u + ah;
    qrPlate(ctx, qr, L.right - S, foot - S, px);
  }
  ctx.font = font(watch);
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.fillText("WATCH THE WHOLE MATCH", cx, wy);
  textPlate(ctx, address, cx, wy + (tall ? 30 : 26) * u, asize, INK, PAPER, {
    align: "center",
    face: LABEL,
    weight: 700,
  });
}
