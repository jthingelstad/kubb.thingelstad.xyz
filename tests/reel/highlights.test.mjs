// The highlight reel's picker (backend/reels/highlights.mjs): pure, on made-up throw facts
// shaped like backend/reels/scan.mjs's.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tune,
  rateThrow,
  shotsFor,
  shotSeconds,
  pickHighlights,
  resultLine,
  drillGroups,
} from "../../backend/reels/highlights.mjs";

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

// Drills: kubbs thrown in. One turn's drilling by a side: the kubbs' ids and where
// they stand once raised (in the half the side throws at), from throw i on, with
// the next baton at i + kubbs.length.
function drilling(throws, i, side, kubbs, o = {}) {
  const at = i + kubbs.length;
  const settled = { at, kubbs: [...kubbs, ...(o.already || [])] };
  kubbs.forEach((k, j) => {
    throws[i + j] = fact(i + j, {
      side,
      team: teams[side],
      turn: o.turn,
      how: "drill",
      ruling: "kubb in",
      kubb: k.id,
      rest: { x: k.x, y: k.y },
      land: { x: k.x, y: k.y - 0.2 },
      landT: 1.0,
      duration: 1.8,
      settled,
      ...(o.each?.(j) || {}),
    });
  });
  return at;
}

// three kubbs within a hand of each other in South's half, thrown in by North
const tight = [
  { id: "k10", x: 1.0, y: 5.2 },
  { id: "k11", x: 1.2, y: 5.3 },
  { id: "k12", x: 1.1, y: 5.45 },
];

test("a tight group of kubbs thrown in is picked, with the baton it set up", () => {
  const throws = match();
  const at = drilling(throws, 24, "A", tight, { turn: 5 });
  throws[at + 1] = hit(at + 1, {
    side: "A",
    team: "North",
    turn: 5,
    ruling: "2 field kubbs down",
    toppled: ["k10", "k12"],
    down: 2,
  });
  const g = drillGroups(throws).get(26);
  assert.ok(g, "the last kubb in the group is its beat");
  assert.equal(g.size, 3);
  assert.equal(g.pays, at + 1);
  const edit = pickHighlights({ throws, end: southWins, teams });
  const drill = edit.moments.find((m) => m.i === 26);
  assert.ok(drill, "the group is in");
  assert.equal(drill.kind, "group");
  assert.equal(drill.caption, "North lands three kubbs close together");
  assert.deepEqual(
    drill.shots.map((s) => s.cam),
    ["release", "arc", "group", "settled"],
  );
  assert.equal(drill.shots.at(-1).at, at, "it holds on the group as raised");
  // the baton that took two of them follows it, closer than minGap
  const next = edit.moments[edit.moments.indexOf(drill) + 1];
  assert.equal(next.i, at + 1);
  assert.equal(next.kind, "multi");
});

test("a match with no notable drill is not made to show one", () => {
  const throws = match();
  throws[33] = fact(33); // the inkast that knocked a kubb, gone
  // kubbs thrown in, but a metre apart: no group
  drilling(throws, 24, "A", [
    { id: "k10", x: -1.5, y: 5.2 },
    { id: "k11", x: 0, y: 5.4 },
    { id: "k12", x: 1.5, y: 5.6 },
  ]);
  // a loose cluster: each close to the next, but too wide to be one group
  drilling(throws, 36, "B", [
    { id: "k20", x: -0.6, y: 2.8 },
    { id: "k21", x: -0.25, y: 2.8 },
    { id: "k22", x: 0.1, y: 2.8 },
    { id: "k23", x: 0.45, y: 2.8 },
  ]);
  assert.equal(drillGroups(throws).size, 0);
  const edit = pickHighlights({ throws, end: southWins, teams });
  assert.ok(!edit.moments.some((m) => m.drill), "no drill moment");
});

test("a group made with only one kubb of this turn's is not this turn's group", () => {
  const throws = match();
  drilling(throws, 24, "A", [tight[0]], {
    already: [tight[1], tight[2]],
  });
  assert.equal(drillGroups(throws).size, 0);
});

test("a kubb out twice is picked, with where the other team stood it", () => {
  const throws = match();
  throws[33] = fact(33);
  drilling(
    throws,
    24,
    "A",
    [
      { id: "k10", x: 1.0, y: 5.2 },
      { id: "k11", x: 2.9, y: 5.3 }, // over the sideline, the second time
    ],
    {
      each: (j) =>
        j === 1
          ? {
              ruling: "out twice: punishment kubb",
              outTwice: true,
              punished: true,
              placed: { x: 0.5, y: 8 },
            }
          : {},
    },
  );
  const edit = pickHighlights({ throws, end: southWins, teams });
  const m = edit.moments.find((x) => x.i === 25);
  assert.ok(m, "the punishment is in");
  assert.equal(m.kind, "punished");
  assert.equal(
    m.caption,
    "North's kubb is out twice: South puts it at the back",
  );
  const hold = m.shots.at(-1);
  assert.equal(hold.cam, "settled");
  assert.deepEqual([hold.focus.x, hold.focus.y], [0.5, 8]);
});

test("drills share the reel: at most a third of it, and its length holds", () => {
  const throws = [];
  for (let i = 0; i < 120; i++) throws.push(fact(i));
  // a tight group every other turn, and good batons between
  for (let n = 0; n < 8; n++) {
    const i = 6 + n * 14;
    const side = n % 2 ? "B" : "A";
    const y = side === "A" ? 5.2 : 2.8;
    drilling(
      throws,
      i,
      side,
      [0, 1, 2, 3].map((j) => ({
        id: `k${n}${j}`,
        x: j * 0.15,
        y: y + (j % 2) * 0.1,
      })),
    );
    throws[i + 8] = hit(i + 8, {
      ruling: "2 field kubbs down",
      toppled: ["x1", "x2"],
      down: 2,
    });
  }
  throws[119] = kingWin(119);
  const edit = pickHighlights({ throws, end: southWins, teams });
  const drills = edit.moments.filter((m) => m.drill).length;
  assert.ok(drills >= 1, "at least one");
  assert.ok(
    drills <= Math.max(1, Math.floor(edit.moments.length / tune.drillShare)),
    `${drills} drills of ${edit.moments.length}`,
  );
  assert.ok(edit.moments.length <= tune.maxMoments);
  assert.ok(
    edit.seconds >= tune.minSeconds && edit.seconds <= tune.maxSeconds,
    `${edit.seconds} s`,
  );
  const order = edit.moments.map((m) => m.i);
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
});
