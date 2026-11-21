// The pitch client: one WebSocket to the pitch server (backend/pitch-server/PROTOCOL.md),
// with the members, the host, the lobby document, the match's head, the actions in
// flight, casts and reconnects handled here. No dependencies; runs in browsers and under
// Node 24+ (global WebSocket). docs/MULTIPLAYER.md says how the game uses it.
//
//   const pitch = connect({ url: config.pitchUrl, pitch: code, member: memberId() });
//   pitch.on("state", ({ doc, match }) => ...);   // joined (every connect) and resync
//   pitch.on("acts", (acts) => ...);              // actions others committed, in order
//   await pitch.ready;
//   await pitch.update((doc) => ({ ...doc, open: true }));   // compare-and-set, retried
//   pitch.act({ n, seq, a, h, snap, over });      // sent at once, resent after a drop
//
// What it promises the game:
// - Every action this client commits is sent once per connection, in order, until the
//   server answers `ok` (a duplicate after a reconnect is answered `ok` with `dup`), or
//   `refused` (someone else was first: the game resyncs). Nothing waits on `ok`.
// - Every action someone else committed reaches `acts` exactly once, in order: live as
//   they come, or after a reconnect as the server's resume (the actions after the last
//   one this client holds). When it cannot be had that way the server sends the whole
//   match instead (`state` with `match.full`), with the snapshot at the head.
// - A jump in the pitch sequence `s` (something missed) asks for the whole pitch again.
// - A dropped socket is tried again at once (a random wait under a third of a second,
//   so a deploy that drops every socket does not bring them all back in the same
//   instant), then with a growing wait up to 10 s, for as long as the page is open.

const BACKSLASH = String.fromCharCode(92);

/** Pitch codes: 10 characters, no 0, 1, i, l or o (the server takes 8 to 24 of these). */
export const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const PITCH_CODE = /^[2-9a-hjkmnp-z]{8,24}$/;
const ID_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

export const pitchTune = {
  pingMs: 20000, // the literal "ping" keep-alive, this often while connected
  pongMs: 10000, // no "pong" (or anything) by then: the socket is dead, connect again
  firstRetryMs: 300, // after a drop: once at a random wait under this ...
  retryMs: 1000, // ... then this, doubled each time ...
  retryMaxMs: 10000, // ... up to this, each with a quarter of jitter either way
  answerMs: 10000, // a lobby write with no answer by then: connect again to find out
  // A long backlog of our own actions after a drop goes in turns: the server takes a
  // burst of 60 messages a connection, then 30 a second (PROTOCOL.md section 9)
  actWindow: 20, // sent and not answered at once, at most ...
  actBurst: 20, // ... and sent at once after a quiet spell, at most ...
  actRate: 15, // ... then this many a second
  rateRetryMs: 1000, // told "too many messages": what is out unanswered goes again
};

// The frames that move `s` on by one (PROTOCOL.md section 2).
const STAMPED = new Set(["member", "left", "host", "doc", "start", "act"]);
// A join refused for good: no point trying again.
const FINAL = new Set([
  "full",
  "no-pitch",
  "bad-member",
  "bad-role",
  "already-joined",
  "bad-message",
  "replaced",
]);

function randomString(length, alphabet) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function makePitchCode(length = 10) {
  return randomString(length, CODE_ALPHABET);
}

/** This browser's member id, kept in localStorage so a refresh is the same member. */
export function memberId(
  storage = globalThis.localStorage,
  key = "kubb.member",
) {
  try {
    const kept = storage?.getItem(key);
    if (kept && /^[A-Za-z0-9_-]{8,40}$/.test(kept)) return kept;
  } catch {}
  const id = randomString(16, ID_ALPHABET);
  try {
    storage?.setItem(key, id);
  } catch {}
  return id;
}

/**
 * An observer's member id (docs/OBSERVER.md): its own, kept for the tab, never this
 * browser's player id. A player who opens WATCH on their own pitch must not take over
 * their playing connection: the server gives a join with a known id that member's place
 * (and refuses one with the other role).
 */
export function observerId(storage = globalThis.sessionStorage) {
  return memberId(storage, "kubb.observer");
}

