// Sharing a match against the computer (docs/REEL.md "Sharing a match against the
// computer", backend/api/API.md "share", docs/CLIENT.md "Sharing a match"): the part with
// no DOM. The name the share card allows, the `share` message made with the engine's own
// calls, what can be known before sending, and the card's states as a pure reducer, so
// tests/net/share-client.test.mjs can walk every answer. The card is src/ui/share.js.
//
//   const made = shareMessage({ engine, trail, need, name });  // { message } or { why }
//   let s = shareStart();
//   s = shareStep(s, { type: "send" });              // SHARE AND MAKE THE REEL
//   s = shareStep(s, { type: "answer", answer });    // what { t: "shared" } said
//   s = shareStep(s, { type: "error", code });       // what went wrong asking
//   s = shareStep(s, { type: "refuse", why });       // known here, nothing sent
//   s = shareStep(s, { type: "open" });              // the card opened again
//   shareView(s)  // { phase, line, text, bar, retry, form, code }
//
// What goes: the match's first snapshot and every action since, as the engine renames
// them (`renameStart`: side A takes the name picked on the card, a generated name from
// the engine's word lists, as every name is), the winner and the number of throws, the engine's
// version and `client: "web"` (checked by the server, then dropped: never stored, as
// the iPhone's "ios" is not). No hashes, no member id, no clock of this browser's. The
// match's own start, with the day and time it began, is part of the first snapshot.
import { apiCall, asciiJson } from "./api.js";
import { CLIENT } from "./sync.js";
import { LOG_BUDGET } from "./lobby.js";

// As backend/api/checks.mjs LIMITS and backend/reels/check.mjs (the share test checks).
export const SHARE_LIMITS = Object.freeze({
  bytes: 256 * 1024, // the whole message, as ASCII JSON
  actions: 1000,
  startBytes: 16 * 1024,
  waitMs: 45000, // the server plays the match before answering: up to 20 s, and 30 s after the last part
});

export const SHARE_URL = "https://throwingwood.com/p/";

// The share card's words, the same on the web and the iPhone (docs/REEL.md "The words",
// "The share card", is the contract).
export const SHARE_WORDS = Object.freeze({
  title: "Share this match",
  about:
    "To make a reel, this match goes to throwingwood.com and gets its own link. Anyone with the link can watch the replay and the reel, for a year.",
  label: "Name on the reel",
  sides:
    "Your side is shown by this name. The other side is Computer. Nothing else about you is sent.",
  when: "The score sheet shows the day and time the match was played.",
  share: "SHARE AND MAKE THE REEL",
  notNow: "NOT NOW",
  checking: "CHECKING THE MATCH",
  checkingText: "This takes a few seconds.",
  link: "The link:",
  failed: "This match could not be shared.",
  notThisTime: "This match could not be shared. Not this time.",
  offline: "No connection.",
  name: {
    pick: "Pick a name for your side.",
  },
  why: {
    name: "Pick a name for your side.",
    engine:
      "This match was played on another version of the game, so it cannot be shared.",
    "does-not-replay":
      "This match did not pass the check, so it cannot be shared.",
    busy: "Sharing is busy right now. Try again later.",
    "too-long": "This match is too long to share.",
    unavailable: "Matches cannot be shared right now.",
    "too-many": "Too many matches shared at once. Try again later.",
  },
});

// Refusals this page cannot change: the card says them again when opened again. The
// rest (busy, unavailable, too-many) let the card start over next time it is opened.
const FINAL = new Set(["engine", "does-not-replay", "too-long"]);

// The name as the share card takes it: null when it may go on the reel, else the
// reason (a key of SHARE_WORDS.name). As the server's check (backend/reels/check.mjs
// sidesOf): a generated player name, or one of the engine's defaults (names.valid's
// `ok` or `default`). The card offers only the name row, so an honest page never sends
// another. names: the engine's door (src/game/names.js).
export function nameProblem(names, name) {
  return typeof name === "string" && names.passes("player", name)
    ? null
    : "pick";
}

// What the name row starts with: the name the match was played under when it is a
// generated name (the device's, since names are generated), else `fallback` (the
// device's name now).
export function nameFromMatch(names, start, fallback) {
  try {
    const n = JSON.parse(start)?.opts?.teams?.A?.name;
    return typeof n === "string" && names.valid("player", n).ok ? n : fallback;
  } catch {
    return fallback;
  }
}

// Is this a match that may be shared: a finished match of the person (side A) against
// the computer (side B), with its whole trail?
export function shareable({ trail, need }) {
  if (trail?.kind !== "match" || need?.kind !== "over") return false;
  if (typeof trail.start !== "string" || !Array.isArray(trail.actions))
    return false;
  try {
    const cpu = JSON.parse(trail.start)?.opts?.cpu;
    return (
      (cpu === "B" ||
        (Array.isArray(cpu) && cpu.length === 1 && cpu[0] === "B")) &&
      trail.actions.length > 0
    );
  } catch {
    return false;
  }
}

