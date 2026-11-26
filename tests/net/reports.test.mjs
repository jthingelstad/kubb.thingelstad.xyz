// Reports (MENU, SEND FEEDBACK: a throw or anything else): the api function's `report`
// call (backend/api/core.mjs, its checks backend/api/checks.mjs), the object it keeps
// (backend/api/records.mjs), the browser's payload and its POST (src/net/report.js), and
// the replay of the reported moment (tools/reports.mjs).
//
// The old rooms server's report socket is gone: no frames to join and no 3 reports a
// connection (there is no connection; API.md "Limits that are not here").
import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import { createApi } from "../../backend/api/core.mjs";
import {
  LIMITS,
  REPORT_KINDS,
  REPORT_MODES,
  asciiJson,
} from "../../backend/api/checks.mjs";
import { memoryStore } from "../../backend/api/memory-store.mjs";
import {
  memoryRecords,
  reportKey,
  reportText,
  s3Reports,
} from "../../backend/api/records.mjs";
import {
  REPORT_LIMITS,
  REPORT_KINDS as CLIENT_KINDS,
  REPORT_MODES as CLIENT_MODES,
  ReportError,
  captureReport,
  reportMessage,
  reportReady,
  sendReport,
} from "../../src/net/report.js";
import { Engine } from "../../src/engine/index.js";
import { bundleLua } from "../../tools/lua-bundle.mjs";
import { parseRecord } from "../../tools/games.mjs";
import { startPitchServer } from "../../tools/pitch-dev.mjs";
import { describeReport, replayReport } from "../../tools/reports.mjs";

const sources = await bundleLua();
const ROOM = "abcdefgh";
const T0 = 1_763_300_000_000; // 2025-11-16

// The api over its in-memory adapters; `post(r)` sends `{ r }` as the browser does.
function harness({ keepReport, limits } = {}) {
  let t = T0;
  const records = memoryRecords();
  const api = createApi({
    store: memoryStore({ now: () => t }),
    keepReport: keepReport === undefined ? records.keepReport : keepReport,
    now: () => t,
    log: () => {},
    ...(limits ? { limits } : {}),
  });
  const send = async (text) => {
    const res = await api.handle({
      method: "POST",
      path: "/api/report",
      query: new URLSearchParams(),
      headers: { "content-type": "application/json" },
      body: Buffer.from(text),
    });
    return { status: res.status, json: JSON.parse(res.body) };
  };
  const post = (r) => send(asciiJson({ r }));
  // the kept reports, oldest first: [{ key, text }]
  const kept = () =>
    [...records.kept]
      .filter(([k]) => k.startsWith("reports/"))
      .map(([key, text]) => ({ key, text: String(text) }));
  return { api, send, post, kept, tick: (ms) => (t += ms) };
}

const minimal = (extra = {}) => ({
  mode: "solo",
  happened: "The kubb fell through.",
  should: "",
  ...extra,
});

test("the limits and modes agree between the browser and the server", () => {
  assert.equal(REPORT_LIMITS.bytes, LIMITS.reportBytes);
  assert.equal(REPORT_LIMITS.chars, LIMITS.reportChars);
  assert.equal(REPORT_LIMITS.feedbackChars, LIMITS.feedbackChars);
  assert.deepEqual([...CLIENT_MODES], [...REPORT_MODES]);
  assert.deepEqual([...CLIENT_KINDS], [...REPORT_KINDS]);
  assert.ok(LIMITS.reportBytes < LIMITS.bodyBytes, "inside a request body");
});

test("a report is kept and acknowledged, and nothing names the sender", async () => {
  const h = harness();
  const res = await h.post(minimal());
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true });
  assert.equal(h.kept().length, 1);
  const kept = h.kept()[0];
  assert.match(
    kept.key,
    /^reports\/2025-11-16\/\d{13}-[2-9a-hjkmnp-z]{8}\.json\.gz$/,
  );
  assert.equal(kept.key.slice(19, 32), String(T0));
  const obj = JSON.parse(kept.text);
  assert.equal(obj.t, T0, "the server's time");
  assert.equal(obj.report.happened, "The kubb fell through.");
  assert.deepEqual(
    Object.keys(obj),
    ["t", "report"],
    "nothing names the sender",
  );
});

