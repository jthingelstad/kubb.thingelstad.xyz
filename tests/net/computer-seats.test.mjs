// Computer seats (engine 0.17, its docs/PITCH.md "Computer seats"; docs/MULTIPLAYER.md
// "Computer players"): the web's wrappers over the engine's four reducers, and what the
// lobby and START read from a document with seats. The rules themselves are the
// engine's (its tests); these pin the web's calls: their arguments, `.value`, and null
// to undefined.
import { test } from "node:test";
import assert from "node:assert/strict";
import { engine } from "./room-engine.mjs";
import {
  ENGINE,
  SEAT_LEVELS,
  TEAM_MAX,
  addComputer,
  isSeat,
  joinTeam,
  lineup,
  lobbyOf,
  matchOptions,
  moveComputer,
  openListing,
  removeComputer,
  roomEngineFor,
  setAccess,
  setComputerLevel,
  setOptions,
  startCheck,
  startMatch,
} from "../../src/net/lobby.js";
import { controlFor, mayAct, shownActor } from "../../src/net/seats.js";
import {
  seatLine,
  seatSpoken,
  SEAT_SAYS,
  COMPUTER_ROW,
} from "../../src/ui/lobby.js";
import { handoffCpu } from "../../src/ui/handoff-words.js";
import { headerLine } from "../../src/game/hud.js";

const me = (name) => ({ name, level: "club", engine: ENGINE });
const members = [
  { id: "jamie001", connected: true, me: me("Mighty Maple") },
  { id: "tyler001", connected: true, me: me("Lucky Larch") },
];

function seated() {
  let d = joinTeam(null, "jamie001", "A");
  d = joinTeam(d, "tyler001", "B");
  d = addComputer(d, "A", "pro", { seed: 11 });
  d = addComputer(d, "B", "pro", { seed: 12 });
  return d;
}

test("the levels a seat may have are the engine's: Beginner, Club, Pro", () => {
  assert.deepEqual(SEAT_LEVELS, ["beginner", "club", "pro"]);
  assert.equal(isSeat("cpu:1"), true);
  assert.equal(isSeat("cpu:0"), false);
  assert.equal(isSeat("jamie001"), false);
  assert.equal(isSeat(null), false);
});

test("2 v 2: each person with a pro partner, named, in throwing order", () => {
  const d = seated();
  const l = lobbyOf(d);
  assert.deepEqual(l.teams, {
    A: ["jamie001", "cpu:1"],
    B: ["tyler001", "cpu:2"],
  });
  for (const id of ["cpu:1", "cpu:2"]) {
    assert.equal(l.computers[id].level, "pro");
    assert.equal(
      engine.call("names.valid", { kind: "player", text: l.computers[id].name })
        .ok,
      true,
    );
  }
  assert.notEqual(l.computers["cpu:1"].name, l.computers["cpu:2"].name);
  // the lineup has each seat in its place, cpu and its level kept
  const lu = lineup(d, members);
  assert.equal(lu.cpu, null);
  assert.deepEqual(
    lu.players.A.map((p) => [p.id, !!p.cpu, p.level]),
    [
      ["jamie001", false, "club"],
      ["cpu:1", true, "pro"],
    ],
  );
  // the engine's newMatch options: the seat's key its id, cpu true, its level
  const o = matchOptions(d, lu, { seed: 5, start: null });
  assert.deepEqual(o.cpu, []);
  assert.deepEqual(
    o.teams.A.players.map((p) => [p.key, p.cpu ?? false, p.level]),
    [
      ["jamie001", false, "club"],
      ["cpu:1", true, "pro"],
    ],
  );
  // START: the header keeps cpu and level on the computer players
  assert.equal(startCheck(lu.players, members, "jamie001").ok, true);
  const s = startMatch(d, {
    snap: "{}",
    hash: "h",
    players: lu.players,
    cpu: lu.cpu,
    host: "jamie001",
    members,
  });
  assert.deepEqual(s.match.players.B[1], {
    id: "cpu:2",
    name: l.computers["cpu:2"].name,
    cpu: true,
    level: "pro",
  });
  // who acts: a computer partner's throw is the host's browser's alone; no person may
  // take it, and it is shown as the computer's
  const ctx = {
    players: s.match.players,
    cpu: null,
    host: "jamie001",
    connected: ["jamie001", "tyler001"],
  };
  const need = {
    kind: "throw",
    side: "B",
    cpu: true,
    setup: { thrower: { key: "cpu:2", cpu: true, level: "pro" } },
  };
  assert.equal(mayAct(need, ctx, "tyler001"), false);
  assert.equal(mayAct(need, ctx, "jamie001"), false);
  assert.equal(shownActor(need, ctx), "cpu");
  assert.equal(controlFor(ctx, "jamie001").cpu, true);
  assert.equal(controlFor(ctx, "tyler001").cpu, false);
});

