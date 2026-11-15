// backend/rooms/core.mjs over the in-memory store, with a fake `send` that records what
// each connection would receive (frames reassembled, as the client does).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LIMITS,
  asciiJson,
  createRooms,
  originAllowed,
  parseOrigins,
  toFrames,
} from "../../backend/rooms/core.mjs";
import { memoryStore } from "../../backend/rooms/memory-store.mjs";

function harness({ limits = LIMITS } = {}) {
  let t = 1_700_000_000_000;
  const now = () => t;
  const store = memoryStore({ now });
  const inbox = new Map(); // conn -> [msg]
  const frames = new Map(); // conn -> [raw frame]
  const parts = new Map();
  const closed = [];
  const gone = new Set();
  const rooms = createRooms({
    store,
    now,
    limits,
    async send(conn, text) {
      if (gone.has(conn)) return false;
      if (!frames.has(conn)) frames.set(conn, []);
      frames.get(conn).push(text);
      if (text.startsWith("~")) {
        const [, id, i, n] = /^~([a-z0-9]+)\.(\d+)\.(\d+)~/.exec(text);
        const got = parts.get(id) ?? [];
        got[Number(i)] = text.slice(text.indexOf("~", 1) + 1);
        parts.set(id, got);
        if (got.filter((x) => x !== undefined).length < Number(n)) return true;
        text = got.join("");
      }
      if (!inbox.has(conn)) inbox.set(conn, []);
      inbox.get(conn).push(JSON.parse(text));
      return true;
    },
    async close(conn) {
      closed.push(conn);
    },
  });
  const say = (conn, msg) =>
    rooms.message(conn, typeof msg === "string" ? msg : asciiJson(msg));
  const take = (conn) => {
    const got = inbox.get(conn) ?? [];
    inbox.set(conn, []);
    return got;
  };
  const last = (conn, type) =>
    take(conn)
      .filter((m) => m.t === type)
      .at(-1);
  return {
    rooms,
    store,
    say,
    take,
    last,
    frames,
    closed,
    gone,
    advance: (ms) => (t += ms),
    now,
  };
}

const ROOM = "abcdefgh23";

test("join creates the room; the creator is host; the reply is the full state", async () => {
  const h = harness();
  await h.say("c1", {
    t: "join",
    room: ROOM,
    member: "member-one",
    name: "Ann",
  });
  const joined = h.last("c1", "joined");
  assert.equal(joined.host, "member-one");
  assert.equal(joined.you, "member-one");
  assert.equal(joined.v, 0);
  assert.equal(joined.doc, null);
  assert.deepEqual(
    joined.members.map((m) => [m.id, m.connected, m.me.name]),
    [["member-one", true, "Ann"]],
  );
  assert.equal(joined.limits.members, 16);

  await h.say("c2", {
    t: "join",
    room: ROOM,
    member: "member-two",
    me: { name: "Bo", team: "B" },
  });
  const two = h.last("c2", "joined");
  assert.equal(two.host, "member-one");
  assert.deepEqual(
    two.members.map((m) => m.id),
    ["member-one", "member-two"],
  );
  const seen = h.last("c1", "member");
  assert.equal(seen.member.id, "member-two");
  assert.equal(seen.isNew, true);
  assert.equal(seen.member.me.team, "B");
});

test("bad codes and member ids are refused", async () => {
  const h = harness();
  await h.say("c1", { t: "join", room: "abc", member: "member-one" });
  assert.equal(h.last("c1", "error").code, "bad-room");
  await h.say("c1", { t: "join", room: "ABCDEFGH", member: "member-one" });
  assert.equal(h.last("c1", "error").code, "bad-room");
  await h.say("c1", { t: "join", room: ROOM, member: "x" });
  const e = h.last("c1", "error");
  assert.equal(e.code, "bad-member");
  assert.equal(e.re, "join");
  await h.say("c1", { t: "set", base: 0, doc: {} });
  assert.equal(h.last("c1", "error").code, "not-joined");
  await h.say("c1", "not json");
  assert.equal(h.last("c1", "error").code, "bad-message");
});