test("a shared pitch's report keeps its room and version", async () => {
  const h = harness();
  const res = await h.post(minimal({ mode: "pitch", room: ROOM, v: 4 }));
  assert.deepEqual(res.json, { ok: true });
  const obj = JSON.parse(h.kept()[0].text);
  assert.equal(obj.report.room, ROOM);
  assert.equal(obj.report.v, 4);
  // `pitch` (API.md's name for it) is taken too
  await h.post(minimal({ mode: "pitch", pitch: ROOM }));
  assert.equal(JSON.parse(h.kept()[1].text).report.pitch, ROOM);
});

test("a big report goes in one request, no parts to join", async () => {
  const h = harness();
  const res = await h.post(minimal({ pad: "x".repeat(40_000) }));
  assert.deepEqual(res.json, { ok: true });
  assert.equal(JSON.parse(h.kept()[0].text).report.pad.length, 40_000);
});

test("refusals: too big, empty, too long, a bad mode, not JSON; no cap a sender", async () => {
  const h = harness();
  const refused = async (body, code, status) => {
    const res = await (typeof body === "string"
      ? h.send(body)
      : h.send(asciiJson(body)));
    assert.equal(res.json.error, code, JSON.stringify(res.json));
    assert.equal(res.status, status);
    assert.equal(typeof res.json.message, "string");
  };
  await refused(
    { r: minimal({ pad: "x".repeat(LIMITS.reportBytes) }) },
    "too-big",
    413,
  );
  await refused(
    { r: minimal({ happened: "  ", should: "\n" }) },
    "bad-message",
    400,
  );
  await refused({ r: minimal({ happened: "é".repeat(1001) }) }, "too-big", 413);
  await refused({ r: minimal({ should: 5 }) }, "bad-message", 400);
  await refused({ r: minimal({ mode: "arcade" }) }, "bad-message", 400);
  await refused({ r: minimal({ room: "BAD" }) }, "bad-pitch", 400);
  await refused({ r: minimal({ pitch: "BAD" }) }, "bad-pitch", 400);
  await refused({ t: "report", id: 7 }, "bad-message", 400);
  await refused("{not json", "bad-message", 400);
  await refused("[1]", "bad-message", 400);
  assert.equal(h.kept().length, 0, "nothing refused is kept");

  // 1000 characters of anything is fine, and there is no connection to cap
  assert.equal(
    (await h.post(minimal({ happened: "é".repeat(1000) }))).status,
    200,
  );
  for (let i = 0; i < 4; i++)
    assert.equal((await h.post(minimal())).status, 200);
  assert.equal(h.kept().length, 5);
});

const feedback = (extra = {}) => ({
  kind: "feedback",
  mode: "solo",
  text: "Love the sound.",
  ...extra,
});

test("a report with no kind is a throw report, kept with kind throw (older clients)", async () => {
  const h = harness();
  const r = minimal({ selectedPieces: [{ id: "king", kind: "king" }] });
  assert.equal(r.kind, undefined, "the iPhone app's current shape");
  assert.deepEqual((await h.post(r)).json, { ok: true });
  const kept = JSON.parse(h.kept()[0].text).report;
  assert.equal(kept.kind, "throw");
  assert.equal(kept.happened, "The kubb fell through.");
  assert.equal(kept.should, "");
  assert.equal(kept.selectedPieces[0].id, "king");
  // null is absent too; and "throw" said outright is the same
  h.tick(1);
  await h.post(minimal({ kind: null }));
  h.tick(1);
  await h.post(minimal({ kind: "throw" }));
  const all = h.kept();
  assert.equal(all.length, 3);
  for (const k of all) assert.equal(JSON.parse(k.text).report.kind, "throw");
});

