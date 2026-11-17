// The pitch's shared document (docs/MULTIPLAYER.md): the lobby and, once the
// host starts, the match. Pure: these are the reducers the room's
// compare-and-set runs (room.update(fn)), tested in tests/net/lobby.test.mjs.
// Each returns the whole new document, or undefined to change nothing (the
// room client then writes nothing).
//
//   {
//     v: 1,
//     teams:   { A: [memberId, ...], B: [...] },   in throwing order, 0 to 6 each
//     options: { surface, opening, raising, wind, set },
//     open:    false | true,     the host's choice: true lists the pitch under
//                                OPEN GAMES on the home page (docs/ROOMS.md
//                                section 9); false (invite only) does not
//     started: false | true,
//     n:       0,                                  matches started on this pitch
//     match:   null | {
//       n,                    the match number (doc.n when it started)
//       seq,                  actions committed (0 at the start)
//       snap,                 the engine's snapshot, text exactly as it gave it
//       hash,                 the engine's hash of that snapshot
//       players: { A: [{ id, name }], B: [...] },  who plays, frozen at START
//       cpu:     "A" | "B" | null,                 the computer's side
//       host,                 who started it
//       setup,                the engine's newMatch options (the replay sets out from them)
//       h0,                   the engine's hash at the start
//       log:   [{ a, h }],    every action committed, with the hash after it: the
//                             replay's. One an action (log.length === seq) while it is
//                             whole; null once it is not (an older browser committed
//                             without it, or the document would grow too big)
//       over:  true,          the match has ended (set by the action that ended it)
//     }
//   }
//
// The snapshot is opaque text: never JSON.parse it and write it back (that
// turns 3.0 into 3 and changes the hash).

import { asciiSize } from "./sync.js";

export const DOC_VERSION = 1;
export const TEAM_MAX = 6;
// An open game's places, as the home page's list shows them: both teams full.
export const SEATS = 2 * TEAM_MAX;
export const SIDES = ["A", "B"];
export const NAME_MAX = 16;

export const OPTION_DEFAULTS = {
  surface: "grass",
  opening: "2-4-6",
  raising: "hand",
  wind: "off",
  set: "classic",
};

// The match options the host sets: [key, label, [[value, label], ...]], as on
// the solo options card. (Each player's throw level is their own.)
export const MATCH_OPTIONS = [
  [
    "surface",
    "Surface",
    [
      ["grass", "Grass"],
      ["sand", "Sand"],
      ["snow", "Snow"],
    ],
  ],
  [
    "opening",
    "Opening",
    [
      ["2-4-6", "2-4-6"],
      ["six", "Six batons"],
    ],
  ],
  [
    "raising",
    "Raising",
    [
      ["hand", "By hand"],
      ["auto", "Automatic"],
    ],
  ],
  [
    "wind",
    "Wind",
    [
      ["off", "Off"],
      ["light", "Light"],
      ["strong", "Strong"],
    ],
  ],
  [
    "set",
    "Kubbs",
    [
      ["classic", "Classic"],
      ["usa", "USA"],
      ["sweden", "Sweden"],
      ["minnesota", "Minnesota"],
      ["wisconsin", "Wisconsin"],
    ],
  ],
];

const OPTION_VALUES = Object.fromEntries(
  MATCH_OPTIONS.map(([k, , choices]) => [k, choices.map(([v]) => v)]),
);

// Only known keys with known values; the rest take the defaults.
export function cleanOptions(o = {}) {
  const out = { ...OPTION_DEFAULTS };
  for (const [k, values] of Object.entries(OPTION_VALUES))
    if (o && values.includes(o[k])) out[k] = o[k];
  return out;
}

export function optionLabel(key, value) {
  const row = MATCH_OPTIONS.find(([k]) => k === key);
  const c = row && row[2].find(([v]) => v === value);
  return c ? c[1] : String(value);
}

// The document as it stands, or a fresh lobby (a room's document is null
// until someone writes it; an expired room comes back empty too).
export function lobbyOf(doc) {
  const d = doc && typeof doc === "object" ? doc : {};
  const teams = { A: [], B: [] };
  for (const s of SIDES)
    if (Array.isArray(d.teams?.[s]))
      teams[s] = d.teams[s].filter((x) => typeof x === "string");
  return {
    v: DOC_VERSION,
    teams,
    options: cleanOptions(d.options),
    open: d.open === true,
    started: !!d.started,
    n: Number.isInteger(d.n) ? d.n : 0,
    match: d.match && typeof d.match === "object" ? d.match : null,
  };
}