test("rejoin as the same member replaces the first connection and keeps the place", async () => {
  const h = harness();
  await h.say("c1", {
    t: "join",
    room: ROOM,
    member: "member-one",
    name: "Ann",
  });
  await h.say("c2", { t: "join", room: ROOM, member: "member-two" });
  h.take("c1");
  await h.say("c3", { t: "join", room: ROOM, member: "member-one" });
  assert.equal(h.last("c1", "error").code, "replaced");
  assert.deepEqual(h.closed, ["c1"]);
  const joined = h.last("c3", "joined");
  assert.deepEqual(
    joined.members.map((m) => m.id),
    ["member-one", "member-two"],
  );
  assert.equal(joined.members[0].me.name, "Ann"); // fields survive
  assert.equal(joined.host, "member-one");
  // The old connection no longer speaks for the member.
  await h.say("c1", { t: "me", me: { name: "Ghost" } });
  assert.equal(h.last("c1", "error").code, "not-joined");
  // Its $disconnect, when it comes, does not mark the member gone.
  await h.rooms.disconnect("c1");
  assert.equal(
    h.take("c2").filter((m) => m.t === "member" && !m.member.connected).length,
    0,
  );
});

test("presence: disconnect and reconnect are broadcast; leave forgets", async () => {
  const h = harness();
  await h.say("c1", { t: "join", room: ROOM, member: "member-one" });
  await h.say("c2", { t: "join", room: ROOM, member: "member-two" });
  h.take("c1");
  await h.rooms.disconnect("c2");
  const away = h.last("c1", "member");
  assert.equal(away.member.id, "member-two");
  assert.equal(away.member.connected, false);
  await h.say("c3", { t: "join", room: ROOM, member: "member-two" });
  const back = h.last("c1", "member");
  assert.equal(back.member.connected, true);
  assert.equal(back.isNew, false);
  assert.ok(back.rev > away.rev);
  await h.say("c3", { t: "leave" });
  assert.equal(h.last("c1", "left").id, "member-two");
  assert.equal((await h.store.getRoom(ROOM)).members["member-two"], undefined);
});

test("a send that comes back gone marks the member disconnected", async () => {
  const h = harness();
  await h.say("c1", { t: "join", room: ROOM, member: "member-one" });
  await h.say("c2", { t: "join", room: ROOM, member: "member-two" });
  h.take("c1");
  h.gone.add("c2");
  await h.say("c1", { t: "me", me: { team: "A" } });
  const room = await h.store.getRoom(ROOM);
  assert.equal(room.members["member-two"].conn, null);
  assert.equal(await h.store.getConn("c2"), null);
});

test("host: claim refused while the host is here or just left; earliest connected member takes it", async () => {
  const h = harness();
  await h.say("c1", { t: "join", room: ROOM, member: "member-one" });
  h.advance(10);
  await h.say("c2", { t: "join", room: ROOM, member: "member-two" });
  h.advance(10);
  await h.say("c3", { t: "join", room: ROOM, member: "member-three" });
  await h.say("c2", { t: "claim" });
  assert.equal(h.last("c2", "error").code, "host-present");
  await h.rooms.disconnect("c1");
  await h.say("c2", { t: "claim" });
  assert.equal(h.last("c2", "error").code, "host-recent");
  h.advance(LIMITS.hostGraceMs + 1);
  await h.say("c3", { t: "claim" });
  assert.equal(h.last("c3", "error").code, "not-next");
  h.take("c3");
  await h.say("c2", { t: "claim" });
  assert.equal(h.last("c3", "host").host, "member-two");
  // The old host returning is an ordinary member now.
  await h.say("c4", { t: "join", room: ROOM, member: "member-one" });
  assert.equal(h.last("c4", "joined").host, "member-two");
});

test("host who left for good: the next member may claim at once", async () => {
  const h = harness();
  await h.say("c1", { t: "join", room: ROOM, member: "member-one" });
  await h.say("c2", { t: "join", room: ROOM, member: "member-two" });
  await h.say("c1", { t: "leave" });
  await h.say("c2", { t: "claim" });
  assert.equal(h.last("c2", "host").host, "member-two");
});

