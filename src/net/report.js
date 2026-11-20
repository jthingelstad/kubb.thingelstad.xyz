// Reports (MENU, SEND FEEDBACK; docs/ROOMS.md section 8): what the player typed and the
// game as it stood when they opened the card, sent once to the room server on a socket of
// its own, which keeps it privately so a throw can be played again offline.
//
//   const state = captureReport({ game, mode, config, pitch });   // when the card opens
//   const msg = reportMessage(state, { kind: "throw", happened, should, selected });
//   const msg = reportMessage(state, { kind: "feedback", text });  // on SEND
//   await sendReport({ url: config.roomsUrl, message: msg });      // resolves on the ack
//
// Two kinds: `kind: "throw"`, a throw that looked wrong, carries the two answers
// (`happened`, `should`) and any pieces marked (`selectedPieces`); `kind: "feedback"`,
// anything else, carries one `text` (trimmed, 1 to REPORT_LIMITS.feedbackChars) and no
// answers. Both carry the same game context. The server takes a report with no `kind` as
// a throw report (older clients).
//
// What is sent (`r` in the message): the kind; the mode; `client: "web"`; `engine`, the
// kubb-engine version; what was typed; the build (package version, commit, the hashed Lua bundle's
// name); the viewport
// size; the browser's clock; the turn and phase; the last throw's action and result; the
// pieces where they stand (the thrower's view frame). For a match: its options (read from
// the snapshot), the snapshot at its start or at the last adopt and every action applied
// here since (start + actions replay it), and the snapshot before the last action with the
// one after (before + last replays the reported moment). For practice: its options and
// every throw and pitch change since it was set out (they replay it from newPractice). On
// a shared pitch also the room code and the document version `v`, which join the report to
// the recorded game. No name field, no user agent, no member id (each is swapped for
// "member1", "member2", ... everywhere, snapshots included): names are only what the
// match options and snapshots already carry.
//
// The whole message is held to LIMITS.reportBytes as ASCII JSON. When it would not fit,
// the parts that only help are dropped in this order (and listed in `r.dropped`): the
// match's start and actions (or practice's ops), the pieces, the snapshot after. The typed
// answers, the snapshot before and the last action are never cut.
import { asciiJson } from "./room.js";
import { ask } from "./ask.js";
import { CLIENT } from "./sync.js";
import { luaFor } from "../site/config.js";

// Kept in step with backend/rooms/core.mjs LIMITS (tests/net/report.test.mjs checks).
export const REPORT_LIMITS = Object.freeze({
  bytes: 64 * 1024,
  chars: 1000,
  feedbackChars: 2000,
});

export const REPORT_MODES = ["practice", "solo", "watch", "pitch"];
export const REPORT_KINDS = ["throw", "feedback"];

const r4 = (x) => (typeof x === "number" ? Math.round(x * 1e4) / 1e4 : x);

function pieces(items) {
  return (items || []).map((it) => {
    const p = { id: it.id, kind: it.kind };
    if (it.team) p.team = it.team;
    for (const k of ["x", "y", "z", "qw", "qx", "qy", "qz"]) p[k] = r4(it[k]);
    if (it.toppled !== undefined) p.toppled = !!it.toppled;
    return p;
  });
}

function needOf(n) {
  if (!n) return null;
  const out = {};
  for (const k of [
    "kind",
    "side",
    "turn",
    "throws",
    "cpu",
    "practice",
    "drill",
    "surface",
    "winner",
    "how",
    "resignPending",
  ])
    if (n[k] !== undefined && n[k] !== null) out[k] = n[k];
  if (n.last?.text) out.last = n.last.text;
  return out;
}

function lastThrowOf(actions) {
  for (let i = actions.length - 1; i >= 0; i--)
    if (actions[i]?.type === "throw") return actions[i];
  return null;
}