test("a report's paint: kept when it is in shape, refused when it is not; older marked pieces still pass", async () => {
  const h = harness();
  const paint = {
    brush: 0.25,
    strokes: [
      [
        [0, 4],
        [0.5, 4.25],
      ],
      [[-1.2, 6.03]],
    ],
  };
  assert.deepEqual((await h.post(minimal({ paint }))).json, { ok: true });
  assert.deepEqual(JSON.parse(h.kept()[0].text).report.paint, paint);
  h.tick(1);
  assert.deepEqual(
    (await h.post(feedback({ paint, selectedPieces: [{ id: "king" }] }))).json,
    { ok: true },
    "feedback may carry it too, beside an older client's pieces",
  );
  const bad = async (p, why) => {
    const res = await h.post(minimal({ paint: p }));
    assert.equal(res.status, 400, why);
    assert.equal(res.json.error, "bad-message", why);
  };
  const pts = (n) => Array.from({ length: n }, (_, i) => [0, (i % 100) / 10]);
  await bad([], "not an object");
  await bad({ brush: 0.25 }, "no strokes");
  await bad({ brush: 0.25, strokes: [] }, "no stroke");
  await bad({ brush: 0.25, strokes: [[]] }, "an empty stroke");
  await bad({ brush: 0.04, strokes: [[[0, 4]]] }, "brush too small");
  await bad({ brush: 1.01, strokes: [[[0, 4]]] }, "brush too big");
  await bad({ brush: "0.2", strokes: [[[0, 4]]] }, "brush not a number");
  await bad({ brush: 0.25, strokes: [[[6.01, 4]]] }, "x past 6");
  await bad({ brush: 0.25, strokes: [[[0, -4.01]]] }, "y under -4");
  await bad({ brush: 0.25, strokes: [[[0, 12.5]]] }, "y past 12");
  await bad({ brush: 0.25, strokes: [[[0.123, 4]]] }, "3 decimals");
  await bad({ brush: 0.25, strokes: [[[0, 4, 1]]] }, "three numbers");
  await bad({ brush: 0.25, strokes: [[["0", 4]]] }, "text for a number");
  await bad(
    { brush: 0.25, strokes: Array.from({ length: 33 }, () => [[0, 4]]) },
    "33 strokes",
  );
  await bad({ brush: 0.25, strokes: [pts(400), pts(401)] }, "801 points");
  assert.deepEqual(
    (
      await h.post(
        minimal({
          paint: {
            brush: 1,
            strokes: [pts(400), pts(400)],
          },
        }),
      )
    ).json,
    { ok: true },
    "800 points is the most",
  );
  assert.equal(h.kept().length, 3, "nothing refused is kept");
});

test("feedback about anything: one text, kept with its kind and the game context", async () => {
  const h = harness();
  const res = await h.post(
    feedback({ mode: "pitch", room: ROOM, v: 3, phase: "aim", pieces: [] }),
  );
  assert.deepEqual(res.json, { ok: true });
  const kept = h.kept()[0];
  assert.ok(kept.key.startsWith("reports/2025-11-16/"), "the same prefix");
  const r = JSON.parse(kept.text).report;
  assert.equal(r.kind, "feedback");
  assert.equal(r.text, "Love the sound.");
  assert.equal(r.room, ROOM);
  assert.equal(r.v, 3);
  assert.equal(r.happened, undefined);
  assert.equal(r.should, undefined);
  // 2000 characters after trimming, whatever the white space around them
  const long = await h.post(feedback({ text: `  ${"é".repeat(2000)}\n\n` }));
  assert.equal(long.status, 200);
});

test("feedback refusals: a bad kind, no text, blank, too long, the throw's answers", async () => {
  const h = harness();
  const refused = async (r, code) => {
    const res = await h.post(r);
    assert.equal(res.json.error, code, JSON.stringify(r));
  };
  for (const kind of ["idea", "Feedback", "", 1, true, ["feedback"], {}])
    await refused(feedback({ kind }), "bad-message");
  await refused(feedback({ text: undefined }), "bad-message");
  await refused(feedback({ text: 5 }), "bad-message");
  await refused(feedback({ text: "" }), "bad-message");
  await refused(feedback({ text: " \n\t " }), "bad-message");
  await refused(feedback({ text: "é".repeat(2001) }), "too-big");
  await refused(feedback({ happened: "x" }), "bad-message");
  await refused(feedback({ should: "" }), "bad-message");
  await refused(feedback({ mode: "arcade" }), "bad-message");
  await refused(feedback({ room: "BAD" }), "bad-pitch");
  await refused(feedback({ client: "Web" }), "bad-message");
  await refused(feedback({ pad: "x".repeat(LIMITS.reportBytes) }), "too-big");
  // a throw report is still judged as one: its answers, not a text
  await refused(minimal({ kind: "throw", happened: undefined }), "bad-message");
  await refused({ kind: "throw", mode: "solo", text: "hi" }, "bad-message");
  assert.equal(h.kept().length, 0, "nothing refused is kept");
});

