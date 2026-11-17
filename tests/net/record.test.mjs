// Matches played in one browser (solo, watching the computer): what the browser sends
// when one ends (src/net/record.js), the room server's `game` message and the object it
// keeps (backend/rooms/recorder.mjs), and the replay (tools/games.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import {
  GAME_MODES,
  LIMITS,
  asciiJson,
  createRooms,
} from "../../backend/rooms/core.mjs";
import { memoryStore } from "../../backend/rooms/memory-store.mjs";
import {
  browserGameKey,
  browserGameText,
  memoryGameRecorder,
} from "../../backend/rooms/recorder.mjs";
import {
  GAME_LIMITS,
  GAME_MODES as CLIENT_MODES,
  gameMessage,
  matchRecord,
  recordMatch,
} from "../../src/net/record.js";
import { Engine } from "../../src/engine/index.js";
import { bundleLua } from "../../tools/lua-bundle.mjs";
import {
  browserMatch,
  parseRecord,
  replayBrowser,
} from "../../tools/games.mjs";

const sources = await bundleLua();
const T0 = 1_763_300_000_000; // 2025-11-16

function harness({ recordGame = memoryGameRecorder(), limits } = {}) {
  let t = T0;
  const inbox = new Map();
  const rooms = createRooms({
    store: memoryStore({ now: () => t }),
    now: () => t,
    recordGame,
    ...(limits ? { limits } : {}),
    async send(conn, text) {
      if (!inbox.has(conn)) inbox.set(conn, []);
      inbox.get(conn).push(JSON.parse(text));
      return true;
    },
  });
  const say = (conn, msg) => rooms.message(conn, asciiJson(msg));
  const last = (conn) => inbox.get(conn)?.at(-1);
  return { rooms, say, last, recordGame };
}

// A short computer-against-computer match played to its end, with the Game's trail as
// src/game/game.js fills it (the start, every action, the hash after each).
async function playedMatch({ maxTurns = 3 } = {}) {
  const engine = await Engine.create({ sources });
  engine.newMatch({
    seed: 11,
    cpu: "both",
    start: { year: 2026, month: 11, day: 16, hour: 9, min: 5 },
    maxTurns,
    teams: {
      A: { name: "North", players: [{ name: "North" }] },
      B: { name: "South", players: [{ name: "South" }] },
    },
  });
  const trail = {
    kind: "match",
    start: engine.snapshot(),
    actions: [],
    hashes: [],
  };
  for (let guard = 0; guard < 400 && engine.need().kind !== "over"; guard++) {
    const n = engine.need();
    let action;
    if (n.kind === "raise") {
      action = { type: "raise", choice: n.default };
      engine.apply(action);
    } else if (n.kind === "punish") {
      action = { type: "punish", x: n.cursor.x, y: n.cursor.y };
      engine.apply(action);
    } else {
      let out;
      for (let i = 0; i < 600 && !out?.action; i++)
        out = engine.frame({ dt: 1 / 60 });
      action = out.action;
    }
    trail.actions.push(action);
    trail.hashes.push(engine.hash().hash);
  }
  assert.equal(engine.need().kind, "over");
  return { engine, trail, need: engine.need() };
}

const config = {
  version: "0.1.0",
  commit: "abc123",
  luaUrl: "/assets/lua-sources-0123456789ab.json",
  engine: "0.2.0",
};

test("the limits and modes agree between the browser and the server", () => {
  assert.equal(GAME_LIMITS.bytes, LIMITS.gameBytes);
  assert.equal(GAME_LIMITS.actions, LIMITS.gameActions);
  assert.deepEqual([...CLIENT_MODES], [...GAME_MODES]);
  assert.ok(LIMITS.gameBytes < LIMITS.messageBytes, "fits a whole message");
  assert.ok(
    Math.ceil(LIMITS.gameBytes / 30000) <= LIMITS.parts,
    "fits the parts a message may be split into",
  );
});

