// The room server: who is in a room and connected, a few fields each member sets about
// themselves, ONE shared JSON document with a version (compare-and-set), and a relay for
// short-lived messages. It knows no Kubb. The wire protocol is docs/ROOMS.md.
//
// Everything here runs over two injected adapters, so the same code is the AWS Lambda
// (handler.mjs: DynamoDB + API Gateway) and the local server (tools/rooms-dev.mjs: memory + ws):
//
//   store  getRoom(code) -> room | null          room = { rev, host, members, exp }
//          putRoom(code, room, prevRev) -> bool   false when the stored rev is not prevRev
//          getDoc(code) -> { v, doc, by, sid, exp } | null     doc is JSON text
//          putDoc(code, doc, base) -> bool        false when the stored v is not base
//          touchDoc(code, exp)                    moves the document's expiry (no-op when absent)
//          putConn(conn, who) / getConn(conn) -> { room, member, exp } | null / delConn(conn)
//          addChunk(conn, id, i, n, text, exp) -> whole text once, when the last part lands
//   send(conn, text) -> false when the connection is gone for good
//   close(conn)      -> closes a connection (used when a member connects a second time)
//   record(entry)    -> optional: keeps a committed document version for good
//                       (recorder.mjs). entry = { room, v, t, by, doc, with }; doc and with
//                       are JSON text (with: null when there was none). It may fail: the
//                       failure is logged and the room carries on.
//
// Invocations for one room run in parallel (one Lambda per message), so nothing here holds
// state between calls except the cast rate buckets, which are only ever a best effort.

export const LIMITS = Object.freeze({
  members: 16, // members in a room
  docBytes: 256 * 1024, // the shared document, as ASCII JSON
  withBytes: 4 * 1024, // the payload that rides along with a `set`
  castBytes: 2 * 1024, // a whole `cast` message
  meBytes: 512, // a member's own fields, as ASCII JSON
  frame: 30_000, // the longest frame either way (API Gateway: 32 KB a frame)
  parts: 16, // the most frames one message may be split into
  messageBytes: 300 * 1024, // a whole reassembled message
  castRate: 10, // casts a second for one connection ...
  castBurst: 20, // ... after a burst of this many
  hostGraceMs: 15_000, // how long the host must be away before host can be claimed
  roomTtl: 48 * 3600, // seconds a room and its document outlive their last write
  connTtl: 3 * 3600, // seconds a connection record lives (connections last 2 hours)
  partTtl: 600, // seconds an unfinished upload is kept
});

// Room codes are made by the client: 8 to 24 characters with no 0, 1, i, l or o.
export const ROOM_CODE = /^[2-9a-hjkmnp-z]{8,24}$/;
export const MEMBER_ID = /^[A-Za-z0-9_-]{8,40}$/;

const FRAME_HEAD = 40; // room for "~<id>.<i>.<n>~" in front of a part
const PART = /^~([a-z0-9]{1,16})\.(\d{1,3})\.(\d{1,3})~/;
const BACKSLASH = String.fromCharCode(92);