test("a report may say which client and engine sent it; a bad tag is refused", async () => {
  const h = harness();
  const res = await h.post(
    minimal({ client: "ios", engine: "1.2.0+core.c11f533" }),
  );
  assert.deepEqual(res.json, { ok: true });
  const kept = JSON.parse(h.kept()[0].text);
  assert.equal(kept.report.client, "ios");
  assert.equal(kept.report.engine, "1.2.0+core.c11f533");
  assert.deepEqual(
    (await h.post(minimal())).json,
    { ok: true },
    "absent is fine",
  );

  const bad = harness();
  for (const extra of [
    { client: "Web" },
    { client: "w_b" },
    { client: "a".repeat(33) },
    { client: 1 },
    { engine: "1 2" },
    { engine: "1".repeat(65) },
    { engine: false },
  ]) {
    const r = await bad.post(minimal(extra));
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.equal(r.json.error, "bad-message");
  }
  assert.equal(bad.kept().length, 0);
});

test("a report that cannot be kept says so", async () => {
  let fail = true;
  const records = memoryRecords();
  const h = harness({
    keepReport: async (entry) => {
      if (fail) throw new Error("S3 down");
      return records.keepReport(entry);
    },
  });
  for (let i = 0; i < 4; i++) {
    const res = await h.post(minimal());
    assert.equal(res.status, 500);
    assert.equal(res.json.error, "failed");
  }
  fail = false;
  assert.deepEqual((await h.post(minimal())).json, { ok: true });
  assert.equal(records.kept.size, 1);
});

test("without a reporter, reports are unavailable", async () => {
  const h = harness({ keepReport: null });
  const res = await h.post(minimal());
  assert.equal(res.status, 503);
  assert.equal(res.json.error, "unavailable");
});

test("the S3 reporter writes one gzipped object under reports/", async () => {
  const sent = [];
  const keep = s3Reports({
    client: { send: async (cmd) => void sent.push(cmd.input) },
    bucket: "games-bucket",
  });
  const key = await keep({
    t: T0,
    report: asciiJson({ mode: "watch", happened: "Å" }),
  });
  assert.equal(sent.length, 1);
  const put = sent[0];
  assert.equal(put.Bucket, "games-bucket");
  assert.equal(put.Key, key);
  assert.ok(put.Key.startsWith("reports/2025-11-16/"));
  assert.equal(put.ContentEncoding, "gzip");
  const obj = JSON.parse(gunzipSync(put.Body).toString("utf8"));
  assert.deepEqual(obj, { t: T0, report: { mode: "watch", happened: "Å" } });
  assert.equal(
    reportKey({ t: T0, tail: "abcdefgh" }),
    `reports/2025-11-16/${T0}-abcdefgh.json.gz`,
  );
  assert.equal(reportText({ t: 5, report: "{}" }), '{"t":5,"report":{}}');
});

// The browser's POST over real HTTP to the local api (tools/pitch-dev.mjs): it resolves
// on { ok: true } and rejects a ReportError carrying the function's error code.
async function withServer(fn) {
  const s = await startPitchServer({ port: 0 });
  try {
    return await fn(s);
  } finally {
    await s.close();
  }
}

const keptReports = (s) =>
  [...s.api.records.kept]
    .filter(([k]) => k.startsWith("reports/"))
    .map(([key, text]) => ({ key, text: String(text) }));