test("a finished match is sent whole, kept under games/browser/ and replays", async () => {
  const game = await playedMatch();
  const record = matchRecord({ game, mode: "watch", config, now: () => T0 });
  assert.equal(record.mode, "watch");
  assert.equal(record.build.lua, "lua-sources-0123456789ab.json");
  assert.equal(record.engine, game.engine.version);
  assert.match(record.engine, /^\d+\.\d+\.\d+$/);
  assert.equal(record.options.seed, 11);
  assert.equal(record.actions.length, game.trail.actions.length);
  assert.equal(record.hashes.length, record.actions.length);
  assert.equal(record.end.over, true);
  assert.equal(record.end.hash, game.engine.hash().hash);
  assert.match(record.file, /\[Team A "North"\]/);
  assert.match(record.file, /\(@ /, "the file keeps the positions");
  assert.match(record.name, /^2026-11-16-0905-north-v-south\.txt$/);
  const text = asciiJson(record);
  for (const word of ["userAgent", "member", "conn", "ip"])
    assert.ok(!text.includes(`"${word}"`), `no ${word}`);

  const h = harness();
  const msg = gameMessage(record);
  assert.equal(msg.g.dropped, undefined, "a short match fits whole");
  await h.say("c1", msg);
  assert.deepEqual(h.last("c1"), { t: "recorded", id: 1 });
  const [kept] = h.recordGame.kept;
  assert.match(
    kept.key,
    /^games\/browser\/2025-11-16\/\d{13}-[2-9a-hjkmnp-z]{8}\.json\.gz$/,
  );
  assert.equal(kept.key.slice(25, 38), String(T0));

  const m = browserMatch(parseRecord(gzipSync(kept.text)));
  assert.equal(m.mode, "watch");
  const engine = await Engine.create({ sources });
  const r = replayBrowser(engine, m);
  assert.equal(r.same, m.actions.length);
  assert.equal(r.differs + r.refused + r.unjudged, 0);
  assert.equal(r.end, "same");
  assert.equal(engine.need().kind, "over");
});

test("a replay stops judging at the first action that goes another way", async () => {
  const game = await playedMatch();
  const record = matchRecord({ game, mode: "solo", config });
  record.hashes[3] = "00000000";
  const m = browserMatch({ t: T0, game: record });
  const r = replayBrowser(await Engine.create({ sources }), m);
  assert.equal(r.same, 3);
  assert.equal(r.steps[3].outcome, "differs");
  assert.equal(r.differs, 1);
  assert.equal(r.unjudged, m.actions.length - 4);
  assert.equal(r.end, null);
  // no history (dropped to fit): nothing to replay
  assert.equal(browserMatch({ t: T0, game: { ...record, start: "-" } }), null);
});

test("an oversized match drops the hashes, then the file, then its history", () => {
  const record = {
    mode: "solo",
    options: { seed: 1 },
    start: "x".repeat(400),
    actions: Array.from({ length: 50 }, () => ({ type: "throw", p: "y" })),
    hashes: Array.from({ length: 50 }, () => "abcdef01"),
    end: { over: true },
    file: "z".repeat(3000),
  };
  const fits = (limit) =>
    gameMessage(record, { limits: { ...GAME_LIMITS, bytes: limit } });
  assert.equal(fits(100_000).g.dropped, undefined);
  const noHashes = fits(asciiJson(gameMessage(record)).length - 10);
  assert.deepEqual(noHashes.g.dropped, ["hashes"]);
  assert.ok(noHashes.g.file);
  const noFile = fits(2500);
  assert.deepEqual(noFile.g.dropped, ["hashes", "file"]);
  assert.equal(noFile.g.file, null);
  const bare = fits(300);
  assert.deepEqual(bare.g.dropped, ["hashes", "file", "history"]);
  assert.equal(bare.g.start, "-");
  assert.deepEqual(bare.g.actions, []);
  assert.equal(bare.g.options.seed, 1, "the options stay");
  // too many actions: the first ones are kept
  const long = gameMessage(
    { ...record, actions: Array(10).fill({ type: "throw" }), hashes: null },
    { limits: { bytes: 100_000, actions: 4 } },
  );
  assert.equal(long.g.actions.length, 4);
  assert.deepEqual(long.g.dropped, ["late-actions"]);
});

test("the server refuses what is not a recordable match", async () => {
  const h = harness();
  const g = { mode: "solo", start: "{}", actions: [{ type: "throw" }] };
  const refused = async (msg, code) => {
    await h.say("c1", msg);
    const r = h.last("c1");
    assert.equal(r.t, "error", JSON.stringify(msg));
    assert.equal(r.code, code);
    assert.equal(r.re, "game");
  };
  await refused(
    { t: "game", id: 2, g: { ...g, mode: "practice" } },
    "bad-message",
  );
  await refused(
    { t: "game", id: 2, g: { ...g, mode: "pitch" } },
    "bad-message",
  );
  await refused({ t: "game", id: 2, g: { ...g, start: "" } }, "bad-message");
  await refused({ t: "game", id: 2, g: { ...g, actions: "x" } }, "bad-message");
  await refused(
    { t: "game", id: 2, g: { ...g, hashes: [1, 2] } },
    "bad-message",
  );
  await refused({ t: "game", id: 2, g: { ...g, file: 3 } }, "bad-message");
  await refused({ t: "game", id: 2 }, "bad-message");
  assert.equal(h.recordGame.kept.length, 0);

  const tight = harness({ limits: { ...LIMITS, gameBytes: 100 } });
  await tight.say("c1", {
    t: "game",
    id: 3,
    g: { ...g, start: "x".repeat(200) },
  });
  assert.equal(tight.last("c1").code, "too-big");

  const none = harness({ recordGame: null });
  await none.say("c1", { t: "game", id: 4, g });
  assert.equal(none.last("c1").code, "unavailable");

  // three a connection; another connection may send its own
  for (let i = 0; i < LIMITS.gamesPerConn; i++) {
    await h.say("c2", { t: "game", id: 10 + i, g });
    assert.equal(h.last("c2").t, "recorded");
  }
  await h.say("c2", { t: "game", id: 20, g });
  assert.equal(h.last("c2").code, "too-many");
  await h.say("c3", { t: "game", id: 21, g });
  assert.equal(h.last("c3").t, "recorded");

  // a recorder that fails says so, and does not use up the connection's allowance
  const broken = harness({
    recordGame: async () => {
      throw new Error("S3 is down");
    },
  });
  const err = console.error;
  console.error = () => {};
  try {
    await broken.say("c1", { t: "game", id: 5, g });
  } finally {
    console.error = err;
  }
  assert.equal(broken.last("c1").code, "failed");
});

test("a match may say which client and engine played it; a bad tag is refused", async () => {
  const g = { mode: "solo", start: "{}", actions: [{ type: "throw" }] };
  const h = harness();
  await h.say("c1", {
    t: "game",
    id: 1,
    g: { ...g, client: "ios", engine: "1.2.0+core.c11f533" },
  });
  assert.equal(h.last("c1").t, "recorded");
  const kept = JSON.parse(h.recordGame.kept[0].text);
  assert.equal(kept.game.client, "ios");
  assert.equal(kept.game.engine, "1.2.0+core.c11f533");
  // absent (an older browser) is fine, and so is the longest tag
  await h.say("c2", { t: "game", id: 2, g });
  assert.equal(h.last("c2").t, "recorded");
  await h.say("c3", {
    t: "game",
    id: 3,
    g: { ...g, client: "a".repeat(32), engine: "1".repeat(64) },
  });
  assert.equal(h.last("c3").t, "recorded");
  assert.equal(h.recordGame.kept.length, 3);

  const bad = harness();
  for (const [field, value] of [
    ["client", "iOS"],
    ["client", "web app"],
    ["client", "web+1"],
    ["client", ""],
    ["client", "a".repeat(33)],
    ["client", 7],
    ["client", ["web"]],
    ["engine", "1.2.0/core"],
    ["engine", "V1"],
    ["engine", ""],
    ["engine", "1".repeat(65)],
    ["engine", { v: 1 }],
  ]) {
    await bad.say("c1", { t: "game", id: 9, g: { ...g, [field]: value } });
    const r = bad.last("c1");
    assert.equal(r.t, "error", `${field} ${JSON.stringify(value)}`);
    assert.equal(r.code, "bad-message");
    assert.equal(r.re, "game");
    assert.equal(r.id, 9);
  }
  assert.equal(bad.recordGame.kept.length, 0);
});

test("the web client says it is the web, and which engine played", async () => {
  const game = await playedMatch();
  const record = matchRecord({ game, mode: "watch", config });
  assert.equal(record.client, "web");
  assert.equal(record.engine, game.engine.version);
  assert.equal(gameMessage(record).g.client, "web");
  assert.equal(gameMessage(record).g.engine, game.engine.version);
  // an engine that does not say gives no made-up version
  const quiet = matchRecord({
    game: {
      ...game,
      engine: Object.assign(Object.create(game.engine), { version: null }),
    },
    mode: "watch",
    config,
  });
  assert.equal(quiet.engine, null);
});

test("recordMatch sends once, never for practice, and never throws", async () => {
  const sent = [];
  const send = async (opts) => {
    sent.push(opts);
    return { t: "recorded" };
  };
  const game = await playedMatch();
  const opts = { game, mode: "watch", config, url: "ws://x", send };
  assert.equal(await recordMatch(opts), true);
  assert.equal(await recordMatch(opts), false, "the same match: not again");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message.t, "game");
  assert.equal(sent[0].url, "ws://x");

  const practice = {
    trail: { kind: "practice", ops: [] },
    engine: game.engine,
  };
  assert.equal(await recordMatch({ ...opts, game: practice }), false);
  const other = { ...game, trail: { ...game.trail, recorded: false } };
  assert.equal(
    await recordMatch({ ...opts, game: other, mode: "pitch" }),
    false,
  );
  assert.equal(await recordMatch({ ...opts, game: other, url: null }), false);
  assert.equal(sent.length, 1);

  // a send that fails resolves false; a broken engine is not a crash either
  const warn = console.warn;
  console.warn = () => {};
  try {
    const failing = async () => {
      throw Object.assign(new Error("no"), { code: "closed" });
    };
    const again = { ...game, trail: { ...game.trail, recorded: false } };
    assert.equal(
      await recordMatch({ ...opts, game: again, send: failing }),
      false,
    );
    const broken = {
      trail: { ...game.trail, recorded: false },
      get engine() {
        throw new Error("gone");
      },
    };
    assert.equal(await recordMatch({ ...opts, game: broken }), false);
  } finally {
    console.warn = warn;
  }
});

test("keys and text of a kept match", () => {
  assert.equal(
    browserGameKey({ t: T0, tail: "abcdefgh" }),
    `games/browser/2025-11-16/${T0}-abcdefgh.json.gz`,
  );
  const text = browserGameText({ t: T0, game: '{"mode":"solo"}' });
  assert.deepEqual(JSON.parse(text), { t: T0, game: { mode: "solo" } });
});
