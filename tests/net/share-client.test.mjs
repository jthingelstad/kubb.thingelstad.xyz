// The browser's side of sharing a match against the computer (src/net/share.js;
// docs/CLIENT.md "Sharing a match"): the name the card takes, the `share` message the
// engine makes, the card's states as a pure reducer, and real shares (POST /api/share)
// against the local api (tools/pitch-dev.mjs) with the reel function's own check: a code,
// the same code again, each refusal's line, and the shared code read as a sealed replay.
import "./room-engine.mjs";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  SHARE_LIMITS,
  SHARE_WORDS,
  askShare,
  clipName,
  nameFromMatch,
  nameProblem,
  shareMessage,
  shareStart,
  shareStep,
  shareView,
  shareable,
} from "../../src/net/share.js";
import { REEL_WORDS, askReel } from "../../src/net/reel.js";
import { askReplay, fetchReplay } from "../../src/replay/fetch.js";
import { Engine } from "../../src/engine/index.js";
import { LOG_BUDGET, useRoomEngine } from "../../src/net/lobby.js";
import { ShareBusy } from "../../backend/api/core.mjs";
import { LIMITS } from "../../backend/api/checks.mjs";
import { checkShare } from "../../backend/reels/check.mjs";
import { startPitchServer } from "../../tools/pitch-dev.mjs";
import { devReelEngines } from "../../tools/reels-dev.mjs";
import { bundleLua, engineVersion } from "../../tools/lua-bundle.mjs";
import { playSolo, soloSetup } from "../../tools/reel/solo.mjs";

const sources = bundleLua();
const engine = await Engine.create({ sources });
useRoomEngine(engine);
const played = await playSolo(soloSetup(2), sources);
useRoomEngine(engine); // playSolo hands the room calls its own engine, now closed

// A finished match as the Game holds it (game.trail) and its `over` need.
const trail = {
  kind: "match",
  start: played.start,
  actions: played.log.map((e) => e.a),
  hashes: [],
  before: null,
  now: "",
};
const need = { kind: "over", winner: { winner: played.end.winner } };

const run = (events) => events.reduce((s, e) => shareStep(s, e), shareStart());
const send = { type: "send" };
const answer = (a) => ({ type: "answer", answer: a });
const error = (code) => ({ type: "error", code });

// ---------- words and names ----------

test("share: the card's words have no em dash and name no device", () => {
  const all = JSON.stringify(SHARE_WORDS);
  assert.ok(!all.includes("\u2014"), "no em dash");
  for (const device of ["iPhone", "iPad", "browser", "Playdate", "phone"])
    assert.ok(!all.includes(device), device);
  assert.equal(SHARE_WORDS.share, "SHARE AND MAKE THE REEL");
  assert.equal(SHARE_WORDS.notNow, "NOT NOW");
  // every why the server answers has its line
  for (const why of [
    "engine",
    "does-not-replay",
    "busy",
    "too-long",
    "unavailable",
    "too-many",
  ])
    assert.ok(SHARE_WORDS.why[why], why);
});

test("share: the browser's limits are the api's", () => {
  assert.equal(SHARE_LIMITS.bytes, LIMITS.shareBytes);
  assert.equal(SHARE_LIMITS.actions, LIMITS.shareActions);
  assert.equal(SHARE_LIMITS.startBytes, LIMITS.shareStartBytes);
  assert.ok(
    SHARE_LIMITS.waitMs > LIMITS.shareWaitMs,
    "the browser waits longer than the api waits for the check",
  );
});

test("share: the name field takes what the check takes, and says why not", () => {
  for (const ok of ["Ann", "Riverside", "a".repeat(16), "Ünïcödé 🪵"])
    assert.equal(nameProblem(ok), null, ok);
  assert.equal(nameProblem(""), "empty");
  assert.equal(nameProblem("   "), "empty");
  assert.equal(nameProblem(" Ann"), "spaces");
  assert.equal(nameProblem("You"), "you");
  assert.equal(nameProblem("YOU"), "you");
  assert.equal(nameProblem("a".repeat(17)), "long");
  // 16 characters counted as the server counts them, not UTF-16 units
  assert.equal(nameProblem("🪵".repeat(16)), null);
  assert.equal(clipName("🪵".repeat(20)), "🪵".repeat(16));
  assert.equal(clipName("abcdefghijklmnopqrs"), "abcdefghijklmnop");
});