test("sendReport posts { r } to the api and resolves on its ack; refusals reject with the code", async () => {
  await withServer(async (s) => {
    const ok = await sendReport({
      url: s.apiUrl,
      message: { t: "report", id: 1, r: minimal() },
    });
    assert.equal(ok, true);
    const kept = keptReports(s);
    assert.equal(kept.length, 1);
    assert.equal(
      JSON.parse(kept[0].text).report.happened,
      "The kubb fell through.",
    );

    await assert.rejects(
      sendReport({
        url: s.apiUrl,
        message: { r: minimal({ happened: " ", should: "" }) },
      }),
      (e) =>
        e instanceof ReportError &&
        e.code === "bad-message" &&
        e.status === 400,
    );
    assert.equal(keptReports(s).length, 1, "nothing refused is kept");
  });
  // nothing listening: closed, never a hang
  const s = await startPitchServer({ port: 0 });
  const gone = s.apiUrl;
  await s.close();
  await assert.rejects(
    sendReport({ url: gone, message: { r: minimal() } }),
    (e) => e instanceof ReportError && e.code === "closed",
  );
  await assert.rejects(
    sendReport({ url: null, message: { r: minimal() } }),
    (e) => e.code === "unavailable",
  );
});

// ---------- the browser's payload, against a real engine ----------

// A Game-shaped object over a real engine that tracks actions the way
// src/game/game.js does (startTrail / track).
async function soloGame(n = 3, keys = {}) {
  const engine = await Engine.create({ sources });
  engine.newMatch({
    seed: 11,
    cpu: "both",
    start: { year: 2026, month: 11, day: 16, hour: 9, min: 0 },
    teams: {
      A: { name: "North", players: [{ name: "Åsa", key: keys.A }] },
      B: { name: "South", players: [{ name: "Bo", key: keys.B }] },
    },
  });
  const start = engine.snapshot();
  const trail = { kind: "match", start, actions: [], before: null, now: start };
  for (let i = 0; i < n; i++) {
    let out;
    for (let k = 0; k < 2000; k++) {
      out = engine.frame({ dt: 1 / 20 });
      if (out.action) break;
    }
    assert.ok(out.action, "the computer threw");
    trail.actions.push(out.action);
    trail.before = trail.now;
    trail.now = engine.snapshot();
  }
  const view = engine.view();
  return {
    engine,
    trail,
    phase: "aim",
    need: view.need,
    level: "club",
  };
}

const CONFIG = {
  version: "0.2.0",
  commit: "abc123",
  luaUrl: "/assets/lua-sources-0123456789ab.json",
  engine: "0.8.1",
  release: { text: "0.2.0 (0.8.1)", detail: "Also plays 0.7.4" },
};
const WIN = { innerWidth: 1280, innerHeight: 768, devicePixelRatio: 2 };

test("the payload carries the match, the build, the viewport, and no person", async () => {
  const game = await soloGame(3);
  const state = captureReport({
    game,
    mode: "watch",
    config: CONFIG,
    win: WIN,
    now: () => 42,
  });
  const msg = reportMessage(state, {
    happened: "It went through the kubb.",
    should: "",
  });
  assert.equal(msg.t, "report");
  const r = msg.r;
  assert.equal(r.mode, "watch");
  assert.equal(r.client, "web");
  assert.equal(r.engine, game.engine.version);
  assert.match(r.engine, /^\d+\.\d+\.\d+$/);
  assert.equal(r.at, 42);
  assert.deepEqual(r.build, {
    version: "0.2.0",
    label: "0.2.0 (0.8.1)",
    commit: "abc123",
    lua: "lua-sources-0123456789ab.json",
  });
  assert.deepEqual(r.viewport, { w: 1280, h: 768, dpr: 2 });
  assert.equal(r.options.seed, 11);
  assert.equal(r.options.surface, "grass");
  assert.equal(r.actions.length, 3);
  assert.equal(r.last.type, "throw");
  assert.deepEqual(r.lastThrow.action, r.last);
  assert.equal(typeof r.lastThrow.result, "object");
  assert.ok(r.lastThrow.result.legal !== undefined);
  assert.equal(typeof r.snapshots.before, "string");
  assert.ok(r.pieces.length > 10);
  assert.ok(!r.dropped);
  const text = asciiJson(msg);
  assert.ok(text.length <= REPORT_LIMITS.bytes, `${text.length} bytes`);
  assert.ok(!/userAgent|Mozilla/.test(text));

  // it goes over HTTP to the api and replays to the same snapshot
  const keptText = await withServer(async (s) => {
    await sendReport({ url: s.apiUrl, message: msg });
    return keptReports(s)[0].text;
  });
  const kept = parseRecord(gzipSync(keptText));
  const engine = await Engine.create({ sources });
  const out = replayReport(engine, kept);
  assert.equal(out.kind, "match");
  assert.equal(out.applied, true);
  assert.equal(out.same, true, "the last action ends on the reported snapshot");
  assert.equal(out.whole.same, true, "the whole match too");
  assert.ok(out.drift.max < 1e-3, "the pieces where the browser had them");
  const lines = describeReport(kept, "x.json.gz").join("\n");
  assert.match(lines, /watch \[web\]/, "the client tag when it says one");
  assert.match(lines, /It went through the kubb/);
  assert.match(lines, /before \+ last action; start \+ 3 actions/);
});