test("set: compare-and-set accepts on the current version and refuses with the current doc", async () => {
  const h = harness();
  await h.say("c1", { t: "join", room: ROOM, member: "member-one" });
  await h.say("c2", { t: "join", room: ROOM, member: "member-two" });
  h.take("c1");
  h.take("c2");
  await h.say("c1", {
    t: "set",
    id: 1,
    base: 0,
    doc: { lobby: true, name: "Ångström" },
    with: { why: "start" },
  });
  assert.deepEqual(h.take("c1"), [{ t: "ok", id: 1, v: 1 }]);
  const doc = h.last("c2", "doc");
  assert.deepEqual(doc, {
    t: "doc",
    v: 1,
    by: "member-one",
    with: { why: "start" },
    doc: { lobby: true, name: "Ångström" },
  });

  await h.say("c2", { t: "set", id: 7, base: 0, doc: { lobby: false } });
  const no = h.last("c2", "no");
  assert.equal(no.id, 7);
  assert.equal(no.v, 1);
  assert.equal(no.sid, "1");
  assert.deepEqual(no.doc, { lobby: true, name: "Ångström" });
  assert.equal(h.take("c1").length, 0); // a refused set is not broadcast

  await h.say("c2", { t: "set", id: 8, base: 1, doc: { lobby: false } });
  assert.equal(h.last("c2", "ok").v, 2);
  // A rejoin with the version it holds is not sent the document again.
  await h.say("c3", { t: "join", room: ROOM, member: "member-one", v: 2 });
  const j = h.last("c3", "joined");
  assert.equal(j.v, 2);
  assert.equal("doc" in j, false);
});

test("limits: document, with, me, cast sizes, and members", async () => {
  const limits = { ...LIMITS, members: 3 };
  const h = harness({ limits });
  await h.say("c1", { t: "join", room: ROOM, member: "member-one" });
  const big = "x".repeat(LIMITS.docBytes);
  // The document arrives in parts, as the client sends it.
  for (const f of toFrames(asciiJson({ t: "set", id: 1, base: 0, doc: big })))
    await h.say("c1", f);
  assert.equal(h.last("c1", "error").code, "too-big");
  await h.say("c1", {
    t: "set",
    id: 2,
    base: 0,
    doc: {},
    with: "y".repeat(LIMITS.withBytes),
  });
  assert.equal(h.last("c1", "error").code, "too-big");
  await h.say("c1", { t: "me", me: { name: "z".repeat(LIMITS.meBytes) } });
  assert.equal(h.last("c1", "error").code, "too-big");
  await h.say("c1", { t: "cast", d: "w".repeat(LIMITS.castBytes) });
  assert.equal(h.last("c1", "error").code, "too-big");

  await h.say("c2", { t: "join", room: ROOM, member: "member-two" });
  await h.say("c3", { t: "join", room: ROOM, member: "member-three" });
  await h.say("c4", { t: "join", room: ROOM, member: "member-four" });
  assert.equal(h.last("c4", "error").code, "full");
  // A member who is away gives up their place to a newcomer when the room is full.
  await h.rooms.disconnect("c2");
  h.take("c1");
  await h.say("c4", { t: "join", room: ROOM, member: "member-four" });
  assert.ok(h.last("c4", "joined"));
  assert.equal(h.last("c1", "left").id, "member-two");
});

test("cast: relayed to everyone else, never stored, rate capped per connection", async () => {
  const h = harness();
  await h.say("c1", { t: "join", room: ROOM, member: "member-one" });
  await h.say("c2", { t: "join", room: ROOM, member: "member-two" });
  h.take("c1");
  h.take("c2");
  await h.say("c1", { t: "cast", d: { aim: [1, 2] } });
  assert.deepEqual(h.take("c2"), [
    { t: "cast", from: "member-one", d: { aim: [1, 2] } },
  ]);
  assert.equal(h.take("c1").length, 0);
  for (let i = 0; i < LIMITS.castBurst + 10; i++)
    await h.say("c1", { t: "cast", d: i });
  assert.equal(h.take("c2").length, LIMITS.castBurst - 1); // the first token went above
  const errors = h.take("c1").filter((m) => m.t === "error");
  assert.equal(errors.length, 1); // said once
  assert.equal(errors[0].code, "rate");
  h.advance(1000);
  await h.say("c1", { t: "cast", d: "again" });
  assert.equal(h.take("c2").length, 1);
  assert.equal(await h.store.getDoc(ROOM), null);
});