// Everything but the typed answers, read from the game when the card opens.
// game: the Game (src/game/game.js); mode: one of REPORT_MODES; config: the page's
// kubb-config; pitch: the shared pitch's controller, if any; win: for the viewport.
export function captureReport({
  game,
  mode,
  config = {},
  pitch = null,
  win = globalThis,
  now = Date.now,
}) {
  const trail = game.trail;
  const engine = game.engine;
  let view = null;
  let rec = null;
  try {
    // the thrower's frame, also in the wide view: the replay compares in it
    view = engine.frameView ? engine.frameView() : engine.view();
  } catch {
    view = null;
  }
  try {
    const r = engine.call("reportThrow");
    if (r && r.result) rec = r;
  } catch {
    rec = null;
  }
  const r = {
    mode,
    client: CLIENT,
    engine: engine.version ?? null,
    at: now(),
    build: {
      version: config.version ?? null,
      commit: config.commit ?? null,
      lua: luaFor(config, engine.version),
    },
    viewport: {
      w: Math.round(win.innerWidth ?? 0),
      h: Math.round(win.innerHeight ?? 0),
      dpr: r4(win.devicePixelRatio ?? 1),
    },
    phase: game.phase,
    need: needOf(game.need),
    level: game.level ?? null,
  };
  if (pitch?.room) {
    r.room = pitch.room.code ?? null;
    r.v = pitch.room.v ?? null;
    const m = pitch.room.doc?.match;
    if (m) r.match = { n: m.n, seq: m.seq };
  }
  const ops = trail?.kind === "practice" ? trail.ops : (trail?.actions ?? []);
  r.last = ops.length ? ops[ops.length - 1] : null;
  const lastThrow = lastThrowOf(ops);
  r.lastThrow = lastThrow
    ? {
        action: lastThrow,
        result: rec ? rec.result : null,
        seq: rec ? (rec.seq ?? null) : null,
      }
    : null;
  if (trail?.kind === "practice") {
    r.practice = { opts: trail.opts, ops: trail.ops };
    r.practiceBefore = rec?.seq === lastThrow?.seq ? rec?.practiceBefore : null;
  } else if (trail?.kind === "match") {
    let options = null;
    try {
      options = JSON.parse(trail.now).opts ?? null;
    } catch {
      options = null;
    }
    r.options = options;
    // snapshots are opaque text: they go as strings, never parsed and written back
    r.snapshots = {
      start: trail.start,
      before: trail.before,
      now: trail.now,
    };
    r.actions = trail.actions;
  }
  r.pieces = pieces(view?.items);
  // The next turn may already have collected the baton or turned the pitch.
  r.pickPieces =
    rec && rec.seq === lastThrow?.seq ? pieces(rec.items) : r.pieces;
  // A copy, never the trail's own arrays: the trail goes on growing while the card is
  // open (the computer, the other players), and the report is the game as it stood.
  return pseudonymise(structuredClone(r), memberIds({ pitch, trail }));
}

// Room member ids are kept in each browser (src/net/room.js memberId), so they would
// name the browser; a match's players carry them as their `key`. A report swaps each
// for "member1", "member2", ... in every place it appears, the snapshot strings too,
// the same way throughout, so the report still replays.
const MEMBER_ID = /^[A-Za-z0-9_-]{8,40}$/;

function memberIds({ pitch, trail }) {
  const ids = new Set();
  const add = (id) =>
    typeof id === "string" && MEMBER_ID.test(id) && ids.add(id);
  for (const m of pitch?.room?.members ?? []) add(m?.id);
  add(pitch?.room?.me?.id);
  add(pitch?.room?.you);
  if (trail?.kind === "match")
    for (const snap of [trail.start, trail.before, trail.now]) {
      let o = null;
      try {
        o = snap ? JSON.parse(snap).opts : null;
      } catch {
        o = null;
      }
      for (const t of Object.values(o?.teams ?? {}))
        for (const p of t?.players ?? []) add(p?.key);
    }
  return [...ids];
}

export function pseudonymise(r, ids) {
  if (!ids.length) return r;
  let text = JSON.stringify(r);
  ids
    .sort((a, b) => b.length - a.length)
    .forEach((id, i) => {
      text = text.split(id).join(`member${i + 1}`);
    });
  return JSON.parse(text);
}

// The message for the server: the captured state with what was typed, cut to fit.
export function reportMessage(
  state,
  { kind = "throw", happened = "", should = "", selected = [], text = "" },
  { id = 1, limits = REPORT_LIMITS } = {},
) {
  const clip = (s, n = limits.chars) =>
    [...String(s ?? "")].slice(0, n).join("");
  const r = structuredClone(state);
  const marked = (r.pickPieces ?? []).filter((p) => selected.includes(p.id));
  delete r.pickPieces;
  const practiceBefore = r.practiceBefore;
  delete r.practiceBefore;
  if (kind === "feedback") {
    r.kind = "feedback";
    r.text = clip(String(text ?? "").trim(), limits.feedbackChars);
  } else {
    r.kind = "throw";
    if (marked.length) r.selectedPieces = marked;
    r.happened = clip(happened);
    r.should = clip(should);
  }
  const msg = { t: "report", id, r };
  const size = () => asciiJson(msg).length;
  const drops = [
    [
      "history",
      () => {
        if (r.snapshots) r.snapshots.start = null;
        if (r.actions) r.actions = null;
        if (r.practice && practiceBefore) {
          r.practice.before = practiceBefore;
          r.practice.ops = null;
        } else if (r.practice && !r.lastThrow) {
          r.practice.opts = {
            ...r.practice.opts,
            surface: r.need?.surface ?? r.practice.opts?.surface,
            drill: r.need?.drill ?? r.practice.opts?.drill,
          };
          r.practice.ops = [];
        }
      },
    ],
    ["pieces", () => (r.pieces = null)],
    ["after", () => r.snapshots && (r.snapshots.now = null)],
  ];
  for (const [name, drop] of drops) {
    if (size() <= limits.bytes) break;
    drop();
    (r.dropped ??= []).push(name);
  }
  return msg;
}

export function reportReady({
  kind = "throw",
  happened = "",
  should = "",
  text = "",
}) {
  if (kind === "feedback") return Boolean(String(text).trim());
  return Boolean(String(happened).trim() || String(should).trim());
}

// The error a send rejects with (src/net/ask.js): `code` is the server's error code, or
// timeout, closed, unavailable.
export { AskError as ReportError } from "./ask.js";

// Open a socket, send the report (in parts when it is longer than a frame), wait for the
// server's `reported` (or an error, or the timeout), close. Resolves true.
export function sendReport(opts) {
  return ask({ ...opts, done: "reported", re: "report" });
}
