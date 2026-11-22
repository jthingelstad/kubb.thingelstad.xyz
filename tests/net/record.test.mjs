// Matches played in one browser (solo, watching the computer): what the browser sends
// when one ends (src/net/record.js), the api function's `game` call and the object it
// keeps (backend/api/core.mjs, backend/api/records.mjs), and the replay (tools/games.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { GAME_MODES, LIMITS, asciiJson } from "../../backend/api/checks.mjs";
import { createApi } from "../../backend/api/core.mjs";
import { memoryStore } from "../../backend/api/memory-store.mjs";
import {
  gameKey,
  gameText,
  memoryRecords,
} from "../../backend/api/records.mjs";
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

// The api function with only what `game` needs: POST /api/game { g } as the browser
// sends it (src/net/record.js sendGame). `kept` is what was recorded, key -> text.
function harness({ recordGame, limits } = {}) {
  const records = memoryRecords();
  const api = createApi({
    store: memoryStore({ now: () => T0 }),
    recordGame: recordGame === undefined ? records.recordGame : recordGame,
    now: () => T0,
    log: () => {},
    ...(limits ? { limits } : {}),
  });
  const post = async (g) => {
    const res = await api.handle({
      method: "POST",
      path: "/api/game",
      query: new URLSearchParams(),
      headers: {},
      body: Buffer.from(asciiJson(g === undefined ? {} : { g })),
    });
    return { status: res.status, json: JSON.parse(res.body) };
  };
  return { post, kept: records.kept };
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
  assert.ok(LIMITS.gameBytes < LIMITS.bodyBytes, "fits a whole request body");
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
  // Planet Kubb Notation 2's position lines (engine 0.13.1 on): "@a ..." and "*a ..."
  assert.match(record.file, /^[@*][ab] /m, "the file keeps the positions");
  assert.match(record.name, /^2026-11-16-0905-north-v-south\.txt$/);
  const text = asciiJson(record);
  for (const word of ["userAgent", "member", "conn", "ip"])
    assert.ok(!text.includes(`"${word}"`), `no ${word}`);

  const h = harness();
  const msg = gameMessage(record);
  assert.equal(msg.g.dropped, undefined, "a short match fits whole");
  assert.deepEqual(await h.post(msg.g), { status: 200, json: { ok: true } });
  const [[key, keptText]] = h.kept;
  assert.match(key, /^games\/browser\/2025-11-16\/\d{13}-[a-z0-9]+\.json\.gz$/);
  assert.equal(key.slice(25, 38), String(T0));

  const m = browserMatch(parseRecord(gzipSync(keptText)));
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
  const refused = async (g, code) => {
    const r = await h.post(g);
    assert.equal(r.json.error, code, JSON.stringify(g));
  };
  await refused({ ...g, mode: "practice" }, "bad-message");
  await refused({ ...g, mode: "pitch" }, "bad-message");
  await refused({ ...g, start: "" }, "bad-message");
  await refused({ ...g, actions: "x" }, "bad-message");
  await refused({ ...g, hashes: [1, 2] }, "bad-message");
  await refused({ ...g, file: 3 }, "bad-message");
  await refused(undefined, "bad-message");
  assert.equal(h.kept.size, 0);

  const tight = harness({ limits: { ...LIMITS, gameBytes: 100 } });
  assert.equal(
    (await tight.post({ ...g, start: "x".repeat(200) })).json.error,
    "too-big",
  );

  const none = harness({ recordGame: null });
  assert.equal((await none.post(g)).json.error, "unavailable");

  // a recorder that fails says so
  const broken = harness({
    recordGame: async () => {
      throw new Error("S3 is down");
    },
  });
  const r = await broken.post(g);
  assert.equal(r.status, 500);
  assert.equal(r.json.error, "failed");
});

test("a match may say which client and engine played it; a bad tag is refused", async () => {
  const g = { mode: "solo", start: "{}", actions: [{ type: "throw" }] };
  const h = harness();
  assert.equal(
    (await h.post({ ...g, client: "ios", engine: "1.2.0+core.c11f533" }))
      .status,
    200,
  );
  const kept = JSON.parse([...h.kept.values()][0]);
  assert.equal(kept.game.client, "ios");
  assert.equal(kept.game.engine, "1.2.0+core.c11f533");
  // absent (an older browser) is fine, and so is the longest tag
  assert.equal((await h.post(g)).status, 200);
  assert.equal(
    (await h.post({ ...g, client: "a".repeat(32), engine: "1".repeat(64) }))
      .status,
    200,
  );
  assert.equal(h.kept.size, 3);

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
    const r = await bad.post({ ...g, [field]: value });
    assert.equal(r.status, 400, `${field} ${JSON.stringify(value)}`);
    assert.equal(r.json.error, "bad-message");
  }
  assert.equal(bad.kept.size, 0);
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
    gameKey({ t: T0, tail: "abcdefgh" }),
    `games/browser/2025-11-16/${T0}-abcdefgh.json.gz`,
  );
  const text = gameText({ t: T0, game: '{"mode":"solo"}' });
  assert.deepEqual(JSON.parse(text), { t: T0, game: { mode: "solo" } });
});