test("chunks: parts in any order make one message; big sends go out in frames", async () => {
  const h = harness();
  await h.say("c1", { t: "join", room: ROOM, member: "member-one" });
  await h.say("c2", { t: "join", room: ROOM, member: "member-two" });
  const doc = {
    blob: "é".repeat(20_000),
    list: Array.from({ length: 3000 }, (_, i) => i),
  };
  const frames = toFrames(asciiJson({ t: "set", id: 3, base: 0, doc }));
  assert.ok(frames.length > 3);
  for (const f of frames) assert.ok(f.length <= LIMITS.frame);
  for (const f of [...frames].reverse()) await h.say("c1", f);
  assert.equal(h.last("c1", "ok").v, 1);
  assert.deepEqual(h.last("c2", "doc").doc, doc);
  const out = h.frames.get("c2").filter((f) => f.startsWith("~"));
  assert.ok(out.length > 3);
  for (const f of h.frames.get("c2")) assert.ok(f.length <= LIMITS.frame);
  await h.say("c1", "~bad.5.2~x"); // part 5 of 2
  assert.equal(h.last("c1", "error").code, "bad-message");
});

test("expiry: rooms, documents and connections carry a TTL; an expired room is new again", async () => {
  const h = harness();
  await h.say("c1", { t: "join", room: ROOM, member: "member-one" });
  await h.say("c1", { t: "set", id: 1, base: 0, doc: { a: 1 } });
  const nowS = Math.floor(h.now() / 1000);
  assert.equal((await h.store.getRoom(ROOM)).exp, nowS + LIMITS.roomTtl);
  assert.equal((await h.store.getDoc(ROOM)).exp, nowS + LIMITS.roomTtl);
  assert.equal((await h.store.getConn("c1")).exp, nowS + LIMITS.connTtl);

  // A join well after the last document write keeps the document alive with the room.
  h.advance(40 * 3600 * 1000);
  await h.say("c2", { t: "join", room: ROOM, member: "member-two" });
  assert.equal(
    (await h.store.getDoc(ROOM)).exp,
    Math.floor(h.now() / 1000) + LIMITS.roomTtl,
  );

  h.advance((LIMITS.roomTtl + 1) * 1000);
  await h.say("c3", { t: "join", room: ROOM, member: "member-three" });
  const joined = h.last("c3", "joined");
  assert.equal(joined.host, "member-three");
  assert.equal(joined.v, 0);
  assert.deepEqual(
    joined.members.map((m) => m.id),
    ["member-three"],
  );
});

test("ping answers pong without a join", async () => {
  const h = harness();
  await h.say("c1", { t: "ping" });
  assert.equal(h.last("c1", "pong").t, "pong");
});

test("origin allow-list", () => {
  const allowed = parseOrigins(
    "https://kubb.thingelstad.xyz, http://localhost,http://127.0.0.1",
  );
  assert.ok(originAllowed("https://kubb.thingelstad.xyz", allowed));
  assert.ok(originAllowed("http://localhost:5173", allowed));
  assert.ok(originAllowed("http://127.0.0.1:8080", allowed));
  assert.ok(!originAllowed("http://kubb.thingelstad.xyz", allowed));
  assert.ok(!originAllowed("https://evil.example", allowed));
  assert.ok(
    !originAllowed("https://kubb.thingelstad.xyz.evil.example", allowed),
  );
  assert.ok(!originAllowed("null", allowed));
  assert.ok(!originAllowed(undefined, allowed));
});
