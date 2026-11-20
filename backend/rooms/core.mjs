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
//   report(entry)    -> optional: keeps a player's report for good (reports.mjs).
//                       entry = { t, report }; report is JSON text. Without it a `report`
//                       message is answered `unavailable`.
//   recordGame(entry) -> optional: keeps a match played in one browser (solo, watching
//                       the computer) for good (recorder.mjs). entry = { t, game }; game
//                       is JSON text. Without it a `game` message is answered `unavailable`.
//
// Replays (docs/ROOMS.md section 10) use two more; a store without them keeps none:
//   putReplay(code, { v, t, data, exp }) kept only when no unexpired replay of this room
//                       has this v or a later one; data is JSON text
//   getReplay(code) -> { v, t, data, exp } | null
//
// Highlight reels (docs/ROOMS.md section 12) use four more; a store without them
// answers every `reel` with `reel: null`:
//   getReel(code) -> { v, tag, job, state, at, tries, tall?, wide?, edit?, seconds?,
//                       why?, exp } | null
//   putReel(code, { v, tag, job, at, exp }, { staleBefore }) -> bool   the request that
//                       may start this render: true only when there is no reel item, or
//                       it is for an earlier version or another tag, or it is this very
//                       render still "rendering" from before staleBefore (epoch ms)
//   dropReel(code, job)  undoes putReel when the renderer could not be asked
//   countReel(day, cap, exp) -> bool   one more render today, false once cap is reached
// and one more adapter, `startReel({ room, v, tag })`, which asks the renderer (on AWS
// an asynchronous Lambda invoke); without it reels are `unavailable`.
//
// The open games list (docs/ROOMS.md section 9) uses three more store methods; a store
// without them lists nothing:
//   putListing(code, entry)  entry = { made, rev, listed, players?, seats?, state?, exp },
//                       kept only when no entry for (code, made) has this rev or a later
//                       one; listed false takes the game off (until it expires)
//   listOpen({ since, limit, now }) -> [{ room, made, players, seats, state }], newest
//                       first, made at or after `since`, unexpired
//
// Invocations for one room run in parallel (one Lambda per message), so nothing here holds
// state between calls except the cast rate buckets, which are only ever a best effort.

import { REEL_TRIES, majorMinor, reelJob, reelTag } from "../reels/tag.mjs";

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
  keepTtl: 365 * 24 * 3600, // seconds a kept room (a finished match: `keep`) lives on
  replayBytes: 256 * 1024, // a kept replay, as ASCII JSON
  connTtl: 3 * 3600, // seconds a connection record lives (connections last 2 hours)
  partTtl: 600, // seconds an unfinished upload is kept
  reportBytes: 64 * 1024, // a whole `report` message, as ASCII JSON
  reportChars: 1000, // each of a throw report's two typed answers, in characters
  feedbackChars: 2000, // a feedback report's one text, in characters after trimming
  reportsPerConn: 3, // reports one connection may send
  gameBytes: 256 * 1024, // a whole `game` message (a match played in one browser)
  gameActions: 4000, // the actions one such match may carry
  gamesPerConn: 3, // `game` messages one connection may send
  listMax: 20, // open games a `list` answers with, newest first
  listRead: 60, // listing entries one `list` reads, at most
  listTtl: 15 * 60, // seconds an open game stays listed after its room last changed
  listAgeMs: 24 * 3600 * 1000, // an open game made longer ago than this is not listed
  seatsMax: 16, // the most seats an open game may say it has
  reelsPerConn: 3, // highlight reels one connection may start (asking how one stands is free)
  reelsPerDay: 200, // highlight reels rendered a day, all pitches together (UTC days)
  reelStaleMs: 25 * 60 * 1000, // a render "rendering" this long died without a word
  reelCountTtl: 3 * 24 * 3600, // seconds a day's render counter is kept
});

// An open game's listing entry's sort key: when it was made (epoch ms, 13 digits), then
// the room, so the newest sort last and one Query reads them newest first.
export const listingKey = (code, made) =>
  `${String(made).padStart(13, "0")}#${code}`;

// What a recorded one-browser match says it was (src/net/record.js).
export const GAME_MODES = Object.freeze(["solo", "watch"]);

// What the host of an open game says it is doing (src/net/pitch.js). Only waiting and
// playing games are listed.
export const OPEN_STATES = Object.freeze(["waiting", "playing", "over"]);

