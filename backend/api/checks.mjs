// What the api function accepts from players: the shapes and limits of a report, a
// recorded one-device match and a share, as the old rooms function held them (its
// rules, moved here unchanged when it was retired on 2026-11-21). Pure: no AWS. The contract is backend/api/API.md.

import { createHash } from "node:crypto";
import { PAINT_LIMITS, paintProblem } from "../../src/net/paint.js";

export const LIMITS = Object.freeze({
  bodyBytes: 300 * 1024, // a whole request body from a player (not a push)
  reportBytes: 64 * 1024, // a whole report, as ASCII JSON
  reportChars: 1000, // each of a throw report's two typed answers, in characters
  feedbackChars: 2000, // a feedback report's one text, in characters after trimming
  gameBytes: 256 * 1024, // a whole recorded match (a match played on one device)
  gameActions: 4000, // the actions one such match may carry
  replayBytes: 256 * 1024, // a kept replay, as ASCII JSON (without its final snapshot)
  snapBytes: 64 * 1024, // one snapshot pushed by a pitch (the pitch server's own limit)
  metaBytes: 16 * 1024, // a match's start info pushed by a pitch (the same)
  logMax: 10_000, // actions a kept replay may carry (the pitch server's own limit)
  pushBytes: 6 * 1024 * 1024, // a whole push (a Lambda function URL takes 6 MB)
  keepTtl: 365 * 24 * 3600, // seconds a finished pitch (its state and replay) lives on
  pitchTtl: 48 * 3600, // seconds a pitch in play outlives its last push
  reelsPerDay: 200, // highlight reels rendered a day, all pitches together (UTC days)
  reelStaleMs: 25 * 60 * 1000, // a render "rendering" this long died without a word
  reelCountTtl: 3 * 24 * 3600, // seconds a day's render or share counter is kept
  shareBytes: 256 * 1024, // a whole share, as ASCII JSON (over it: too-long)
  shareActions: 1000, // the actions a share may carry (over it: too-long)
  shareStartBytes: 16 * 1024, // a share's first snapshot
  sharesPerDay: 200, // shares checked a day, all devices together (UTC days)
  shareWaitMs: 20_000, // how long the function waits for the renderer's check
  paint: PAINT_LIMITS, // a report's optional `paint` (src/net/paint.js, the one source)
});

// Pitch codes are made by the client: 8 to 24 characters with no 0, 1, i, l or o.
export const PITCH_CODE = /^[2-9a-hjkmnp-z]{8,24}$/;

// What made a one-device match or a report, both optional: `client` the program
// ("web", "ios"), `engine` the game engine's version.
export const CLIENT_TAG = /^[a-z0-9.-]{1,32}$/;
export const ENGINE_TAG = /^[a-z0-9.+-]{1,64}$/;

export const GAME_MODES = Object.freeze(["solo", "watch"]);
export const REPORT_MODES = Object.freeze([
  "practice",
  "solo",
  "watch",
  "pitch",
]);
// A report with no `kind` is a throw report: clients built before feedback send none.
export const REPORT_KINDS = Object.freeze(["throw", "feedback"]);