test("share: the field starts with the match's name, never the stand-in You", () => {
  assert.equal(nameFromMatch(played.start), "Riverside");
  const you = JSON.parse(played.start);
  you.opts.teams.A.name = "You";
  assert.equal(nameFromMatch(JSON.stringify(you)), "");
  assert.equal(nameFromMatch("not json"), "");
});

test("share: only a finished match against the computer may be shared", () => {
  assert.equal(shareable({ trail, need }), true);
  assert.equal(shareable({ trail, need: { kind: "throw" } }), false);
  assert.equal(shareable({ trail: { kind: "practice" }, need }), false);
  const both = JSON.parse(played.start);
  both.opts.cpu = ["A", "B"];
  assert.equal(
    shareable({ trail: { ...trail, start: JSON.stringify(both) }, need }),
    false,
  );
});

// ---------- the message ----------

test("share: the message is the engine's rename, and passes the real check", async () => {
  const made = shareMessage({ engine, trail, need, name: "Lakeside" });
  assert.ok(made.message, JSON.stringify(made.why));
  const g = made.message.g;
  assert.equal(made.message.t, "share");
  assert.equal(g.client, "web");
  assert.equal(g.engine, engine.version);
  assert.deepEqual(Object.keys(g).sort(), [
    "client",
    "end",
    "engine",
    "log",
    "start",
  ]);
  const opts = JSON.parse(g.start).opts;
  assert.equal(opts.teams.A.name, "Lakeside");
  assert.equal(opts.teams.A.players[0].name, "Lakeside");
  assert.ok(!g.start.includes("Riverside"), "the typed name stays here");
  assert.equal(g.log.length, played.log.length);
  assert.deepEqual(g.end, {
    winner: played.end.winner,
    throws: played.end.throws,
  });
  // the start keeps the day and time the match was played (the card says so)
  assert.deepEqual(opts.start, {
    year: 2026,
    month: 11,
    day: 19,
    hour: 12,
    min: 0,
  });
  const out = await realChecker(g);
  assert.equal(out.ok, true, JSON.stringify(out.why));
  assert.equal(out.throws, g.end.throws);
});

test("share: a match plainly too long is known here, before anything is sent", () => {
  const fake = {
    version: engine.version,
    call: (name, args) => ({ start: args.start, log: args.log }),
  };
  const many = Array.from({ length: SHARE_LIMITS.actions + 1 }, () => ({
    type: "raise",
  }));
  const long = shareMessage({
    engine: fake,
    trail: { ...trail, actions: many },
    need,
    name: "Ann",
  });
  assert.equal(long.why, "too-long");
  // under the message's size, but past the engine's log budget as the finished
  // document would hold it (each action with its hash, and the last snapshot)
  const big = { type: "throw", pad: "x".repeat(600) };
  const heavyTrail = {
    ...trail,
    actions: Array.from({ length: 150 }, () => big),
    hashes: Array.from({ length: 150 }, () => "h".repeat(16)),
    now: "s".repeat(200 * 1024),
  };
  assert.ok(Number.isFinite(LOG_BUDGET));
  const heavy = shareMessage({
    engine: fake,
    trail: heavyTrail,
    need,
    name: "Ann",
  });
  assert.ok(heavy.bytes < SHARE_LIMITS.bytes, "the message alone would go");
  assert.equal(heavy.why, "too-long");
  // a real match is not
  assert.ok(shareMessage({ engine, trail, need, name: "Ann" }).message);
});

// ---------- the card's states ----------

test("share: SHARE goes to checking, and a code hands over to the reel", () => {
  const s = run([send]);
  assert.equal(s.phase, "sending");
  const v = shareView(s);
  assert.equal(v.line, SHARE_WORDS.checking);
  assert.equal(v.bar, true);
  assert.equal(v.retry, false);
  const done = shareStep(s, answer({ code: "abcdefgh23", v: 1 }));
  assert.equal(done.phase, "shared");
  assert.equal(done.code, "abcdefgh23");
  assert.equal(done.v, 1);
  assert.equal(shareView(shareStart()).form, true);
});

test("share: each why has its line, and none offers TRY AGAIN", () => {
  for (const why of [
    "engine",
    "does-not-replay",
    "busy",
    "too-long",
    "unavailable",
  ]) {
    const s = run([send, answer({ code: null, v: 0, why })]);
    assert.equal(s.phase, "refused");
    assert.equal(shareView(s).text, SHARE_WORDS.why[why], why);
    assert.equal(shareView(s).retry, false, why);
  }
  const odd = run([send, answer({ code: null, why: "something-new" })]);
  assert.equal(shareView(odd).text, SHARE_WORDS.why.unavailable);
});