// What a report says it came from (src/net/report.js).
export const REPORT_MODES = Object.freeze([
  "practice",
  "solo",
  "watch",
  "pitch",
]);

// What a report is about: a throw that looked wrong (its two answers, `happened` and
// `should`), or anything else (one `text`). A report with no `kind` is a throw report:
// clients built before feedback (the iPhone app's current builds) send none.
export const REPORT_KINDS = Object.freeze(["throw", "feedback"]);

// Room codes are made by the client: 8 to 24 characters with no 0, 1, i, l or o.
export const ROOM_CODE = /^[2-9a-hjkmnp-z]{8,24}$/;
export const MEMBER_ID = /^[A-Za-z0-9_-]{8,40}$/;

// What made a one-browser match or a report, both optional (clients built before them
// send neither): `client` the program ("web", "ios"), `engine` the game engine's version.
// A room match's `with` rider may carry the same as `c` and `e`; the server stores the
// rider as it came and checks none of it (docs/ROOMS.md section 7).
export const CLIENT_TAG = /^[a-z0-9.-]{1,32}$/;
export const ENGINE_TAG = /^[a-z0-9.+-]{1,64}$/;

// Throws a RoomError (bad-message) when `x.client` or `x.engine` is present and not a tag.
function checkTags(x, fail) {
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

// A `report` message checked: { t: "report", id?, r: { kind?, mode, ..., client?, engine?, ... } }.
// A throw report (`kind` "throw" or absent) carries `happened` and `should`; a feedback
// report (`kind` "feedback") carries `text` and neither answer. `bytes` is the message's
// size. Throws a RoomError, or returns the report object to keep, with its `kind` set.
export function checkReport(msg, bytes, limits = LIMITS) {
  const id = msg.id ?? null;
  const fail = (code, message) => {
    throw new RoomError(code, message, { id });
  };
  if (bytes > limits.reportBytes)
    fail("too-big", `A report is limited to ${limits.reportBytes} bytes.`);
  const r = msg.r;
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
  if (r.room !== undefined && r.room !== null)
    if (typeof r.room !== "string" || !ROOM_CODE.test(r.room))
      fail("bad-room", "That is not a room code.");
  checkTags(r, fail);
  return { ...r, kind };
}

// A `game` message checked: { t: "game", id?, g: { mode, start, actions, hashes?, client?, engine?, ... } }.
// `bytes` is the message's size. Throws a RoomError, or returns the game object.
export function checkGame(msg, bytes, limits = LIMITS) {
  const id = msg.id ?? null;
  const fail = (code, message) => {
    throw new RoomError(code, message, { id });
  };
  if (bytes > limits.gameBytes)
    fail(
      "too-big",
      `A recorded match is limited to ${limits.gameBytes} bytes.`,
    );
  const g = msg.g;
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
  checkTags(g, fail);
  return g;
}

// An `open` message's description of the game, checked; null turns the listing off.
export function checkOpen(open, limits = LIMITS) {
  if (open === null || open === false) return null;
  const count = (x, lo) =>
    Number.isInteger(x) && x >= lo && x <= limits.seatsMax;
  if (
    !isObject(open) ||
    !count(open.players, 0) ||
    !count(open.seats, 1) ||
    !OPEN_STATES.includes(open.state)
  )
    throw new RoomError(
      "bad-message",
      "`open` must be { players, seats, state } or null.",
    );
  return { players: open.players, seats: open.seats, state: open.state };
}

export function createRooms({
  store,
  send,
  close = async () => {},
  record = null,
  report: keepReport = null,
  recordGame = null,
  startReel = null,
  reelEngines = [],
  now = Date.now,
  limits = LIMITS,
}) {
  const buckets = new Map(); // conn -> { tokens, t, warned }
  const reported = new Map(); // conn -> reports kept (best effort, like the buckets)
  const recorded = new Map(); // conn -> one-browser matches kept (the same)
  const reelsStarted = new Map(); // conn -> highlight reels started (the same)
  const listing = typeof store.putListing === "function";

  const expiry = (seconds) => Math.floor(now() / 1000) + seconds;
  // A room lives roomTtl after its last write, or until its `keep` runs out if that is
  // later (a finished match's room is kept a year: docs/ROOMS.md section 10).
  const roomExpiry = (room) =>
    Math.max(expiry(limits.roomTtl), room?.keep?.until ?? 0);

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
      out.room.exp = roomExpiry(out.room);
      if (await store.putRoom(code, out.room, prev)) {
        await syncListing(code, current, out.room);
        return out;
      }
    }
    throw new RoomError("busy", "The room is busy. Try again.");
  }

  // ---------- the open games list ----------

  // A room is listed while its host says it is open and waiting or playing, someone is
  // connected, it has a free seat and a newcomer could get in (as join() decides: a full
  // room still admits one by dropping a member who is away, never the host).
  function listable(room) {
    const o = room?.open;
    if (!o || o.state === "over" || o.players >= o.seats) return false;
    const members = Object.entries(room.members);
    if (
      members.length >= limits.members &&
      !members.some(([id, m]) => !m.conn && id !== room.host)
    )
      return false;
    return members.some(([, m]) => m.conn);
  }

  // After every room write: the listing entry follows the room. Each write carries the
  // room's rev and the store keeps only a newer one, so invocations that finish out of
  // order cannot list a room again after a later write took it off; taking it off writes
  // an unlisted entry (it expires by itself) rather than deleting, so that rev stays.
  // A listing that cannot be written is logged and the room carries on.
  async function syncListing(code, before, after) {
    if (!listing || (!before?.open && !after?.open)) return;
    try {
      if (listable(after)) {
        const o = after.open;
        await store.putListing(code, {
          made: o.made,
          rev: after.rev,
          listed: true,
          players: o.players,
          seats: o.seats,
          state: o.state,
          exp: expiry(limits.listTtl),
        });
      } else if (before?.open && listable(before)) {
        await store.putListing(code, {
          made: before.open.made,
          rev: after.rev,
          listed: false,
          exp: expiry(limits.listTtl),
        });
      }
    } catch (error) {
      console.error("listing failed", error?.name, error?.message);
    }
  }

  // The host says whether the room is listed, and how it stands. Sent again from time to
  // time while it is open, which keeps the entry from expiring.
  async function setOpen(conn, who, msg) {
    const open = checkOpen(msg.open, limits);
    const t = now();
    await mutate(who.room, (room) => {
      member(room, who, conn);
      if (room.host !== who.member)
        throw new RoomError("not-host", "Only the host opens a game.");
      if (!open) {
        if (!room.open) return { room: null };
        delete room.open;
      } else {
        room.open = { made: room.open?.made ?? t, ...open };
      }
      return { room };
    });
  }

  // A match has ended: keep its replay, the room and its document a year (docs/ROOMS.md
  // section 10). `replay` is the game's, opaque here (at most replayBytes as ASCII JSON),
  // stored beside the document for `v`, the document version the match ended at (never
  // later than the room's: a keep that arrives late is ordered by its own version, not
  // by the one the room has reached since). Saying it again for a
  // version already kept changes nothing, so a finished room is kept a year from the end
  // of its match, not from its last visit, and an older match never replaces a newer one.
  async function keepRoom(conn, who, msg) {
    if (!isObject(msg.replay))
      throw new RoomError("bad-message", "`replay` must be an object.");
    const data = asciiJson(msg.replay);
    if (data.length > limits.replayBytes)
      throw new RoomError(
        "too-big",
        `A replay is limited to ${limits.replayBytes} bytes.`,
      );
    const v = msg.v;
    if (!Number.isInteger(v) || v < 1)
      throw new RoomError("bad-message", "`v` must be a document version.");
    member(await store.getRoom(who.room), who, conn);
    const stored = await store.getDoc(who.room);
    if (!stored || !stored.v || v > stored.v)
      throw new RoomError("bad-message", "There is no such version to keep.");
    const until = expiry(limits.keepTtl);
    if (typeof store.putReplay === "function")
      await store.putReplay(who.room, {
        v,
        t: now(),
        data,
        exp: until,
      });
    const { room } = await mutate(who.room, (room) => {
      member(room, who, conn);
      if ((room.keep?.v ?? 0) >= v) return { room: null };
      room.keep = { v, until };
      return { room };
    });
    if (room) await store.touchDoc(who.room, room.exp);
  }

  // A pitch's kept replay, by its code, on any connection (no join: the replay player can
  // fetch it without the pitch page's socket). Answered with `replay: null` when there is
  // none: a room never kept (a match in play, a match from before replays) or long gone.
  async function getReplay(conn, msg) {
    const id = msg.id ?? null;
    if (typeof msg.room !== "string" || !ROOM_CODE.test(msg.room))
      throw new RoomError("bad-room", "That is not a room code.", { id });
    let item = null;
    if (typeof store.getReplay === "function") {
      try {
        item = await store.getReplay(msg.room);
      } catch (error) {
        console.error("replay read failed", error?.name, error?.message);
      }
    }
    const head = asciiJson({
      t: "replay",
      id,
      room: msg.room,
      v: item?.v ?? 0,
      at: item?.t ?? null,
    });
    await post(
      conn,
      `${head.slice(0, -1)},"replay":${item ? item.data : "null"}}`,
    );
  }

  // ---------- highlight reels (docs/ROOMS.md section 12) ----------

  // How a reel stands, as the asker is told it: no member ids, no names, the paths
  // once it is done.
  const reelView = (item, staleBefore) =>
    item.state === "rendering" &&
    item.at < staleBefore &&
    (item.tries ?? 0) >= REEL_TRIES
      ? { state: "failed", tag: item.tag, at: item.at } // timed out every try
      : item.state === "done"
        ? {
            state: "done",
            tag: item.tag,
            at: item.at,
            tall: item.tall,
            wide: item.wide,
            edit: item.edit,
            seconds: item.seconds ?? null,
          }
        : { state: item.state, tag: item.tag, at: item.at };

  // A finished pitch's highlight reel, by its code, on any connection (no join: anyone
  // with the link, as for a replay). The first request for a kept replay's version
  // asks the renderer; every later one is told how it stands. The room server still
  // knows no Kubb: of the replay it reads only the engine's version, a tag.
  async function reel(conn, msg) {
    const id = msg.id ?? null;
    const code = msg.room;
    if (typeof code !== "string" || !ROOM_CODE.test(code))
      throw new RoomError("bad-room", "That is not a room code.", { id });
    const answer = (fields) =>
      post(conn, asciiJson({ t: "reel", id, room: code, ...fields }));
    if (
      !startReel ||
      typeof store.getReel !== "function" ||
      typeof store.getReplay !== "function"
    )
      return answer({ v: 0, reel: null, why: "unavailable" });
    let kept, item;
    try {
      kept = await store.getReplay(code);
      item = kept ? await store.getReel(code) : null;
    } catch (error) {
      console.error("reel read failed", error?.name, error?.message);
      throw new RoomError("failed", "The reel could not be read.", { id });
    }
    if (!kept) return answer({ v: 0, reel: null, why: "replay" });
    let engine = null;
    try {
      const tagged = JSON.parse(kept.data)?.engine;
      engine = typeof tagged === "string" ? majorMinor(tagged) : null;
    } catch {
      engine = null;
    }
    // A match from another engine is never rendered on this one: its throws could go
    // differently from what was played.
    if (!engine || !reelEngines.includes(engine))
      return answer({ v: kept.v, reel: null, why: "engine" });
    const tag = reelTag(engine);
    const job = reelJob(kept.v, tag);
    const t = now();
    const staleBefore = t - limits.reelStaleMs;
    // A render "rendering" long past its start died without a word (Lambda stopped,
    // the invoke was lost): the next request may start it again, unless it was tried
    // as often as it may be (then it is shown as failed).
    const stale = (x) =>
      x.state === "rendering" &&
      x.at < staleBefore &&
      (x.tries ?? 0) < REEL_TRIES;
    if (item && item.job === job && !stale(item))
      return answer({ v: kept.v, reel: reelView(item, staleBefore) });

    // This request would start a render.
    const count = reelsStarted.get(conn) ?? 0;
    if (count >= limits.reelsPerConn)
      throw new RoomError(
        "too-many",
        `A connection may start ${limits.reelsPerConn} reels.`,
        { id },
      );
    // The one request that may start it writes the reel item; only that one is
    // counted against the day, so viewers asking at once cost one render.
    let won = false;
    let counted = false;
    try {
      won = await store.putReel(
        code,
        { v: kept.v, tag, job, at: t, exp: kept.exp },
        { staleBefore },
      );
      if (!won) item = await store.getReel(code);
      else {
        const day = new Date(t).toISOString().slice(0, 10);
        counted = await store.countReel(
          day,
          limits.reelsPerDay,
          expiry(limits.reelCountTtl),
        );
        if (!counted) await store.dropReel(code, job);
      }
    } catch (error) {
      console.error("reel write failed", error?.name, error?.message);
      if (won && !counted) await store.dropReel(code, job).catch(() => {});
      throw new RoomError("failed", "The reel could not be asked for.", {
        id,
      });
    }
    if (won && !counted) return answer({ v: kept.v, reel: null, why: "busy" });
    if (!won)
      return answer({
        v: kept.v,
        reel: item && item.job === job ? reelView(item, staleBefore) : null,
        ...(item && item.job === job ? {} : { why: "busy" }),
      });
    try {
      await startReel({ room: code, v: kept.v, tag });
    } catch (error) {
      console.error("reel start failed", error?.name, error?.message);
      await store.dropReel(code, job).catch(() => {});
      throw new RoomError("failed", "The reel could not be started.", { id });
    }
    if (reelsStarted.size > 5000) reelsStarted.clear();
    reelsStarted.set(conn, count + 1);
    return answer({
      v: kept.v,
      reel: { state: "rendering", tag, at: t },
    });
  }

  async function list(conn, msg) {
    const t = now();
    let games = [];
    if (listing) {
      let rows = [];
      try {
        rows = await store.listOpen({
          since: t - limits.listAgeMs,
          limit: limits.listRead,
          now: Math.floor(t / 1000),
        });
      } catch (error) {
        console.error("list failed", error?.name, error?.message);
      }
      games = rows.slice(0, limits.listMax).map((r) => ({
        room: r.room,
        made: r.made,
        players: r.players,
        seats: r.seats,
        state: r.state,
      }));
    }
    await post(
      conn,
      asciiJson({ t: "list", id: msg.id ?? null, now: t, games }),
    );
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
    const before = await store.getRoom(who.room);
    member(before, who, conn);

    const v = base + 1;
    const next = {
      v,
      doc,
      by: who.member,
      sid: id === null ? null : String(id),
      exp: roomExpiry(before),
    };
    if (await store.putDoc(who.room, next, base)) {
      const t = now(); // the record's time, taken before anything else is awaited
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
              t,
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

  // A player's report: any connection, joined to a room or not. Kept, then acknowledged.
  async function report(conn, msg, bytes) {
    const id = msg.id ?? null;
    const r = checkReport(msg, bytes, limits);
    if (!keepReport)
      throw new RoomError("unavailable", "Reports are not kept here.", { id });
    const count = reported.get(conn) ?? 0;
    if (count >= limits.reportsPerConn)
      throw new RoomError(
        "too-many",
        `A connection may send ${limits.reportsPerConn} reports.`,
        { id },
      );
    if (reported.size > 5000) reported.clear();
    reported.set(conn, count + 1);
    try {
      await keepReport({ t: now(), report: asciiJson(r) });
    } catch (error) {
      reported.set(conn, count);
      console.error("report failed", error?.name, error?.message);
      throw new RoomError("failed", "The report could not be kept.", { id });
    }
    await post(conn, asciiJson({ t: "reported", id }));
  }

  // A match played in one browser (solo, watching the computer): any connection, joined
  // to a room or not. Kept, then acknowledged.
  async function game(conn, msg, bytes) {
    const id = msg.id ?? null;
    const g = checkGame(msg, bytes, limits);
    if (!recordGame)
      throw new RoomError("unavailable", "Matches are not kept here.", { id });
    const count = recorded.get(conn) ?? 0;
    if (count >= limits.gamesPerConn)
      throw new RoomError(
        "too-many",
        `A connection may send ${limits.gamesPerConn} matches.`,
        { id },
      );
    if (recorded.size > 5000) recorded.clear();
    recorded.set(conn, count + 1);
    try {
      await recordGame({ t: now(), game: asciiJson(g) });
    } catch (error) {
      recorded.set(conn, count);
      console.error("game record failed", error?.name, error?.message);
      throw new RoomError("failed", "The match could not be kept.", { id });
    }
    await post(conn, asciiJson({ t: "recorded", id }));
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
      if (msg.t === "report") return await report(conn, msg, bytes);
      if (msg.t === "game") return await game(conn, msg, bytes);
      if (msg.t === "list") return await list(conn, msg);
      if (msg.t === "replay") return await getReplay(conn, msg);
      if (msg.t === "reel") return await reel(conn, msg);
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
        case "open":
          return await setOpen(conn, who, msg);
        case "keep":
          return await keepRoom(conn, who, msg);
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
    reported.delete(conn);
    recorded.delete(conn);
    reelsStarted.delete(conn);
    if (who) await dropped(who.room, who.member, conn);
  }

  return { message, disconnect, limits };
}
