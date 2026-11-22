// The Tournament scene (engine id `tournament`, grass, the USA set's colouring;
// docs/SCENES.md): a kubb tournament. The player's pitch is one of several side by
// side on mown grass, roped off with lines of pennants; the neighbouring pitches have
// their own kubbs, kings, stakes and players; scoreboards and a canopy stand round
// them. A generic tournament (the owner: "No championship's name or logo anywhere"):
// no words on anything, the scoreboards show numbers only.
//
// The neighbours are drawn by one function from data, drawNeighbours(ctx, cam, kx, B,
// pitches), so a later engine release that makes them live (the engine's
// docs/notes/tournament.md: "a grid of pitches that are all live") hands it each
// neighbour's pieces as they stand. Today they are NEIGHBOURS below, still, unless a
// scene passes `neighbours` of its own (scene.neighbours).
import { project } from "./camera.js";
import { TOURNAMENT, INK, setOf as daySetOf } from "./palette.js";
import { DAYLIGHT, DAY_PAINT } from "./world.js";
import {
  farToNear,
  groundLines,
  groundRect,
  hash,
  inked,
  inkFor,
  middleDepth,
  person,
  skyGradient,
  standAt,
} from "./scenery.js";

// ---------- the neighbours, as data ----------

// A neighbouring pitch: { x, y } its near baseline's middle in the drawn frame (the
// pitch runs from y to y + 8, x - 2.5 to x + 2.5, like the player's), `pieces` in its
// own frame (x across from its middle, y from its near baseline): { kind: "kubb" |
// "king" | "baton", x, y, down, team }, and `people`: { x, y, shirt, arm }.
function standardPieces(seed, downs = []) {
  const pieces = [];
  for (let i = 0; i < 5; i++) {
    const x = -2 + i;
    pieces.push({
      kind: "kubb",
      x,
      y: 0,
      team: "A",
      down: downs.includes(`a${i}`),
    });
    pieces.push({
      kind: "kubb",
      x,
      y: 8,
      team: "B",
      down: downs.includes(`b${i}`),
    });
  }
  pieces.push({ kind: "king", x: 0, y: 4 });
  // a field kubb or two, and a baton lying past the far line
  pieces.push({ kind: "kubb", x: -1.2 + hash(seed) * 2.4, y: 5.3, team: "A" });
  if (hash(seed * 3) > 0.4)
    pieces.push({ kind: "kubb", x: 1 - hash(seed * 5) * 2, y: 2.6, team: "B" });
  pieces.push({
    kind: "baton",
    x: 1.4 - hash(seed * 7) * 2.8,
    y: 8.6,
    down: true,
  });
  return pieces;
}

export const NEIGHBOURS = [
  {
    x: -8,
    y: 0,
    pieces: standardPieces(1, ["b1", "b3"]),
    people: [
      { x: -0.8, y: -1.2, shirt: 0, arm: 1 },
      { x: 0.9, y: -1.0, shirt: 0 },
      { x: -0.5, y: 9.3, shirt: 1 },
      { x: 1.1, y: 9.5, shirt: 1 },
    ],
  },
  {
    x: 8,
    y: 0,
    pieces: standardPieces(2, ["a2"]),
    people: [
      { x: 0.6, y: -1.1, shirt: 2 },
      { x: -0.4, y: 9.4, shirt: 5, arm: 1 },
      { x: 0.8, y: 9.2, shirt: 5 },
    ],
  },
  {
    x: -16,
    y: 0,
    pieces: standardPieces(3, ["b0", "b2", "b4"]),
    people: [
      { x: 0, y: -1.2, shirt: 4 },
      { x: 0.3, y: 9.3, shirt: 6 },
    ],
  },
  {
    x: 16,
    y: 0,
    pieces: standardPieces(4),
    people: [
      { x: -0.3, y: -1.3, shirt: 3, arm: 1 },
      { x: 0.2, y: 9.4, shirt: 2 },
    ],
  },
  {
    x: -4,
    y: 14,
    pieces: standardPieces(5, ["a1"]),
    people: [
      { x: 0.4, y: -1.2, shirt: 6 },
      { x: -0.6, y: 9.4, shirt: 1, arm: 1 },
    ],
  },
  {
    x: 4,
    y: 14,
    pieces: standardPieces(6, ["b2", "b4"]),
    people: [
      { x: -0.5, y: -1.1, shirt: 3 },
      { x: 0.6, y: 9.3, shirt: 0 },
    ],
  },
];

