// The paint on a report (docs/CLIENT.md "Reports", backend/api/API.md "report"): where
// on the pitch the player painted, in the report's own frame and units (the thrower's
// view frame, metres: x across, y along). Pure, so the card (src/ui/paint.js), the
// message (src/net/report.js), the readers (tools/reports.mjs) and the tests share it.
//
//   paint: { brush: <radius in metres>, strokes: [ [ [x, y], [x, y], ... ], ... ] }
//
// Numbers to 2 decimals, at most 32 strokes and 800 points in all, every stroke at least
// one point, `brush` from 0.05 to 1, x within -6..6 and y within -4..12. The api function
// holds a report to the same (backend/api/checks.mjs, tests/net/paint.test.mjs).

export const PAINT_LIMITS = Object.freeze({
  strokes: 32,
  points: 800,
  brushMin: 0.05,
  brushMax: 1,
  x: [-6, 6],
  y: [-4, 12],
});

// Half extents along a piece's local x, y, z (src/render/world.js SIZES, held to it by
// tests/net/paint.test.mjs).
export const PIECE_SIZES = Object.freeze({
  kubb: [0.035, 0.035, 0.075],
  king: [0.045, 0.045, 0.15],
  baton: [0.022, 0.022, 0.15],
  stake: [0.0095, 0.0095, 0.075],
});

const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

// A paint as the message carries it, or null when there is nothing painted. Anything
// past the limits is left off (the strokes after the 32nd, the points after the 800th).
export function normalizePaint(paint, limits = PAINT_LIMITS) {
  if (!paint || !Array.isArray(paint.strokes)) return null;
  const brush = r2(
    clamp(Number(paint.brush) || limits.brushMin, [
      limits.brushMin,
      limits.brushMax,
    ]),
  );
  let left = limits.points;
  const strokes = [];
  for (const s of paint.strokes) {
    if (strokes.length >= limits.strokes || left <= 0) break;
    if (!Array.isArray(s)) continue;
    const pts = [];
    for (const p of s) {
      if (pts.length >= left) break;
      if (!Array.isArray(p)) continue;
      const [x, y] = p.map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const q = [r2(clamp(x, limits.x)), r2(clamp(y, limits.y))];
      const last = pts[pts.length - 1];
      if (last && last[0] === q[0] && last[1] === q[1]) continue;
      pts.push(q);
    }
    if (!pts.length) continue;
    left -= pts.length;
    strokes.push(pts);
  }
  return strokes.length ? { brush, strokes } : null;
}

// Is `paint` as the message carries it? Returns the reason it is not, or null.
export function paintProblem(paint, limits = PAINT_LIMITS) {
  const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
  if (!isObj(paint)) return "`paint` must be { brush, strokes }.";
  const { brush, strokes } = paint;
  if (
    typeof brush !== "number" ||
    !Number.isFinite(brush) ||
    brush < limits.brushMin ||
    brush > limits.brushMax
  )
    return `\`paint.brush\` must be ${limits.brushMin} to ${limits.brushMax} metres.`;
  if (!Array.isArray(strokes) || !strokes.length)
    return "`paint.strokes` must be a list of strokes.";
  if (strokes.length > limits.strokes)
    return `A paint is limited to ${limits.strokes} strokes.`;
  let n = 0;
  const two = (v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
  for (const s of strokes) {
    if (!Array.isArray(s) || !s.length)
      return "Every stroke must be a list of at least one point.";
    for (const p of s) {
      if (
        !Array.isArray(p) ||
        p.length !== 2 ||
        !p.every((v) => typeof v === "number" && Number.isFinite(v) && two(v))
      )
        return "Every point must be [x, y] in metres, to 2 decimals.";
      if (p[0] < limits.x[0] || p[0] > limits.x[1])
        return `A point's x must be ${limits.x[0]} to ${limits.x[1]}.`;
      if (p[1] < limits.y[0] || p[1] > limits.y[1])
        return `A point's y must be ${limits.y[0]} to ${limits.y[1]}.`;
    }
    n += s.length;
  }
  if (n > limits.points)
    return `A paint is limited to ${limits.points} points.`;
  if (!two(brush)) return "`paint.brush` must be to 2 decimals.";
  return null;
}

// A piece's footprint seen from above: { poly: [[x, y], ...], lying } in the frame of
// its own `x`, `y`. `lying` when its long axis lies more along the ground than up.
export function footprint(p) {
  const [hx, hy, hz] = PIECE_SIZES[p.kind] ?? PIECE_SIZES.kubb;
  const qw = p.qw ?? 1,
    qx = p.qx ?? 0,
    qy = p.qy ?? 0,
    qz = p.qz ?? 0;
  // core/quat.toMatrix: columns are the local axes in the world
  const m = [
    1 - 2 * (qy * qy + qz * qz),
    2 * (qx * qy - qw * qz),
    2 * (qx * qz + qw * qy),
    2 * (qx * qy + qw * qz),
    1 - 2 * (qx * qx + qz * qz),
    2 * (qy * qz - qw * qx),
  ];
  const pts = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const lx = sx * hx,
          ly = sy * hy,
          lz = sz * hz;
        pts.push([
          p.x + m[0] * lx + m[1] * ly + m[2] * lz,
          p.y + m[3] * lx + m[4] * ly + m[5] * lz,
        ]);
      }
  // how much of the long (local z) axis points up: the matrix's bottom right
  const up = Math.abs(1 - 2 * (qx * qx + qy * qy));
  const lying = p.toppled === true || up < 0.7;
  return { poly: hull(pts), lying };
}