test("share: errors: too-many and too-big are refusals; failed once, then not this time", () => {
  assert.equal(
    shareView(run([send, error("too-many")])).text,
    SHARE_WORDS.why["too-many"],
  );
  assert.equal(
    shareView(run([send, error("too-big")])).text,
    SHARE_WORDS.why["too-long"],
  );
  const failed = run([send, error("failed")]);
  assert.equal(shareView(failed).text, SHARE_WORDS.failed);
  assert.equal(shareView(failed).retry, true);
  const again = run([send, error("failed"), send]);
  assert.equal(again.phase, "sending");
  const twice = run([send, error("failed"), send, error("failed")]);
  assert.equal(twice.phase, "failed");
  assert.equal(shareView(twice).text, SHARE_WORDS.notThisTime);
  assert.equal(shareView(twice).retry, false);
});

test("share: no connection offers TRY AGAIN as often as pressed", () => {
  let s = run([send]);
  for (let i = 0; i < 4; i++) {
    s = shareStep(s, error(i % 2 ? "timeout" : "unavailable"));
    assert.equal(shareView(s).text, SHARE_WORDS.offline);
    assert.equal(shareView(s).retry, true);
    s = shareStep(s, send);
    assert.equal(s.phase, "sending");
  }
});

test("share: opened again, a refusal that may pass later starts over; a final one stays", () => {
  for (const why of ["busy", "unavailable", "too-many"]) {
    const s = run([send, answer({ code: null, why }), { type: "open" }]);
    assert.equal(s.phase, "idle", why);
  }
  for (const why of ["engine", "does-not-replay", "too-long"]) {
    const s = run([send, answer({ code: null, why }), { type: "open" }]);
    assert.equal(s.phase, "refused", why);
  }
  const known = run([{ type: "refuse", why: "too-long" }]);
  assert.equal(shareView(known).text, SHARE_WORDS.why["too-long"]);
});

// ---------- against the local api ----------

let server;
let plain; // an api with no check: sharing unavailable
const servers = [];
const reels = []; // the renders the api started
const quiet = () => {};

async function serve(opts = {}) {
  const s = await startPitchServer({ port: 0, log: quiet, ...opts });
  servers.push(s);
  return s;
}

// the reel function's check, which hands the room calls its own engine and closes it:
// this file's engine is put back after (fetchReplay's check uses it)
const realChecker = async (g) => {
  try {
    return await checkShare({
      g,
      sources,
      engine: engineVersion(),
      engines: devReelEngines(),
    });
  } finally {
    useRoomEngine(engine);
  }
};

before(async () => {
  server = await serve({
    reelEngines: devReelEngines(),
    startReel: async (job) => void reels.push(job),
    shareChecker: realChecker,
  });
  plain = await serve({ reelEngines: devReelEngines() });
});

after(async () => {
  for (const s of servers) await s.close();
});

const at = (s) => ({ url: s.apiUrl });
const message = (name = "Lakeside") =>
  shareMessage({ engine, trail, need, name }).message;

// What the card shows for one real share.
async function shown(s, msg, extra = {}) {
  try {
    const a = await askShare({ ...at(s), message: msg, ...extra });
    return { a, view: shareView(run([send, answer(a)])) };
  } catch (e) {
    return { e, view: shareView(run([send, error(e?.code)])) };
  }
}

let sharedCode = null;

test("share (server): a match gets a code, and the same match again the same code", async () => {
  const one = await askShare({ ...at(server), message: message() });
  assert.match(one.code, /^[2-9a-hjkmnp-z]{8,24}$/);
  assert.equal(one.v, 1);
  assert.equal(one.why, undefined);
  sharedCode = one.code;
  const two = await askShare({ ...at(server), message: message() });
  assert.equal(two.code, one.code, "a share is idempotent");
  // another name is another match
  const other = await askShare({ ...at(server), message: message("Hillside") });
  assert.notEqual(other.code, one.code);
});

