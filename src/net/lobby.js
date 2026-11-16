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
//     }
//   }
//
// The snapshot is opaque text: never JSON.parse it and write it back (that
// turns 3.0 into 3 and changes the hash).

export const DOC_VERSION = 1;
export const TEAM_MAX = 6;
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

// START: the match begins with the host's first snapshot.
export function startMatch(doc, { snap, hash, players, cpu, host }) {
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
  return l;
}

// An action committed: the snapshot after it, as action number `seq` of
// match `n`. Refused (undefined) unless it follows the document's own last
// action: the compare-and-set's loser drops its action and adopts.
export function commitAction(doc, { n, seq, snap, hash }) {
  const l = lobbyOf(doc);
  const m = l.match;
  if (!l.started || !m || m.n !== n || m.seq !== seq - 1) return undefined;
  l.match = { ...m, seq, snap, hash };
  return l;
}

// REMATCH: back to the lobby with the same teams (the old match is dropped).
export function backToLobby(doc, n) {
  const l = lobbyOf(doc);
  if (!l.started || (n != null && l.n !== n)) return undefined;
  l.started = false;
  l.match = null;
  return l;
}
