// What a pitch pushes to AWS, taken apart: the signature over the raw bytes, the
// envelope, and the pure rules that fold pushes into a pitch's state whatever order they
// arrive in. Pure: no AWS. The sender is backend/pitch-server (its PROTOCOL.md "On the
// wire to AWS"); the contract is backend/api/API.md "Pushes".
//
//   POST /push
//   x-pitch-signature: sha256=<hex HMAC-SHA256 of the raw body, keyed by the shared secret>
//   idempotency-key: <pitch>:<made>:<k>
//   { "v": 1, pitch, made, k, topic, sent, body }
//
// `made` is when the pitch object was made (epoch ms): a code wiped and used again starts
// its keys over, so (pitch, made, k) names one push for good. Pushes are retried until
// answered 2xx and are not ordered across keys.

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  ApiError,
  LIMITS,
  PITCH_CODE,
  asciiJson,
  isObject,
} from "./checks.mjs";

export const SIGNATURE = /^sha256=([0-9a-f]{64})$/;

// The signature check: HMAC-SHA256 of the exact bytes received, compared in constant time.
// `raw` is a Buffer; `header` the x-pitch-signature value. Never parses the body.
export function signatureValid(raw, header, secret) {
  if (typeof secret !== "string" || !secret) return false;
  const m = SIGNATURE.exec(typeof header === "string" ? header.trim() : "");
  if (!m) return false;
  const want = createHmac("sha256", secret).update(raw).digest();
  const got = Buffer.from(m[1], "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

// The header a sender puts on `raw` (tests and tools; the pitch server has its own).
export const sign = (raw, secret) =>
  `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;

const bad = (message) => {
  throw new ApiError("bad-message", message);
};
const int = (x, lo = 0) => Number.isSafeInteger(x) && x >= lo;
const utf8 = (s) => Buffer.byteLength(s, "utf8");
const isHash = (h) =>
  (typeof h === "string" && h.length > 0 && h.length <= 128) ||
  (typeof h === "number" && Number.isFinite(h));

// The envelope, checked against its own key and the idempotency-key header. Returns
// { pitch, made, k, topic, dev, sent, body } with `body` checked for its topic. Throws a
// bad-message ApiError: a signed push this function cannot read is a bug in one of the
// two, and the pitch keeps retrying it until a fixed receiver takes it.
export function readPush(text, idempotencyKey, limits = LIMITS) {
  let env;
  try {
    env = JSON.parse(text);
  } catch {
    bad("A push is JSON.");
  }
  if (!isObject(env) || env.v !== 1) bad("A push is { v: 1, ... }.");
  const { pitch, made, k, topic, body } = env;
  // when the pitch sent this attempt: only for the log's delay figures
  const sent = int(env.sent, 1) ? env.sent : null;
  // the dev Worker marks everything it pushes (`dev: true`): kept apart, never as play
  // (API.md "Dev pushes"); a production push has no such field
  if (env.dev !== undefined && env.dev !== true)
    bad("`dev` is true or absent.");
  const dev = env.dev === true;
  if (typeof pitch !== "string" || !PITCH_CODE.test(pitch))
    bad("`pitch` is not a pitch code.");
  if (!int(made, 1)) bad("`made` must be the pitch's epoch ms.");
  if (typeof k !== "string" || k.length > 64) bad("`k` must be the push key.");
  if (idempotencyKey !== `${pitch}:${made}:${k}`)
    bad("The idempotency-key header must be <pitch>:<made>:<k>.");
  if (!isObject(body) || body.pitch !== pitch)
    bad("`body` must be the push for this pitch.");
  // the pitch was made: its host's name, for the link's preview before any match
  if (topic === "open") {
    if (k !== "open") bad("An open's key is open.");
    const host = body.host ?? null;
    if (host !== null && (typeof host !== "string" || host.length > 40))
      bad("`body.host` must be a name or null.");
    return { pitch, made, k, topic, dev, sent, body: { pitch, host } };
  }
  if (!int(body.n, 1)) bad("`body.n` must be the match number.");
  if (topic === "start") {
    if (k !== `start:${body.n}`) bad("A start's key is start:<n>.");
    checkSnap(body.snap, limits);
    if (!isObject(body.meta ?? {})) bad("`meta` must be an object.");
    if (utf8(JSON.stringify(body.meta ?? {})) > limits.metaBytes)
      bad("`meta` is too big.");
    return {
      pitch,
      made,
      k,
      topic,
      dev,
      sent,
      body: { ...body, meta: body.meta ?? {} },
    };
  }
  if (topic === "act") {
    if (!int(body.seq, 1)) bad("`body.seq` must be the action's sequence.");
    if (k !== `act:${body.n}:${body.seq}`)
      bad("An act's key is act:<n>:<seq>.");
    if (!isObject(body.a)) bad("`body.a` must be the action.");
    if (!isHash(body.h)) bad("`body.h` must be the hash after the action.");
    checkSnap(body.snap, limits);
    return { pitch, made, k, topic, dev, sent, body };
  }
  if (topic === "keep") {
    if (k !== `keep:${body.n}`) bad("A keep's key is keep:<n>.");
    if (!int(body.at, 1)) bad("`body.at` must be when the match ended.");
    if (!isObject(body.meta ?? {})) bad("`meta` must be an object.");
    if (
      !Array.isArray(body.log) ||
      body.log.length > limits.logMax ||
      !body.log.every((e) => isObject(e) && isObject(e.a))
    )
      bad("`log` must be a list of { a, h, ts }.");
    return {
      pitch,
      made,
      k,
      topic,
      dev,
      sent,
      body: { ...body, meta: body.meta ?? {} },
    };
  }
  bad("`topic` must be start, act, keep or open.");
}

function checkSnap(snap, limits) {
  if (typeof snap !== "string" || !snap) bad("`snap` must be the snapshot.");
  if (utf8(snap) > limits.snapBytes) bad("`snap` is too big.");
}

// ---------- what a match's start info says, for share previews ----------

const LEVELS = ["beginner", "club", "pro"];
const teamName = (s) =>
  typeof s === "string" && s.trim() ? s.trim().slice(0, 40) : null;

// From a match's `meta` (or a replay): the team names, the side the computer
// played alone ("A" or "B") and its level. Only what a pitch's link shows (backend/pages).
export function matchInfo(meta) {
  const setup = isObject(meta?.setup) ? meta.setup : null;
  let cpu = meta?.cpu ?? null;
  if (Array.isArray(cpu)) cpu = cpu.length === 1 ? cpu[0] : null;
  if (cpu !== "A" && cpu !== "B") cpu = null;
  const level = cpu ? setup?.teams?.[cpu]?.players?.[0]?.level : null;
  const names = {
    A: teamName(setup?.teams?.A?.name),
    B: teamName(setup?.teams?.B?.name),
  };
  return {
    names: names.A || names.B ? names : null,
    cpu,
    level: LEVELS.includes(level) ? level : null,
  };
}

// ---------- a pitch's state: the latest match as far as the pushes go ----------
//
//   { made, n, seq, over, snap, hash, names, cpu, level, rev, exp, sealed? }
//
// Pushes are ordered by (made, n, seq), a start being seq 0. A later made or n starts
// the state over; within one match an act moves it on only when its seq is higher; a
// start that comes after the match's first act adds what only it knows (names, the
// computer) and moves nothing back. A sealed state (a shared match) is never replaced.
// Returns the new state without rev and exp, or null when the push changes nothing.

export function mergeState(old, push) {
  const { made, n } = push;
  const seq = push.topic === "start" ? 0 : push.seq;
  const info =
    push.topic === "start"
      ? matchInfo(push.meta)
      : { names: null, cpu: null, level: null };
  const fresh = () => ({
    made,
    n,
    seq,
    over: push.over === true,
    snap: push.snap,
    hash: push.hash ?? null,
    ...info,
  });
  if (!old) return fresh();
  if (old.sealed) return null;
  if (made < old.made) return null;
  if (made > old.made) return fresh();
  if (n < old.n) return null;
  if (n > old.n) return fresh();
  const next = { ...old };
  let changed = false;
  if (push.topic === "start") {
    for (const key of ["names", "cpu", "level"])
      if (next[key] == null && info[key] != null) {
        next[key] = info[key];
        changed = true;
      }
  } else if (seq > old.seq) {
    Object.assign(next, {
      seq,
      over: old.over || push.over === true,
      snap: push.snap,
      hash: push.hash ?? null,
    });
    changed = true;
  }
  if (!changed) return null;
  delete next.rev;
  delete next.exp;
  return next;
}

// The push's part in mergeState: { topic, made, n, seq?, over?, snap, hash?, meta? }.
export function statePush({ made, topic, body }) {
  return topic === "start"
    ? {
        topic,
        made,
        n: body.n,
        snap: body.snap,
        hash: body.h0,
        meta: body.meta,
      }
    : {
        topic,
        made,
        n: body.n,
        seq: body.seq,
        over: body.over === true,
        snap: body.snap,
        hash: body.h,
      };
}

// ---------- the kept replay ----------

// The engine's replay of a finished match from a `keep` push: the start info as the host
// sent it (`v`, `setup`, `engine`, `players`, `cpu`: the client's to fill), then the
// match number, the first hash, the log and the final hash. The final snapshot is not in
// a keep: it comes with the action that ended the match and is put beside it
// (`snap`, read back by the replay endpoint). Returns { text, hash, info } or { why }
// when it is over the limit.
export function keptReplay(body, limits = LIMITS) {
  const log = body.log.map((e) => ({
    a: e.a,
    h: e.h ?? null,
    ts: e.ts ?? null,
  }));
  const last = log.length ? log[log.length - 1].h : body.h0;
  const replay = {
    ...body.meta,
    n: body.n,
    h0: body.h0 ?? null,
    log,
    hash: last ?? null,
  };
  const text = asciiJson(replay);
  if (text.length > limits.replayBytes) return { why: "too-long" };
  return { text, hash: replay.hash, info: matchInfo(body.meta) };
}

// The replay as served: the kept text with the final snapshot set on it (last, so it
// wins over any `snap` the text has). `text` is a JSON object's text, `snap` a string.
export function withSnap(text, snap) {
  const body = text.trim().slice(1, -1).trim();
  return `{${body ? `${body},` : ""}"snap":${asciiJson(snap)}}`;
}

// The table key of a replay's half item: one a match, so a later match's pushes never drop one still being put
// together: half#<made, 13 digits>#<n, 4 digits>.
export const halfKey = ({ made, n }) =>
  `half#${String(made).padStart(13, "0")}#${String(n).padStart(4, "0")}`;

// The S3 key a recorded push is kept under, so a retried push lands on the same object:
//   games/pitch/<code>/<made, 13 digits>/<n, 4 digits>-<seq, 6 digits>.json.gz
// (a start is seq 0). "pitch" cannot be a pitch code (codes are 8 to 24 characters).
export function pushKey({ pitch, made, topic, body, dev = false }) {
  const seq = topic === "start" ? 0 : body.seq;
  return `games/${dev ? "dev/" : ""}pitch/${pitch}/${String(made).padStart(13, "0")}/${String(body.n).padStart(4, "0")}-${String(seq).padStart(6, "0")}.json.gz`;
}