test("share (server): the shared code reads as a finished pitch's replay, and its reel can be asked", async () => {
  assert.ok(sharedCode);
  const r = await fetchReplay({ ...at(server), code: sharedCode });
  assert.ok(r, "the replay");
  assert.equal(
    r.kept,
    server.api.store.items.get(`pitch#${sharedCode}|replay`).v,
  );
  assert.equal(r.players.A[0].name, "Lakeside");
  const reel = await askReel({ ...at(server), code: sharedCode, v: r.kept });
  assert.equal(reel.v, r.kept);
  assert.equal(reel.reel?.state, "rendering", JSON.stringify(reel));
  assert.equal(reels.at(-1).room, sharedCode);
});

// The old rooms server refused a join on a sealed room; the pitch server knows nothing of
// shares, so the page asks the api first and never joins a pitch it says is sealed
// (src/net/pitch.js `sealedAsk`).
test("share (server): the shared code is sealed, so the page watches its replay and never joins", async () => {
  assert.ok(sharedCode);
  const a = await askReplay({ ...at(server), code: sharedCode });
  assert.equal(a.sealed, true);
  assert.equal(a.pitch, sharedCode);
  const r = await fetchReplay({ ...at(server), code: sharedCode });
  assert.equal(r?.sealed, true);
  assert.equal(r?.n, 1);
  // an ordinary code is not
  const open = await askReplay({ ...at(server), code: "pqrstuvw22" });
  assert.deepEqual(
    { sealed: open.sealed, replay: open.replay, v: open.v },
    { sealed: false, replay: null, v: 0 },
  );
});

test("share (server): each refusal shows its line", async () => {
  // engine: played on an engine the server does not play
  const old = { ...message(), g: { ...message().g, engine: "0.1.0" } };
  let got = await shown(server, old);
  assert.equal(got.a?.why, "engine");
  assert.equal(got.view.text, SHARE_WORDS.why.engine);

  // does-not-replay: the end claimed is not the end the match reaches
  const m = message("Cliffside");
  const wrong = {
    ...m,
    g: {
      ...m.g,
      end: { ...m.g.end, winner: m.g.end.winner === "A" ? "B" : "A" },
    },
  };
  got = await shown(server, wrong);
  assert.equal(got.a?.why, "does-not-replay");
  assert.equal(got.view.text, SHARE_WORDS.why["does-not-replay"]);

  // unavailable: no check on this server
  got = await shown(plain, message());
  assert.equal(got.a?.why, "unavailable");
  assert.equal(got.view.text, SHARE_WORDS.why.unavailable);

  // busy: the check could not run in time
  const busy = await serve({
    reelEngines: devReelEngines(),
    shareChecker: async () => {
      throw new ShareBusy("busy");
    },
  });
  got = await shown(busy, message("Seaside"));
  assert.equal(got.a?.why, "busy");
  assert.equal(got.view.text, SHARE_WORDS.why.busy);

  // failed: the check broke; TRY AGAIN once
  const broken = await serve({
    reelEngines: devReelEngines(),
    shareChecker: async () => {
      throw new Error("broken");
    },
  });
  got = await shown(broken, message("Brookside"));
  assert.equal(got.e?.code, "failed");
  assert.equal(got.view.text, SHARE_WORDS.failed);
  assert.equal(got.view.retry, true);

  // too-many: there is no connection to count shares on any more; only the site's web
  // ACL says it, as a bare 429
  got = await shown(server, message("Parkside"), {
    fetch: async () => new Response("", { status: 429 }),
  });
  assert.equal(got.e?.code, "too-many");
  assert.equal(got.view.text, SHARE_WORDS.why["too-many"]);

  // too-long, from the server: past its own action ceiling, before any check
  const long = message("Bayside");
  const many = {
    ...long,
    g: {
      ...long.g,
      log: Array.from({ length: LIMITS.shareActions + 1 }, () => ({
        a: { type: "raise" },
      })),
    },
  };
  got = await shown(plain, many);
  assert.equal(got.a?.why, "too-long");
  assert.equal(got.view.text, SHARE_WORDS.why["too-long"]);

  // no connection
  got = await shown({ apiUrl: "http://127.0.0.1:9/api" }, message());
  assert.equal(got.view.text, SHARE_WORDS.offline);
  assert.equal(got.view.retry, true);
});

test("share: the reel card's words are the reel's own once shared", () => {
  // the hand-over keeps one set of words: the button's while checking is the reel's
  assert.equal(REEL_WORDS.make, "MAKE A HIGHLIGHT REEL");
  assert.equal(REEL_WORDS.making, "MAKING YOUR REEL");
});