test("answers are clipped, and a report too big drops history, then pieces, never the text", async () => {
  const game = await soloGame(1);
  const state = captureReport({ game, mode: "solo", config: CONFIG, win: WIN });
  const long = reportMessage(state, {
    happened: "x".repeat(5000),
    should: "y",
  });
  assert.equal(long.r.happened.length, REPORT_LIMITS.chars);
  assert.ok(!reportReady({ happened: " ", should: "\n" }));
  assert.ok(reportReady({ happened: "", should: "a" }));

  state.actions = Array.from({ length: 300 }, () => state.last);
  const big = reportMessage(state, { happened: "h", should: "s" });
  assert.deepEqual(big.r.dropped, ["history"]);
  assert.equal(big.r.actions, null);
  assert.equal(big.r.snapshots.start, null);
  assert.equal(typeof big.r.snapshots.before, "string");
  assert.equal(big.r.happened, "h");
  assert.ok(asciiJson(big).length <= REPORT_LIMITS.bytes);
  const bytes = asciiJson(big).length - 1;
  const small = reportMessage(
    state,
    { happened: "h", should: "s" },
    {
      limits: { ...REPORT_LIMITS, bytes },
    },
  );
  assert.deepEqual(small.r.dropped, ["history", "pieces"]);
  assert.equal(small.r.pieces, null);
  const paint = {
    brush: 0.25,
    strokes: [
      [
        [0, 4],
        [0.4, 4.2],
      ],
    ],
  };
  const marked = reportMessage(
    state,
    { happened: "h", paint, selected: ["king"] },
    { limits: { ...REPORT_LIMITS, bytes } },
  );
  assert.equal(marked.r.pieces, null);
  assert.deepEqual(marked.r.paint, paint, "the paint is kept when pieces go");
  assert.equal(marked.r.selectedPieces, undefined, "no longer sent");
  assert.equal(marked.r.pickPieces, undefined);
  const tinyPaint = reportMessage(
    state,
    { happened: "h", paint },
    { limits: { ...REPORT_LIMITS, bytes: 10 } },
  );
  assert.deepEqual(tinyPaint.r.paint, paint, "never cut");
  const tiny = reportMessage(
    state,
    { happened: "h", should: "s" },
    {
      limits: { ...REPORT_LIMITS, bytes: 10 },
    },
  );
  assert.deepEqual(tiny.r.dropped, ["history", "pieces", "after"]);
  assert.equal(typeof tiny.r.snapshots.before, "string", "never cut");
  assert.equal(tiny.r.last.type, "throw", "never cut");
});