// JSON with everything above "~" escaped: its length is its size in bytes.
export function asciiJson(value) {
  return JSON.stringify(value).replace(
    /[^\x00-\x7e]/g,
    (c) => BACKSLASH + "u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

export class PitchError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

// The socket's address for a pitch: the server's origin and /ws?pitch=<code>.
export function socketUrl(url, pitch) {
  return `${String(url).replace(/\/+$/, "")}/ws?pitch=${encodeURIComponent(pitch)}`;
}

/** Connect to a pitch. Returns at once; `ready` resolves with the first `joined`. */
export function connect(options) {
  const p = new PitchClient(options);
  p.open();
  return p;
}

export class PitchClient {
  // url: the server's origin (wss://...); pitch: the code; member: the member id;
  // role: "player" or "observer"; me: the member's own fields (name, level, engines);
  // WebSocket: the constructor (tests); tune: pitchTune overrides; now: the clock.
  constructor({
    url,
    pitch,
    member,
    role = "player",
    me = {},
    WebSocket = globalThis.WebSocket,
    tune = {},
    now = () => Date.now(),
  }) {
    if (!PITCH_CODE.test(pitch ?? ""))
      throw new PitchError("bad-pitch", "That is not a pitch code.");
    Object.assign(this, { url, pitch, member, role, WebSocket, now });
    this.tune = { ...pitchTune, ...tune };
    this.me = { ...me };
    this.status = "connecting"; // connecting | open | reconnecting | closed | replaced
    this.you = member;
    this.host = null;
    this.members = [];
    this.doc = null;
    this.v = 0;
    this.by = null;
    this.s = 0;
    this.limits = null;
    this.match = null; // the head as last heard: { n, seq, h, over, h0?, meta?, at? }
    this.at = { n: null, seq: 0 }; // the last action this client holds that the server has
    this.pending = []; // our own actions not answered yet, in order
    this.writes = new Map(); // id -> { resolve, reject, timer } for set and start
    this.listeners = new Map();
    this.ws = null;
    this.joined = false; // this connection has had its `joined`
    this.ever = false; // any connection has
    this.waitState = false; // a resync on its way: stamped frames wait for it
    this.attempt = 0;
    this.retryTimer = null;
    this.pingTimer = null;
    this.lastHeard = 0;
    this.pingAt = 0;
    this.seq = 0; // ids for writes
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.ready.catch(() => {}); // a refusal is also an event; nobody need await it
    this.onOnline = () => {
      if (this.status === "reconnecting") this.retryNow();
    };
    this.onVisible = () => {
      if (globalThis.document?.hidden) return;
      if (this.status === "reconnecting") this.retryNow();
      else if (this.status === "open") this.ping(true);
    };
  }

  // ---------- events ----------

  on(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
    return () => this.listeners.get(name)?.delete(fn);
  }

  emit(name, value) {
    for (const fn of this.listeners.get(name) ?? []) {
      try {
        fn(value);
      } catch (err) {
        console.error(err);
      }
    }
  }

  setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.emit("status", s);
  }

  isHost() {
    return !!this.you && this.host === this.you;
  }

  // ---------- the socket ----------

  open() {
    globalThis.addEventListener?.("online", this.onOnline);
    globalThis.document?.addEventListener?.("visibilitychange", this.onVisible);
    this.dial();
    this.pingTimer = setInterval(() => this.ping(), this.tune.pingMs / 2);
  }

  dial() {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.status === "closed" || this.status === "replaced") return;
    let ws;
    try {
      ws = new this.WebSocket(socketUrl(this.url, this.pitch));
    } catch {
      this.dropped(null);
      return;
    }
    this.ws = ws;
    this.joined = false;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.lastHeard = this.now();
      this.sendRaw(this.joinMessage());
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      this.lastHeard = this.now();
      this.pingAt = 0;
      const text = typeof e.data === "string" ? e.data : "";
      if (text === "pong") return;
      let m;
      try {
        m = JSON.parse(text);
      } catch {
        return;
      }
      if (m && typeof m === "object") this.frame(m);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.dropped(e?.code ?? null);
    };
    ws.onerror = () => {
      // a close follows
    };
  }

  joinMessage() {
    const m = {
      t: "join",
      member: this.member,
      role: this.role,
      me: this.me,
      create: this.role === "player",
    };
    if (this.ever) m.v = this.v;
    if (this.at.n != null) {
      m.n = this.at.n;
      m.seq = this.at.seq;
    }
    return m;
  }

  sendRaw(msg) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    try {
      ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  // A message for the pitch, only once joined on this connection.
  send(msg) {
    return this.joined && this.sendRaw(msg);
  }

  dropped(code) {
    this.ws = null;
    this.joined = false;
    this.waitState = false;
    this.failWrites("uncertain", "The connection dropped before the answer.");
    if (code === 4001) return this.replaced();
    if (this.status === "closed" || this.status === "replaced") return;
    this.setStatus(this.ever ? "reconnecting" : "connecting");
    const t = this.tune;
    const wait =
      this.attempt === 0
        ? Math.random() * t.firstRetryMs
        : Math.min(t.retryMaxMs, t.retryMs * 2 ** (this.attempt - 1)) *
          (0.75 + Math.random() * 0.5);
    this.attempt++;
    this.retryTimer = setTimeout(() => this.dial(), wait);
  }

  retryNow() {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.dial();
  }

  // The keep-alive: the literal "ping", answered "pong" without waking the pitch. Silence
  // past pongMs after one means a dead socket (a phone that slept, a network that
  // changed): it is closed and dialled again.
  ping(now = false) {
    if (this.status !== "open" || !this.ws) return;
    const t = this.now();
    if (this.pingAt && t - this.pingAt > this.tune.pongMs) {
      const ws = this.ws;
      try {
        ws.close();
      } catch {}
      if (this.ws === ws) this.dropped(null);
      return;
    }
    if (this.pingAt) return;
    if (now || t - this.lastHeard >= this.tune.pingMs) {
      if (this.sendRaw("ping")) this.pingAt = t;
    }
  }

  replaced() {
    this.stop();
    this.setStatus("replaced");
    this.emit("error", { code: "replaced", message: "Open somewhere else." });
  }

  stop() {
    clearTimeout(this.retryTimer);
    clearTimeout(this.actTimer);
    clearTimeout(this.rateTimer);
    this.actTimer = this.rateTimer = null;
    clearInterval(this.pingTimer);
    this.retryTimer = null;
    globalThis.removeEventListener?.("online", this.onOnline);
    globalThis.document?.removeEventListener?.(
      "visibilitychange",
      this.onVisible,
    );
    this.failWrites("closed", "The connection is closed.");
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {}
  }

  /** Off the pitch for good (the member is forgotten), then closed. */
  leave() {
    this.sendRaw({ t: "leave" });
    this.close();
  }

  /** Closed without leaving: the member stays, marked away. */
  close() {
    if (this.status === "closed") return;
    this.stop();
    this.setStatus("closed");
  }

  // ---------- frames from the pitch ----------

  frame(m) {
    switch (m.t) {
      case "joined":
        return this.onJoined(m);
      case "state":
        return this.onState(m);
      case "ok":
        return this.onOk(m);
      case "no":
        return this.onNo(m);
      case "refused":
        return this.onRefused(m);
      case "cast":
        return this.emit("cast", { from: m.m, d: m.d, ts: m.ts, s: m.s });
      case "error":
        return this.onError(m);
      case "bye":
      case "pong":
        return;
    }
    if (!STAMPED.has(m.t) || !this.joined) return;
    if (this.waitState) return; // the state on its way covers it
    if (!this.stamp(m.s)) return;
    switch (m.t) {
      case "member":
        this.upsert(m.member);
        this.host = m.host ?? null;
        this.emit("members", { members: this.members, host: this.host });
        if (m.member?.id === this.you) this.emit("me", m.member);
        return;
      case "left":
        this.members = this.members.filter((x) => x.id !== m.id);
        this.host = m.host ?? null;
        this.emit("members", { members: this.members, host: this.host });
        this.emit("left", { id: m.id });
        return;
      case "host":
        this.host = m.host ?? null;
        this.emit("members", { members: this.members, host: this.host });
        return;
      case "doc":
        this.doc = m.doc ?? null;
        this.v = m.v;
        this.by = m.by ?? null;
        this.emit("doc", {
          doc: this.doc,
          v: this.v,
          by: this.by,
          mine: false,
        });
        return;
      case "start":
        this.doc = m.doc ?? null;
        this.v = m.v;
        this.by = m.by ?? null;
        this.match = {
          n: m.n,
          seq: 0,
          h: m.h,
          over: false,
          h0: m.h,
          meta: m.meta ?? null,
          at: m.ts ?? null,
        };
        this.at = { n: m.n, seq: 0 };
        this.pending = [];
        this.emit("start", {
          doc: this.doc,
          v: this.v,
          by: this.by,
          n: m.n,
          h: m.h,
          snap: m.snap,
          meta: m.meta ?? null,
          from: m.m,
        });
        return;
      case "act":
        return this.remoteActs([m]);
    }
  }

  // `s` of a stamped frame: true when it is the next, false when it is old (seen in a
  // state already) or a jump (then the whole pitch is asked for).
  stamp(s) {
    if (!Number.isSafeInteger(s)) return true;
    if (s === this.s + 1) {
      this.s = s;
      return true;
    }
    if (s <= this.s) return false;
    this.resync();
    return false;
  }

  upsert(view) {
    if (!view?.id) return;
    const i = this.members.findIndex((x) => x.id === view.id);
    const list = [...this.members];
    if (i >= 0) list[i] = view;
    else list.push(view);
    list.sort((a, b) => (a.joined ?? 0) - (b.joined ?? 0));
    this.members = list;
  }

  onJoined(m) {
    const first = !this.ever;
    this.joined = true;
    this.ever = true;
    this.attempt = 0;
    this.you = m.you ?? this.member;
    this.role = m.role ?? this.role;
    this.limits = m.limits ?? this.limits;
    this.setStatus("open");
    // what was not answered before the drop goes again, in order and a window at a
    // time (flushActs): an action the pitch already holds is answered `ok` with `dup`
    for (const p of this.pending) p.sent = false;
    this.whole(m);
    if (first) this.readyResolve(this);
    this.flushActs();
  }

  onState(m) {
    this.waitState = false;
    this.whole(m);
  }

  // joined and state: everything at once.
  whole(m) {
    this.s = m.s ?? this.s;
    this.host = m.host ?? null;
    this.members = [...(m.members ?? [])];
    if ("doc" in m) {
      this.doc = m.doc ?? null;
      this.v = m.v ?? 0;
      this.by = m.by ?? null;
    }
    const mt = m.match ?? null;
    let match = null;
    let resumed = [];
    if (mt && mt.full === false) {
      // resuming: the actions after ours; our own unanswered ones among them are taken
      const acts = [];
      for (const a of mt.acts ?? []) {
        if (this.ack(a.id, a.n, a.seq)) continue;
        acts.push(actOf(a));
      }
      if (acts.length) this.at = { n: mt.n, seq: acts.at(-1).seq };
      this.match = {
        ...(this.match?.n === mt.n ? this.match : {}),
        n: mt.n,
        seq: mt.seq,
        h: mt.h,
        over: !!mt.over,
      };
      match = { full: false, n: mt.n, seq: mt.seq, h: mt.h, over: !!mt.over };
      resumed = acts;
    } else if (mt) {
      this.match = {
        n: mt.n,
        seq: mt.seq,
        h: mt.h,
        over: !!mt.over,
        h0: mt.h0,
        meta: mt.meta ?? null,
        at: mt.at ?? null,
      };
      this.at = { n: mt.n, seq: mt.seq };
      // an action of ours the head may already hold: sent again, it is answered dup
      this.pending = this.pending.filter((p) => p.n === mt.n);
      match = {
        full: true,
        n: mt.n,
        seq: mt.seq,
        h: mt.h,
        over: !!mt.over,
        h0: mt.h0,
        meta: mt.meta ?? null,
        at: mt.at ?? null,
        snap: mt.snap,
      };
    } else {
      this.match = null;
      this.at = { n: null, seq: 0 };
      this.pending = [];
    }
    this.emit("members", { members: this.members, host: this.host });
    this.emit("state", { doc: this.doc, v: this.v, match });
    // a resume's actions (others' only) come after it, as live ones do
    if (resumed.length) this.emit("acts", resumed);
  }

  remoteActs(frames) {
    const acts = [];
    for (const f of frames) {
      const a = actOf(f);
      if (this.match && this.match.n === a.n && a.seq > this.match.seq) {
        this.match.seq = a.seq;
        this.match.h = a.h;
        if (a.over) this.match.over = true;
      }
      if (this.at.n === a.n && a.seq > this.at.seq)
        this.at = { n: a.n, seq: a.seq };
      acts.push(a);
    }
    if (acts.length) this.emit("acts", acts);
  }

  // One of our pending actions answered (ok, or seen in a resume): true when it was ours.
  ack(id, n, seq) {
    const i = this.pending.findIndex((p) => p.id === id);
    if (i < 0) return false;
    const [p] = this.pending.splice(i, 1);
    this.flushActs();
    if (this.at.n === n && seq > this.at.seq) this.at = { n, seq };
    if (this.match && this.match.n === n && seq > this.match.seq) {
      this.match.seq = seq;
      this.match.h = p.msg.h;
      if (p.msg.over) this.match.over = true;
    }
    return true;
  }

  onOk(m) {
    if (m.re === "act") {
      if (!m.dup) this.stampOwn(m.s);
      const mine = this.ack(m.id, m.n, m.seq);
      if (mine) this.emit("ok", { id: m.id, n: m.n, seq: m.seq, dup: !!m.dup });
      return;
    }
    this.stampOwn(m.s);
    const w = this.writes.get(m.id);
    if (!w) return;
    this.writes.delete(m.id);
    clearTimeout(w.timer);
    this.v = m.v ?? this.v;
    this.doc = w.doc;
    this.by = this.you;
    if (m.re === "start") {
      const s = w.start;
      this.match = {
        n: s.n,
        seq: 0,
        h: s.h,
        over: false,
        h0: s.h,
        meta: s.meta ?? null,
        at: m.ts ?? null,
      };
      this.at = { n: s.n, seq: 0 };
    }
    this.emit("doc", { doc: this.doc, v: this.v, by: this.by, mine: true });
    w.resolve({ doc: this.doc, v: this.v });
  }

  // Our own write's `s`: the next one, or already past it in a state.
  stampOwn(s) {
    if (!Number.isSafeInteger(s) || this.waitState) return;
    if (s === this.s + 1) this.s = s;
    else if (s > this.s + 1) this.resync();
  }

  onNo(m) {
    const w = this.writes.get(m.id);
    this.doc = m.doc ?? null;
    this.v = m.v ?? this.v;
    this.by = m.by ?? null;
    this.emit("doc", { doc: this.doc, v: this.v, by: this.by, mine: false });
    if (!w) return;
    this.writes.delete(m.id);
    clearTimeout(w.timer);
    w.resolve(null);
  }

  onRefused(m) {
    const i = this.pending.findIndex((p) => p.id === m.id);
    if (i < 0) return;
    // this one and every later one of ours: each follows the refused one
    this.pending.splice(i);
    this.flushActs();
    this.emit("refused", {
      id: m.id,
      n: m.n,
      seq: m.seq,
      why: m.why,
      head: m.head ?? null,
    });
  }

  onError(m) {
    if (m.code === "replaced") return this.replaced();
    if (!this.joined && FINAL.has(m.code)) {
      const err = new PitchError(m.code, m.message || "Refused.");
      this.stop();
      this.setStatus("closed");
      if (!this.ever) this.readyReject(err);
      this.emit("failed", err);
      return;
    }
    const w = m.id != null ? this.writes.get(m.id) : null;
    if (w && (m.re === "set" || m.re === "start")) {
      this.writes.delete(m.id);
      clearTimeout(w.timer);
      w.reject(new PitchError(m.code, m.message || "Refused."));
    }
    if (m.code === "rate" && m.re == null && this.pending.length)
      this.rateLimited();
    this.emit("error", { code: m.code, message: m.message, re: m.re });
  }

  failWrites(code, message) {
    for (const [, w] of this.writes) {
      clearTimeout(w.timer);
      w.reject(new PitchError(code, message));
    }
    this.writes.clear();
  }

  // ---------- writing ----------

  nextId(prefix) {
    this.seq++;
    return `${prefix}${this.seq}${randomString(6, CODE_ALPHABET)}`;
  }

  // A compare-and-set lobby write (or a start) and its answer: { doc, v } (taken), null
  // (the pitch moved on: `no`), or a PitchError (refused, or `uncertain` when the
  // connection dropped first: the state after the reconnect says what happened).
  write(msg, doc, start = null) {
    return new Promise((resolve, reject) => {
      if (!this.send(msg)) {
        reject(new PitchError("closed", "Not connected to the pitch."));
        return;
      }
      const timer = setTimeout(() => {
        if (!this.writes.has(msg.id)) return;
        this.writes.delete(msg.id);
        reject(new PitchError("uncertain", "No answer from the pitch."));
        // the socket may be dead: connect again to find out
        const ws = this.ws;
        try {
          ws?.close();
        } catch {}
        if (ws && this.ws === ws) this.dropped(null);
      }, this.tune.answerMs);
      this.writes.set(msg.id, { resolve, reject, timer, doc, start });
    });
  }

  /**
   * The lobby document through fn, compare-and-set, tried again on the newer document
   * when someone else wrote first. fn(doc) returns the new document, or null/undefined
   * to write nothing. Resolves { doc, v }, or null when fn wrote nothing.
   */
  async update(fn, { tries = 5 } = {}) {
    for (let i = 0; i < tries; i++) {
      const next = fn(this.doc);
      if (next == null) return null;
      const r = await this.write(
        { t: "set", id: this.nextId("w"), base: this.v, doc: next },
        next,
      );
      if (r) return r;
    }
    throw new PitchError("busy", "The pitch kept changing.");
  }

  /**
   * Start match n (the host): the lobby document as it is with the match begun, the
   * hash and snapshot at its start and `meta`, what a replay needs besides the log.
   * Resolves { doc, v }, or null when the document moved first (`no`).
   */
  start({ doc, n, h, snap, meta }) {
    const msg = {
      t: "start",
      id: this.nextId("s"),
      base: this.v,
      doc,
      n,
      h,
      snap,
      meta,
    };
    return this.write(msg, doc, { n, h, meta });
  }

  /**
   * Commit one action, the next after the head this client holds. Sent at once (and
   * again after every reconnect until answered); returns its id. Nothing waits for the
   * answer: `ok` and `refused` are events.
   */
  act({ n, seq, a, h, snap, over = false, c = "web" }) {
    const id = this.nextId("a");
    const msg = { t: "act", id, n, seq, a, h, snap, c };
    if (over) msg.over = true;
    this.pending.push({ id, n, seq, msg, sent: false });
    this.flushActs();
    return id;
  }

  // Our pending actions not yet sent on this connection go, in order, while fewer than
  // actWindow are out unanswered and at most actRate a second after a burst of
  // actBurst; each answer lets the next go. One action a throw never waits.
  flushActs() {
    if (!this.joined) return;
    const T = this.tune;
    const t = this.now();
    const b = this.actBucket ?? { tokens: T.actBurst, at: t };
    b.tokens = Math.min(T.actBurst, b.tokens + ((t - b.at) * T.actRate) / 1000);
    b.at = t;
    this.actBucket = b;
    let out = this.pending.filter((p) => p.sent).length;
    for (const p of this.pending) {
      if (out >= T.actWindow) break;
      if (p.sent) continue;
      if (b.tokens < 1) {
        if (!this.actTimer)
          this.actTimer = setTimeout(() => {
            this.actTimer = null;
            this.flushActs();
          }, 1000 / T.actRate);
        break;
      }
      b.tokens--;
      p.sent = true;
      out++;
      this.sendRaw(p.msg);
    }
  }

  // The server dropped messages for their rate: which is not said, so every action out
  // unanswered goes again a little later (one the pitch holds is answered dup).
  rateLimited() {
    if (this.rateTimer) return;
    this.rateTimer = setTimeout(() => {
      this.rateTimer = null;
      for (const p of this.pending) p.sent = false;
      this.flushActs();
    }, this.tune.rateRetryMs);
  }

  /** The member's own fields, merged (a null value removes one). */
  setMe(patch) {
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (v === null) delete this.me[k];
      else this.me[k] = v;
    }
    return this.send({ t: "me", me: patch });
  }

  /** The open games list: { seats, state }, or null to take it off. The host only. */
  setOpen(info) {
    return this.send({
      t: "open",
      open: info ? { seats: info.seats, state: info.state } : null,
    });
  }

  /** Aim or a shout to the other players; `all` reaches observers unthinned. */
  cast(d, all = false) {
    if (this.role !== "player") return false;
    return this.send(all ? { t: "cast", d, all: true } : { t: "cast", d });
  }

  /** The whole pitch again (a hash that disagrees, a refusal, a jump in `s`). */
  resync() {
    if (this.waitState) return;
    if (this.send({ t: "resync" })) this.waitState = true;
  }
}

// An act frame as the game takes it.
function actOf(f) {
  return {
    id: f.id,
    from: f.m ?? null,
    n: f.n,
    seq: f.seq,
    a: f.a,
    h: f.h,
    over: !!f.over,
    ts: f.ts ?? null,
  };
}
