// The pitch core: everything a live pitch decides, as pure logic. The wire protocol is
// PROTOCOL.md beside this file; the design is docs/PITCH-SERVER.md.
//
// No Cloudflare APIs, no network, no timers, no storage calls. The Durable Object
// (build step 2) owns the sockets, the SQLite storage and the alarm, and drives this:
//
//   let { state, effects } = rebuildPitch({ code, stored, conns, now, options });
//   ({ state, effects } = step(state, { type: "frame", conn, text, now }));
//   ({ state, effects } = step(state, { type: "close", conn, now }));
//   ({ state, effects } = step(state, { type: "tick", now }));        // the alarm fired
//
// and carries out the effects in the order given (PROTOCOL.md "Effects"). `step`
// changes `state` in place and returns it: the state is the core's, opaque to the
// caller. What must be persisted comes out as one `persist` effect per event, so the
// object can sleep and `rebuildPitch` gives back the same pitch from it.
//
// The pitch knows no Kubb. It keeps the members, the host, one lobby document
// (compare-and-set), the match's head (sequence, hash, snapshot) and its action log,
// and relays casts. Clients run the engine and cross-check hashes.

export const PITCH_CODE = /^[2-9a-hjkmnp-z]{8,24}$/;
export const MEMBER_ID = /^[A-Za-z0-9_-]{8,40}$/;
export const ACT_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const CLIENT_TAG = /^[a-z0-9.-]{1,32}$/;
export const ROLES = Object.freeze(["player", "observer"]);
export const OPEN_STATES = Object.freeze(["waiting", "playing", "over"]);

export const LIMITS = Object.freeze({
  players: 16, // members who join as players: 12 seats (6 v 6) and 4 more in the lobby
  observers: 20, // members who join as observers (OPTION: the owner's call, 20 or 100)
  messageBytes: 128 * 1024, // one incoming message, UTF-8
  docBytes: 64 * 1024, // the lobby document, as JSON
  metaBytes: 16 * 1024, // a match's opaque start info (`meta`), as JSON
  snapBytes: 64 * 1024, // one snapshot (opaque text)
  actionBytes: 4 * 1024, // one action (`a`), as JSON
  hashChars: 128, // a hash given as text
  meBytes: 512, // a member's own fields, as JSON
  castBytes: 2 * 1024, // a whole `cast` message
  msgRate: 30, // messages a second for one connection ...
  msgBurst: 60, // ... after a burst of this many
  castRate: 16, // casts a second for one connection (aim at up to 15 Hz) ...
  castBurst: 24, // ... after a burst of this many
  observerCastMs: 100, // observers: one cast per sender per this, on average ...
  observerCastGapMs: 50, // ... and never two from one sender closer than this
  resumeMax: 64, // a resume further behind than this many actions gets the state
  actsMax: 10_000, // actions one match may log (a safety net, far above a real match)
  seatsMax: 12, // the most seats an open game may say it has
  hostGraceMs: 15_000, // how long the host may be away before the host passes on
  listRefreshMs: 5 * 60 * 1000, // an open game's listing is pushed again this often
  idleMs: 48 * 3600 * 1000, // a pitch nobody is on is wiped this long after its last change
});

// The owner's open calls (docs/PITCH-SERVER.md section 11), each a named option with
// the spec's recommended default where it gives one.
export const OPTIONS = Object.freeze({
  // "relay-first": relay an action (and a lobby write) and then persist it, 25 ms
  // median against 42 to 51 for "write-first" (section 6). Recommended, to confirm.
  commitOrder: "relay-first",
  // "open": joining a code nobody has used opens an empty pitch (today's behaviour).
  // "refuse": such a join is answered `no-pitch` unless it says `create: true`.
  unknownPitch: "open",
});

export class PitchError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

export function resolveOptions(options = {}) {
  const limits = Object.freeze({ ...LIMITS, ...(options.limits ?? {}) });
  const commitOrder = options.commitOrder ?? OPTIONS.commitOrder;
  const unknownPitch = options.unknownPitch ?? OPTIONS.unknownPitch;
  if (!["relay-first", "write-first"].includes(commitOrder))
    throw new TypeError(`commitOrder: ${commitOrder}`);
  if (!["open", "refuse"].includes(unknownPitch))
    throw new TypeError(`unknownPitch: ${unknownPitch}`);
  return Object.freeze({ limits, commitOrder, unknownPitch });
}

