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

// The end card: who won and how, and where to watch the whole match.
export function endCard(ctx, L, { winner, teams, line, address, a = 1 }) {
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