// JSON with every character above "~" written as a backslash-u escape: the text is pure
// ASCII, so its length is its size in bytes and it can be cut anywhere.
export function asciiJson(value) {
  return JSON.stringify(value).replace(
    /[^\x00-\x7e]/g,
    (c) => BACKSLASH + "u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

// One message as the frames that carry it: itself when it fits, else "~id.i.n~<slice>" parts.
export function toFrames(text, frame = LIMITS.frame, id = randomId()) {
  if (text.length <= frame) return [text];
  const size = frame - FRAME_HEAD;
  const n = Math.ceil(text.length / size);
  const frames = [];
  for (let i = 0; i < n; i++)
    frames.push(`~${id}.${i}.${n}~${text.slice(i * size, (i + 1) * size)}`);
  return frames;
}

export function randomId() {
  return Math.random().toString(36).slice(2, 10) || "x";
}

// The connect filter. `allowed` is a list of origins; an entry without a port matches any
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

// `extra` is fields that ride on the error reply (the `set` id, `re`).
export class RoomError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

const isObject = (x) =>
  x !== null && typeof x === "object" && !Array.isArray(x);

export function createRooms({
  store,
  send,
  close = async () => {},
  record = null,
  now = Date.now,
  limits = LIMITS,
}) {
  const buckets = new Map(); // conn -> { tokens, t, warned }

  const expiry = (seconds) => Math.floor(now() / 1000) + seconds;

  const publicLimits = {
    members: limits.members,
    docBytes: limits.docBytes,
    withBytes: limits.withBytes,
    castBytes: limits.castBytes,
    meBytes: limits.meBytes,
    frame: limits.frame,
    castRate: limits.castRate,
    castBurst: limits.castBurst,
    hostGraceMs: limits.hostGraceMs,
  };

  const view = (id, m) => ({
    id,
    connected: Boolean(m.conn),
    joined: m.joined,
    since: m.since,
    me: m.me,
  });
  const viewAll = (room) =>
    Object.entries(room.members)
      .map(([id, m]) => view(id, m))
      .sort((a, b) => a.joined - b.joined);

  async function sendFrames(conn, frames) {
    for (const frame of frames) {
      if ((await send(conn, frame)) === false) return false;
    }
    return true;
  }

  const post = (conn, text) => sendFrames(conn, toFrames(text, limits.frame));
  const postError = (conn, code, message, extra = {}) =>
    post(conn, asciiJson({ t: "error", code, message, ...extra }));

  // To every connected member but `except`. The text is cut into frames once.
  async function broadcast(code, room, text, except = null, cascade = true) {
    const frames = toFrames(text, limits.frame);
    const gone = [];
    await Promise.all(
      Object.entries(room.members).map(async ([id, m]) => {
        if (!m.conn || m.conn === except) return;
        if (!(await sendFrames(m.conn, frames))) gone.push([id, m.conn]);
      }),
    );
    if (cascade)
      for (const [id, conn] of gone) await dropped(code, id, conn, false);
  }

  // Read, change, write back if nobody else wrote in between; else again. `change` gets a
  // private copy (null when there is no room) and returns { room, ...more }; a null room
  // means there is nothing to write.
  async function mutate(code, change) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await store.getRoom(code);
      const out = change(current ? structuredClone(current) : null);
      if (!out.room) return out;
      const prev = current ? current.rev : 0;
      out.room.rev = prev + 1;
      out.room.exp = expiry(limits.roomTtl);
      if (await store.putRoom(code, out.room, prev)) return out;
    }
    throw new RoomError("busy", "The room is busy. Try again.");
  }

  // A connection went away (a $disconnect, or a send that came back Gone).
  async function dropped(code, member, conn, cascade = true) {
    buckets.delete(conn);
    await store.delConn(conn);
    const { room } = await mutate(code, (room) => {
      const m = room?.members[member];
      if (!m || m.conn !== conn) return { room: null }; // already reconnected, or gone
      m.conn = null;
      m.since = now();
      return { room };
    });
    if (room) {
      const text = asciiJson({
        t: "member",
        rev: room.rev,
        member: view(member, room.members[member]),
      });
      await broadcast(code, room, text, null, cascade);
    }
  }

  function mergeMe(me, fields) {
    if (fields === undefined) return me;
    if (!isObject(fields))
      throw new RoomError("bad-message", "`me` must be an object.");
    const next = { ...me };
    for (const [key, value] of Object.entries(fields)) {
      if (value === null) delete next[key];
      else next[key] = value;
    }
    if (asciiJson(next).length > limits.meBytes) {
      throw new RoomError(
        "too-big",
        `A member's fields are limited to ${limits.meBytes} bytes.`,
      );
    }
    return next;
  }

  async function join(conn, msg) {
    const code = msg.room;
    const member = msg.member;
    if (typeof code !== "string" || !ROOM_CODE.test(code))
      throw new RoomError("bad-room", "That is not a room code.");
    if (typeof member !== "string" || !MEMBER_ID.test(member)) {
      throw new RoomError("bad-member", "That is not a member id.");
    }
    const fields =
      msg.me ?? (typeof msg.name === "string" ? { name: msg.name } : undefined);

    const who = await store.getConn(conn);
    if (who && (who.room !== code || who.member !== member)) {
      throw new RoomError(
        "already-joined",
        "This connection is already in a room.",
      );
    }

    const t = now();
    const { room, old, evicted, isNew } = await mutate(code, (room) => {
      room ??= { rev: 0, host: member, members: {} };
      let m = room.members[member];
      let evicted = null;
      const isNew = !m;
      if (!m) {
        const all = Object.entries(room.members);
        if (all.length >= limits.members) {
          // Full: the member who has been away longest gives up their place.
          const away = all
            .filter(([id, x]) => !x.conn && id !== room.host)
            .sort((a, b) => a[1].since - b[1].since)[0];
          if (!away)
            throw new RoomError(
              "full",
              `This room is full (${limits.members}).`,
            );
          evicted = away[0];
          delete room.members[evicted];
        }
        const last = Math.max(
          0,
          ...Object.values(room.members).map((x) => x.joined),
        );
        m = room.members[member] = {
          joined: Math.max(t, last + 1),
          since: t,
          conn: null,
          me: {},
        };
      }
      const old = m.conn;
      m.me = mergeMe(m.me, fields);
      m.conn = conn;
      m.since = t;
      return { room, old, evicted, isNew };
    });
    // The document is read AFTER this member is written into the room, and a `set` reads the
    // room AFTER it writes the document, so a joiner either gets the new document here or is
    // in the room that `set` broadcasts to. Never neither.
    const stored = await store.getDoc(code);
    if (stored && stored.exp < room.exp - 3600)
      await store.touchDoc(code, room.exp);
    await store.putConn(conn, {
      room: code,
      member,
      exp: expiry(limits.connTtl),
    });

    if (old && old !== conn) {
      // The same member on a second connection replaces the first.
      await store.delConn(old);
      buckets.delete(old);
      await postError(old, "replaced", "This member connected somewhere else.");
      await close(old);
    }

    const doc = stored ?? { v: 0, doc: "null", by: null, sid: null };
    const head = asciiJson({
      t: "joined",
      room: code,
      you: member,
      host: room.host,
      rev: room.rev,
      members: viewAll(room),
      v: doc.v,
      by: doc.by,
      sid: doc.sid,
      now: t,
      limits: publicLimits,
    });
    // A client that already holds this version says so and is not sent the document again.
    const same = msg.v === doc.v && doc.v > 0;
    await post(conn, same ? head : `${head.slice(0, -1)},"doc":${doc.doc}}`);

    if (evicted)
      await broadcast(
        code,
        room,
        asciiJson({ t: "left", id: evicted, rev: room.rev }),
        conn,
      );
    const text = asciiJson({
      t: "member",
      rev: room.rev,
      member: view(member, room.members[member]),
      isNew,
    });
    await broadcast(code, room, text, conn);
  }

  async function setMe(conn, who, msg) {
    const { room } = await mutate(who.room, (room) => {
      const m = member(room, who, conn);
      m.me = mergeMe(m.me, msg.me ?? {});
      return { room };
    });
    const text = asciiJson({
      t: "member",
      rev: room.rev,
      member: view(who.member, room.members[who.member]),
    });
    await broadcast(who.room, room, text);
  }

  // A recorder that fails must never cost a room its move.
  async function keep(entry) {
    try {
      await record(entry);
    } catch (error) {
      console.error("record failed", error?.name, error?.message);
    }
  }

  // The member a connection speaks for. A connection that has been replaced by the same
  // member's newer one no longer speaks for anybody.
  function member(room, who, conn) {
    const m = room?.members[who.member];
    if (!m || m.conn !== conn)
      throw new RoomError("not-joined", "Join the room first.");
    return m;
  }

  async function setDoc(conn, who, msg) {
    const id = msg.id ?? null;
    const base = msg.base;
    if (!Number.isSafeInteger(base) || base < 0)
      throw new RoomError("bad-message", "`base` must be a version.", { id });
    if (msg.doc === undefined)
      throw new RoomError("bad-message", "`doc` is missing.", { id });
    const doc = asciiJson(msg.doc);
    if (doc.length > limits.docBytes) {
      throw new RoomError(
        "too-big",
        `The document is limited to ${limits.docBytes} bytes.`,
        { id },
      );
    }
    const rider = msg.with === undefined ? null : asciiJson(msg.with);
    if (rider && rider.length > limits.withBytes) {
      throw new RoomError(
        "too-big",
        `\`with\` is limited to ${limits.withBytes} bytes.`,
        { id },
      );
    }
    member(await store.getRoom(who.room), who, conn);

    const v = base + 1;
    const next = {
      v,
      doc,
      by: who.member,
      sid: id === null ? null : String(id),
      exp: expiry(limits.roomTtl),
    };
    if (await store.putDoc(who.room, next, base)) {
      const room = await store.getRoom(who.room); // read after the write: see join
      const withPart = rider ? `,"with":${rider}` : "";
      const text = `{"t":"doc","v":${v},"by":${asciiJson(who.member)}${withPart},"doc":${doc}}`;
      await Promise.all([
        post(conn, asciiJson({ t: "ok", id, v })),
        room ? broadcast(who.room, room, text, conn) : null,
        record
          ? keep({
              room: who.room,
              v,
              t: now(),
              by: who.member,
              doc,
              with: rider,
            })
          : null,
      ]);
    } else {
      const cur = (await store.getDoc(who.room)) ?? {
        v: 0,
        doc: "null",
        by: null,
        sid: null,
      };
      const head = asciiJson({
        t: "no",
        id,
        v: cur.v,
        by: cur.by,
        sid: cur.sid,
      });
      await post(conn, `${head.slice(0, -1)},"doc":${cur.doc}}`);
    }
  }

  function castAllowed(conn) {
    const t = now();
    if (buckets.size > 5000) buckets.clear();
    const b = buckets.get(conn) ?? {
      tokens: limits.castBurst,
      t,
      warned: false,
    };
    b.tokens = Math.min(
      limits.castBurst,
      b.tokens + ((t - b.t) / 1000) * limits.castRate,
    );
    b.t = t;
    buckets.set(conn, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    b.warned = false;
    return true;
  }

  async function cast(conn, who, msg, bytes) {
    if (bytes > limits.castBytes)
      throw new RoomError(
        "too-big",
        `A cast is limited to ${limits.castBytes} bytes.`,
      );
    if (!castAllowed(conn)) {
      // Dropped. Say so once, not once a message.
      const b = buckets.get(conn);
      if (!b.warned) {
        b.warned = true;
        await postError(conn, "rate", "Too many casts. Slow down.", {
          re: "cast",
        });
      }
      return;
    }
    const room = await store.getRoom(who.room);
    member(room, who, conn);
    const text = `{"t":"cast","from":${asciiJson(who.member)},"d":${asciiJson(msg.d ?? null)}}`;
    await broadcast(who.room, room, text, conn);
  }

  // The host is the member who made the room. When the host is gone (left, or away longer
  // than the grace), the earliest joined connected member may take over.
  async function claim(conn, who) {
    const t = now();
    const { room } = await mutate(who.room, (room) => {
      member(room, who, conn);
      if (room.host === who.member) return { room: null };
      const host = room.members[room.host];
      if (host?.conn)
        throw new RoomError("host-present", "The host is here.", {
          re: "claim",
        });
      if (host && t - host.since < limits.hostGraceMs) {
        throw new RoomError(
          "host-recent",
          "The host only just left. Try again shortly.",
          { re: "claim" },
        );
      }
      const first = viewAll(room).find((m) => m.connected);
      if (!first || first.id !== who.member) {
        throw new RoomError(
          "not-next",
          "Another member is first in line for host.",
          { re: "claim" },
        );
      }
      room.host = who.member;
      return { room };
    });
    if (room)
      await broadcast(
        who.room,
        room,
        asciiJson({ t: "host", host: room.host, rev: room.rev }),
      );
  }

  async function leave(conn, who) {
    buckets.delete(conn);
    await store.delConn(conn);
    const { room } = await mutate(who.room, (room) => {
      if (room?.members[who.member]?.conn !== conn) return { room: null };
      delete room.members[who.member];
      return { room };
    });
    if (room)
      await broadcast(
        who.room,
        room,
        asciiJson({ t: "left", id: who.member, rev: room.rev }),
      );
  }

  async function handle(conn, text) {
    const bytes = Buffer.byteLength(text);
    if (bytes > limits.messageBytes)
      throw new RoomError("too-big", "That message is too big.");
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      throw new RoomError("bad-message", "Messages are JSON.");
    }
    if (!isObject(msg) || typeof msg.t !== "string")
      throw new RoomError("bad-message", "Messages are { t, ... }.");

    if (msg.t === "ping")
      return void (await post(conn, asciiJson({ t: "pong", now: now() })));
    try {
      if (msg.t === "join") return await join(conn, msg);
      const who = await store.getConn(conn);
      if (!who) throw new RoomError("not-joined", "Join the room first.");
      switch (msg.t) {
        case "me":
          return await setMe(conn, who, msg);
        case "set":
          return await setDoc(conn, who, msg);
        case "cast":
          return await cast(conn, who, msg, bytes);
        case "claim":
          return await claim(conn, who);
        case "leave":
          return await leave(conn, who);
        default:
          throw new RoomError(
            "bad-message",
            `Unknown message "${msg.t.slice(0, 20)}".`,
          );
      }
    } catch (error) {
      if (error instanceof RoomError)
        error.extra = { re: msg.t, ...error.extra };
      throw error;
    }
  }

  // One frame from a connection: a whole message, or one part of a split one.
  async function message(conn, frame) {
    try {
      if (typeof frame !== "string")
        throw new RoomError("bad-message", "Messages are text.");
      if (frame.startsWith("~")) {
        const head = PART.exec(frame);
        const i = head ? Number(head[2]) : -1;
        const n = head ? Number(head[3]) : 0;
        if (
          !head ||
          n < 2 ||
          n > limits.parts ||
          i >= n ||
          frame.length > limits.frame
        ) {
          throw new RoomError("bad-message", "That is not a message part.");
        }
        const text = await store.addChunk(
          conn,
          head[1],
          i,
          n,
          frame.slice(head[0].length),
          expiry(limits.partTtl),
        );
        if (text === null) return;
        frame = text;
      }
      await handle(conn, frame);
    } catch (error) {
      if (!(error instanceof RoomError)) throw error;
      await postError(conn, error.code, error.message, error.extra);
    }
  }

  async function disconnect(conn) {
    const who = await store.getConn(conn);
    buckets.delete(conn);
    if (who) await dropped(who.room, who.member, conn);
  }

  return { message, disconnect, limits };
}