// The size of text as UTF-8, without TextEncoder's copy.
export function utf8Length(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

const jsonBytes = (v) => utf8Length(JSON.stringify(v));
const isObject = (x) =>
  x !== null && typeof x === "object" && !Array.isArray(x);
const isHash = (h, limits) =>
  (typeof h === "string" && h.length >= 1 && h.length <= limits.hashChars) ||
  (typeof h === "number" && Number.isFinite(h));
const optId = (id) =>
  id === undefined ||
  id === null ||
  (typeof id === "string" && ACT_ID.test(id)) ||
  Number.isSafeInteger(id);

// ---------- state ----------

// A pitch nobody has joined. `fresh` until its first member: nothing is persisted yet.
export function createPitch({ code, now, options } = {}) {
  if (typeof code !== "string" || !PITCH_CODE.test(code))
    throw new TypeError("not a pitch code");
  return blank(code, now, resolveOptions(options));
}

function blank(code, now, opts) {
  return {
    code,
    opts,
    fresh: true,
    made: null,
    touched: now ?? 0,
    s: 0,
    host: null,
    hostAway: null,
    members: new Map(), // id -> { joined, since, role, me, conn }
    conns: new Map(), // conn -> { member, msg, cast, msgWarned, castWarned }
    doc: { v: 0, by: null, sid: null, value: null },
    match: null, // { n, meta, h0, at, seq, h, snap, over, acts, ids }
    open: null, // { made, seats, state }
    listing: { entry: null, at: null },
    alarmAt: null,
    thin: new Map(), // sender member -> the time its next cast may reach observers
  };
}

const bucket = (burst, now) => ({ tokens: burst, t: now });

function take(b, rate, burst, now) {
  b.tokens = Math.min(burst, b.tokens + (Math.max(0, now - b.t) / 1000) * rate);
  b.t = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function connState(st, conn, now) {
  let c = st.conns.get(conn);
  if (!c) {
    const L = st.opts.limits;
    c = {
      member: null,
      msg: bucket(L.msgBurst, now),
      cast: bucket(L.castBurst, now),
      msgWarned: false,
      castWarned: false,
    };
    st.conns.set(conn, c);
  }
  return c;
}

// The observer feed's thinning, decided on arrival (no timers, so the object can
// sleep). A cast reaches observers when it arrives at or after its sender's due time;
// each one let through moves the due time on by observerCastMs from the last due time,
// but never to less than observerCastGapMs after now. So a steady stream is thinned to
// 1000 / observerCastMs a second on average (15 Hz in, 10 Hz out), never two closer
// than the gap, and at most T / observerCastMs + 2 in any span T. Dropped, not delayed.
export function thinAllow(thin, sender, now, limits = LIMITS) {
  const due = thin.get(sender) ?? -Infinity;
  if (now < due) return false;
  thin.set(
    sender,
    Math.max(due + limits.observerCastMs, now + limits.observerCastGapMs),
  );
  return true;
}

// ---------- the event loop ----------

function context(st, now) {
  return {
    st,
    now,
    out: [], // send, close, attach: in order
    dirty: {
      pitch: false,
      doc: false,
      members: false,
      match: false,
      head: false,
    },
    acts: [],
    clearActs: false,
    pushes: [],
    listing: null,
    wipe: false,
  };
}

function send(cx, to, frame) {
  const list = Array.isArray(to) ? to : [to];
  if (list.length) cx.out.push({ kind: "send", to: list, frame });
}

function stamp(cx) {
  cx.st.s += 1;
  cx.dirty.pitch = true;
  return { s: cx.st.s, ts: cx.now };
}

// Connections of joined members, in join order: all, or one role, less one.
function joinedConns(st, { role = null, except = null } = {}) {
  const out = [];
  for (const m of st.members.values())
    if (m.conn && m.conn !== except && (!role || m.role === role))
      out.push(m.conn);
  return out;
}

export function step(st, event) {
  const now = event.now;
  if (!Number.isFinite(now)) throw new TypeError("event.now must be a time");
  const cx = context(st, now);
  if (event.type === "frame") onFrame(cx, event.conn, event.text);
  else if (event.type === "close") onClose(cx, event.conn);
  else if (event.type === "tick") {
    // nothing but what settle does
  } else throw new TypeError(`unknown event ${event.type}`);
  settle(cx);
  return { state: st, effects: finish(cx) };
}

function onFrame(cx, conn, text) {
  const { st, now } = cx;
  const L = st.opts.limits;
  const c = connState(st, conn, now);
  if (!take(c.msg, L.msgRate, L.msgBurst, now)) {
    if (!c.msgWarned) {
      c.msgWarned = true;
      send(cx, conn, err("rate", "Too many messages. Slow down."));
    }
    return;
  }
  c.msgWarned = false;
  let msg = null;
  try {
    if (typeof text !== "string")
      throw new PitchError("bad-message", "Messages are text.");
    const bytes = utf8Length(text);
    if (bytes > L.messageBytes)
      throw new PitchError(
        "too-big",
        `A message is limited to ${L.messageBytes} bytes.`,
      );
    try {
      msg = JSON.parse(text);
    } catch {
      throw new PitchError("bad-message", "Messages are JSON.");
    }
    if (!isObject(msg) || typeof msg.t !== "string")
      throw new PitchError("bad-message", "Messages are { t, ... }.");
    dispatch(cx, conn, c, msg, bytes);
  } catch (error) {
    if (!(error instanceof PitchError)) throw error;
    const extra = { ...error.extra };
    if (msg && typeof msg.t === "string") extra.re = msg.t.slice(0, 20);
    if (msg && optId(msg.id) && msg.id !== undefined) extra.id = msg.id;
    send(cx, conn, err(error.code, error.message, extra));
  }
}

const err = (code, message, extra = {}) => ({
  t: "error",
  code,
  message,
  ...extra,
});

function dispatch(cx, conn, c, msg, bytes) {
  if (msg.t === "ping") return send(cx, conn, { t: "pong", ts: cx.now });
  if (msg.t === "join") return onJoin(cx, conn, c, msg);
  const m = c.member ? cx.st.members.get(c.member) : null;
  if (!m || m.conn !== conn)
    throw new PitchError("not-joined", "Join the pitch first.");
  const who = { id: c.member, m };
  switch (msg.t) {
    case "me":
      return onMe(cx, who, msg);
    case "set":
      return onSet(cx, conn, who, msg);
    case "start":
      return onStart(cx, conn, who, msg);
    case "act":
      return onAct(cx, conn, who, msg);
    case "cast":
      return onCast(cx, conn, c, who, msg, bytes);
    case "open":
      return onOpen(cx, who, msg);
    case "resync":
      return send(cx, conn, stateFrame(cx.st, cx.now));
    case "leave":
      return onLeave(cx, conn, c, who);
    default:
      throw new PitchError(
        "bad-message",
        `Unknown message "${msg.t.slice(0, 20)}".`,
      );
  }
}

// ---------- views ----------

const memberView = (id, m) => ({
  id,
  role: m.role,
  connected: Boolean(m.conn),
  joined: m.joined,
  since: m.since,
  me: m.me,
});

const membersView = (st) =>
  [...st.members.entries()]
    .map(([id, m]) => memberView(id, m))
    .sort((a, b) => a.joined - b.joined);

function publicLimits(L) {
  const keys = [
    "players",
    "observers",
    "messageBytes",
    "docBytes",
    "metaBytes",
    "snapBytes",
    "actionBytes",
    "meBytes",
    "castBytes",
    "msgRate",
    "msgBurst",
    "castRate",
    "castBurst",
    "observerCastMs",
    "resumeMax",
    "seatsMax",
    "hostGraceMs",
  ];
  return Object.fromEntries(keys.map((k) => [k, L[k]]));
}

// An action as it is relayed: never the snapshot.
const relayAct = (n, r) => {
  const f = {
    t: "act",
    m: r.m,
    s: r.s,
    ts: r.ts,
    id: r.id,
    n,
    seq: r.seq,
    a: r.a,
    h: r.h,
  };
  if (r.over) f.over = true;
  return f;
};

// The match as a joining or resuming client needs it. With the client's own `n` and
// `seq`, and that match still in play here, close enough behind: the actions it missed
// (`full: false`). Otherwise the whole state (`full: true`): the start info, the hash
// at the start and the snapshot at the head.
export function matchView(st, n, seq, forceFull = false) {
  const M = st.match;
  if (!M) return null;
  const head = { n: M.n, seq: M.seq, h: M.h, over: M.over };
  if (
    !forceFull &&
    n === M.n &&
    Number.isSafeInteger(seq) &&
    seq >= 0 &&
    seq <= M.seq &&
    M.seq - seq <= st.opts.limits.resumeMax
  )
    return {
      ...head,
      full: false,
      acts: M.acts.slice(seq).map((r) => relayAct(M.n, r)),
    };
  return {
    ...head,
    full: true,
    at: M.at,
    h0: M.h0,
    meta: M.meta,
    snap: M.snap,
  };
}

function stateFrame(st, now) {
  return {
    t: "state",
    s: st.s,
    ts: now,
    host: st.host,
    members: membersView(st),
    v: st.doc.v,
    by: st.doc.by,
    doc: st.doc.value,
    match: matchView(st, null, null, true),
  };
}

// ---------- members ----------

function mergeMe(me, fields, L) {
  if (fields === undefined) return me;
  if (!isObject(fields))
    throw new PitchError("bad-message", "`me` must be an object.");
  const next = { ...me };
  for (const [k, v] of Object.entries(fields)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  if (jsonBytes(next) > L.meBytes)
    throw new PitchError(
      "too-big",
      `A member's fields are limited to ${L.meBytes} bytes.`,
    );
  return next;
}

// The earliest-joined connected player other than the host: who the host passes to.
// Observers never host.
function nextHost(st) {
  let best = null;
  for (const [id, m] of st.members)
    if (m.conn && m.role === "player" && id !== st.host)
      if (!best || m.joined < best[1].joined) best = [id, m];
  return best ? best[0] : null;
}

// The host passes on when it is gone (left: host null) or has been away hostGraceMs,
// and someone may take it. True when the host changed.
function succeed(cx) {
  const { st, now } = cx;
  if (st.host !== null && !st.members.has(st.host)) {
    st.host = null;
    st.hostAway = null;
    cx.dirty.pitch = true;
  }
  const due =
    st.host === null ||
    (st.hostAway !== null && now - st.hostAway >= st.opts.limits.hostGraceMs);
  if (!due) return false;
  const next = nextHost(st);
  if (!next) return false;
  st.host = next;
  st.hostAway = null;
  cx.dirty.pitch = true;
  return true;
}

function onJoin(cx, conn, c, msg) {
  const { st, now } = cx;
  const L = st.opts.limits;
  const role = msg.role ?? "player";
  if (!ROLES.includes(role))
    throw new PitchError("bad-message", "`role` is player or observer.");
  const id = msg.member;
  if (typeof id !== "string" || !MEMBER_ID.test(id))
    throw new PitchError("bad-member", "That is not a member id.");
  if (c.member && c.member !== id)
    throw new PitchError(
      "already-joined",
      "This connection is already in the pitch as another member.",
    );
  if (st.fresh) {
    if (role === "observer")
      throw new PitchError("no-pitch", "Nobody is on this pitch.");
    if (st.opts.unknownPitch === "refuse" && msg.create !== true)
      throw new PitchError("no-pitch", "There is no such pitch.");
  }
  if (msg.n !== undefined && msg.n !== null && !Number.isSafeInteger(msg.n))
    throw new PitchError("bad-message", "`n` must be a match number.");
  if (
    msg.seq !== undefined &&
    msg.seq !== null &&
    !Number.isSafeInteger(msg.seq)
  )
    throw new PitchError("bad-message", "`seq` must be a sequence.");

  let m = st.members.get(id);
  if (m && m.role !== role)
    throw new PitchError(
      "bad-role",
      `This member joined as ${m.role === "player" ? "a player" : "an observer"}. Leave first, or join with another member id.`,
    );
  const me = mergeMe(m ? m.me : {}, msg.me, L);

  const frames = [];
  if (!m) {
    const same = [...st.members.entries()].filter(([, x]) => x.role === role);
    const cap = role === "player" ? L.players : L.observers;
    if (same.length >= cap) {
      // Full: the member of this role away longest gives up their place, never the host.
      const away = same
        .filter(([mid, x]) => !x.conn && mid !== st.host)
        .sort((a, b) => a[1].since - b[1].since)[0];
      if (!away)
        throw new PitchError(
          "full",
          role === "player"
            ? `This pitch is full (${cap} players).`
            : `This pitch has all the watchers it can take (${cap}).`,
        );
      st.members.delete(away[0]);
      st.thin.delete(away[0]);
      frames.push(away[0]);
    }
    const last = Math.max(0, ...[...st.members.values()].map((x) => x.joined));
    m = {
      joined: Math.max(now, last + 1),
      since: now,
      role,
      me: {},
      conn: null,
    };
    st.members.set(id, m);
  }
  const old = m.conn;
  m.me = me;
  m.conn = conn;
  m.since = now;
  c.member = id;
  if (st.fresh) {
    st.fresh = false;
    st.made = now;
    cx.dirty.doc = true;
  }
  if (id === st.host) st.hostAway = null;
  succeed(cx);
  cx.dirty.members = true;
  cx.dirty.pitch = true;

  cx.out.push({ kind: "attach", conn, member: id, role });
  for (const gone of frames)
    send(cx, joinedConns(st, { except: conn }), {
      t: "left",
      id: gone,
      host: st.host,
      ...stamp(cx),
    });
  send(cx, joinedConns(st, { except: conn }), {
    t: "member",
    member: memberView(id, m),
    host: st.host,
    ...stamp(cx),
  });
  if (old && old !== conn) {
    // The same member on a second connection replaces the first.
    const oc = st.conns.get(old);
    if (oc) oc.member = null;
    send(cx, old, err("replaced", "This member connected somewhere else."));
    cx.out.push({ kind: "attach", conn: old, member: null, role: null });
    cx.out.push({ kind: "close", conn: old, code: 4001, reason: "replaced" });
  }
  const frame = {
    t: "joined",
    pitch: st.code,
    you: id,
    role,
    host: st.host,
    s: st.s,
    ts: now,
    members: membersView(st),
    limits: publicLimits(L),
    v: st.doc.v,
    by: st.doc.by,
    match: matchView(st, msg.n ?? null, msg.seq ?? null),
  };
  // A client that already holds this version of the document says so and is not sent it.
  if (!(msg.v === st.doc.v && st.doc.v > 0)) frame.doc = st.doc.value;
  send(cx, conn, frame);
}

function onMe(cx, who, msg) {
  who.m.me = mergeMe(who.m.me, msg.me ?? {}, cx.st.opts.limits);
  cx.dirty.members = true;
  send(cx, joinedConns(cx.st), {
    t: "member",
    member: memberView(who.id, who.m),
    host: cx.st.host,
    ...stamp(cx),
  });
}

function onLeave(cx, conn, c, who) {
  const { st } = cx;
  st.members.delete(who.id);
  st.thin.delete(who.id);
  c.member = null;
  cx.dirty.members = true;
  cx.dirty.pitch = true;
  if (st.host === who.id) {
    st.host = null;
    st.hostAway = null;
  }
  succeed(cx);
  cx.out.push({ kind: "attach", conn, member: null, role: null });
  send(cx, joinedConns(st), {
    t: "left",
    id: who.id,
    host: st.host,
    ...stamp(cx),
  });
  send(cx, conn, { t: "bye", ts: cx.now });
}

function onClose(cx, conn) {
  const { st, now } = cx;
  const c = st.conns.get(conn);
  st.conns.delete(conn);
  if (!c || !c.member) return;
  const m = st.members.get(c.member);
  if (!m || m.conn !== conn) return;
  m.conn = null;
  m.since = now;
  if (c.member === st.host) st.hostAway = now;
  cx.dirty.members = true;
  send(cx, joinedConns(st), {
    t: "member",
    member: memberView(c.member, m),
    host: st.host,
    ...stamp(cx),
  });
}

// ---------- the lobby document ----------

function checkDocWrite(cx, who, msg) {
  const L = cx.st.opts.limits;
  if (who.m.role === "observer")
    throw new PitchError("observer", "Observers do not write the pitch.");
  if (!optId(msg.id))
    throw new PitchError("bad-message", "`id` must be a short id.");
  if (!Number.isSafeInteger(msg.base) || msg.base < 0)
    throw new PitchError("bad-message", "`base` must be a version.");
  if (msg.doc === undefined)
    throw new PitchError("bad-message", "`doc` is missing.");
  if (jsonBytes(msg.doc) > L.docBytes)
    throw new PitchError(
      "too-big",
      `The document is limited to ${L.docBytes} bytes.`,
    );
}

function refuseWrite(cx, conn, msg) {
  const d = cx.st.doc;
  send(cx, conn, {
    t: "no",
    re: msg.t,
    id: msg.id ?? null,
    v: d.v,
    by: d.by,
    sid: d.sid,
    doc: d.value,
  });
}

function writeDoc(cx, who, msg) {
  const st = cx.st;
  st.doc = {
    v: msg.base + 1,
    by: who.id,
    sid: msg.id === undefined || msg.id === null ? null : String(msg.id),
    value: msg.doc,
  };
  cx.dirty.doc = true;
}

function onSet(cx, conn, who, msg) {
  checkDocWrite(cx, who, msg);
  if (msg.base !== cx.st.doc.v) return refuseWrite(cx, conn, msg);
  writeDoc(cx, who, msg);
  const st = cx.st;
  const t = stamp(cx);
  send(cx, joinedConns(st, { except: conn }), {
    t: "doc",
    v: st.doc.v,
    by: who.id,
    doc: st.doc.value,
    ...t,
  });
  send(cx, conn, { t: "ok", re: "set", id: msg.id ?? null, v: st.doc.v, ...t });
}

// ---------- matches ----------

function onStart(cx, conn, who, msg) {
  const { st, now } = cx;
  const L = st.opts.limits;
  checkDocWrite(cx, who, msg);
  if (who.id !== st.host)
    throw new PitchError("not-host", "Only the host starts a match.");
  const n = (st.match?.n ?? 0) + 1;
  if (msg.n !== n)
    throw new PitchError("bad-match", `The next match here is ${n}.`, {
      n: st.match?.n ?? 0,
    });
  if (!isHash(msg.h, L))
    throw new PitchError("bad-message", "`h` must be the hash at the start.");
  if (typeof msg.snap !== "string" || !msg.snap)
    throw new PitchError("bad-message", "`snap` must be the first snapshot.");
  if (utf8Length(msg.snap) > L.snapBytes)
    throw new PitchError(
      "too-big",
      `A snapshot is limited to ${L.snapBytes} bytes.`,
    );
  const meta = msg.meta ?? {};
  if (!isObject(meta))
    throw new PitchError("bad-message", "`meta` must be an object.");
  if (jsonBytes(meta) > L.metaBytes)
    throw new PitchError(
      "too-big",
      `A match's meta is limited to ${L.metaBytes} bytes.`,
    );
  if (msg.base !== st.doc.v) return refuseWrite(cx, conn, msg);

  writeDoc(cx, who, msg);
  st.match = {
    n,
    meta,
    h0: msg.h,
    at: now,
    seq: 0,
    h: msg.h,
    snap: msg.snap,
    over: false,
    acts: [],
    ids: new Map(),
  };
  cx.dirty.match = true;
  cx.dirty.head = true;
  cx.clearActs = true;
  const t = stamp(cx);
  send(cx, joinedConns(st, { except: conn }), {
    t: "start",
    m: who.id,
    v: st.doc.v,
    by: who.id,
    doc: st.doc.value,
    n,
    h: msg.h,
    snap: msg.snap,
    meta,
    ...t,
  });
  send(cx, conn, {
    t: "ok",
    re: "start",
    id: msg.id ?? null,
    v: st.doc.v,
    n,
    ...t,
  });
  cx.pushes.push({
    kind: "push",
    topic: "start",
    body: {
      pitch: st.code,
      n,
      m: who.id,
      ts: now,
      v: st.doc.v,
      doc: st.doc.value,
      meta,
      h0: msg.h,
      snap: msg.snap,
    },
  });
}

function onAct(cx, conn, who, msg) {
  const { st, now } = cx;
  const L = st.opts.limits;
  if (who.m.role === "observer")
    throw new PitchError("observer", "Observers do not act.");
  if (typeof msg.id !== "string" || !ACT_ID.test(msg.id))
    throw new PitchError("bad-message", "`id` must be the action's own id.");
  if (!Number.isSafeInteger(msg.n) || !Number.isSafeInteger(msg.seq))
    throw new PitchError("bad-message", "`n` and `seq` must be integers.");
  if (!isObject(msg.a))
    throw new PitchError("bad-message", "`a` must be the action.");
  if (jsonBytes(msg.a) > L.actionBytes)
    throw new PitchError(
      "too-big",
      `An action is limited to ${L.actionBytes} bytes.`,
    );
  if (!isHash(msg.h, L))
    throw new PitchError("bad-message", "`h` must be the hash after it.");
  if (typeof msg.snap !== "string" || !msg.snap)
    throw new PitchError(
      "bad-message",
      "`snap` must be the snapshot after it.",
    );
  if (utf8Length(msg.snap) > L.snapBytes)
    throw new PitchError(
      "too-big",
      `A snapshot is limited to ${L.snapBytes} bytes.`,
    );
  if (msg.over !== undefined && typeof msg.over !== "boolean")
    throw new PitchError("bad-message", "`over` is true or absent.");
  if (
    msg.c !== undefined &&
    (typeof msg.c !== "string" || !CLIENT_TAG.test(msg.c))
  )
    throw new PitchError("bad-message", "`c` must be a client tag.");

  const M = st.match;
  // Already stored: ack again with its stored place, whatever it claims now.
  const known = M ? M.ids.get(msg.id) : undefined;
  if (known !== undefined) {
    const r = M.acts[known];
    return send(cx, conn, {
      t: "ok",
      re: "act",
      id: r.id,
      n: M.n,
      seq: r.seq,
      s: r.s,
      ts: r.ts,
      dup: true,
    });
  }
  const why = !M
    ? "no-match"
    : msg.n !== M.n
      ? "match"
      : M.over
        ? "over"
        : msg.seq !== M.seq + 1
          ? "seq"
          : M.acts.length >= L.actsMax
            ? "full"
            : null;
  if (why)
    return send(cx, conn, {
      t: "refused",
      id: msg.id,
      n: msg.n,
      seq: msg.seq,
      why,
      head: M ? { n: M.n, seq: M.seq, h: M.h, over: M.over } : null,
    });

  const t = stamp(cx);
  const r = {
    id: msg.id,
    seq: msg.seq,
    m: who.id,
    a: msg.a,
    h: msg.h,
    s: t.s,
    ts: t.ts,
    over: msg.over === true,
  };
  if (msg.c) r.c = msg.c;
  M.ids.set(r.id, M.acts.length);
  M.acts.push(r);
  M.seq = r.seq;
  M.h = r.h;
  M.snap = msg.snap;
  if (r.over) M.over = true;
  cx.dirty.head = true;
  cx.acts.push({ n: M.n, ...r });

  send(cx, joinedConns(st, { except: conn }), relayAct(M.n, r));
  send(cx, conn, {
    t: "ok",
    re: "act",
    id: r.id,
    n: M.n,
    seq: r.seq,
    ...t,
  });
  cx.pushes.push({
    kind: "push",
    topic: "act",
    body: { pitch: st.code, n: M.n, ...r, snap: msg.snap },
  });
  if (r.over)
    cx.pushes.push({
      kind: "push",
      topic: "keep",
      body: keptReplay(st, now),
    });
}

// The kept replay of a finished match, built from the pitch's own log: the start info
// as the host sent it, the hash at the start, and every action with the hash after it.
export function keptReplay(st, now) {
  const M = st.match;
  return {
    pitch: st.code,
    n: M.n,
    at: now,
    started: M.at,
    meta: M.meta,
    h0: M.h0,
    log: M.acts.map((r) => ({ a: r.a, h: r.h, ts: r.ts })),
  };
}

// ---------- casts ----------

function onCast(cx, conn, c, who, msg, bytes) {
  const { st, now } = cx;
  const L = st.opts.limits;
  if (who.m.role === "observer")
    throw new PitchError("observer", "Observers do not cast.");
  if (bytes > L.castBytes)
    throw new PitchError(
      "too-big",
      `A cast is limited to ${L.castBytes} bytes.`,
    );
  if (!take(c.cast, L.castRate, L.castBurst, now)) {
    // Dropped. Said once, not once a message.
    if (!c.castWarned) {
      c.castWarned = true;
      send(cx, conn, err("rate", "Too many casts. Slow down.", { re: "cast" }));
    }
    return;
  }
  c.castWarned = false;
  const frame = { t: "cast", m: who.id, s: st.s, ts: now, d: msg.d ?? null };
  send(cx, joinedConns(st, { role: "player", except: conn }), frame);
  const thinned = thinAllow(st.thin, who.id, now, L);
  if (msg.all === true || thinned)
    send(cx, joinedConns(st, { role: "observer" }), frame);
}

// ---------- the open games list ----------

function onOpen(cx, who, msg) {
  const { st, now } = cx;
  if (who.id !== st.host)
    throw new PitchError("not-host", "Only the host opens a game.");
  const o = msg.open;
  if (o === null || o === false) {
    if (st.open) {
      st.open = null;
      cx.dirty.pitch = true;
    }
    return;
  }
  const L = st.opts.limits;
  if (
    !isObject(o) ||
    !Number.isInteger(o.seats) ||
    o.seats < 1 ||
    o.seats > L.seatsMax ||
    !OPEN_STATES.includes(o.state)
  )
    throw new PitchError(
      "bad-message",
      "`open` must be { seats, state } or null.",
    );
  st.open = { made: st.open?.made ?? now, seats: o.seats, state: o.state };
  cx.dirty.pitch = true;
}

// What the open games list shows of this pitch, or null when it is not listed: open,
// waiting or playing, someone on it, a free seat, and room for one more player.
export function listingEntry(st) {
  const o = st.open;
  if (!o || o.state === "over") return null;
  let players = 0;
  let watchers = 0;
  let playerMembers = 0;
  let evictable = false;
  for (const [id, m] of st.members) {
    if (m.role === "player") {
      playerMembers++;
      if (m.conn) players++;
      else if (id !== st.host) evictable = true;
    } else if (m.conn) watchers++;
  }
  if (players === 0 || players >= o.seats) return null;
  if (playerMembers >= st.opts.limits.players && !evictable) return null;
  return { made: o.made, players, watchers, seats: o.seats, state: o.state };
}

const sameEntry = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- after every event ----------

const anyoneOn = (st) => [...st.members.values()].some((m) => m.conn);

function settle(cx) {
  const { st, now } = cx;
  if (succeed(cx))
    send(cx, joinedConns(st), { t: "host", host: st.host, ...stamp(cx) });

  const entry = listingEntry(st);
  const L = st.opts.limits;
  if (
    !sameEntry(entry, st.listing.entry) ||
    (entry && now - st.listing.at >= L.listRefreshMs)
  ) {
    st.listing = { entry, at: now };
    cx.listing = { kind: "listing", pitch: st.code, entry };
    cx.dirty.pitch = true;
  }

  if (
    !st.fresh &&
    !anyoneOn(st) &&
    now - st.touched >= L.idleMs &&
    !Object.values(cx.dirty).some(Boolean)
  )
    cx.wipe = true;
}

// When the pitch next needs a tick: the host's grace running out, the listing's
// refresh, or the idle wipe. Null when nothing is due.
function nextAlarm(st, now) {
  const L = st.opts.limits;
  const due = [];
  if (st.hostAway !== null) {
    const at = st.hostAway + L.hostGraceMs;
    if (at > now) due.push(at);
  }
  if (st.listing.entry) due.push(st.listing.at + L.listRefreshMs);
  if (!st.fresh && !anyoneOn(st)) due.push(st.touched + L.idleMs);
  return due.length ? Math.min(...due) : null;
}

function finish(cx) {
  const { st, now } = cx;
  if (cx.wipe) {
    const had = st.alarmAt;
    const conns = st.conns;
    Object.assign(st, blank(st.code, now, st.opts));
    st.conns = conns;
    const effects = [...cx.out];
    if (cx.listing) effects.push(cx.listing);
    effects.push({ kind: "wipe" });
    if (had !== null) effects.push({ kind: "alarm", at: null });
    return effects;
  }
  const d = cx.dirty;
  const changed =
    d.pitch || d.doc || d.members || d.match || d.head || cx.acts.length > 0;
  if (changed) {
    st.touched = now;
    d.pitch = true;
  }
  const alarm = nextAlarm(st, now);
  let alarmEffect = null;
  if (alarm !== st.alarmAt) {
    st.alarmAt = alarm;
    d.pitch = true;
    alarmEffect = { kind: "alarm", at: alarm };
  }
  const persist = buildPersist(cx);
  const effects =
    persist && st.opts.commitOrder === "write-first"
      ? [persist, ...cx.out]
      : persist
        ? [...cx.out, persist]
        : [...cx.out];
  effects.push(...cx.pushes);
  if (cx.listing) effects.push(cx.listing);
  if (alarmEffect) effects.push(alarmEffect);
  return effects;
}

// ---------- persistence ----------
//
// Six records (PROTOCOL.md "Persisted records"), written whole except the log, which
// only grows within a match and is cleared when the next one starts:
//   pitch    { code, made, s, host, hostAway, open, listing, alarmAt, touched }
//   doc      { v, by, sid, text }                    text: the document as JSON
//   members  [{ id, joined, since, role, me, on }]   on: connected when written
//   match    { n, meta, h0, at }                     the current match's start
//   head     { n, seq, h, snap, over }               where it stands
//   act      { n, seq, id, m, a, h, s, ts, over, c? }  one per committed action

const pitchRecord = (st) => ({
  code: st.code,
  made: st.made,
  s: st.s,
  host: st.host,
  hostAway: st.hostAway,
  open: st.open,
  listing: st.listing,
  alarmAt: st.alarmAt,
  touched: st.touched,
});

const membersRecord = (st) =>
  [...st.members.entries()].map(([id, m]) => ({
    id,
    joined: m.joined,
    since: m.since,
    role: m.role,
    me: m.me,
    on: Boolean(m.conn),
  }));

function buildPersist(cx) {
  const { st, dirty: d } = cx;
  const p = { kind: "persist" };
  let any = false;
  const put = (k, v) => {
    p[k] = v;
    any = true;
  };
  if (d.pitch) put("pitch", pitchRecord(st));
  if (d.doc)
    put("doc", {
      v: st.doc.v,
      by: st.doc.by,
      sid: st.doc.sid,
      text: JSON.stringify(st.doc.value),
    });
  if (d.members) put("members", membersRecord(st));
  if (d.match && st.match)
    put("match", {
      n: st.match.n,
      meta: st.match.meta,
      h0: st.match.h0,
      at: st.match.at,
    });
  if (d.head && st.match)
    put("head", {
      n: st.match.n,
      seq: st.match.seq,
      h: st.match.h,
      snap: st.match.snap,
      over: st.match.over,
    });
  if (cx.clearActs) put("clearActs", true);
  if (cx.acts.length) put("acts", cx.acts);
  return any ? p : null;
}

// The pitch again from what was persisted, after the object slept or restarted.
// `stored` is { pitch, doc, members, match, head, acts } as the persist effects left
// them (all absent for a pitch never joined); `conns` is the sockets still open, each
// { conn, member, role } from its attachment. A member written as connected whose
// socket is gone is marked away now and the others are told.
export function rebuildPitch({ code, stored, conns = [], now, options } = {}) {
  if (typeof code !== "string" || !PITCH_CODE.test(code))
    throw new TypeError("not a pitch code");
  const st = blank(code, now, resolveOptions(options));
  const cx = context(st, now);
  for (const k of conns) connState(st, k.conn, now);
  if (!stored?.pitch) return { state: st, effects: [] };

  const P = stored.pitch;
  Object.assign(st, {
    fresh: false,
    made: P.made,
    s: P.s,
    host: P.host,
    hostAway: P.hostAway,
    open: P.open,
    listing: P.listing ?? { entry: null, at: null },
    alarmAt: P.alarmAt ?? null,
    touched: P.touched ?? now,
  });
  if (stored.doc)
    st.doc = {
      v: stored.doc.v,
      by: stored.doc.by,
      sid: stored.doc.sid,
      value: JSON.parse(stored.doc.text),
    };
  const wasOn = [];
  for (const r of stored.members ?? []) {
    st.members.set(r.id, {
      joined: r.joined,
      since: r.since,
      role: r.role,
      me: r.me,
      conn: null,
    });
    if (r.on) wasOn.push(r.id);
  }
  if (stored.match && stored.head && stored.head.n === stored.match.n) {
    const acts = (stored.acts ?? [])
      .filter((a) => a.n === stored.match.n)
      .sort((a, b) => a.seq - b.seq)
      .map(({ n: _n, ...r }) => r);
    st.match = {
      n: stored.match.n,
      meta: stored.match.meta,
      h0: stored.match.h0,
      at: stored.match.at,
      seq: stored.head.seq,
      h: stored.head.h,
      snap: stored.head.snap,
      over: stored.head.over,
      acts,
      ids: new Map(acts.map((r, i) => [r.id, i])),
    };
  }
  for (const k of conns) {
    const m = k.member ? st.members.get(k.member) : null;
    if (m && !m.conn && m.role === k.role) {
      m.conn = k.conn;
      st.conns.get(k.conn).member = k.member;
    } else if (k.member) {
      cx.out.push({ kind: "attach", conn: k.conn, member: null, role: null });
    }
  }
  for (const id of wasOn) {
    const m = st.members.get(id);
    if (m.conn) continue;
    m.since = now;
    if (id === st.host) st.hostAway = now;
    cx.dirty.members = true;
    send(cx, joinedConns(st), {
      t: "member",
      member: memberView(id, m),
      host: st.host,
      ...stamp(cx),
    });
  }
  settle(cx);
  return { state: st, effects: finish(cx) };
}