// Which side a member is on in the lobby, or null (watching).
export function sideOf(doc, id) {
  const l = lobbyOf(doc);
  for (const s of SIDES) if (l.teams[s].includes(id)) return s;
  return null;
}

// Put member `id` on `side` ("A" | "B"), or take them off both (null: sit out
// and watch). Only between matches; a full side refuses.
export function joinTeam(doc, id, side) {
  const l = lobbyOf(doc);
  if (l.started) return undefined;
  if (side !== null && !SIDES.includes(side)) return undefined;
  if (side && l.teams[side].includes(id)) return undefined;
  if (side && l.teams[side].length >= TEAM_MAX) return undefined;
  const was = SIDES.some((s) => l.teams[s].includes(id));
  if (!side && !was) return undefined;
  for (const s of SIDES) l.teams[s] = l.teams[s].filter((x) => x !== id);
  if (side) l.teams[side].push(id);
  return l;
}

// The host's match options (merged; unknown values ignored).
export function setOptions(doc, options) {
  const l = lobbyOf(doc);
  if (l.started) return undefined;
  const next = { ...l.options };
  for (const [k, values] of Object.entries(OPTION_VALUES))
    if (options && values.includes(options[k])) next[k] = options[k];
  if (doc && JSON.stringify(next) === JSON.stringify(l.options))
    return undefined;
  l.options = next;
  return l;
}

// The host's choice: open (anyone may join from the home page's list) or invite
// only (the link is the only way in). Between matches or during one.
export function setAccess(doc, open) {
  const l = lobbyOf(doc);
  if (doc && l.open === !!open) return undefined;
  l.open = !!open;
  return l;
}

// What the host tells the room server about an open pitch, for the home page's list
// (backend/rooms/core.mjs checkOpen), or null while it is invite only. `members`: the
// room's members; `over`: the match on screen has ended.
export function openListing(doc, members, { over = false } = {}) {
  const l = lobbyOf(doc);
  if (!l.open) return null;
  const here = members.filter((m) => m.connected !== false).length;
  return {
    players: Math.min(here, SEATS),
    seats: SEATS,
    state: !l.started ? "waiting" : over ? "over" : "playing",
  };
}

// Forget members who left the room for good (`present`: the ids still in
// it). Between matches only; the match keeps its own players.
export function pruneTeams(doc, present) {
  const l = lobbyOf(doc);
  if (l.started) return undefined;
  const keep = new Set(present);
  let changed = false;
  for (const s of SIDES) {
    const t = l.teams[s].filter((x) => keep.has(x));
    if (t.length !== l.teams[s].length) changed = true;
    l.teams[s] = t;
  }
  return changed ? l : undefined;
}

// Who plays: the lobby's teams with each member's name, the computer on an
// empty side. `members`: the room's [{ id, me }]; members who are no longer
// in the room are left out. Returns { players, cpu } or null when nobody is on
// a team.
export function lineup(doc, members) {
  const l = lobbyOf(doc);
  const byId = new Map(members.map((m) => [m.id, m]));
  const players = { A: [], B: [] };
  for (const s of SIDES)
    for (const id of l.teams[s]) {
      const m = byId.get(id);
      if (!m) continue;
      players[s].push({
        id,
        name: cleanName(m.me?.name) || `Player ${players[s].length + 1}`,
        level: m.me?.level,
      });
    }
  if (!players.A.length && !players.B.length) return null;
  const cpu = !players.A.length ? "A" : !players.B.length ? "B" : null;
  return { players, cpu };
}

export function cleanName(name) {
  return typeof name === "string"
    ? name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX)
    : "";
}