test("a seat re-levelled, moved within and across, removed; null is undefined", () => {
  let d = seated();
  d = addComputer(d, "A", "club", { seed: 13 }); // cpu:3, last on A
  assert.deepEqual(lobbyOf(d).teams.A, ["jamie001", "cpu:1", "cpu:3"]);
  d = setComputerLevel(d, "cpu:3", "beginner");
  assert.equal(lobbyOf(d).computers["cpu:3"].level, "beginner");
  assert.equal(
    setComputerLevel(d, "cpu:3", "beginner"),
    undefined,
    "unchanged",
  );
  assert.equal(
    setComputerLevel(d, "cpu:3", "kid"),
    undefined,
    "Kid is never a seat's",
  );
  // up: to the place of the row before it; down: to the place of the row after it
  d = moveComputer(d, "cpu:3", "A", 1);
  assert.deepEqual(lobbyOf(d).teams.A, ["jamie001", "cpu:3", "cpu:1"]);
  d = moveComputer(d, "cpu:3", "A", 2);
  assert.deepEqual(lobbyOf(d).teams.A, ["jamie001", "cpu:1", "cpu:3"]);
  d = moveComputer(d, "cpu:3", "A", 0);
  assert.deepEqual(lobbyOf(d).teams.A, ["cpu:3", "jamie001", "cpu:1"]);
  // across: last in the other team's order
  d = moveComputer(d, "cpu:3", "B", null);
  assert.deepEqual(lobbyOf(d).teams.B, ["tyler001", "cpu:2", "cpu:3"]);
  assert.equal(moveComputer(d, "cpu:3", "B", null), undefined, "already there");
  d = removeComputer(d, "cpu:3");
  assert.deepEqual(lobbyOf(d).teams.B, ["tyler001", "cpu:2"]);
  assert.equal(lobbyOf(d).computers["cpu:3"], undefined);
  assert.equal(removeComputer(d, "cpu:3"), undefined);
  // the last seat gone, so is `computers`
  d = removeComputer(removeComputer(d, "cpu:1"), "cpu:2");
  assert.equal("computers" in d, false);
});

test("six a team counts seats: a full side refuses a join, a seat and a move", () => {
  let d = joinTeam(null, "jamie001", "A");
  for (let i = 0; i < TEAM_MAX - 1; i++)
    d = addComputer(d, "A", "club", { seed: 100 + i });
  assert.equal(lobbyOf(d).teams.A.length, TEAM_MAX);
  assert.equal(addComputer(d, "A", "club", { seed: 9 }), undefined);
  assert.equal(joinTeam(d, "tyler001", "A"), undefined);
  d = addComputer(d, "B", "pro", { seed: 10 });
  assert.equal(moveComputer(d, "cpu:6", "A", 0), undefined);
});

test("three people against two club and one pro; the open listing counts seats", () => {
  const three = [
    ...members,
    { id: "kate0001", connected: true, me: me("Cheerful Cedar") },
  ];
  let d = null;
  for (const m of three) d = joinTeam(d, m.id, "A");
  d = addComputer(d, "B", "club", { seed: 1 });
  d = addComputer(d, "B", "club", { seed: 2 });
  d = addComputer(d, "B", "pro", { seed: 3 });
  const lu = lineup(d, three);
  assert.equal(lu.cpu, null, "a side of computers is not empty");
  assert.deepEqual(
    lu.players.B.map((p) => p.level),
    ["club", "club", "pro"],
  );
  d = setAccess(d, true);
  assert.equal(openListing(d, three).seats, 12 - 3);
});