test("feedback: one trimmed text with the same game context, cut the same way, never the text", async () => {
  const game = await soloGame(1);
  const state = captureReport({ game, mode: "solo", config: CONFIG, win: WIN });
  const msg = reportMessage(state, {
    kind: "feedback",
    text: "  The menu is hard to find.\n",
    happened: "ignored",
    selected: ["king"],
  });
  const r = msg.r;
  assert.equal(r.kind, "feedback");
  assert.equal(r.text, "The menu is hard to find.");
  for (const k of ["happened", "should", "selectedPieces", "pickPieces"])
    assert.equal(r[k], undefined, k);
  assert.equal(r.mode, "solo");
  assert.equal(typeof r.snapshots.before, "string", "the game goes with it");
  assert.equal(r.lastThrow.action.type, "throw");
  assert.equal(
    reportMessage(state, { kind: "feedback", text: "x".repeat(5000) }).r.text
      .length,
    REPORT_LIMITS.feedbackChars,
  );
  assert.equal(reportMessage(state, { happened: "h" }).r.kind, "throw");
  assert.ok(!reportReady({ kind: "feedback", text: " \n" }));
  assert.ok(!reportReady({ kind: "feedback", happened: "a" }));
  assert.ok(reportReady({ kind: "feedback", text: "a" }));

  state.actions = Array.from({ length: 300 }, () => state.last);
  const text = "é".repeat(REPORT_LIMITS.feedbackChars);
  const tiny = reportMessage(
    state,
    { kind: "feedback", text },
    { limits: { ...REPORT_LIMITS, bytes: 10 } },
  );
  assert.deepEqual(tiny.r.dropped, ["history", "pieces", "after"]);
  assert.equal(tiny.r.text, text, "never cut");

  // through the server; the tools print it, and replay its throw
  const h = harness();
  assert.deepEqual((await h.send(asciiJson({ r: msg.r }))).json, { ok: true });
  const kept = parseRecord(gzipSync(h.kept()[0].text));
  const lines = describeReport(kept, "x.json.gz").join("\n");
  assert.match(lines, /feedback {2}solo \[web\]/);
  assert.match(lines, /Feedback: The menu is hard to find\./);
  assert.doesNotMatch(lines, /What happened/);
  const engine = await Engine.create({ sources });
  assert.equal(replayReport(engine, kept).same, true, "its throw replays");

  // feedback from before any throw has nothing to replay
  const fresh = {
    report: { kind: "feedback", mode: "solo", text: "Hi", lastThrow: null },
  };
  const out = replayReport(engine, fresh);
  assert.equal(out.kind, null);
  assert.match(out.why, /feedback/);
  // a kept throw report from before kinds reads as a throw
  assert.match(
    describeReport({ t: T0, report: { mode: "solo", happened: "a" } }).join(),
    /throw {2}solo/,
  );
});

test("the report is the game as the card opened, whatever is played after", async () => {
  const game = await soloGame(2);
  const state = captureReport({
    game,
    mode: "watch",
    config: CONFIG,
    win: WIN,
  });
  game.trail.actions.push({ type: "throw", later: true });
  const practice = {
    engine: game.engine,
    trail: { kind: "practice", opts: { level: "club" }, ops: [] },
  };
  const p = captureReport({ game: practice, mode: "practice", win: WIN });
  practice.trail.ops.push({ type: "reset" });
  assert.equal(state.actions.length, 2);
  assert.equal(p.practice.ops.length, 0);
});

test("room member ids are swapped for member1, member2 everywhere, and it still replays", async () => {
  const A = "Kq3_xY7-abcdEFGH";
  const B = "Zz9988776655aaBB";
  const game = await soloGame(2, { A, B });
  const pitch = {
    room: {
      code: ROOM,
      v: 3,
      you: A,
      members: [{ id: A }, { id: B }, { id: "Other123member" }],
      doc: {},
    },
  };
  assert.ok(game.trail.now.includes(A), "the snapshot carries the key");
  const state = captureReport({
    game,
    mode: "pitch",
    config: CONFIG,
    pitch,
    win: WIN,
  });
  const text = asciiJson(reportMessage(state, { happened: "h" }));
  assert.ok(!text.includes(A) && !text.includes(B));
  assert.ok(!text.includes("Other123member"));
  assert.match(text, /member\d/);
  const names = state.options.teams;
  assert.match(names.A.players[0].key, /^member\d$/);
  assert.notEqual(names.A.players[0].key, names.B.players[0].key);
  const engine = await Engine.create({ sources });
  const out = replayReport(engine, { t: 1, report: state });
  assert.equal(out.same, true);
  assert.equal(out.whole.same, true);
});

