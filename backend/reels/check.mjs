// The renderer's check of a shared match against the computer (docs/REEL.md "Sharing a
// match against the computer", backend/api/API.md "share"). The api function invokes the
// reel function synchronously with { check: g } and waits; this plays the match through
// the engine it was played on, when the function carries that engine, and answers. It
// writes nothing: the api function keeps what comes back.
//
//   checkShare({ g, carried, engines }) ->     carried: backend/reels/carried.mjs's set
//   checkShare({ g, sources, engine, engines })  (one engine: a set of one) ->
//     { ok: true, engine, document, replay, actions, throws }   document and replay are
//                 ASCII JSON text, built by the engine (replayDocument, replayOf)
//     { ok: false, why, step }   why: "engine", "name", "does-not-replay" or "too-long";
//                 step names the check that failed, for the log
//
// What it holds the match to (the engine's docs/SESSION.md "What a server can prove"):
//
//   engine    the match's major.minor (`g.engine`) is among `engines` (REEL_ENGINES) and
//             one the package carries; it is checked on that engine, so an iPhone build
//             still on an older minor shares on the engine it played
//   start     a match's first snapshot, exactly what newMatch makes of its own options
//             (checkStart); side A a person, side B the computer and named Computer; side
//             A's team and player named with a generated player name or one of the
//             engine's defaults (names.valid's `ok` or `default`, the engine's
//             docs/NAMES.md section 6), else refused "name": "Pick a name"
//   replay    every action taken in order (none refused), each of the computer's throws
//             the one the engine makes again from the snapshot before it (checkCpu), each
//             of the person's throws one the dial could make (checkThrows), the match over
//             at its last action with the winner and the number of throws the device
//             claims
//   size      the finished document keeps its log (the engine drops it past its budget,
//             and such a match has no replay), and the document and replay fit the room's
//             limits: otherwise "too-long"
//
// What it cannot prove is in the engine's docs: that a person made the throws (a
// program inside the bounds passes), that a fast throw was likely (a legal overpowered
// baton can reach about 57 m/s), and nothing about the computer's actions other than
// its throws (raising and placing are taken as legal moves, not made again).
//
// It logs nothing itself: the caller logs the step and the engine, never a name.
import { Engine } from "../../src/engine/index.js";
import { replayOf, useRoomEngine } from "../../src/net/lobby.js";
import { asciiJson } from "../api/checks.mjs";
import { majorMinor } from "./tag.mjs";
import { carriedLookup } from "./carried.mjs";

// What a shared match may keep, as the old rooms server held it (the api keeps the
// replay under its own LIMITS.replayBytes, backend/api/checks.mjs, the same size).
export const SHARE_KEEP = Object.freeze({
  docBytes: 256 * 1024,
  replayBytes: 256 * 1024,
});

export const COMPUTER = "Computer";

// A side's name as a share may carry it: a generated player name or one of the
// engine's defaults ("Player 1", ...), as names.valid says on the match's own engine.
// The share card offers only generated names (src/ui/share.js), so an honest client
// never sends another. A side of one player is named after that player, so side A's
// team name is checked as a player's.
export function nameAllowed(engine, name) {
  if (typeof name !== "string") return false;
  const v = engine.call("names.valid", { kind: "player", text: name });
  return !!(v.ok || v.default);
}

const no = (why, step) => ({ ok: false, why, step });

// Side A a person under an allowed name, side B the computer under its own: read from
// the start's options (before the replay) and the setup the engine made of them. null
// when they are; "name" for side A's name; else what is wrong.
function sidesOf(setup, engine) {
  const cpu = setup?.cpu;
  if (!Array.isArray(cpu) || cpu.length !== 1 || cpu[0] !== "B")
    return "not a person against the computer";
  const a = setup.teams?.A;
  const b = setup.teams?.B;
  if (!a || !Array.isArray(a.players) || a.players.length < 1)
    return "side A has no player";
  if (
    !nameAllowed(engine, a.name) ||
    !a.players.every((p) => nameAllowed(engine, p?.name))
  )
    return "name";
  if (
    !b ||
    b.name !== COMPUTER ||
    !Array.isArray(b.players) ||
    !b.players.every((p) => p?.name === COMPUTER)
  )
    return "side B is not named Computer";
  return null;
}

export async function checkShare({
  g,
  carried,
  sources,
  engine,
  engines = [],
}) {
  const played = majorMinor(g?.engine);
  const own = played
    ? carriedLookup({ carried, engine, sources })(played)
    : null;
  if (!own || majorMinor(own.engine) !== played || !engines.includes(played))
    return no("engine", "engine");
  if (typeof g.start !== "string" || !Array.isArray(g.log) || !g.end)
    return no("does-not-replay", "shape");

  let e = null;
  try {
    e = await Engine.create({ sources: own.sources });
    useRoomEngine(e);
    const start = e.call("checkStart", { start: g.start });
    if (!start?.ok) return no("does-not-replay", "start");
    // checkStart proved the start is newMatch's of these options: who plays, and names
    let opts = null;
    try {
      opts = JSON.parse(g.start)?.opts ?? null;
    } catch {
      opts = null;
    }
    const sides = sidesOf(opts, e);
    if (sides === "name") return no("name", "name");
    if (sides) return no("does-not-replay", "sides");
    e.call("replayLoad", {
      start: g.start,
      log: g.log,
      checkCpu: true,
      checkThrows: true,
      document: true,
    });
    const info = e.call("replayFinish");
    if (info.refusedAt != null) return no("does-not-replay", "refused");
    // the first of the two, when a changed throw also changes what follows it
    if (info.forged || info.outOfBounds) {
      const bounds =
        info.outOfBounds &&
        (!info.forged || (info.outOfBoundsAt ?? 0) <= (info.forgedAt ?? 0));
      return no("does-not-replay", bounds ? "bounds" : "computer");
    }
    if (!info.over) return no("does-not-replay", "not-over");
    const winner = e.need()?.winner?.winner ?? null;
    if (winner !== g.end.winner || info.thrown !== g.end.throws)
      return no("does-not-replay", "end");
    const { document } = e.call("replayDocument");
    const after = sidesOf(document?.match?.setup, e);
    if (after === "name") return no("name", "name");
    if (after) return no("does-not-replay", "sides");
    // past the engine's log budget the document drops its log: no replay to keep
    const replay = replayOf(document.match);
    if (!replay) return no("too-long", "log");
    const docText = asciiJson(document);
    const replayText = asciiJson(replay);
    if (
      docText.length > SHARE_KEEP.docBytes ||
      replayText.length > SHARE_KEEP.replayBytes
    )
      return no("too-long", "size");
    return {
      ok: true,
      engine: e.version ?? null,
      document: docText,
      replay: replayText,
      actions: g.log.length,
      throws: info.thrown,
    };
  } catch {
    // anything the engine refuses outright (a log it cannot read, an assert)
    return no("does-not-replay", "engine-error");
  } finally {
    try {
      e?.lua.global.close();
    } catch {
      // closed already
    }
  }
}