function hull(pts) {
  const s = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of s) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-12
    )
      lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-12
    )
      upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// The box the picture shows: the pitch (5 by 8) and every piece, with a margin, in
// the paint's limits. { x0, x1, y0, y1 } in metres.
export function pictureBounds(pieces) {
  const xs = pieces.map((p) => p.x).filter(Number.isFinite);
  const ys = pieces.map((p) => p.y).filter(Number.isFinite);
  return {
    x0: Math.max(PAINT_LIMITS.x[0], Math.min(-2.5, ...xs) - 0.5),
    x1: Math.min(PAINT_LIMITS.x[1], Math.max(2.5, ...xs) + 0.5),
    y0: Math.max(PAINT_LIMITS.y[0], Math.min(0, ...ys) - 0.6),
    y1: Math.min(PAINT_LIMITS.y[1], Math.max(8, ...ys) + 0.6),
  };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

function pointSeg(p, a, b) {
  const ab = sub(b, a);
  const l = dot(ab, ab);
  const t = l ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l)) : 0;
  return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t);
}

function segsCross(a, b, c, d) {
  const o = (p, q, r) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

function segSeg(a, b, c, d) {
  if (segsCross(a, b, c, d)) return 0;
  return Math.min(
    pointSeg(a, c, d),
    pointSeg(b, c, d),
    pointSeg(c, a, b),
    pointSeg(d, a, b),
  );
}

function inside(p, poly) {
  let inn = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (
      yi > p[1] !== yj > p[1] &&
      p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi
    )
      inn = !inn;
  }
  return inn;
}

// The pieces the paint lies over (any of their footprint within the brush of a
// stroke), in the pieces' order. Stakes are left out.
export function piecesUnder(pieces, paint) {
  if (!paint?.strokes?.length || !Array.isArray(pieces)) return [];
  const r = paint.brush;
  return pieces.filter((p) => {
    if (p.kind === "stake" || !Number.isFinite(p.x) || !Number.isFinite(p.y))
      return false;
    const { poly } = footprint(p);
    for (const s of paint.strokes) {
      const segs = s.length === 1 ? [[s[0], s[0]]] : [];
      for (let i = 1; i < s.length; i++) segs.push([s[i - 1], s[i]]);
      for (const [a, b] of segs) {
        if (inside(a, poly)) return true;
        for (let i = 0; i < poly.length; i++)
          if (segSeg(a, b, poly[i], poly[(i + 1) % poly.length]) <= r)
            return true;
      }
    }
    return false;
  });
}

// Is the point [x, y] painted?
export function painted(paint, pt) {
  for (const s of paint?.strokes ?? []) {
    if (
      s.length === 1 &&
      Math.hypot(pt[0] - s[0][0], pt[1] - s[0][1]) <= paint.brush
    )
      return true;
    for (let i = 1; i < s.length; i++)
      if (pointSeg(pt, s[i - 1], s[i]) <= paint.brush) return true;
  }
  return false;
}

// A text map of the pitch with the paint, for a terminal: the far baseline at the top,
// a quarter metre a column and half a metre a row. `#` painted ground, `K`/`k` the
// king standing/down, `A`/`a` and `B`/`b` a team's kubb standing/down (`o` a kubb of
// no team), `/` a baton, `|` and `-` the pitch's lines, `.` the pitch's grass.
export function paintMap(pieces, paint, { col = 0.25, row = 0.5 } = {}) {
  const b = pictureBounds(pieces ?? []);
  const cols = Math.round((b.x1 - b.x0) / col);
  const rows = Math.round((b.y1 - b.y0) / row);
  const grid = [];
  for (let j = 0; j < rows; j++) {
    const y = b.y1 - (j + 0.5) * row;
    const line = [];
    for (let i = 0; i < cols; i++) {
      const x = b.x0 + (i + 0.5) * col;
      let c = " ";
      const onPitch = x >= -2.5 && x <= 2.5 && y >= 0 && y <= 8;
      if (onPitch) c = ".";
      const nearX = Math.abs(Math.abs(x) - 2.5) < col / 2 && y >= 0 && y <= 8;
      const nearY =
        [0, 4, 8].some((v) => Math.abs(y - v) < row / 2) && Math.abs(x) <= 2.5;
      if (nearY) c = "-";
      if (nearX) c = "|";
      if (paint && painted(paint, [x, y])) c = "#";
      line.push(c);
    }
    grid.push(line);
  }
  for (const p of pieces ?? []) {
    if (p.kind === "stake" || !Number.isFinite(p.x) || !Number.isFinite(p.y))
      continue;
    const i = Math.floor((p.x - b.x0) / col);
    const j = Math.floor((b.y1 - p.y) / row);
    if (j < 0 || j >= rows || i < 0 || i >= cols) continue;
    const down = footprint(p).lying;
    let c;
    if (p.kind === "king") c = down ? "k" : "K";
    else if (p.kind === "baton") c = "/";
    else if (p.team === "A" || p.team === "B")
      c = down ? p.team.toLowerCase() : p.team;
    else c = "o";
    grid[j][i] = c;
  }
  return grid.map((l) => l.join("").trimEnd());
}

// A piece's name for a reader: "king", "kubb B1 (down)", "baton 2".
export function pieceName(p) {
  const number = String(p.id ?? "").startsWith(p.kind)
    ? String(p.id).slice(p.kind.length)
    : String(p.id ?? "").toUpperCase();
  const down = p.kind !== "baton" && footprint(p).lying ? " (down)" : "";
  return `${p.kind}${number ? " " + number : ""}${down}`;
}