// The engine's newMatch options for a lineup (src/engine: teams with each
// player's key = the member id, so a throw maps back to a member).
export function matchOptions(doc, { players, cpu }, { seed, start }) {
  const l = lobbyOf(doc);
  const team = (s) =>
    s === cpu
      ? { name: "Computer", players: [{ name: "Computer" }] }
      : {
          name: players[s].length === 1 ? players[s][0].name : `Team ${s}`,
          players: players[s].map((p) => ({
            name: p.name,
            key: p.id,
            level: LEVELS.includes(p.level) ? p.level : "club",
          })),
        };
  return {
    seed,
    start,
    teams: { A: team("A"), B: team("B") },
    cpu: cpu || [],
    first: "A",
    ...l.options,
  };
}

export const LEVELS = ["beginner", "club", "pro"];

// START: the match begins with the host's first snapshot. `setup` (the newMatch
// options) starts the replay's log.
export function startMatch(doc, { snap, hash, players, cpu, host, setup }) {
  const l = lobbyOf(doc);
  if (l.started) return undefined;
  const n = l.n + 1;
  l.started = true;
  l.n = n;
  l.match = {
    n,
    seq: 0,
    snap,
    hash,
    players: {
      A: players.A.map(({ id, name }) => ({ id, name })),
      B: players.B.map(({ id, name }) => ({ id, name })),
    },
    cpu: cpu || null,
    host,
  };
  if (setup && typeof setup === "object")
    Object.assign(l.match, { setup, h0: hash, log: [] });
  return l;
}

// An action committed: the snapshot after it, as action number `seq` of
// match `n`. Refused (undefined) unless it follows the document's own last
// action: the compare-and-set's loser drops its action and adopts.
// `action` goes on the replay's log with the hash after it; `over` when it ended the
// match. A log that cannot stay whole (no action, a gap, or the document past
// LOG_BUDGET) is dropped: that match has no replay.
export function commitAction(doc, { n, seq, snap, hash, action, over }) {
  const l = lobbyOf(doc);
  const m = l.match;
  if (!l.started || !m || m.n !== n || m.seq !== seq - 1) return undefined;
  l.match = { ...m, seq, snap, hash };
  if (Array.isArray(m.log)) {
    l.match.log =
      action && m.log.length === seq - 1
        ? [...m.log, { a: action, h: hash }]
        : null;
  }
  if (over) l.match.over = true;
  if (l.match.log && asciiSize(l) > LOG_BUDGET) l.match.log = null;
  return l;
}

// The most the document may grow to while it carries a replay's log (the room's limit is
// 256 KB). An action is about 360 B with its hash and a snapshot up to 30 KB, so this
// holds about 600 actions: a 35-turn match between the computers is about 400.
export const LOG_BUDGET = 248 * 1024;

// A match's replay, when it has one: it has ended and its log is whole. This is what a
// pitch keeps (room.keep, docs/ROOMS.md section 10) and what the replay player plays
// (src/replay/player.js): { v, n, setup, h0, log, snap, hash, players, cpu }. Older
// matches (from before replays, or committed by an older browser) give null: their
// pitch shows the result without a replay.
export const REPLAY_VERSION = 1;
export function replayOf(match) {
  const m = match;
  if (!m || typeof m !== "object" || m.over !== true) return null;
  if (!m.setup || typeof m.setup !== "object" || typeof m.snap !== "string")
    return null;
  if (!Array.isArray(m.log) || m.log.length !== m.seq) return null;
  return {
    v: REPLAY_VERSION,
    n: m.n,
    setup: m.setup,
    h0: m.h0 ?? null,
    log: m.log,
    snap: m.snap,
    hash: m.hash,
    players: m.players,
    cpu: m.cpu ?? null,
  };
}

// The same check for a replay that came from elsewhere (the room's kept copy).
export function isReplay(r) {
  return (
    !!r &&
    typeof r === "object" &&
    r.v === REPLAY_VERSION &&
    ((!!r.setup && typeof r.setup === "object") ||
      typeof r.start === "string") &&
    Array.isArray(r.log) &&
    r.log.every((e) => e && typeof e.a === "object" && e.a) &&
    typeof r.snap === "string"
  );
}

// REMATCH: back to the lobby with the same teams (the old match is dropped from the
// document; its replay was kept by the room when it ended).
export function backToLobby(doc, n) {
  const l = lobbyOf(doc);
  if (!l.started || (n != null && l.n !== n)) return undefined;
  l.started = false;
  l.match = null;
  return l;
}