test("a report from the wide view keeps the thrower's frame, so it still replays in place", async () => {
  // far enough in for Team B to be the one throwing
  let game = null;
  for (const n of [3, 4, 5, 6, 8]) {
    game = await soloGame(n);
    game.engine.setWide({ left: 0, top: 0, right: 400, bottom: 240 });
    if (game.engine.view().need.side === "B") break;
  }
  const wideItems = game.engine.view().items;
  const state = captureReport({
    game,
    mode: "watch",
    config: CONFIG,
    win: WIN,
  });
  const far = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const kubb = wideItems.find(
    (it) => it.kind !== "stake" && Math.abs(it.y) > 1,
  );
  const same = state.pieces.find((p) => p.id === kubb.id);
  assert.ok(
    far(kubb, same) > 1,
    "the wide view turned the pitch, the report did not",
  );
  const engine = await Engine.create({ sources });
  const out = replayReport(engine, { t: 1, report: state });
  assert.equal(out.same, true);
  assert.ok(out.drift.max < 1e-3, "the pieces where the replay has them");
});

test("a shared pitch's report names the pitch, the version and the match's head", async () => {
  const game = await soloGame(1);
  const pitch = {
    // as PitchClient holds them: the code is its `pitch`
    room: { pitch: ROOM, v: 12, match: { n: 2, seq: 5, h: "x" }, doc: {} },
  };
  const r = captureReport({
    game,
    mode: "pitch",
    config: CONFIG,
    pitch,
    win: WIN,
  });
  assert.equal(r.pitch, ROOM);
  assert.equal(r.room, undefined);
  assert.equal(r.v, 12);
  assert.deepEqual(r.match, { n: 2, seq: 5 });
});

test("practice: options and every step replay to the pieces the browser had", async () => {
  const engine = await Engine.create({ sources });
  engine.newPractice({ level: "club", surface: "sand" });
  const trail = {
    kind: "practice",
    opts: { level: "club", drill: false, surface: "sand" },
    ops: [],
  };
  // a swing as a pointer gives it (tests/engine/engine.test.mjs swingArms)
  const throwOnce = () => {
    const plan = engine.view().aim.plan;
    const back = (plan.powerLo + plan.powerHi) / 2;
    const arms = [0, -5];
    for (let a = -5; a > -back;) arms.push((a = Math.max(-back, a - 400 / 60)));
    for (let a = -back; a < plan.release;)
      arms.push((a = Math.min(plan.release, a + 2400 / 60)));
    for (let i = 0; i < 6; i++) arms.push(plan.release);
    let out;
    for (const arm of arms) {
      out = engine.frame({ dt: 1 / 60, arm });
      if (out.event) break;
    }
    assert.ok(out.action, "a throw");
    trail.ops.push(out.action);
  };
  throwOnce();
  engine.reset();
  trail.ops.push({ type: "reset" });
  throwOnce();
  throwOnce();
  const view = engine.view();
  const game = { engine, trail, phase: "aim", need: view.need, level: "club" };
  const r = captureReport({ game, mode: "practice", config: CONFIG, win: WIN });
  assert.equal(r.practice.ops.length, 4);
  assert.equal(r.lastThrow.action.type, "throw");
  const fresh = await Engine.create({ sources });
  const out = replayReport(fresh, { t: 1, report: r });
  assert.equal(out.kind, "practice");
  // the report rounds positions to 0.1 mm
  assert.ok(out.drift.max < 1e-3, "the same pieces in the same places");
  assert.equal(out.drift.missing, 0);

  const original = engine.recording();
  r.practice.ops.unshift(
    ...Array(3000).fill({ type: "surface", surface: "sand" }),
  );
  const compact = reportMessage(r, {
    happened: "stuck",
    paint: { brush: 0.3, strokes: [[[0.123, 4.567]]] },
  });
  assert.ok(asciiJson(compact).length <= REPORT_LIMITS.bytes);
  assert.equal(compact.r.practice.ops, null);
  assert.equal(typeof compact.r.practice.before, "string");
  assert.deepEqual(compact.r.paint, { brush: 0.3, strokes: [[[0.12, 4.57]]] });
  assert.equal(replayReport(fresh, compact.r).kind, "practice");
  assert.deepEqual(fresh.recording(), original);
});
