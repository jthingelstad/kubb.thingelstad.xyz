// The highlight reel's picker (tools/reel/highlights.mjs): pure, on made-up throw facts
// shaped like tools/reel/scan.mjs's.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tune,
  rateThrow,
  shotsFor,
  shotSeconds,
  pickHighlights,
  resultLine,
} from "../../tools/reel/highlights.mjs";

const teams = { A: "North", B: "South" };
const half = (base, field) => ({ base, field });

// One throw. A baton by default, nothing hit, 1.4 s of flight.
function fact(i, o = {}) {
  const side = o.side ?? (Math.floor(i / 6) % 2 ? "B" : "A");
  return {
    i,
    turn: o.turn ?? Math.floor(i / 6) + 1,
    side,
    team: teams[side],
    how: "baton",
    n: (i % 6) + 1,
    of: 6,
    ruling: "missed",
    toppled: [],
    down: 0,
    distance: 8,
    touches: [],
    firstHit: null,
    duration: 1.4,
    before: { A: half(5, 0), B: half(5, 0), king: true },
    after: { A: half(5, 0), B: half(5, 0), king: true },
    over: false,
    ...o,
  };
}

const hit = (i, o = {}) =>
  fact(i, {
    ruling: "base kubb down",
    toppled: ["k1"],
    down: 1,
    firstHit: { t: 0.9, x: 0, y: 8 },
    touches: [{ id: "k1", kind: "kubb", t: 0.9 }],
    ...o,
  });

const kingWin = (i) =>
  fact(i, {
    side: "B",
    team: "South",
    ruling: "king down: South wins",
    toppled: ["king"],
    down: 1,
    firstHit: { t: 1.0, x: 0, y: 4 },
    touches: [{ id: "king", kind: "king", t: 1.0 }],
    over: true,
  });

const southWins = {
  winner: "B",
  winnerName: "South",
  turns: 9,
  how: "South toppled the king",
};

function match() {
  const throws = [];
  for (let i = 0; i < 60; i++) throws.push(fact(i));
  throws[8] = hit(8, { distance: 8 });
  throws[20] = hit(20, {
    ruling: "3 field kubbs down",
    toppled: ["k1", "k2", "k3"],
    down: 3,
  });
  throws[33] = fact(33, {
    how: "drill",
    ruling: "kubb in",
    down: 1,
    toppled: ["k4"],
    touches: [{ id: "k4", kind: "kubb", t: 0.8 }],
    firstHit: { t: 0.8, x: 0, y: 5 },
  });
  throws[44] = hit(44, {
    ruling: "field kubb down",
    n: 6,
    before: { A: half(5, 1), B: half(5, 1), king: true },
    after: { A: half(5, 0), B: half(5, 0), king: true },
  });
  throws[59] = kingWin(59);
  return throws;
}

test("the winning king shot is always in, and last", () => {
  const edit = pickHighlights({ throws: match(), end: southWins, teams });
  const last = edit.moments.at(-1);
  assert.equal(last.i, 59);
  assert.equal(last.kind, "king");
  assert.equal(last.caption, "South takes the king");
});

test("4 to 6 moments in match order, 25 to 40 s", () => {
  const edit = pickHighlights({ throws: match(), end: southWins, teams });
  assert.ok(
    edit.moments.length >= tune.minMoments,
    `${edit.moments.length} moments`,
  );
  assert.ok(edit.moments.length <= tune.maxMoments);
  const order = edit.moments.map((m) => m.i);
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
  assert.ok(
    edit.seconds >= tune.minSeconds && edit.seconds <= tune.maxSeconds,
    `${edit.seconds} s`,
  );
});

test("the kinds and their captions", () => {
  const edit = pickHighlights({ throws: match(), end: southWins, teams });
  const by = Object.fromEntries(edit.moments.map((m) => [m.i, m]));
  assert.equal(by[8].kind, "long");
  assert.equal(by[8].caption, "South: a base kubb from 8 metres");
  assert.equal(by[20].kind, "multi");
  assert.equal(by[20].caption, "South: three kubbs with one baton");
  assert.equal(by[33].kind, "inkast");
  assert.equal(by[44].kind, "clear");
  assert.match(by[44].caption, /clears the field with the last baton/);
});

test("a dull match still gets a reel: the opening throw, the best hit, the end", () => {
  const throws = [];
  for (let i = 0; i < 40; i++) throws.push(fact(i));
  throws[17] = hit(17, { ruling: "field kubb down", distance: 4 });
  const end = {
    winner: "A",
    winnerName: "North",
    how: "South resigned",
    text: "South resigned: North wins",
  };
  const edit = pickHighlights({ throws, end, teams });
  const ids = edit.moments.map((m) => m.i);
  assert.ok(ids.includes(0), "the opening throw");
  assert.equal(ids.at(-1), 17, "the last hit stands for the end");
  assert.ok(edit.moments.length >= 2);
  assert.ok(edit.seconds >= tune.minSeconds, `${edit.seconds} s`);
});

test("a king hit too early is a moment of its own", () => {
  const t = fact(12, {
    toppled: ["king"],
    down: 1,
    ruling: "king down: South wins",
    over: true,
  });
  const r = rateThrow(t, { end: { winner: "B" } });
  assert.equal(r.kind, "kingEarly");
  assert.equal(r.caption, "North hits the king too early");
});

test("a near miss right before a big hit is put in to set it up", () => {
  const throws = match();
  throws[19] = fact(19, {
    touches: [{ id: "k2", kind: "kubb", t: 0.9 }],
    firstHit: { t: 0.9, x: 0, y: 8 },
  });
  const edit = pickHighlights({ throws, end: southWins, teams });
  const near = edit.moments.find((m) => m.i === 19);
  assert.ok(near, "the near miss is in");
  assert.equal(near.kind, "nearMiss");
});

test("shots: the release, the arc, slow motion through the hit, a beat", () => {
  const t = hit(3, { duration: 2.2 });
  const shots = shotsFor(t, "hit", 10);
  assert.deepEqual(
    shots.map((s) => s.cam),
    ["release", "arc", "impact", "rest", "rest"],
  );
  const slow = shots[2];
  assert.equal(slow.rate, tune.slowRate);
  assert.ok(slow.t0 < 0.9 && slow.t1 > 0.9, "slow through the first hit");
  // a big moment is seen twice: whole at its own pace, then close and slow
  const big = shotsFor(t, "multi", 60);
  assert.equal(big[2].replay, true);
  assert.ok(shotSeconds(big) > shotSeconds(shots));
  // a miss: the arc and where it landed
  assert.deepEqual(
    shotsFor(fact(4), "miss", 0).map((s) => s.cam),
    ["release", "arc", "rest"],
  );
});

test("the result line", () => {
  assert.equal(resultLine(southWins, teams), "South wins in 9 turns");
  assert.equal(
    resultLine(
      { winner: "A", winnerName: "North", how: "South resigned" },
      teams,
    ),
    "North wins: South resigned",
  );
});