// A refusal: `code` names it on the wire, `status` is its HTTP status.
export class ApiError extends Error {
  constructor(code, message, status = statusOf(code)) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const STATUS = {
  "bad-message": 400,
  "bad-pitch": 400,
  "bad-signature": 401,
  forbidden: 403,
  "not-found": 404,
  method: 405,
  "too-big": 413,
  unavailable: 503,
  failed: 500,
};
function statusOf(code) {
  return STATUS[code] ?? 400;
}

export const isObject = (x) =>
  x !== null && typeof x === "object" && !Array.isArray(x);

const BACKSLASH = String.fromCharCode(92);

// JSON with every character above "~" written as a backslash-u escape: the text is pure
// ASCII, so its length is its size in bytes.
export function asciiJson(value) {
  return JSON.stringify(value).replace(
    /[^\x00-\x7e]/g,
    (c) => BACKSLASH + "u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

const fail = (code, message) => {
  throw new ApiError(code, message);
};

function checkTags(x) {
  if (x.client !== undefined && x.client !== null)
    if (typeof x.client !== "string" || !CLIENT_TAG.test(x.client))
      fail(
        "bad-message",
        "`client` must be 1 to 32 of a-z, 0-9, dot and dash.",
      );
  if (x.engine !== undefined && x.engine !== null)
    if (typeof x.engine !== "string" || !ENGINE_TAG.test(x.engine))
      fail(
        "bad-message",
        "`engine` must be 1 to 64 of a-z, 0-9, dot, dash and plus.",
      );
}

// A report: { r: { kind?, mode, happened?, should?, text?, paint?, pitch?, client?, engine?, ... } }.
// `paint`, where the player painted on the picture of the pitch, is held to its shape
// and limits (src/net/paint.js); `selectedPieces` from older clients passes as it is.
// `bytes` is the request body's size. Returns the report to keep, with its `kind` set.
export function checkReport(msg, bytes, limits = LIMITS) {
  if (bytes > limits.reportBytes)
    fail("too-big", `A report is limited to ${limits.reportBytes} bytes.`);
  const r = msg?.r;
  if (!isObject(r)) fail("bad-message", "`r` must be the report.");
  const kind = r.kind ?? "throw";
  if (!REPORT_KINDS.includes(kind))
    fail("bad-message", "The report's `kind` is not one the game has.");
  if (!REPORT_MODES.includes(r.mode))
    fail("bad-message", "The report's `mode` is not one the game has.");
  if (kind === "throw") {
    for (const k of ["happened", "should"]) {
      if (typeof r[k] !== "string")
        fail("bad-message", `\`${k}\` must be text.`);
      if ([...r[k]].length > limits.reportChars)
        fail(
          "too-big",
          `Each answer is limited to ${limits.reportChars} characters.`,
        );
    }
    if (!r.happened.trim() && !r.should.trim())
      fail("bad-message", "Say what happened, or what should have happened.");
  } else {
    if (typeof r.text !== "string") fail("bad-message", "`text` must be text.");
    const text = r.text.trim();
    if (!text) fail("bad-message", "Say what you would like to tell us.");
    if ([...text].length > limits.feedbackChars)
      fail(
        "too-big",
        `Feedback is limited to ${limits.feedbackChars} characters.`,
      );
    if (r.happened !== undefined || r.should !== undefined)
      fail("bad-message", "Feedback carries `text`, not a throw's answers.");
  }
  for (const k of ["pitch", "room"])
    if (r[k] !== undefined && r[k] !== null)
      if (typeof r[k] !== "string" || !PITCH_CODE.test(r[k]))
        fail("bad-pitch", "That is not a pitch code.");
  if (r.paint !== undefined && r.paint !== null) {
    const why = paintProblem(r.paint, limits.paint ?? PAINT_LIMITS);
    if (why) fail("bad-message", why);
  }
  checkTags(r);
  return { ...r, kind };
}

// A recorded one-device match: { g: { mode, start, actions, hashes?, file?, client?, engine?, ... } }.
export function checkGame(msg, bytes, limits = LIMITS) {
  if (bytes > limits.gameBytes)
    fail(
      "too-big",
      `A recorded match is limited to ${limits.gameBytes} bytes.`,
    );
  const g = msg?.g;
  if (!isObject(g)) fail("bad-message", "`g` must be the match.");
  if (!GAME_MODES.includes(g.mode))
    fail(
      "bad-message",
      "The match's `mode` is not one that is recorded this way.",
    );
  if (typeof g.start !== "string" || !g.start)
    fail("bad-message", "`start` must be the match's first snapshot.");
  if (!Array.isArray(g.actions) || !g.actions.every(isObject))
    fail("bad-message", "`actions` must be a list of actions.");
  if (g.actions.length > limits.gameActions)
    fail(
      "too-big",
      `A recorded match is limited to ${limits.gameActions} actions.`,
    );
  if (g.hashes !== undefined && g.hashes !== null) {
    if (
      !Array.isArray(g.hashes) ||
      g.hashes.length !== g.actions.length ||
      !g.hashes.every((x) => typeof x === "number" || typeof x === "string")
    )
      fail("bad-message", "`hashes` must be one hash an action.");
  }
  if (g.file !== undefined && g.file !== null && typeof g.file !== "string")
    fail("bad-message", "`file` must be text.");
  checkTags(g);
  return g;
}

// A share: { g: { client?, engine, start, log, end } }. Returns { g } to check (`client`
// checked and dropped), or { why: "too-long" }. The function knows no Kubb: what the
// match is, the renderer checks.
export function checkShare(msg, bytes, limits = LIMITS) {
  const g = msg?.g;
  if (!isObject(g)) fail("bad-message", "`g` must be the match.");
  checkTags(g);
  if (typeof g.engine !== "string")
    fail("bad-message", "`engine` must name the engine that played it.");
  if (typeof g.start !== "string" || !g.start)
    fail("bad-message", "`start` must be the match's first snapshot.");
  if (
    !Array.isArray(g.log) ||
    !g.log.every((e) => isObject(e) && isObject(e.a))
  )
    fail("bad-message", "`log` must be a list of { a: <action> }.");
  const end = g.end;
  if (
    !isObject(end) ||
    (end.winner !== "A" && end.winner !== "B") ||
    !Number.isSafeInteger(end.throws) ||
    end.throws < 0
  )
    fail("bad-message", "`end` must be { winner, throws }.");
  if (
    bytes > limits.shareBytes ||
    g.log.length > limits.shareActions ||
    g.start.length > limits.shareStartBytes
  )
    return { why: "too-long" };
  return {
    g: {
      engine: g.engine,
      start: g.start,
      log: g.log,
      end: { winner: end.winner, throws: end.throws },
    },
  };
}

// What a share is known by, so the same match shared again gets the same link: the
// SHA-256 of its first snapshot and its log, as sent.
export const shareHash = (g) =>
  createHash("sha256")
    .update(asciiJson([g.start, g.log]))
    .digest("hex");

// A fresh pitch code for a shared match: 10 of the code alphabet, as the client makes.
const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export function newPitchCode(random = Math.random) {
  let code = "";
  for (let i = 0; i < 10; i++)
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

// The CORS filter. `allowed` is a list of origins; an entry without a port matches any
// port ("http://localhost" allows http://localhost:5173).
export function originAllowed(origin, allowed) {
  let o;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  return allowed.some((entry) => {
    let a;
    try {
      a = new URL(entry);
    } catch {
      return false;
    }
    return (
      a.protocol === o.protocol &&
      a.hostname === o.hostname &&
      (a.port === "" || a.port === o.port)
    );
  });
}

export function parseOrigins(text) {
  return String(text ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
