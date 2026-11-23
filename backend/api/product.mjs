// What the api function writes to its log about how the game is used: one `product`
// line for each thing a player did that the dashboards count (a pitch made, a match
// started or ended, a match against the computer kept, a report, a share, a reel, a
// replay opened). Pure: no AWS. The contract is backend/api/API.md "Logs".
//
// A product line never says who. It carries no pitch code, no name, no member id, no
// typed text and no address: only the kind of thing that happened and a few small facts
// about it (which engine, which scene, how many people). PRODUCT_FIELDS is the whole
// list, and productLine drops anything that is not on it or is not the plain value its
// field takes, so a new field is a decision made here and held by a test
// (tests/api/product.test.mjs), never something that rides in with a request.

import { GAME_MODES, REPORT_KINDS, REPORT_MODES, isObject } from "./checks.mjs";

// A short lower case word, as the engine spells its own ids ("night", "pro", "2-4-6").
// A generated name has a capital and a space, so it is never one.
const WORD = /^[a-z0-9][a-z0-9-]{0,23}$/;
const word = (x) => (typeof x === "string" && WORD.test(x) ? x : null);
const oneOf = (list) => (x) => (list.includes(x) ? x : null);
const count = (max) => (x) =>
  Number.isSafeInteger(x) && x >= 0 && x <= max ? x : null;
const flag = (x) => (typeof x === "boolean" ? x : null);
const MINOR = /^\d{1,3}\.\d{1,3}$/;
const engine = (x) => (typeof x === "string" && MINOR.test(x) ? x : null);
const SIDES = /^[0-6]v[0-6]$/;
const sides = (x) => (typeof x === "string" && SIDES.test(x) ? x : null);

const FRONTS = ["web", "ios", "other", "unknown"];
const front = oneOf(FRONTS);

// action -> { field: its check }. A check returns the value to log, or null to drop it.
export const PRODUCT_FIELDS = Object.freeze({
  // a pitch was made (its `open` push, the first time)
  "pitch-open": {},
  // a match started on a pitch (its `start` push, the first time)
  "match-start": {
    engine,
    scene: word,
    opening: word,
    raising: word,
    sides, // seats a side, people and computers together: "2v2"
    people: count(12),
    computers: count(12),
    level: word, // the computer's, when one level plays
    rematch: flag,
  },
  // a match on a pitch ended and its replay was kept (its `keep` push, the first time)
  "match-over": {
    engine,
    actions: count(100_000),
    minutes: count(100_000),
  },
  // a match on one device, against or between computers, was kept (`game`)
  game: {
    mode: oneOf(GAME_MODES),
    front,
    engine,
    scene: word,
    level: word,
    outcome: oneOf(["finished", "left"]),
    how: word,
    winner: oneOf(["player", "computer"]),
    actions: count(100_000),
  },
  // a report was kept (`report`)
  report: {
    kind: oneOf(REPORT_KINDS),
    mode: oneOf(REPORT_MODES),
    front,
    engine,
  },
  // a match against the computer was shared, or was not (`share`)
  share: {
    front,
    engine,
    outcome: oneOf(["shared", "again", "refused"]),
    why: word,
  },
  // a highlight reel was asked for (`reel`)
  reel: {
    outcome: oneOf(["started", "rendering", "done", "failed", "none"]),
    why: word,
  },
  // a kept replay was asked for (`replay`)
  replay: {
    outcome: oneOf(["found", "none"]),
  },
});

// The line for `action`: { event: "product", action, ...the fields that pass }. An
// action that is not on the list is no line at all (null).
export function productLine(action, fields = {}) {
  const allowed = PRODUCT_FIELDS[action];
  if (!allowed) return null;
  const line = { event: "product", action };
  for (const [name, check] of Object.entries(allowed)) {
    const value = fields?.[name];
    if (value === undefined || value === null) continue;
    const checked = check(value);
    if (checked !== null) line[name] = checked;
  }
  return line;
}

// ---------- reading the small facts out of what was sent ----------

// The program that sent a request: "web", "ios", another tag ("other") or none.
export function frontOf(client) {
  if (client === undefined || client === null) return "unknown";
  return client === "web" || client === "ios" ? client : "other";
}

// An engine version as its major.minor ("1.0.0" and "1.0" are both "1.0"), or null.
export function engineOf(version) {
  if (typeof version !== "string") return null;
  const m = /^(\d{1,3})\.(\d{1,3})(?:[.+-]|$)/.exec(version);
  return m ? `${m[1]}.${m[2]}` : null;
}

const seats = (team) =>
  Array.isArray(team?.players) ? Math.min(team.players.length, 6) : 0;
const here = (list) => (Array.isArray(list) ? list.length : 0);

// The one level the computers of a match play at, or null when there is none or several.
function levelOf(setup, people) {
  if (typeof setup?.computer === "string") return setup.computer;
  const levels = new Set();
  for (const side of ["A", "B"]) {
    const players = setup?.teams?.[side]?.players;
    if (!Array.isArray(players)) continue;
    // a side's people come first; its computer seats are the rest
    for (const p of players.slice(here(people?.[side])))
      if (typeof p?.level === "string") levels.add(p.level);
  }
  return levels.size === 1 ? [...levels][0] : null;
}

// From a pitch's start: the match's `meta` as the host sent it and its number.
export function startFacts(meta, n) {
  const setup = isObject(meta?.setup) ? meta.setup : {};
  const a = seats(setup.teams?.A);
  const b = seats(setup.teams?.B);
  const people = Math.min(
    here(meta?.players?.A) + here(meta?.players?.B),
    a + b,
  );
  return {
    engine: engineOf(meta?.engine),
    scene: setup.scene,
    opening: setup.opening,
    raising: setup.raising,
    sides: `${a}v${b}`,
    people,
    computers: a + b - people,
    level: levelOf(setup, meta?.players),
    rematch: Number.isSafeInteger(n) ? n > 1 : null,
  };
}

// From a pitch's kept replay: how long the match was.
export function overFacts(body) {
  const ms = body?.at - body?.started;
  return {
    engine: engineOf(body?.meta?.engine),
    actions: Array.isArray(body?.log) ? body.log.length : null,
    minutes: Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 60_000) : null,
  };
}

// From a match played on one device (`game`).
export function gameFacts(g) {
  const options = isObject(g?.options) ? g.options : {};
  const over = g?.end?.over === true;
  const winner = g?.end?.winner;
  return {
    mode: g?.mode,
    front: frontOf(g?.client),
    engine: engineOf(g?.engine),
    scene: options.scene,
    level: levelOf(options, { A: g?.mode === "solo" ? [1] : [], B: [] }),
    outcome: over ? "finished" : "left",
    how: over ? g.end.how : null,
    // a solo match's person is side A
    winner:
      over && g?.mode === "solo" && (winner === "A" || winner === "B")
        ? winner === "A"
          ? "player"
          : "computer"
        : null,
    actions: Array.isArray(g?.actions) ? g.actions.length : null,
  };
}