// A neighbour's piece, a small flat picture of it: a kubb's wood with its set's head,
// the king with his crown, a baton.
function piece(ctx, cam, kx, B, nearest, p, set) {
  const at = standAt(cam, p.x, p.y, B, nearest, 0.5);
  if (!at) return;
  const s = at.s;
  const tall = (p.kind === "king" ? 0.3 : p.kind === "baton" ? 0.3 : 0.15) * s;
  if (tall * kx < 2) return;
  const w = inkFor(tall * 4, kx) * 0.6;
  const wide =
    (p.kind === "king" ? 0.09 : p.kind === "baton" ? 0.044 : 0.07) * s;
  const head = set?.bands?.[0]?.paint || TOURNAMENT.wood;
  const stripe = set?.bands?.[1]?.paint || null;
  if (p.down) {
    const len = tall,
      th = wide;
    inked(
      ctx,
      () => ctx.rect(at.x - len / 2, at.y - th, len, th),
      TOURNAMENT.wood,
      INK,
      w,
    );
    if (p.kind === "kubb") {
      ctx.fillStyle = head;
      ctx.fillRect(at.x + len * 0.3, at.y - th, len * 0.2, th);
    }
    return;
  }
  inked(
    ctx,
    () => ctx.rect(at.x - wide / 2, at.y - tall, wide, tall),
    TOURNAMENT.wood,
    INK,
    w,
  );
  if (p.kind === "kubb") {
    ctx.fillStyle = head;
    ctx.fillRect(at.x - wide / 2, at.y - tall, wide, tall * 0.22);
    if (stripe) {
      ctx.fillStyle = stripe;
      ctx.fillRect(at.x - wide / 2, at.y - tall * 0.72, wide, tall * 0.05);
    }
  } else if (p.kind === "king") {
    ctx.fillStyle = set?.crown || INK;
    ctx.fillRect(at.x - wide / 2, at.y - tall, wide, tall * 0.3);
  }
}

