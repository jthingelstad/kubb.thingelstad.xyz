// The pitch's shared document (docs/MULTIPLAYER.md): the lobby and, once the
// host starts, the match. The reducers are the engine's (vendor/engine/room/lobby.lua,
// its docs/ROOM.md "The document"), the same the iPhone app calls; these are thin
// wrappers over `room.<name>` (src/net/room-engine.js). Each reducer returns the whole
// new document, or undefined to change nothing (the room client then writes nothing),
// as room.update(fn) expects.
//
//   {
//     v: 1,
//     teams:   { A: [memberId, ...], B: [...] },   in throwing order, 0 to 6 each
//     options: { surface, opening, raising, wind, set },
//     open:    false | true,     true lists the pitch under OPEN GAMES (docs/ROOMS.md 9)
//     started: false | true,
//     n:       0,                                  matches started on this pitch
//     match:   null | { n, seq, snap, hash, players, cpu, host, engine, setup, h0,
//                       log, over }
//     ...      any other top-level key is kept as it is (a newer client's)
//   }
//
// The snapshot is opaque text: never JSON.parse it and write it back (that
// turns 3.0 into 3 and changes the hash). The calls carry it as a string.
import {
  addRoomEngine,
  roomCall,
  roomEngineMinor,
  setRoomEngine,
} from "./room-engine.js";

// Admission requires a named, matching major.minor. Patches can play together.
export const LENIENT_ENGINES = false;

// The newest engine's constants (room.constants), read once by useRoomEngine: the
// engine the page plays on. engineConstants(mm) is any carried engine's.
export let DOC_VERSION;
export let TEAM_MAX;
export let SEATS; // an open game's places, as the web game's open-games list shows them
export let SIDES;
export let NAME_MAX;
export let OPTION_DEFAULTS;
export let MATCH_OPTIONS; // [key, label, [[value, label], ...]], as on the solo card
export let LEVELS;
export let LOG_BUDGET;
export let REPLAY_VERSION;
// The newest engine's major.minor ("0.3"): what a member sends as me.engine and what
// START stamps as match.engine.
export let ENGINE;

// Each engine's room.constants, by major.minor, read once apiece.
const constants = new Map();
export function engineConstants(mm = roomEngineMinor()) {
  let k = constants.get(mm);
  if (!k) {
    k = roomCall("constants", {}, mm);
    constants.set(mm, k);
  }
  return k;
}

// Once, with the page's newest engine, before anything here is called.
export function useRoomEngine(engine) {
  setRoomEngine(engine);
  constants.delete(roomEngineMinor());
  const k = engineConstants();
  ({
    DOC_VERSION,
    TEAM_MAX,
    SEATS,
    SIDES,
    NAME_MAX,
    OPTION_DEFAULTS,
    MATCH_OPTIONS,
    LEVELS,
    LOG_BUDGET,
    REPLAY_VERSION,
    ENGINE,
  } = k);
  return k;
}

// Another carried engine (src/engine/registry.js), once loaded; returns its
// major.minor. Play stays on the newest.
export function useOlderEngine(engine) {
  return addRoomEngine(engine);
}

// A reducer's "nothing to write" comes back as null; room.update wants undefined.
const write = (name, args, mm) => roomCall(name, args, mm) ?? undefined;

export const cleanOptions = (options) => roomCall("cleanOptions", { options });
export const optionLabel = (key, value) =>
  roomCall("optionLabel", { key, value });

const names = new Map(); // cleanName is asked for every name on screen: kept
export function cleanName(name) {
  if (typeof name !== "string") return "";
  let c = names.get(name);
  if (c === undefined) {
    c = roomCall("cleanName", { name });
    if (names.size > 256) names.clear();
    names.set(name, c);
  }
  return c;
}

export const lobbyOf = (doc) => roomCall("lobbyOf", { doc });

// Every match option the room holds, defaults filled in: the five in `options` and,
// since engine 0.9, the computer's level and the scene from the document's top-level
// `settings`. An engine before 0.9 has no optionsOf: its lobbyOf's options are all it
// knows. Asked once per engine, then remembered.
const noOptionsOf = new Set();
export function optionsOf(doc, mm = roomEngineMinor()) {
  if (!noOptionsOf.has(mm)) {
    try {
      return roomCall("optionsOf", { doc }, mm);
    } catch (e) {
      if (!/unknown call/.test(String(e?.message ?? e))) throw e;
      noOptionsOf.add(mm);
    }
  }
  return roomCall("lobbyOf", { doc }, mm).options;
}
export const sideOf = (doc, id) => roomCall("sideOf", { doc, id });
export const joinTeam = (doc, id, side) => write("joinTeam", { doc, id, side });
export const setOptions = (doc, options) =>
  write("setOptions", { doc, options });