// The `share` message for a finished match, renamed by the engine, or { why: "too-long" }
// when it is plainly past what the server keeps (known here, nothing sent). The engine
// drops a finished document's log past its LOG_BUDGET, and such a match has no replay:
// the log as the document would hold it (each action with the hash after it) and the
// last snapshot are both in that document, so when they alone pass the budget the match
// is too long. Short of that the server decides (13.4).
export function shareMessage({ engine, trail, need, name, id = 1 }) {
  const out = engine.call("renameStart", {
    start: trail.start,
    names: { A: name },
    log: trail.actions.map((a) => ({ a })),
  });
  const log = Array.isArray(out.log) ? out.log : [];
  const g = {
    client: CLIENT,
    engine: engine.version ?? null,
    start: out.start,
    log,
    end: {
      winner: need.winner?.winner ?? null,
      throws: log.filter((e) => e?.a?.type === "throw").length,
    },
  };
  const message = { t: "share", id, g };
  const bytes = asciiJson(message).length;
  if (
    bytes > SHARE_LIMITS.bytes ||
    log.length > SHARE_LIMITS.actions ||
    out.start.length > SHARE_LIMITS.startBytes
  )
    return { why: "too-long", bytes };
  const hashes = Array.isArray(trail.hashes) ? trail.hashes : [];
  const kept =
    asciiJson(log.map((e, i) => ({ a: e.a, h: hashes[i] ?? "" }))).length +
    asciiJson(trail.now ?? "").length;
  // a margin for the name's length in the last snapshot, which is the one picked
  if (Number.isFinite(LOG_BUDGET) && kept - 4096 > LOG_BUDGET)
    return { why: "too-long", bytes };
  return { message, bytes };
}

// POST /api/share with the message's `g` (src/net/api.js). Resolves { code, v, why? };
// rejects an ApiError (too-many, failed, bad-message, too-big; timeout, closed,
// unavailable). A share is idempotent on the server (the same start and log are
// answered the same code, free), so sending it again after a lost answer is safe and
// gives one link.
export function askShare({ url, message, fetch }) {
  return apiCall({
    base: url,
    call: "share",
    body: { g: message.g },
    timeoutMs: SHARE_LIMITS.waitMs,
    ...(fetch ? { fetch } : {}),
  });
}

// ---------- the card's states ----------
//
// idle      the name card (SHARE AND MAKE THE REEL, NOT NOW)
// sending   CHECKING THE MATCH, the slow bar
// shared    a code: the reel card takes over (src/ui/share.js)
// refused   a why, no TRY AGAIN; final ones stay, the others start over when opened
// error     no connection (TRY AGAIN as often as pressed) or the server could not keep
//           it (TRY AGAIN once)
// failed    the second such failure: "Not this time"

export function shareStart() {
  return {
    phase: "idle",
    code: null,
    v: null,
    why: null,
    retried: 0,
  };
}

export function shareStep(s, e) {
  switch (e.type) {
    case "open":
      // the card opened again: a refusal that may pass later starts over
      if (s.phase === "refused" && !FINAL.has(s.why))
        return { ...s, phase: "idle", why: null };
      return s;
    case "send":
      if (s.phase === "idle") return { ...s, phase: "sending", why: null };
      if (s.phase === "error") {
        if (s.why === "failed" && s.retried >= 1)
          return { ...s, phase: "failed", why: "failed" };
        return {
          ...s,
          phase: "sending",
          retried: s.why === "failed" ? s.retried + 1 : s.retried,
          why: null,
        };
      }
      return s;
    case "refuse":
      if (s.phase !== "idle" && s.phase !== "sending") return s;
      return { ...s, phase: "refused", why: known(e.why) };
    case "answer": {
      if (s.phase !== "sending") return s;
      const a = e.answer ?? {};
      if (typeof a.code === "string" && a.code)
        return {
          ...s,
          phase: "shared",
          code: a.code,
          v: Number.isInteger(a.v) ? a.v : null,
          why: null,
        };
      return { ...s, phase: "refused", why: known(a.why) };
    }
    case "error": {
      if (s.phase !== "sending") return s;
      const code = e.code ?? "error";
      if (code === "too-many")
        return { ...s, phase: "refused", why: "too-many" };
      if (code === "too-big")
        return { ...s, phase: "refused", why: "too-long" };
      if (code === "bad-message")
        return { ...s, phase: "refused", why: "does-not-replay" };
      if (code === "timeout" || code === "closed" || code === "unavailable")
        return { ...s, phase: "error", why: "offline" };
      return s.retried >= 1
        ? { ...s, phase: "failed", why: "failed" }
        : { ...s, phase: "error", why: "failed" };
    }
    default:
      return s;
  }
}

const known = (why) =>
  typeof why === "string" && why in SHARE_WORDS.why ? why : "unavailable";

// What the card shows for a state.
export function shareView(s) {
  const W = SHARE_WORDS;
  const view = {
    phase: s.phase,
    line: "",
    text: "",
    bar: false,
    retry: false,
    form: false,
    code: s.code,
  };
  if (s.phase === "idle") return { ...view, form: true };
  if (s.phase === "sending")
    return { ...view, line: W.checking, text: W.checkingText, bar: true };
  if (s.phase === "refused") return { ...view, text: W.why[s.why] };
  if (s.phase === "failed") return { ...view, text: W.notThisTime };
  if (s.phase === "error")
    return {
      ...view,
      text: s.why === "offline" ? W.offline : W.failed,
      retry: true,
    };
  return view;
}
