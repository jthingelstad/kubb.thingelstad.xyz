// Reports (MENU, REPORT A THROW; docs/ROOMS.md section 8): what the player typed and the
// game as it stood when they opened the card, sent once to the room server on a socket of
// its own, which keeps it privately so the throw can be played again offline.
//
//   const state = captureReport({ game, mode, config, pitch });   // when the card opens
//   const msg = reportMessage(state, { happened, should });        // on SEND
//   await sendReport({ url: config.roomsUrl, message: msg });      // resolves on the ack
//
// What is sent (`r` in the message): the mode; the two answers; the build (package
// version, commit, the hashed Lua bundle's name, the vendored core's commit); the viewport
// size; the browser's clock; the turn and phase; the last throw's action and result; the
// pieces where they stand (the thrower's view frame). For a match: its options (read from
// the snapshot), the snapshot at its start or at the last adopt and every action applied
// here since (start + actions replay it), and the snapshot before the last action with the
// one after (before + last replays the reported moment). For practice: its options and
// every throw and pitch change since it was set out (they replay it from newPractice). On
// a shared pitch also the room code and the document version `v`, which join the report to
// the recorded game. No name field, no user agent, no member id: names are only what the
// match options and snapshots already carry.
//
// The whole message is held to LIMITS.reportBytes as ASCII JSON. When it would not fit,
// the parts that only help are dropped in this order (and listed in `r.dropped`): the
// match's start and actions (or practice's ops), the pieces, the snapshot after. The typed
// answers, the snapshot before and the last action are never cut.
import { asciiJson, toFrames } from "./room.js";

// Kept in step with backend/rooms/core.mjs LIMITS (tests/net/report.test.mjs checks).
export const REPORT_LIMITS = Object.freeze({
  bytes: 64 * 1024,
  chars: 1000,
});

export const REPORT_MODES = ["practice", "solo", "watch", "pitch"];

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
    view = engine.view();
  } catch {
    view = null;
  }
  try {
    const r = engine.recording();
    if (r && r.result) rec = r;
  } catch {
    rec = null;
  }
  const r = {
    mode,
    at: now(),
    build: {
      version: config.version ?? null,
      commit: config.commit ?? null,
      lua: config.luaUrl ? String(config.luaUrl).split("/").pop() : null,
      core: config.core ?? null,
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
  return r;
}

// The message for the server: the captured state with the answers, cut to fit.
export function reportMessage(
  state,
  { happened = "", should = "" },
  { id = 1, limits = REPORT_LIMITS } = {},
) {
  const clip = (s) => [...String(s ?? "")].slice(0, limits.chars).join("");
  const r = structuredClone(state);
  r.happened = clip(happened);
  r.should = clip(should);
  const msg = { t: "report", id, r };
  const size = () => asciiJson(msg).length;
  const drops = [
    [
      "history",
      () => {
        if (r.snapshots) r.snapshots.start = null;
        if (r.actions) r.actions = null;
        if (r.practice) r.practice.ops = null;
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

export function reportReady({ happened = "", should = "" }) {
  return Boolean(String(happened).trim() || String(should).trim());
}

export class ReportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Open a socket, send the report (in parts when it is longer than a frame), wait for the
// server's `reported` (or an error, or the timeout), close. Resolves true.
export function sendReport({
  url,
  message,
  WebSocket = globalThis.WebSocket,
  timeoutMs = 15000,
  frame = 30000,
}) {
  return new Promise((resolve, reject) => {
    if (!url || !WebSocket) {
      reject(new ReportError("unavailable", "Reports cannot be sent here."));
      return;
    }
    let ws;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        // already closed
      }
      if (error) reject(error);
      else resolve(true);
    };
    const timer = setTimeout(
      () => finish(new ReportError("timeout", "No answer from the server.")),
      timeoutMs,
    );
    try {
      ws = new WebSocket(url);
    } catch {
      finish(new ReportError("closed", "Could not reach the server."));
      return;
    }
    ws.onopen = () => {
      for (const f of toFrames(asciiJson(message), frame)) ws.send(f);
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(typeof e.data === "string" ? e.data : "");
      } catch {
        return;
      }
      if (m.t === "reported" && m.id === message.id) finish();
      else if (m.t === "error" && m.re === "report")
        finish(new ReportError(m.code || "error", m.message || "Refused."));
    };
    ws.onerror = () =>
      finish(new ReportError("closed", "Could not reach the server."));
    ws.onclose = () =>
      finish(new ReportError("closed", "The connection closed."));
  });
}
