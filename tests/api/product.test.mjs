// The api's product lines (backend/api/product.mjs): what the dashboards count about
// how the game is used. This file is the list's guard: a product line says what
// happened and never who, so a new field is added here on purpose.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PRODUCT_FIELDS,
  engineOf,
  frontOf,
  gameFacts,
  overFacts,
  productLine,
  startFacts,
} from "../../backend/api/product.mjs";

test("the whole list: every action and the fields it may carry", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(PRODUCT_FIELDS).map(([a, f]) => [a, Object.keys(f)]),
    ),
    {
      "pitch-open": [],
      "match-start": [
        "engine",
        "scene",
        "opening",
        "raising",
        "sides",
        "people",
        "computers",
        "level",
        "rematch",
      ],
      "match-over": ["engine", "actions", "minutes"],
      game: [
        "mode",
        "front",
        "engine",
        "scene",
        "level",
        "outcome",
        "how",
        "winner",
        "actions",
      ],
      report: ["kind", "mode", "front", "engine"],
      share: ["front", "engine", "outcome", "why"],
      reel: ["outcome", "why"],
      replay: ["outcome"],
    },
  );
  // nothing on the list can say who or which pitch
  const all = Object.values(PRODUCT_FIELDS).flatMap((f) => Object.keys(f));
  for (const never of ["pitch", "code", "name", "member", "id", "text", "ip"])
    assert.ok(!all.includes(never), never);
});

test("productLine: only the listed fields, only as the plain values they take", () => {
  assert.equal(productLine("nothing-we-count", { a: 1 }), null);
  assert.deepEqual(productLine("pitch-open", { pitch: "abcdefgh23" }), {
    event: "product",
    action: "pitch-open",
  });
  assert.deepEqual(
    productLine("match-start", {
      engine: "1.0",
      scene: "night",
      opening: "2-4-6",
      raising: "hand",
      sides: "2v1",
      people: 2,
      computers: 1,
      level: "pro",
      rematch: false,
      // none of these is on the list
      pitch: "abcdefgh23",
      name: "Mighty Maple",
      member: "m-1",
    }),
    {
      event: "product",
      action: "match-start",
      engine: "1.0",
      scene: "night",
      opening: "2-4-6",
      raising: "hand",
      sides: "2v1",
      people: 2,
      computers: 1,
      level: "pro",
      rematch: false,
    },
  );
  // a value that is not the plain kind its field takes is dropped, not logged
  assert.deepEqual(
    productLine("match-start", {
      engine: "1.0.0-rc1 by Mighty Maple",
      scene: "Mighty Maple", // a generated name: a capital and a space
      opening: "x".repeat(40),
      raising: { by: "hand" },
      sides: "12v12",
      people: -1,
      computers: 1.5,
      level: "Not A Level!",
      rematch: "yes",
    }),
    { event: "product", action: "match-start" },
  );
  assert.deepEqual(
    productLine("game", { mode: "pitch", front: "safari", outcome: "won" }),
    { event: "product", action: "game" },
  );
  assert.deepEqual(productLine("reel", { outcome: "done", why: null }), {
    event: "product",
    action: "reel",
    outcome: "done",
  });
});

test("frontOf and engineOf: the program and the engine's major.minor", () => {
  assert.equal(frontOf("web"), "web");
  assert.equal(frontOf("ios"), "ios");
  assert.equal(frontOf("playdate"), "other");
  assert.equal(frontOf(undefined), "unknown");
  assert.equal(engineOf("1.0.0"), "1.0");
  assert.equal(engineOf("0.18"), "0.18");
  assert.equal(engineOf("1.0.0+engines"), "1.0");
  assert.equal(engineOf("one point oh"), null);
  assert.equal(engineOf(1), null);
});

// A start as the web sends it (src/net/pitch.js): the setup is the engine's match
// options, `players` each side as seated (a computer player marked `cpu`, with its
// level), `cpu` a side nobody is on.
const SETUP = {
  scene: "night",
  opening: "2-4-6",
  raising: "hand",
  wind: "none",
  // the match's own computer level: there even when no computer takes it
  computer: "club",
  teams: {
    A: {
      name: "Mighty Maple",
      players: [
        { name: "Bold Birch", key: "m-1", level: "club" },
        { name: "Calm Cedar", key: "cpu:1", level: "pro", cpu: true },
      ],
    },
    B: {
      name: "Lucky Larch",
      players: [{ name: "Lucky Larch", key: "m-2", level: "club" }],
    },
  },
};
const PLAYERS = {
  A: [
    { id: "m-1", name: "Bold Birch" },
    { id: "cpu:1", name: "Calm Cedar", cpu: true, level: "pro" },
  ],
  B: [{ id: "m-2", name: "Lucky Larch" }],
};

