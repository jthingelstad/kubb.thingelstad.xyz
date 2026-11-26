// The paint on a report (src/net/paint.js; docs/CLIENT.md "Reports",
// backend/api/API.md "report"): what the message carries, what the api accepts, and
// what the readers make of it (tools/reports.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import {
  PAINT_LIMITS,
  PIECE_SIZES,
  normalizePaint,
  paintProblem,
  footprint,
  piecesUnder,
  paintMap,
  pieceName,
} from "../../src/net/paint.js";
import { SIZES } from "../../src/render/world.js";
import { LIMITS } from "../../backend/api/checks.mjs";
import { describePaint } from "../../tools/reports.mjs";

test("the limits are the brief's, and the api holds a report to the same", () => {
  assert.deepEqual(PAINT_LIMITS, {
    strokes: 32,
    points: 800,
    brushMin: 0.05,
    brushMax: 1,
    x: [-6, 6],
    y: [-4, 12],
  });
  assert.deepEqual(LIMITS.paint, PAINT_LIMITS);
});

test("the picture's pieces are the sizes the game draws", () => {
  for (const k of Object.keys(PIECE_SIZES))
    assert.deepEqual(PIECE_SIZES[k], SIZES[k], k);
});

test("normalizePaint: 2 decimals, in range, no empty stroke, within the counts", () => {
  assert.equal(normalizePaint(null), null);
  assert.equal(normalizePaint({ brush: 0.2, strokes: [] }), null);
  assert.equal(normalizePaint({ brush: 0.2, strokes: [[], [["a", 1]]] }), null);
  assert.deepEqual(
    normalizePaint({
      brush: 0.2345,
      strokes: [
        [
          [0.123, 4.567],
          [0.1234, 4.5671],
          [9, -9],
        ],
        [],
      ],
    }),
    {
      brush: 0.23,
      strokes: [
        [
          [0.12, 4.57],
          [6, -4],
        ],
      ],
    },
  );
  assert.equal(normalizePaint({ brush: 3, strokes: [[[0, 0]]] }).brush, 1);
  assert.equal(normalizePaint({ brush: 0, strokes: [[[0, 0]]] }).brush, 0.05);
  const many = normalizePaint({
    brush: 0.2,
    strokes: Array.from({ length: 40 }, (_, i) => [[0, i / 10]]),
  });
  assert.equal(many.strokes.length, 32);
  const long = normalizePaint({
    brush: 0.2,
    strokes: [0, 1].map((s) =>
      Array.from({ length: 500 }, (_, i) => [s, i / 100]),
    ),
  });
  assert.equal(
    long.strokes.reduce((n, s) => n + s.length, 0),
    800,
  );
  for (const p of [many, long]) assert.equal(paintProblem(p), null);
});

test("paintProblem says why a paint is not in shape", () => {
  const ok = {
    brush: 0.25,
    strokes: [
      [[0, 4]],
      [
        [1, 2],
        [1.5, 2.25],
      ],
    ],
  };
  assert.equal(paintProblem(ok), null);
  for (const bad of [
    null,
    [],
    "paint",
    { strokes: [[[0, 0]]] },
    { brush: 0.25 },
    { brush: 0.25, strokes: [] },
    { brush: 0.25, strokes: [[]] },
    { brush: 0.255, strokes: [[[0, 0]]] },
    { brush: Number.NaN, strokes: [[[0, 0]]] },
    { brush: 0.25, strokes: [[[0, 0.001]]] },
    { brush: 0.25, strokes: [[[0, 12.01]]] },
    { brush: 0.25, strokes: [[[-6.01, 0]]] },
    { brush: 0.25, strokes: [[[0, null]]] },
    { brush: 0.25, strokes: [[{ x: 0, y: 0 }]] },
  ])
    assert.equal(typeof paintProblem(bad), "string", JSON.stringify(bad));
});

const kubb = (id, x, y, more = {}) => ({
  id,
  kind: "kubb",
  team: "B",
  x,
  y,
  z: 0.075,
  qw: 1,
  qx: 0,
  qy: 0,
  qz: 0,
  ...more,
});
// lying along x: a quarter turn about the y axis
const down = { qw: Math.SQRT1_2, qy: Math.SQRT1_2, z: 0.035 };

