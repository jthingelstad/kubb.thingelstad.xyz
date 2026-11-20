// The browser's side of highlight reels (src/net/reel.js; docs/CLIENT.md "Highlight
// reels"): the card's states as a pure reducer, what the page knows on load, and the two
// requests against the local room server (tools/rooms-dev.mjs) over a real socket.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { WebSocket as NodeWs } from "ws";
import {
  REEL_WORDS,
  askKept,
  askReel,
  reelFileName,
  reelFromPage,
  reelPath,
  reelRequest,
  reelStart,
  reelStep,
  reelTune,
  reelView,
} from "../../src/net/reel.js";
import { reelPaths } from "../../backend/reels/tag.mjs";
import { startRoomsServer } from "../../tools/rooms-dev.mjs";

const CODE = "abcdefgh23";
const MATCH = { n: 2, hash: "h2" };
const KEPT = { kept: 14, n: 2, hash: "h2" };
const DONE = {
  v: 14,
  reel: {
    state: "done",
    tag: "r1-0.7",
    at: 1,
    ...reelPaths(CODE, 14, "r1-0.7"),
  },
};

// A run of events from the start.
const run = (events, known = null) =>
  events.reduce((s, e) => reelStep(s, e), reelStart(known));
const press = { type: "press" };
const kept = (k = KEPT, match = MATCH) => ({ type: "kept", kept: k, match });
const answer = (a) => ({ type: "answer", answer: a });
const error = (code) => ({ type: "error", code });
const rendering = answer({
  v: 14,
  reel: { state: "rendering", tag: "r1-0.7", at: 1 },
});

test("reel: the file names and paths are the design's", () => {
  assert.equal(reelFileName(CODE, "tall"), `throwing-wood-${CODE}-tall.mp4`);
  assert.equal(reelFileName(CODE, "wide"), `throwing-wood-${CODE}-wide.mp4`);
  const p = reelPaths(CODE, 14, "r1-0.7");
  assert.deepEqual(reelPath(p.tall, CODE), { v: 14, format: "tall" });
  assert.equal(reelPath(p.tall, "zzzzzzzz22"), null);
  assert.equal(reelPath("/reels/../x/wide.mp4", CODE), null);
});

test("reel: on load the page knows only what its og:video says", () => {
  const p = reelPaths(CODE, 14, "r1-0.7");
  const origin = "https://throwingwood.com";
  assert.deepEqual(reelFromPage(`${origin}${p.wide}`, CODE, [origin]), {
    v: 14,
    wide: p.wide,
    tall: p.tall,
  });
  // another site, another pitch, the tall file, nothing: no reel
  assert.equal(
    reelFromPage(`https://evil.example${p.wide}`, CODE, [origin]),
    null,
  );
  assert.equal(
    reelFromPage(`${origin}${p.wide}`, "zzzzzzzz22", [origin]),
    null,
  );
  assert.equal(reelFromPage(`${origin}${p.tall}`, CODE, [origin]), null);
  assert.equal(reelFromPage(undefined, CODE, [origin]), null);
  assert.equal(reelFromPage("", CODE, [origin]), null);
});

test("reel: MAKE, the kept replay checked, then rendering until done", () => {
  let s = reelStart();
  assert.equal(reelView(s).label, REEL_WORDS.make);
  assert.equal(reelView(s).ask, null);
  s = reelStep(s, press);
  assert.equal(s.phase, "checking");
  assert.equal(reelView(s).label, REEL_WORDS.making);
  assert.equal(reelView(s).ask, "kept");
  assert.equal(reelView(s).text, REEL_WORDS.wait);
  assert.equal(reelView(s).bar, true);
  assert.equal(reelView(s).title, "Highlight reel");
  assert.equal(reelView(s).line, "MAKING YOUR REEL");
  s = reelStep(s, kept());
  assert.equal(s.phase, "asking");
  assert.equal(s.v, 14);
  assert.equal(reelView(s).ask, "reel");
  s = reelStep(s, rendering);
  assert.equal(s.phase, "asking");
  assert.equal(reelView(s).ask, "reel"); // polled every reelTune.pollMs
  assert.equal(reelView(s).label, REEL_WORDS.making);
  // pressing again (the card opened again) changes nothing
  assert.equal(reelStep(s, press), s);
  s = reelStep(s, answer(DONE));
  assert.equal(s.phase, "done");
  const v = reelView(s);
  assert.equal(v.label, REEL_WORDS.watch);
  assert.equal(v.ask, null);
  assert.deepEqual(v.video, { tall: DONE.reel.tall, wide: DONE.reel.wide });
  assert.equal(reelTune.pollMs, 5000);
});

test("reel: a lost poll while it renders is said and the polling goes on", () => {
  let s = run([press, kept(), rendering, error("timeout")]);
  assert.equal(s.phase, "asking");
  assert.equal(s.offline, true);
  assert.equal(reelView(s).ask, "reel");
  assert.match(reelView(s).text, /No connection/);
  s = reelStep(s, rendering);
  assert.equal(s.offline, false);
  assert.equal(reelView(s).text, REEL_WORDS.wait);
});