test("startFacts: a match's start, with its people and computers counted and no name", () => {
  const facts = startFacts(
    { v: 1, setup: SETUP, engine: "1.0.0", players: PLAYERS, cpu: null },
    2,
  );
  // two people and one computer player: the computer is not a person, and its level
  // is its own, not the match's (which no computer here takes)
  assert.deepEqual(facts, {
    engine: "1.0",
    scene: "night",
    opening: "2-4-6",
    raising: "hand",
    sides: "2v1",
    people: 2,
    computers: 1,
    level: "pro",
    rematch: true,
  });
  const line = JSON.stringify(productLine("match-start", facts));
  for (const word of ["Maple", "Birch", "Cedar", "Larch", "m-1", "m-2", "cpu:"])
    assert.ok(!line.includes(word), word);
  // a start with nothing readable in it is still a line, with what could be read
  assert.deepEqual(productLine("match-start", startFacts(null, null)), {
    event: "product",
    action: "match-start",
    sides: "0v0",
    people: 0,
    computers: 0,
  });
});

test("startFacts: the level is the computers that play, wherever they sit", () => {
  const level = (meta) => {
    const f = startFacts({ setup: SETUP, players: PLAYERS, ...meta }, 1);
    return [f.people, f.computers, f.level];
  };
  // people only: no computer, so no level, whatever the match's own says
  assert.deepEqual(
    level({ players: { A: [{ id: "m-1" }], B: [{ id: "m-2" }] } }),
    [2, 0, null],
  );
  // one person against the side nobody is on: the match's computer plays it
  const alone = { players: { A: [{ id: "m-1" }], B: [] }, cpu: "B" };
  assert.deepEqual(level(alone), [1, 1, "club"]);
  assert.deepEqual(level({ ...alone, setup: { ...SETUP, computer: "pro" } }), [
    1,
    1,
    "pro",
  ]);
  // a match that names no level plays at the engine's default
  assert.deepEqual(
    level({ ...alone, setup: { ...SETUP, computer: undefined } }),
    [1, 1, "club"],
  );
  // computer players seated before a person, at two levels
  const two = {
    A: [
      { id: "cpu:2", cpu: true, level: "beginner" },
      { id: "m-1" },
      { id: "cpu:1", cpu: true, level: "pro" },
    ],
    B: [{ id: "m-2" }],
  };
  assert.deepEqual(level({ players: two }), [2, 2, "mixed"]);
  // a computer player and the computer's own side, both at Pro
  assert.deepEqual(
    level({
      players: { A: PLAYERS.A, B: [] },
      cpu: "B",
      setup: { ...SETUP, computer: "pro" },
    }),
    [1, 2, "pro"],
  );
  // and at Pro and Club
  assert.deepEqual(level({ players: { A: PLAYERS.A, B: [] }, cpu: "B" }), [
    1,
    2,
    "mixed",
  ]);
  // the Kid computer is the match's: every computer in it is Kid
  assert.deepEqual(level({ setup: { ...SETUP, computer: "kid" } }), [
    2,
    1,
    "kid",
  ]);
});

test("overFacts and gameFacts: how long, how it ended, who won as player or computer", () => {
  assert.deepEqual(
    overFacts({
      at: 1_000_000 + 14.6 * 60_000,
      started: 1_000_000,
      meta: { engine: "1.0.0" },
      log: [{}, {}, {}],
    }),
    { engine: "1.0", actions: 3, minutes: 15 },
  );
  assert.deepEqual(overFacts({ at: 5, started: 10 }), {
    engine: null,
    actions: null,
    minutes: null,
  });
  const g = {
    mode: "solo",
    client: "ios",
    engine: "1.0.0",
    options: { scene: "day", computer: "club" },
    actions: [{}, {}],
    end: { over: true, winner: "B", how: "king", text: "Lucky Larch won" },
  };
  assert.deepEqual(productLine("game", gameFacts(g)), {
    event: "product",
    action: "game",
    mode: "solo",
    front: "ios",
    engine: "1.0",
    scene: "day",
    level: "club",
    outcome: "finished",
    how: "king",
    winner: "computer",
    actions: 2,
  });
  // left before the end: no winner and no how
  assert.deepEqual(
    productLine("game", gameFacts({ ...g, mode: "watch", end: null })),
    {
      event: "product",
      action: "game",
      mode: "watch",
      front: "ios",
      engine: "1.0",
      scene: "day",
      level: "club",
      outcome: "left",
      actions: 2,
    },
  );
});
