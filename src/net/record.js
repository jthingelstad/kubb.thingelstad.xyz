// Every match is recorded (AGENTS.md "Recorded games"). A shared pitch's room records
// itself on the server (backend/rooms/recorder.mjs). A match played in this browser alone,
// against the computer (?solo=1) or the computer against itself (?watch=1), has no room:
// when it ends, the browser sends it whole, once, on a socket of its own, and the room
// server keeps it beside the rooms' records (docs/ROOMS.md section 7).
//
//   recordMatch({ game, mode, config, url });   // on the `over` need; never throws
//
// What is sent (`g` in the message): the mode; the build (package version, commit, the
// hashed Lua bundle's name, the vendored core's commit); the browser's clock; the match's
// options as its first snapshot carries them (seed, teams, names typed, opening, ...); the
// first snapshot and every action applied since, with the engine's hash after each (start
// + actions replay it, and the hashes say where this checkout's engine first goes another
// way); the end (the winner, how it ended, the last hash); and the game file in Planet Kubb
// Notation (positions included) with its file name. No user agent, no member id (these
// matches have none), no address. Practice is not a match and is not recorded.
//
// The whole message is held to GAME_LIMITS.bytes as ASCII JSON. Over it, the parts that
// only help are dropped in this order (listed in `g.dropped`): the hashes, the game file,
// then the first snapshot and the actions (the options, with the seed, stay).
import { asciiJson } from "./room.js";
import { ask } from "./ask.js";

// Kept in step with backend/rooms/core.mjs LIMITS (tests/net/record.test.mjs checks).
export const GAME_LIMITS = Object.freeze({
  bytes: 256 * 1024,
  actions: 4000,
});

export const GAME_MODES = ["solo", "watch"];

// The match as it stands, from the Game (src/game/game.js); null when there is none.
export function matchRecord({ game, mode, config = {}, now = Date.now }) {
  const trail = game.trail;
  if (trail?.kind !== "match" || !GAME_MODES.includes(mode)) return null;
  const engine = game.engine;
  let sheet = null;
  try {
    sheet = engine.sheet();
  } catch {
    sheet = null;
  }
  let options = null;
  try {
    options = JSON.parse(trail.start).opts ?? null;
  } catch {
    options = null;
  }
  let hash = null;
  try {
    hash = engine.hash().hash;
  } catch {
    hash = null;
  }
  const need = game.need || {};
  return structuredClone({
    mode,
    at: now(),
    build: {
      version: config.version ?? null,
      commit: config.commit ?? null,
      lua: config.luaUrl ? String(config.luaUrl).split("/").pop() : null,
      core: config.core ?? null,
    },
    options,
    start: trail.start,
    actions: trail.actions,
    hashes: trail.hashes?.length === trail.actions.length ? trail.hashes : null,
    end: {
      over: need.kind === "over",
      winner: need.winner ?? null,
      how: need.how ?? null,
      text: need.text ?? null,
      hash,
    },
    file: typeof sheet?.text === "string" ? sheet.text : null,
    name: typeof sheet?.name === "string" ? sheet.name : null,
  });
}

// The message for the server, cut to fit.
export function gameMessage(record, { id = 1, limits = GAME_LIMITS } = {}) {
  const g = structuredClone(record);
  if (Array.isArray(g.actions) && g.actions.length > limits.actions) {
    g.actions = g.actions.slice(0, limits.actions);
    if (g.hashes) g.hashes = g.hashes.slice(0, limits.actions);
    (g.dropped ??= []).push("late-actions");
  }
  const msg = { t: "game", id, g };
  const size = () => asciiJson(msg).length;
  const drops = [
    ["hashes", () => (g.hashes = null)],
    ["file", () => (g.file = null)],
    [
      "history",
      () => {
        g.start = "-";
        g.actions = [];
        g.hashes = null;
      },
    ],
  ];
  for (const [name, drop] of drops) {
    if (size() <= limits.bytes) break;
    drop();
    (g.dropped ??= []).push(name);
  }
  return msg;
}

export function sendGame(opts) {
  return ask({ ...opts, done: "recorded", re: "game" });
}

// When a solo or watch match ends: send it once (the trail is marked), in the background.
// Resolves true when the server kept it, false otherwise; never rejects, never throws, so
// a failed send cannot disturb play.
export function recordMatch({
  game,
  mode,
  config = {},
  url,
  send = sendGame,
  now = Date.now,
}) {
  try {
    const trail = game?.trail;
    if (!url || trail?.kind !== "match" || trail.recorded)
      return Promise.resolve(false);
    if (!GAME_MODES.includes(mode)) return Promise.resolve(false);
    trail.recorded = true;
    const record = matchRecord({ game, mode, config, now });
    if (!record) return Promise.resolve(false);
    return Promise.resolve()
      .then(() => send({ url, message: gameMessage(record) }))
      .then(
        () => true,
        (err) => {
          console.warn("The match was not recorded:", err?.code ?? err);
          return false;
        },
      );
  } catch (err) {
    console.warn("The match was not recorded:", err);
    return Promise.resolve(false);
  }
}