test("START with no person is refused in the engine's words", () => {
  let d = addComputer(null, "A", "club", { seed: 1 });
  d = addComputer(d, "B", "pro", { seed: 2 });
  const lu = lineup(d, []);
  const ok = startCheck(lu.players, [], "jamie001");
  assert.equal(ok.ok, false);
  assert.equal(ok.why, "person");
  assert.equal(typeof ok.text, "string");
  assert.ok(ok.text.length > 10);
  assert.equal(
    startMatch(d, {
      snap: "{}",
      hash: "h",
      players: lu.players,
      cpu: lu.cpu,
      host: "jamie001",
      members: [],
    }),
    undefined,
  );
});

test("a Kid pitch: the seats keep their own level, the match makes every computer Kid", () => {
  let d = seated();
  d = setOptions(d, { computer: "kid" });
  assert.equal(lobbyOf(d).computers["cpu:1"].level, "pro", "kept for later");
  const o = matchOptions(d, lineup(d, members), { seed: 5, start: null });
  assert.equal(o.computer, "kid");
  const s = engine.newMatch(o);
  assert.ok(s);
  const v = engine.view();
  assert.equal(v.need.kid, true, "a Kid match");
});

test("a seat's name the engine refuses is shown as Computer (names.check)", () => {
  const d = seated();
  const typed = {
    ...d,
    computers: { ...d.computers, "cpu:2": { level: "pro", name: "Robo Rick" } },
  };
  const out = engine.call("names.check", { document: typed, members: [] });
  const from = (p) => out.names.find((n) => n.from === p);
  assert.equal(from("computers.cpu:1.name").ok, true);
  assert.equal(from("computers.cpu:2.name").ok, false);
  // and the lobby's own lobbyOf drops it
  assert.equal(lobbyOf(typed).computers["cpu:2"].name, undefined);
});

test("the words: a seat's row, what is said, the header line and the hand-off", () => {
  assert.equal(seatLine("Bold Birch", "pro"), "Bold Birch · computer · Pro");
  assert.equal(
    seatSpoken("Bold Birch", "pro", 2, 3, "A"),
    "Bold Birch, computer, Pro, 2 of 3 in Team A",
  );
  assert.equal(
    SEAT_SAYS.add("Bold Birch", "A", "club"),
    "Bold Birch joins Team A at Club.",
  );
  assert.equal(
    SEAT_SAYS.across("Bold Birch", "B"),
    "Bold Birch moves to Team B.",
  );
  assert.equal(COMPUTER_ROW.empty, "An empty side plays as");
  assert.equal(
    headerLine({ turn: 4, kind: "baton", n: 2, of: 6, cpu: "Pro" }),
    "Turn 4 · baton 2 of 6 · computer · pro",
  );
  assert.equal(
    headerLine({ turn: 2, kind: "Rethrow", n: 1, of: 1 }),
    "Turn 2 · rethrow 1 of 1",
  );
  assert.equal(
    handoffCpu({
      thrower: "Bold Birch",
      throwerCpu: true,
      throwerLevel: "pro",
    }),
    "Bold Birch throws first · computer · Pro",
  );
  assert.equal(handoffCpu({ thrower: "Mighty Maple" }), null);
});

test("the room's engine is the people's: a seat carries none (engine 0.17.0's engineFor counted it)", () => {
  const d = seated();
  const carrying = members.map((m) => ({
    ...m,
    me: { ...m.me, engine: `${ENGINE}+engines`, engines: [ENGINE] },
  }));
  assert.deepEqual(roomEngineFor(d, carrying, "jamie001"), {
    engine: ENGINE,
    missing: [],
    unknown: [],
  });
  // the engine alone, with the seats left in, names them as players with no engine
  const raw = engine.call("pitch.engineFor", {
    doc: d,
    members: carrying,
    host: "jamie001",
  }).value;
  assert.equal(
    raw.engine,
    null,
    "if this passes the engine skips seats: drop withoutSeats",
  );
  assert.deepEqual([...raw.unknown].sort(), ["cpu:1", "cpu:2"]);
});