// Every neighbouring pitch: its mown ground, its lines and stakes, its pieces and its
// players, the farthest first. pitches: NEIGHBOURS' shape.
export function drawNeighbours(
  ctx,
  cam,
  kx,
  B,
  pitches,
  set = daySetOf("usa"),
) {
  const nearest = middleDepth(cam);
  const N = TOURNAMENT.neighbour;
  const sorted = farToNear(
    cam,
    pitches.map((p) => ({ ...p, x: p.x, y: p.y + 4, base: p })),
  );
  for (const e of sorted) {
    const p = e.base;
    // a pitch wholly nearer the camera than the player's middle is left out
    const far =
      (p.x - cam.px) * cam.fx + (p.y + 8 - cam.py) * cam.fy - cam.pz * cam.fz;
    if (far < nearest) continue;
    groundRect(ctx, cam, p.x - 2.5, p.y, p.x + 2.5, p.y + 8, N.pitch);
    for (let i = 0; i < 5; i += 2)
      groundRect(
        ctx,
        cam,
        p.x - 2.5 + i,
        p.y,
        p.x - 1.5 + i,
        p.y + 8,
        N.stripe,
      );
    const segs = [
      [p.x - 2.5, p.y, p.x - 2.5, p.y + 8],
      [p.x + 2.5, p.y, p.x + 2.5, p.y + 8],
      [p.x - 2.5, p.y, p.x + 2.5, p.y],
      [p.x - 2.5, p.y + 8, p.x + 2.5, p.y + 8],
    ];
    for (let x = -2.5; x < 2.5; x += 0.4)
      segs.push([p.x + x, p.y + 4, p.x + Math.min(2.5, x + 0.24), p.y + 4]);
    groundLines(ctx, cam, segs, N.line, 0.9 / kx);
    const things = [
      ...p.pieces.map((q) => ({
        ...q,
        x: p.x + q.x,
        y: p.y + q.y,
        what: "piece",
      })),
      ...p.people.map((q) => ({
        ...q,
        x: p.x + q.x,
        y: p.y + q.y,
        what: "person",
      })),
      ...[
        [-2.5, 0],
        [2.5, 0],
        [-2.5, 8],
        [2.5, 8],
      ].map(([x, y]) => ({
        x: p.x + x,
        y: p.y + y,
        kind: "stake",
        what: "piece",
      })),
    ];
    for (const t of farToNear(cam, things)) {
      if (t.what === "person") {
        const at = standAt(cam, t.x, t.y, B, nearest, 2);
        if (at)
          person(ctx, at, kx, TOURNAMENT.person, {
            shirt: TOURNAMENT.shirts[t.shirt % TOURNAMENT.shirts.length],
            arm: t.arm || 0,
          });
      } else if (t.kind === "stake") {
        const at = standAt(cam, t.x, t.y, B, nearest, 0.4);
        if (at) {
          const h = at.s * 0.15;
          if (h * kx >= 2) {
            ctx.fillStyle = INK;
            ctx.fillRect(
              at.x - Math.max(0.5 / kx, at.s * 0.01),
              at.y - h,
              Math.max(1 / kx, at.s * 0.02),
              h,
            );
          }
        }
      } else piece(ctx, cam, kx, B, nearest, t, set);
    }
  }
}

// ---------- the rope, the boards, the canopy ----------

export const tune = {
  // near the pitch: the cameras look down at it, so its few metres round are what
  // most views show (the aim view sees about 6 m past the far baseline)
  rope: { x0: -3.7, x1: 3.7, y0: -2.6, y1: 10.1, h: 0.75, posts: 1.85 }, // m
  pennantEvery: 0.46, // m along the rope
  boards: [
    { x: -2.9, y: 11.3, a: 3, b: 2 },
    { x: 8, y: 11.4, a: 1, b: 4 },
  ],
  // people watching past the far rope
  watchers: [
    { x: -1.4, y: 11.0, shirt: 1 },
    { x: -0.6, y: 11.4, shirt: 4, arm: 1 },
    { x: 0.9, y: 11.1, shirt: 2 },
    { x: 1.8, y: 11.6, shirt: 6 },
    { x: 3.2, y: 10.9, shirt: 0 },
    { x: -4.4, y: 10.6, shirt: 5 },
  ],
  tent: { x: 0, y: 26, w: 6, d: 3.4, h: 2.6 },
};

