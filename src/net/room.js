// The room client: one WebSocket to the room server (backend/rooms), with the shared
// document, members, casts, reconnects and chunking handled here. No dependencies; runs in
// browsers and under Node 24+ (global WebSocket). The protocol and this API are docs/ROOMS.md.
//
//   const room = connect({ url, room: code, member: memberId(), name: 'Jamie' });
//   room.on('doc', ({ doc, v, by, with: w, mine }) => ...);
//   await room.ready;
//   await room.update((doc) => ({ ...doc, started: true }), { with: { action: 'start' } });

const BACKSLASH = String.fromCharCode(92);
const DEFAULT_FRAME = 30_000;
const FRAME_HEAD = 40;
const PART = /^~([a-z0-9]{1,16})\.(\d{1,3})\.(\d{1,3})~/;

/** Room codes: 10 characters, no 0, 1, i, l or o (the server takes 8 to 24 of these). */
export const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
export const ROOM_CODE = /^[2-9a-hjkmnp-z]{8,24}$/;

function randomString(length, alphabet) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function makeRoomCode(length = 10) {
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
  const id = randomString(
    16,
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-",
  );
  try {
    storage?.setItem(key, id);
  } catch {}
  return id;
}

/** fn at most once every `ms`; the latest call in between is sent at the end of the wait. */
export function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  let pending = null;
  const fire = () => {
    timer = null;
    last = Date.now();
    const args = pending;
    pending = null;
    fn(...args);
  };
  const call = (...args) => {
    pending = args;
    const wait = last + ms - Date.now();
    if (wait <= 0 && !timer) fire();
    else timer ??= setTimeout(fire, Math.max(0, wait));
  };
  call.cancel = () => {
    clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return call;
}

