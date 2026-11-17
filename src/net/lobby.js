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
import { roomCall, setRoomEngine } from "./room-engine.js";

// May a member whose engine is not known (a tab still on a web build from before the
// engine was named, kubb-engine 0.2) play? Yes for now: 0.2 and 0.3 play every match to
// the same hashes. A member whose engine differs is refused either way. This flips to
// strict (false) before the iPhone app ships, once every client names its engine.
export const LENIENT_ENGINES = true;

// The engine's constants (room.constants), read once by useRoomEngine.
export let DOC_VERSION;
export let TEAM_MAX;
export let SEATS; // an open game's places, as the home page's list shows them
export let SIDES;
export let NAME_MAX;
export let OPTION_DEFAULTS;
export let MATCH_OPTIONS; // [key, label, [[value, label], ...]], as on the solo card
export let LEVELS;
export let LOG_BUDGET;
export let REPLAY_VERSION;
// This engine's major.minor ("0.3"): what a member sends as me.engine and what START
// stamps as match.engine.
export let ENGINE;

// Once, with the page's engine, before anything here is called.
export function useRoomEngine(engine) {
  setRoomEngine(engine);
  const k = roomCall("constants");
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

// A reducer's "nothing to write" comes back as null; room.update wants undefined.
const write = (name, args) => roomCall(name, args) ?? undefined;

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

// The engine's newMatch options for a lineup.
export const matchOptions = (doc, lineup, { seed, start }) =>
  roomCall("matchOptions", { doc, lineup, seed, start });

// May START go ahead? { ok, engine, differ: [ids], unknown: [ids] }.
export const startCheck = (players, members, host) =>
  roomCall("startCheck", {
    players,
    members,
    host,
    lenient: LENIENT_ENGINES,
  });

// START: the match from the host's first snapshot, stamped with this engine's version.
// Refused (undefined) while a match runs or startCheck refuses.
export const startMatch = (
  doc,
  { snap, hash, players, cpu, host, setup, members = [] },
) =>
  write("startMatch", {
    doc,
    snap,
    hash,
    players,
    cpu,
    host,
    setup,
    members,
    lenient: LENIENT_ENGINES,
  });

// An action committed: the snapshot after it, as action `seq` of match `n`. Refused
// unless it follows the document's own last action (the loser adopts).
export const commitAction = (doc, { n, seq, snap, hash, action, over }) =>
  write("commitAction", { doc, n, seq, snap, hash, action, over });

// A match's replay when it has ended with a whole log, else null.
export const replayOf = (match) => roomCall("replayOf", { match });
export const isReplay = (replay) => roomCall("isReplay", { replay });

// REMATCH: back to the lobby with the same teams.
export const backToLobby = (doc, n) => write("backToLobby", { doc, n });

// May a member whose engine is `engine` (major.minor) play `match`?
// { ok, why: null | "unknown" | "differs", engine, match }.
export const mayPlay = (engine, match) =>
  roomCall("mayPlay", { engine, match, lenient: LENIENT_ENGINES });