test("reel: a keep still on its way is looked for again, then 'no kept replay'", () => {
  let s = run([press]);
  for (let i = 1; i < reelTune.keptTries; i++) {
    s = reelStep(s, kept(null));
    assert.equal(s.phase, "checking", `try ${i}`);
  }
  s = reelStep(s, kept(null));
  assert.equal(s.phase, "refused");
  assert.equal(reelView(s).text, REEL_WORDS.why.replay);
  // the room still keeps the match before: the same
  s = run([press, kept({ kept: 9, n: 1, hash: "h1" })]);
  assert.equal(s.phase, "checking");
  // a newer match kept: this one can no longer have a reel asked for
  s = run([press, kept({ kept: 20, n: 3, hash: "h3" })]);
  assert.equal(s.phase, "refused");
  assert.equal(reelView(s).text, REEL_WORDS.why.moved);
  // another match with the same number (a different hash) is not this one
  s = run([press, kept({ kept: 14, n: 2, hash: "other" })]);
  assert.equal(s.phase, "checking");
});

test("reel: every why in plain words", () => {
  const cases = {
    engine:
      "This match was played on another version of the game, so it cannot have a reel.",
    busy: "Reels are busy today.",
    unavailable: "Reels cannot be made right now.",
    replay: "This match has no replay, so it cannot have a reel.",
    moved: "This pitch has moved on to a newer match.",
  };
  for (const [why, words] of Object.entries(cases)) {
    const s = run([press, kept(), answer({ v: 14, reel: null, why })]);
    assert.equal(s.phase, "refused", why);
    assert.equal(reelView(s).text, words, why);
    assert.equal(reelView(s).retry, false, why);
    assert.equal(reelView(s).label, REEL_WORDS.make, why);
    assert.equal(reelView(s).title, "Highlight reel", why);
  }
  // a why this build does not know is "cannot be made here"
  const odd = run([press, kept(), answer({ v: 14, reel: null, why: "new" })]);
  assert.equal(reelView(odd).text, REEL_WORDS.why.unavailable);
  // nothing to show
  const empty = run([
    press,
    kept(),
    answer({
      v: 14,
      reel: { state: "failed", tag: "r1-0.7", at: 1, why: "empty" },
    }),
  ]);
  assert.equal(
    reelView(empty).text,
    "There are no highlights to show in this match.",
  );
  // too many asked from one connection
  const many = run([press, kept(), error("too-many")]);
  assert.equal(many.phase, "refused");
  assert.equal(
    reelView(many).text,
    "Too many reels asked for at once. Try again later.",
  );
});

test("reel: a render that failed is final, with no TRY AGAIN", () => {
  for (const why of ["render", undefined]) {
    const s = run([
      press,
      kept(),
      rendering,
      answer({ v: 14, reel: { state: "failed", tag: "r1-0.7", at: 1, why } }),
    ]);
    assert.equal(s.phase, "failed");
    const v = reelView(s);
    assert.equal(v.text, "The reel could not be made. Not this time.");
    assert.equal(v.retry, false);
    assert.equal(reelStep(s, press), s);
  }
});

test("reel: the server could not start it: TRY AGAIN once, then not this time", () => {
  let s = run([press, kept(), error("failed")]);
  assert.equal(s.phase, "error");
  assert.equal(reelView(s).text, "The reel could not be made.");
  assert.equal(reelView(s).retry, true);
  s = reelStep(s, press); // TRY AGAIN: reads the kept replay afresh, then asks again
  assert.equal(s.phase, "checking");
  assert.equal(s.retried, 1);
  s = reelStep(s, kept());
  assert.equal(s.phase, "asking");
  s = reelStep(s, error("failed"));
  assert.equal(s.phase, "failed");
  assert.equal(reelView(s).text, REEL_WORDS.notThisTime);
  assert.equal(reelView(s).retry, false);
});

test("reel: no connection says so and TRY AGAIN asks again, as often as pressed", () => {
  let s = run([press, error("closed")]);
  assert.equal(s.phase, "error");
  assert.equal(reelView(s).text, "No connection.");
  assert.equal(reelView(s).retry, true);
  for (let i = 0; i < 3; i++) {
    s = reelStep(s, press);
    assert.equal(s.phase, "checking");
    s = reelStep(s, error("timeout"));
    assert.equal(s.phase, "error");
  }
  s = reelStep(reelStep(s, press), kept());
  assert.equal(s.phase, "asking");
});