// JSON with everything above "~" escaped: its length is its size in bytes, and it can be
// cut anywhere.
export function asciiJson(value) {
  return JSON.stringify(value).replace(
    /[^\x00-\x7e]/g,
    (c) => BACKSLASH + "u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

export function toFrames(text, frame = DEFAULT_FRAME) {
  if (text.length <= frame) return [text];
  const id = randomString(8, CODE_ALPHABET);
  const size = frame - FRAME_HEAD;
  const n = Math.ceil(text.length / size);
  const out = [];
  for (let i = 0; i < n; i++)
    out.push(`~${id}.${i}.${n}~${text.slice(i * size, (i + 1) * size)}`);
  return out;
}

export class RoomError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Connect to a room. Returns at once; `ready` resolves with the first state.
 * options: url (wss://...), room (code), member (id), name?, me? (initial fields),
 * WebSocket? (constructor), pingMs? (240000), backoff? ([500, 15000] ms), retries? (20),
 * answerMs? (10000: a set with no answer by then reconnects to find out).
 */
export function connect(options) {
  return new Room(options);
}

export class Room {
  constructor({
    url,
    room,
    member,
    name,
    me,
    WebSocket: WS = globalThis.WebSocket,
    pingMs = 240_000,
    backoff = [500, 15_000],
    retries = 20,
    answerMs = 10_000,
  }) {
    if (!ROOM_CODE.test(room))
      throw new RoomError("bad-room", "That is not a room code.");
    this.url = url;
    this.code = room;
    this.you = member;
    this.WS = WS;
    this.pingMs = pingMs;
    this.backoff = backoff;
    this.retries = retries;
    this.answerMs = answerMs;

    this.status = "connecting"; // connecting | open | reconnecting | closed | replaced
    this.host = null;
    this.members = []; // [{ id, connected, joined, since, me }] in joined order
    this.v = 0;
    this.doc = null;
    this.by = null;
    this.limits = { frame: DEFAULT_FRAME };
    this.me = { ...(me ?? {}), ...(name === undefined ? {} : { name }) };

    this._listeners = new Map();
    this._byId = new Map();
    this._rev = new Map(); // member id -> room rev of the last event applied for them
    this._hostRev = 0;
    this._parts = new Map();
    this._waiting = new Map(); // set id -> { resolve, reject, base, sent }
    this._seq = 0;
    this._queue = Promise.resolve();
    this._joinedOnce = false;
    this._attempt = 0;
    this._closed = false;
    this._socket = null;
    this._joined = false;
    this._afterJoin = [];

    this.ready = new Promise((resolve, reject) => {
      this._ready = { resolve, reject };
    });
    this.ready.catch(() => {});
    this._open();
  }

  // ---- events ------------------------------------------------------------------------

  on(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    this._listeners.get(type)?.delete(fn);
  }

  _emit(type, detail) {
    for (const fn of this._listeners.get(type) ?? []) {
      try {
        fn(detail);
      } catch (error) {
        console.error(error);
      }
    }
  }

  _setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    this._emit("status", { status });
  }

  // ---- the socket --------------------------------------------------------------------

  _open() {
    if (this._closed) return;
    this._setStatus(this._joinedOnce ? "reconnecting" : "connecting");
    let ws;
    try {
      ws = new this.WS(this.url);
    } catch {
      this._retry();
      return;
    }
    this._socket = ws;
    this._joined = false;
    ws.onopen = () => {
      this._sendNow({
        t: "join",
        room: this.code,
        member: this.you,
        me: this.me,
        v: this.v || undefined,
      });
    };
    ws.onmessage = (event) => {
      if (ws !== this._socket) return;
      if (typeof event.data === "string") this._frame(event.data);
    };
    ws.onclose = () => {
      if (ws !== this._socket) return;
      this._socket = null;
      this._joined = false;
      clearInterval(this._pinger);
      clearTimeout(this._pongTimer);
      this._parts.clear();
      // A set whose answer never came may or may not have landed: settled at the next join.
      for (const w of this._waiting.values()) w.lost = true;
      if (this._closed || this.status === "replaced") return;
      this._retry();
    };
    ws.onerror = () => {};
  }

  _retry() {
    if (this._closed) return;
    this._setStatus(this._joinedOnce ? "reconnecting" : "connecting");
    const [min, max] = this.backoff;
    const delay =
      Math.min(max, min * 2 ** this._attempt) * (0.75 + Math.random() * 0.5);
    this._attempt++;
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => this._open(), delay);
  }

  _sendNow(value) {
    const ws = this._socket;
    if (!ws || ws.readyState !== 1) return false;
    for (const frame of toFrames(
      asciiJson(value),
      this.limits.frame ?? DEFAULT_FRAME,
    ))
      ws.send(frame);
    return true;
  }

  _whenJoined() {
    if (this._joined) return Promise.resolve();
    if (this._closed)
      return Promise.reject(new RoomError("closed", "The room is closed."));
    return new Promise((resolve, reject) =>
      this._afterJoin.push({ resolve, reject }),
    );
  }

  _frame(text) {
    if (text.startsWith("~")) {
      const head = PART.exec(text);
      if (!head) return;
      const [, id, i, n] = head;
      const got = this._parts.get(id) ?? [];
      got[Number(i)] = text.slice(head[0].length);
      this._parts.set(id, got);
      if (got.filter((x) => x !== undefined).length < Number(n)) return;
      this._parts.delete(id);
      text = got.join("");
    }
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    this._message(msg);
  }

  _ping() {
    clearInterval(this._pinger);
    this._pinger = setInterval(() => {
      if (!this._sendNow({ t: "ping" })) return;
      clearTimeout(this._pongTimer);
      // No answer in 15 s: the socket is dead even if the browser has not noticed.
      const ws = this._socket;
      this._pongTimer = setTimeout(() => ws?.close(), 15_000);
    }, this.pingMs);
  }

  // ---- what the server says ----------------------------------------------------------

  _message(msg) {
    switch (msg.t) {
      case "joined":
        return this._onJoined(msg);
      case "member":
        return this._onMember(msg);
      case "left":
        return this._onLeft(msg);
      case "host":
        if (msg.rev > this._hostRev) {
          this._hostRev = msg.rev;
          this.host = msg.host;
          this._emit("host", { host: msg.host });
        }
        return;
      case "doc":
        return this._adopt(msg.v, msg.doc, msg.by, {
          with: msg.with,
          mine: false,
        });
      case "ok":
        return this._onOk(msg);
      case "no":
        return this._onNo(msg);
      case "cast":
        return this._emit("cast", { from: msg.from, d: msg.d });
      case "pong":
        clearTimeout(this._pongTimer);
        return;
      case "error":
        return this._onError(msg);
    }
  }

  _onJoined(msg) {
    this._attempt = 0;
    this.limits = { ...this.limits, ...msg.limits };
    this.host = msg.host;
    this._hostRev = msg.rev;
    this._byId.clear();
    this._rev.clear();
    for (const m of msg.members) {
      this._byId.set(m.id, m);
      this._rev.set(m.id, msg.rev);
    }
    this._sortMembers();
    if ("doc" in msg)
      this._adopt(msg.v, msg.doc, msg.by, {
        mine: false,
        force: true,
        quiet: true,
      });

    // Settle sets whose answer was lost with the old socket.
    for (const [id, w] of this._waiting) {
      if (!w.lost) continue;
      this._waiting.delete(id);
      if (msg.sid === String(id) && msg.by === this.you)
        w.resolve({ v: msg.v, landed: true });
      else if (msg.v === w.base)
        w.resolve({ v: msg.v, landed: false, again: true });
      else
        w.reject(
          new RoomError(
            "uncertain",
            "The connection dropped before the room answered.",
          ),
        );
    }

    this._joined = true;
    this._joinedOnce = true;
    this._setStatus("open");
    this._ping();
    const state = this.state();
    this._emit("state", state);
    this._emit("members", { members: this.members });
    if ("doc" in msg)
      this._emit("doc", { v: this.v, doc: this.doc, by: this.by, mine: false });
    this._ready.resolve(state);
    for (const w of this._afterJoin.splice(0)) w.resolve();
  }

  _sortMembers() {
    this.members = [...this._byId.values()].sort((a, b) => a.joined - b.joined);
  }

  _onMember(msg) {
    const id = msg.member.id;
    if ((this._rev.get(id) ?? 0) >= msg.rev) return;
    this._rev.set(id, msg.rev);
    const before = this._byId.get(id);
    this._byId.set(id, msg.member);
    this._sortMembers();
    this._emit("member", {
      member: msg.member,
      isNew: !before,
      was: before ?? null,
    });
    this._emit("members", { members: this.members });
  }

  _onLeft(msg) {
    if ((this._rev.get(msg.id) ?? 0) >= msg.rev) return;
    this._rev.set(msg.id, msg.rev);
    if (!this._byId.delete(msg.id)) return;
    this._sortMembers();
    this._emit("left", { id: msg.id });
    this._emit("members", { members: this.members });
  }

  _adopt(v, doc, by, { with: w, mine, force = false, quiet = false }) {
    if (!force && v <= this.v) return;
    this.v = v;
    this.doc = doc ?? null;
    this.by = by ?? null;
    if (!quiet)
      this._emit("doc", { v, doc: this.doc, by: this.by, with: w, mine });
  }

  _onOk(msg) {
    const w = this._waiting.get(msg.id);
    if (!w) return;
    this._waiting.delete(msg.id);
    this._adopt(msg.v, w.doc, this.you, { with: w.with, mine: true });
    w.resolve({ v: msg.v, landed: true });
  }

  _onNo(msg) {
    this._adopt(msg.v, msg.doc, msg.by, { mine: false });
    const w = this._waiting.get(msg.id);
    if (!w) return;
    this._waiting.delete(msg.id);
    w.resolve({ v: msg.v, landed: false, again: true });
  }

  _onError(msg) {
    const error = new RoomError(msg.code, msg.message, { re: msg.re });
    if (msg.code === "replaced") {
      // This member opened the room somewhere else; that one wins. Do not fight it.
      this._setStatus("replaced");
      this._closed = true;
      this._failAll(error);
    } else if (msg.re === "join" && msg.code === "busy") {
      this._socket?.close(); // try again after the backoff
    } else if (msg.re === "join") {
      // full, bad-room, bad-member: trying again will not help.
      this._ready.reject(error);
      this._closed = true;
      this._socket?.close();
      this._failAll(error);
      this._setStatus("closed");
    } else if (msg.re === "set" && this._waiting.has(msg.id)) {
      const w = this._waiting.get(msg.id);
      this._waiting.delete(msg.id);
      w.reject(error);
      return;
    }
    this._emit("error", error);
  }

  _failAll(error) {
    for (const w of this._waiting.values()) w.reject(error);
    this._waiting.clear();
    for (const w of this._afterJoin.splice(0)) w.reject(error);
  }

  // ---- what the app does -------------------------------------------------------------

  /** A snapshot: { room, you, host, members, v, doc, by, status, limits }. */
  state() {
    return {
      room: this.code,
      you: this.you,
      host: this.host,
      members: this.members,
      v: this.v,
      doc: this.doc,
      by: this.by,
      status: this.status,
      limits: this.limits,
    };
  }

  isHost() {
    return this.host === this.you;
  }

  /** Merge fields into this member's own (null removes one). Kept across reconnects. */
  setMe(fields) {
    for (const [k, value] of Object.entries(fields)) {
      if (value === null) delete this.me[k];
      else this.me[k] = value;
    }
    if (this._joined) this._sendNow({ t: "me", me: fields });
  }

  /**
   * Change the shared document: `fn(doc)` gets a copy of the current document and returns
   * the new one (or undefined to change nothing). When another member wrote first, fn runs
   * again on theirs. Updates from this client run one at a time, in call order.
   * Resolves { v, doc } once the room has it, or null when fn changed nothing.
   */
  update(fn, { with: rider } = {}) {
    const run = this._queue.then(() => this._update(fn, rider));
    this._queue = run.catch(() => {});
    return run;
  }

  async _update(fn, rider) {
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      await this._whenJoined();
      const base = this.v;
      const doc = fn(this.doc === null ? null : structuredClone(this.doc));
      if (doc === undefined) return null;
      const result = await this._set(base, doc, rider);
      if (result.landed) return { v: result.v, doc };
      if (attempt >= 2)
        await new Promise((r) => setTimeout(r, Math.random() * 50 * attempt));
    }
    throw new RoomError(
      "busy",
      "Could not update the room: too many others writing.",
    );
  }

  /** One compare-and-set: resolves { v, landed, again }. Most code wants update(). */
  _set(base, doc, rider) {
    const id = ++this._seq;
    return new Promise((resolve, reject) => {
      // No answer at all (API Gateway drops throttled messages without a word): reconnect,
      // and the join settles whether the set landed.
      const timer = setTimeout(() => {
        if (this._waiting.get(id)?.lost === false) this._socket?.close();
      }, this.answerMs);
      const done = (fn) => (value) => {
        clearTimeout(timer);
        fn(value);
      };
      this._waiting.set(id, {
        resolve: done(resolve),
        reject: done(reject),
        base,
        doc,
        with: rider,
        lost: false,
      });
      const msg = { t: "set", id, base, doc };
      if (rider !== undefined) msg.with = rider;
      if (!this._sendNow(msg)) this._waiting.get(id).lost = true;
    });
  }

  /** Relay `d` to everyone else in the room, now. Dropped while not connected. */
  cast(d) {
    if (!this._joined) return false;
    return this._sendNow({ t: "cast", d });
  }

  /** A cast function that sends at most once every `ms` (the latest value wins). */
  caster(ms = 150) {
    return throttle((d) => this.cast(d), ms);
  }

  /**
   * Keep a finished match's replay a year (docs/ROOMS.md section 10): `replay` is the
   * game's (src/net/lobby.js replayOf), opaque to the room, which keeps it beside the
   * document and keeps the room and its document as long. `v` is the document version
   * the match ended at. Once a version (saying it again changes nothing). False while
   * not connected.
   */
  keep(replay, v) {
    return this._joined && this._sendNow({ t: "keep", v, replay });
  }

  /**
   * The host lists the room under OPEN GAMES, or takes it off (null): `open` is
   * { players, seats, state } (docs/ROOMS.md section 9). Sent again from time to time
   * while open, or the listing expires. False while not connected.
   */
  setOpen(open) {
    return this._joined && this._sendNow({ t: "open", open: open ?? null });
  }

  /** Take over as host when the host is gone (see docs/ROOMS.md). */
  claimHost() {
    return this._joined && this._sendNow({ t: "claim" });
  }

  /** Leave the room for good (forgets this member there) and close. */
  leave() {
    if (this._joined) this._sendNow({ t: "leave" });
    this.close();
  }

  /** Close the connection without leaving: the member shows as disconnected. */
  close() {
    this._closed = true;
    clearTimeout(this._retryTimer);
    clearInterval(this._pinger);
    clearTimeout(this._pongTimer);
    this._socket?.close();
    this._socket = null;
    this._joined = false;
    this._failAll(new RoomError("closed", "The room is closed."));
    this._setStatus("closed");
  }
}