test("a piece's footprint tells lying from standing, and its size", () => {
  const up = footprint(kubb("b1", 0, 8));
  assert.equal(up.lying, false);
  const xs = up.poly.map((p) => p[0]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 0.07) < 1e-9);
  const lying = footprint(kubb("b2", 0, 8, down));
  assert.equal(lying.lying, true);
  const lx = lying.poly.map((p) => p[0]);
  assert.ok(
    Math.abs(Math.max(...lx) - Math.min(...lx) - 0.15) < 1e-9,
    "its length lies along the ground",
  );
  assert.equal(footprint(kubb("b3", 0, 8, { toppled: true })).lying, true);
});

test("the pieces under the paint, and the text map", () => {
  const pieces = [
    { id: "king", kind: "king", x: 0, y: 4, z: 0.15, qw: 1 },
    kubb("b1", -2, 8),
    kubb("b2", 1, 8, down),
    {
      id: "baton1",
      kind: "baton",
      x: 1.2,
      y: 7.6,
      z: 0.022,
      qw: Math.SQRT1_2,
      qx: Math.SQRT1_2,
    },
    { id: "stake1", kind: "stake", x: 2.5, y: 8, z: 0 },
  ];
  const paint = {
    brush: 0.2,
    strokes: [
      [
        [0.8, 8],
        [1.3, 7.7],
      ],
    ],
  };
  assert.deepEqual(
    piecesUnder(pieces, paint).map((p) => p.id),
    ["b2", "baton1"],
  );
  assert.deepEqual(
    piecesUnder(pieces, { brush: 0.05, strokes: [[[0, 4]]] }).map((p) => p.id),
    ["king"],
  );
  assert.deepEqual(
    piecesUnder(pieces, { brush: 0.05, strokes: [[[0, 0]]] }),
    [],
  );
  assert.equal(pieceName(pieces[2]), "kubb B2 (down)");
  assert.equal(pieceName(pieces[0]), "king");
  const map = paintMap(pieces, paint);
  assert.ok(map.some((l) => l.includes("#")));
  assert.ok(map.some((l) => l.includes("K")));
  assert.ok(
    map.some((l) => l.includes("B")),
    "b1 standing",
  );
  assert.ok(
    map.some((l) => l.includes("b")),
    "b2 down",
  );
  // the far baseline is at the top
  const row = (c) => map.findIndex((l) => l.includes(c));
  assert.ok(row("B") < row("K"));
  const text = describePaint({ pieces, paint, lastThrow: {} }).join("\n");
  assert.match(text, /Paint: 1 stroke, 2 points, brush 0\.2 m/);
  assert.match(text, /Under the paint: kubb B2 \(down\), baton 1/);
  assert.match(text, /Map \(far baseline at the top/);
  assert.deepEqual(describePaint({}), []);
  assert.match(
    describePaint({ paint, pieces: null }).join("\n"),
    /dropped to fit/,
  );
  assert.deepEqual(describePaint({ paint: { brush: 9 } }), [
    "  Paint: not readable",
  ]);
});

test("a painted report's pieces are the ones its picture showed, never dropped", async () => {
  const { reportMessage } = await import("../../src/net/report.js");
  const now = [{ id: "king", kind: "king", x: 0, y: 4 }];
  const rest = [...now, { id: "baton1", kind: "baton", x: 1, y: 7 }];
  const state = { mode: "solo", pieces: now, pickPieces: rest, lastThrow: {} };
  const paint = { brush: 0.2, strokes: [[[1, 7]]] };
  const m = reportMessage(state, { happened: "h", paint });
  assert.deepEqual(m.r.pieces, rest, "the last throw's rest, as drawn");
  assert.equal(m.r.pickPieces, undefined);
  const plain = reportMessage(state, { happened: "h" });
  assert.deepEqual(plain.r.pieces, now, "unpainted: the pitch as it stood");
  const tiny = reportMessage(
    state,
    { happened: "h", paint },
    { limits: { bytes: 10, chars: 1000, feedbackChars: 2000 } },
  );
  assert.deepEqual(tiny.r.pieces, rest);
  assert.ok(!tiny.r.dropped?.includes("pieces"));
});