test("reel: a reel the page says is done is shown once the kept replay agrees", () => {
  const p = reelPaths(CODE, 14, "r1-0.7");
  const known = { v: 14, tall: p.tall, wide: p.wide };
  let s = reelStart(known);
  assert.equal(reelView(s).label, REEL_WORDS.watch);
  s = reelStep(s, press);
  assert.equal(reelView(s).ask, "kept"); // read only: nothing is started
  assert.equal(reelView(s).title, REEL_WORDS.title);
  assert.equal(reelView(s).line, ""); // nothing is being made
  s = reelStep(s, kept());
  assert.equal(s.phase, "done");
  assert.deepEqual(reelView(s).video, { tall: p.tall, wide: p.wide });
  // the page was written for an earlier version: ask the server as MAKE would
  s = run([press, kept({ ...KEPT, kept: 15 })], known);
  assert.equal(s.phase, "asking");
  assert.equal(s.known, null);
  assert.equal(reelView(s).label, REEL_WORDS.making);
});

test("reel: an answer for another version than the match's is not its reel", () => {
  const s = run([press, kept(), answer({ ...DONE, v: 20 })]);
  assert.equal(s.phase, "refused");
  assert.equal(s.why, "moved");
});

test("reel: no copy has an em dash", () => {
  const all = JSON.stringify(REEL_WORDS);
  assert.equal(all.includes("—"), false);
});

// ---------- the requests, against the local room server ----------

let server;
const started = [];
let store;

before(async () => {
  server = await startRoomsServer({
    port: 0,
    reelEngines: ["0.7"],
    reelRenderer: (s) => {
      store = s;
      return async (job) => {
        started.push(job);
      };
    },
  });
});

after(async () => {
  await server.close();
});

test("reel: askKept reads the kept replay and starts nothing; askReel starts one render", async () => {
  const at = { url: server.url, code: CODE, WebSocket: NodeWs };
  assert.equal(await askKept(at), null);
  const none = await askReel(at);
  assert.equal(none.reel, null);
  assert.equal(none.why, "replay");
  await store.putReplay(CODE, {
    v: 14,
    t: Date.now(),
    data: JSON.stringify({
      v: 1,
      n: 2,
      hash: "h2",
      engine: "0.7.1",
      log: [],
      snap: "{}",
    }),
    exp: Math.floor(Date.now() / 1000) + 86400,
  });
  assert.deepEqual(await askKept(at), KEPT);
  assert.equal(started.length, 0);
  const first = await askReel(at);
  assert.equal(first.v, 14);
  assert.equal(first.reel.state, "rendering");
  const again = await askReel(at);
  assert.equal(again.reel.state, "rendering");
  assert.equal(started.length, 1);
  // the reducer takes the server's own answers
  const s = run([press, kept(await askKept(at)), answer(first), answer(again)]);
  assert.equal(s.phase, "asking");
  assert.equal(s.polled, true);
});

test("reel: no server is no connection", async () => {
  await assert.rejects(
    askReel({
      url: "ws://127.0.0.1:9",
      code: CODE,
      WebSocket: NodeWs,
      timeoutMs: 2000,
    }),
    (e) => ["closed", "timeout"].includes(e.code),
  );
});

// A socket that notes the type of every message it sends.
function counting(sent) {
  return class extends NodeWs {
    send(data, ...rest) {
      sent.push(JSON.parse(data).t);
      return super.send(data, ...rest);
    }
  };
}

// Make the requests the states call for, as the card does, until one is answered with
// a render on its way or nothing is left to ask.
async function drive(s, at, match) {
  while (reelView(s).ask && !s.polled) {
    const e = await reelRequest(s, at, match);
    s = reelStep(s, e);
  }
  return s;
}

test("reel: the room keeps a newer match than the one on screen: 'moved', no reel asked", async () => {
  const code = "staxhntq22";
  await store.putReplay(code, {
    v: 30,
    t: Date.now(),
    data: JSON.stringify({
      v: 1,
      n: 3,
      hash: "h3",
      engine: "0.7.1",
      log: [],
      snap: "{}",
    }),
    exp: Math.floor(Date.now() / 1000) + 86400,
  });
  const sent = [];
  const before = started.length;
  // the viewer's replay (and any hint of it) is match 2; the room has kept match 3
  const s = await drive(
    reelStep(reelStart(), press),
    { url: server.url, code, WebSocket: counting(sent) },
    { n: 2, hash: "h2" },
  );
  assert.equal(s.phase, "refused");
  assert.equal(reelView(s).text, REEL_WORDS.why.moved);
  assert.deepEqual(sent, ["replay"]);
  assert.equal(started.length, before);
});

test("reel: a press reads the kept replay once, then asks for the reel once", async () => {
  const code = "nrmxhtqp22";
  await store.putReplay(code, {
    v: 40,
    t: Date.now(),
    data: JSON.stringify({
      v: 1,
      n: 2,
      hash: "h2",
      engine: "0.7.1",
      log: [],
      snap: "{}",
    }),
    exp: Math.floor(Date.now() / 1000) + 86400,
  });
  const sent = [];
  const s = await drive(
    reelStep(reelStart(), press),
    { url: server.url, code, WebSocket: counting(sent) },
    MATCH,
  );
  assert.equal(s.phase, "asking");
  assert.equal(s.polled, true);
  assert.equal(s.v, 40);
  assert.deepEqual(sent, ["replay", "reel"]);
});