// The rope round the player's pitch: posts, the rope sagging between them and a
// pennant hanging under it every pennantEvery, the far side and the two long sides
// (the near side is behind the thrower).
function drawRope(ctx, cam, kx, B) {
  const r = tune.rope;
  const nearest = middleDepth(cam) - 6;
  const runs = [
    [r.x0, r.y1, r.x1, r.y1],
    [r.x0, r.y0, r.x0, r.y1],
    [r.x1, r.y0, r.x1, r.y1],
  ];
  for (const [x0, y0, x1, y1] of runs) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.round(len / r.posts));
    for (let i = 0; i < n; i++) {
      const ax = x0 + ((x1 - x0) * i) / n,
        ay = y0 + ((y1 - y0) * i) / n;
      const bx = x0 + ((x1 - x0) * (i + 1)) / n,
        by = y0 + ((y1 - y0) * (i + 1)) / n;
      const da =
        (ax - cam.px) * cam.fx + (ay - cam.py) * cam.fy - cam.pz * cam.fz;
      if (da < nearest) continue;
      // the rope: a sag of 8 cm in the middle
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const u = k / 8;
        const p = project(
          cam,
          ax + (bx - ax) * u,
          ay + (by - ay) * u,
          r.h - 0.08 * 4 * u * (1 - u),
        );
        if (!p) {
          pts.length = 0;
          break;
        }
        pts.push(p);
      }
      if (pts.length < 2) continue;
      // pennants under it
      const m = Math.max(1, Math.round(len / n / tune.pennantEvery));
      for (let k = 0; k < m; k++) {
        const u0 = (k + 0.15) / m,
          u1 = (k + 0.85) / m;
        const z0 = r.h - 0.08 * 4 * u0 * (1 - u0),
          z1 = r.h - 0.08 * 4 * u1 * (1 - u1);
        const p0 = project(cam, ax + (bx - ax) * u0, ay + (by - ay) * u0, z0);
        const p1 = project(cam, ax + (bx - ax) * u1, ay + (by - ay) * u1, z1);
        const um = (u0 + u1) / 2;
        const pm = project(
          cam,
          ax + (bx - ax) * um,
          ay + (by - ay) * um,
          (z0 + z1) / 2 - 0.16,
        );
        if (!p0 || !p1 || !pm) continue;
        ctx.fillStyle =
          TOURNAMENT.pennant[(i * 3 + k) % TOURNAMENT.pennant.length];
        ctx.strokeStyle = INK;
        ctx.lineWidth =
          Math.max(0.6, Math.min(1.6, (cam.f / pm[2]) * kx * 0.02)) / kx;
        ctx.beginPath();
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
        ctx.lineTo(pm[0], pm[1]);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.strokeStyle = INK;
      ctx.lineWidth =
        Math.max(0.8, Math.min(2.2, (cam.f / pts[0][2]) * kx * 0.025)) / kx;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts) ctx.lineTo(p[0], p[1]);
      ctx.stroke();
      ctx.strokeStyle = TOURNAMENT.rope;
      ctx.lineWidth *= 0.5;
      ctx.stroke();
      // the post at its start
      const foot = project(cam, ax, ay, 0),
        top = project(cam, ax, ay, r.h + 0.08);
      if (foot && top) {
        ctx.strokeStyle = INK;
        ctx.lineCap = "round";
        ctx.lineWidth = Math.max(1.4, (cam.f / foot[2]) * kx * 0.05) / kx;
        ctx.beginPath();
        ctx.moveTo(foot[0], foot[1]);
        ctx.lineTo(top[0], top[1]);
        ctx.stroke();
        ctx.strokeStyle = TOURNAMENT.post;
        ctx.lineWidth *= 0.5;
        ctx.stroke();
      }
    }
  }
}