export const setAccess = (doc, open) => write("setAccess", { doc, open });
export const pruneTeams = (doc, present) =>
  write("pruneTeams", { doc, present });

// What the host tells the room server about an open pitch, or null while it is invite
// only. The host asks on every tick: kept while the document and members are the same.
let listed = null;
export function openListing(doc, members, { over = false } = {}) {
  if (
    listed &&
    listed.doc === doc &&
    listed.members === members &&
    listed.over === over
  )
    return listed.value;
  const value = roomCall("openListing", { doc, members, over });
  listed = { doc, members, over, value };
  return value;
}

// Who plays: { players, cpu } or null when nobody is on a team.
export const lineup = (doc, members) => roomCall("lineup", { doc, members });

// The engine's newMatch options for a lineup, on engine `mm` (the room's).
export const matchOptions = (doc, lineup, { seed, start }, mm) =>
  roomCall("matchOptions", { doc, lineup, seed, start }, mm);

// ---------- several engines in one room (the engine's docs/ROOM.md, since 0.8.1) ----------
// These four are the newest engine's: older ones do not have them.

// The engine the pitch's next match runs on: { engine, missing: [ids], unknown: [ids] },
// engine null when none is carried by the host and every player. `me` (this browser's
// member id) counts this browser too, with `carries` (what it carries) while its own
// presence is still on its way.
export const roomEngineFor = (doc, members, host, me, carries) =>
  roomCall("engineFor", {
    doc,
    members,
    host: host ?? null,
    ...(me == null ? {} : { me }),
    ...(carries ? { carries } : {}),
  });

// The major.minors a member's presence says it carries, newest first.
export const carriedBy = (me) => roomCall("carried", { me: me ?? null });

// What this browser announces while the room's engine is `engine`:
// { engine: "<engine>+engines", engines: [...] }; its newest without one.
export const announce = (carries, engine) =>
  roomCall("announce", { carries, ...(engine ? { engine } : {}) });

// The members as the host passes them to `engine`'s own startMatch.
export const speakAs = (members, engine) =>
  roomCall("speakAs", { members, engine });

// -1, 0 or 1 as major.minor a is older, the same or newer than b; null when either is
// not one.
export const compareEngines = (a, b) => roomCall("compareEngines", { a, b });

// May START go ahead on engine `mm`? { ok, engine, differ: [ids], unknown: [ids] }.
export const startCheck = (players, members, host, mm) =>
  roomCall(
    "startCheck",
    {
      players,
      members,
      host,
      lenient: LENIENT_ENGINES,
    },
    mm,
  );

// START: the match from the host's first snapshot, stamped with engine `mm`'s
// major.minor (the newest without one). Refused (undefined) while a match runs or
// startCheck refuses.
export const startMatch = (
  doc,
  { snap, hash, players, cpu, host, setup, members = [] },
  mm,
) =>
  write(
    "startMatch",
    {
      doc,
      snap,
      hash,
      players,
      cpu,
      host,
      setup,
      members,
      lenient: LENIENT_ENGINES,
    },
    mm,
  );

// An action committed: the snapshot after it, as action `seq` of match `n`. Refused
// unless it follows the document's own last action (the loser adopts).
export const commitAction = (doc, { n, seq, snap, hash, action, over }, mm) =>
  write("commitAction", { doc, n, seq, snap, hash, action, over }, mm);

// A match's replay when it has ended with a whole log, else null.
export const replayOf = (match) => roomCall("replayOf", { match });
export const isReplay = (replay) => roomCall("isReplay", { replay });

// REMATCH: back to the lobby with the same teams.
export const backToLobby = (doc, n) => write("backToLobby", { doc, n });

// May a member whose engine is `engine` (major.minor) play `match`? On engine `mm`, the
// match's own. { ok, why: null | "unknown" | "differs", engine, match }.
export const mayPlay = (engine, match, mm) =>
  roomCall("mayPlay", { engine, match, lenient: LENIENT_ENGINES }, mm);