// A flip scoreboard on two legs: two numbers, no words.
function board(ctx, at, b, kx) {
  const s = at.s;
  const W = 1.6 * s,
    H = 0.9 * s,
    legs = 1.0 * s;
  if (W * kx < 6) return;
  const w = inkFor(H + legs, kx);
  const { x, y } = at;
  inked(
    ctx,
    () => {
      ctx.rect(x - W * 0.42, y - legs, s * 0.06, legs);
      ctx.rect(x + W * 0.36, y - legs, s * 0.06, legs);
    },
    TOURNAMENT.board.frame,
    INK,
    w,
  );
  inked(
    ctx,
    () => ctx.rect(x - W / 2, y - legs - H, W, H),
    TOURNAMENT.board.face,
    INK,
    w,
  );
  const cell = (cx, n) => {
    ctx.fillStyle = TOURNAMENT.board.plate;
    ctx.fillRect(cx - W * 0.17, y - legs - H * 0.86, W * 0.34, H * 0.72);
    ctx.fillStyle = TOURNAMENT.board.digit;
    ctx.font = `900 ${H * 0.62}px "Londrina Solid", "Arial Black", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n), cx, y - legs - H * 0.48);
  };
  if (H * kx >= 9) {
    cell(x - W * 0.22, b.a);
    cell(x + W * 0.22, b.b);
  }
}

// A canopy: a striped roof on four legs, past the far pitches.
function tent(ctx, cam, kx, B) {
  const t = tune.tent;
  const at = standAt(cam, t.x, t.y, B, 0, 8);
  if (!at) return;
  const s = at.s;
  const W = t.w * s,
    H = t.h * s;
  if (W * kx < 8) return;
  const w = inkFor(H, kx);
  const { x, y } = at;
  inked(
    ctx,
    () => {
      ctx.rect(x - W / 2, y - H, s * 0.08, H);
      ctx.rect(x + W / 2 - s * 0.08, y - H, s * 0.08, H);
    },
    TOURNAMENT.tent.leg,
    INK,
    w,
  );
  const n = 8;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = TOURNAMENT.tent.roof[i % 2];
    ctx.beginPath();
    ctx.moveTo(x - W / 2 + (W * i) / n, y - H);
    ctx.lineTo(x - W / 2 + (W * (i + 1)) / n, y - H);
    ctx.lineTo(x - W * 0.3 + (W * 0.6 * (i + 1)) / n, y - H - s * 0.9);
    ctx.lineTo(x - W * 0.3 + (W * 0.6 * i) / n, y - H - s * 0.9);
    ctx.closePath();
    ctx.fill();
  }
  inked(
    ctx,
    () => {
      ctx.moveTo(x - W / 2, y - H);
      ctx.lineTo(x + W / 2, y - H);
      ctx.lineTo(x + W * 0.3, y - H - s * 0.9);
      ctx.lineTo(x - W * 0.3, y - H - s * 0.9);
      ctx.closePath();
    },
    null,
    INK,
    w,
  );
  // the valance's scallops
  ctx.fillStyle = TOURNAMENT.tent.roof[1];
  for (let i = 0; i < n; i++) {
    ctx.beginPath();
    ctx.arc(x - W / 2 + (W * (i + 0.5)) / n, y - H, W / n / 2, 0, Math.PI);
    ctx.fill();
  }
}

function drawSky(ctx, cam, kx, B) {
  skyGradient(ctx, cam, B, TOURNAMENT.sky.top, TOURNAMENT.sky.low);
}

function drawThings(ctx, cam, kx, B, G, scene) {
  tent(ctx, cam, kx, B);
  drawNeighbours(
    ctx,
    cam,
    kx,
    B,
    scene.neighbours || NEIGHBOURS,
    daySetOf(scene.set || "usa"),
  );
  const nearest = middleDepth(cam);
  const things = [
    ...tune.boards.map((b) => ({ ...b, what: "board" })),
    ...tune.watchers.map((w) => ({ ...w, what: "person" })),
  ];
  for (const t of farToNear(cam, things)) {
    const at = standAt(cam, t.x, t.y, B, nearest, 2);
    if (!at) continue;
    if (t.what === "board") board(ctx, at, t, kx);
    else
      person(ctx, at, kx, TOURNAMENT.person, {
        shirt: TOURNAMENT.shirts[t.shirt % TOURNAMENT.shirts.length],
        arm: t.arm || 0,
      });
  }
  drawRope(ctx, cam, kx, B);
  void G;
  void hash;
}

const GROUNDS = { grass: TOURNAMENT.ground };

export function makeTournament({ reduced = false } = {}) {
  return {
    id: "tournament",
    skin: null, // the day's controls
    reduced,
    groundOf: (surface) => GROUNDS[surface] || GROUNDS.grass,
    setOf: daySetOf,
    light: DAYLIGHT,
    paint: DAY_PAINT,
    clearing: null,
    cone: TOURNAMENT.cone,
    sky: drawSky,
    scenery: drawThings,
  };
}
