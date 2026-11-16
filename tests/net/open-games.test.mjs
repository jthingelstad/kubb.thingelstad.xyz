// Open games (docs/ROOMS.md section 9): the host's `open` message, the listing entry that
// follows the room, and the `list` anyone may ask for without joining.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LIMITS,
  asciiJson,
  checkOpen,
  createRooms,
  listingKey,
} from "../../backend/rooms/core.mjs";
import { memoryStore } from "../../backend/rooms/memory-store.mjs";
import { SEATS, lobbyOf, openListing, setAccess } from "../../src/net/lobby.js";

const T0 = 1_700_000_000_000;

function harness({ limits = LIMITS, store: makeStore = memoryStore } = {}) {
  let t = T0;
  const now = () => t;
  const store = makeStore({ now });
  const inbox = new Map();
  const rooms = createRooms({
    store,
    now,
    limits,
    async send(conn, text) {
      if (!inbox.has(conn)) inbox.set(conn, []);
      inbox.get(conn).push(JSON.parse(text));
      return true;
    },
  });
  const say = (conn, msg) => rooms.message(conn, asciiJson(msg));
  const last = (conn, type) =>
    (inbox.get(conn) ?? []).filter((m) => !type || m.t === type).at(-1);
  const join = (conn, room, member) =>
    say(conn, { t: "join", room, member, name: member });
  const list = async (conn = "looker") => {
    await say(conn, { t: "list", id: 9 });
    return last(conn, "list");
  };
  return {
    rooms,
    store,
    say,
    last,
    join,
    list,
    advance: (ms) => (t += ms),
  };
}

const OPEN = { players: 1, seats: 12, state: "waiting" };

test("the host opens a room; anyone may list it without joining", async () => {
  const h = harness();
  await h.join("c1", "abcdefgh", "host-member");
  assert.deepEqual((await h.list()).games, []);
  await h.say("c1", { t: "open", open: OPEN });
  const answer = await h.list();
  assert.equal(answer.id, 9);
  assert.equal(answer.now, T0);
  assert.deepEqual(answer.games, [
    { room: "abcdefgh", made: T0, players: 1, seats: 12, state: "waiting" },
  ]);
  // only counts and state: no names, no members
  assert.ok(!asciiJson(answer).includes("host-member"));

  // said again later: the same entry (made stays), new counts
  h.advance(60_000);
  await h.say("c1", {
    t: "open",
    open: { ...OPEN, players: 3, state: "playing" },
  });
  assert.deepEqual((await h.list()).games, [
    { room: "abcdefgh", made: T0, players: 3, seats: 12, state: "playing" },
  ]);
  assert.equal(h.store.listings.size, 1);

  // invite only again: gone from the list
  await h.say("c1", { t: "open", open: null });
  assert.deepEqual((await h.list()).games, []);
  assert.equal(h.store.listings.size, 0);
});

test("only the host opens; bad descriptions are refused", async () => {
  const h = harness();
  await h.join("c1", "abcdefgh", "host-member");
  await h.join("c2", "abcdefgh", "guest-member");
  await h.say("c2", { t: "open", open: OPEN });
  assert.equal(h.last("c2", "error").code, "not-host");
  await h.say("c3", { t: "open", open: OPEN });
  assert.equal(h.last("c3", "error").code, "not-joined");
  for (const open of [
    { ...OPEN, seats: 0 },
    { ...OPEN, seats: 99 },
    { ...OPEN, players: -1 },
    { ...OPEN, players: 1.5 },
    { ...OPEN, state: "lobby" },
    "yes",
  ]) {
    await h.say("c1", { t: "open", open });
    assert.equal(
      h.last("c1", "error").code,
      "bad-message",
      JSON.stringify(open),
    );
  }
  assert.deepEqual((await h.list()).games, []);
  assert.equal(checkOpen(null), null);
  assert.equal(checkOpen(false), null);
  assert.deepEqual(checkOpen({ ...OPEN, extra: "x" }), OPEN);
});

test("full, over and empty rooms leave the list", async () => {
  const h = harness();
  await h.join("c1", "abcdefgh", "host-member");
  await h.say("c1", { t: "open", open: OPEN });
  await h.say("c1", { t: "open", open: { ...OPEN, players: 12 } });
  assert.deepEqual((await h.list()).games, [], "every seat taken");
  await h.say("c1", { t: "open", open: { ...OPEN, players: 2 } });
  assert.equal((await h.list()).games.length, 1);
  await h.say("c1", { t: "open", open: { ...OPEN, state: "over" } });
  assert.deepEqual((await h.list()).games, [], "the match ended");
  await h.say("c1", { t: "open", open: OPEN });
  assert.equal((await h.list()).games.length, 1);
  await h.rooms.disconnect("c1");
  assert.deepEqual((await h.list()).games, [], "nobody connected");
  // back: listed again once the host says so
  await h.join("c4", "abcdefgh", "host-member");
  await h.say("c4", { t: "open", open: OPEN });
  assert.equal((await h.list()).games.length, 1);
});

test("a room with as many members as it allows is not listed", async () => {
  const h = harness({ limits: { ...LIMITS, members: 2 } });
  await h.join("c1", "abcdefgh", "host-member");
  await h.say("c1", { t: "open", open: OPEN });
  assert.equal((await h.list()).games.length, 1);
  await h.join("c2", "abcdefgh", "guest-member");
  // the room changed (a join): the listing follows it
  assert.deepEqual((await h.list()).games, []);
});

test("entries expire; old games are not listed; the list is capped, newest first", async () => {
  const h = harness();
  await h.join("c1", "abcdefgh", "host-member");
  await h.say("c1", { t: "open", open: OPEN });
  h.advance(LIMITS.listTtl * 1000 + 1000);
  assert.deepEqual((await h.list()).games, [], "not said again: expired");

  const many = harness();
  const codes = [];
  for (let i = 0; i < LIMITS.listMax + 5; i++) {
    const code = `abcdef${"23456789abcdefghjkmnpqrstuvwxyz"[i]}x`;
    codes.push(code);
    await many.join(`c${i}`, code, `host-member-${i}`);
    await many.say(`c${i}`, { t: "open", open: OPEN });
    many.advance(1000);
  }
  const { games } = await many.list();
  assert.equal(games.length, LIMITS.listMax);
  assert.equal(games[0].room, codes.at(-1), "newest first");
  assert.ok(games.every((g, i) => i === 0 || g.made <= games[i - 1].made));

  // one made more than listAgeMs ago drops out, though its host keeps saying so
  const old = harness();
  await old.join("c1", "abcdefgh", "host-member");
  await old.say("c1", { t: "open", open: OPEN });
  for (let i = 0; i < 26; i++) {
    old.advance(3600 * 1000);
    await old.say("c1", { t: "open", open: OPEN });
  }
  assert.deepEqual((await old.list()).games, []);
});

test("a store without listings lists nothing; a failing read is an empty list", async () => {
  const plain = harness({
    store: (o) => {
      const s = memoryStore(o);
      delete s.putListing;
      delete s.delListing;
      delete s.listOpen;
      return s;
    },
  });
  await plain.join("c1", "abcdefgh", "host-member");
  await plain.say("c1", { t: "open", open: OPEN });
  assert.equal(plain.last("c1", "error"), undefined);
  assert.deepEqual((await plain.list()).games, []);

  const broken = harness({
    store: (o) => ({
      ...memoryStore(o),
      async listOpen() {
        throw new Error("DynamoDB is down");
      },
    }),
  });
  const err = console.error;
  console.error = () => {};
  try {
    assert.deepEqual((await broken.list()).games, []);
  } finally {
    console.error = err;
  }
});

test("the listing key sorts by when the game was made", () => {
  assert.equal(listingKey("abcdefgh", 5), "0000000000005#abcdefgh");
  assert.ok(listingKey("zzzzzzzz", T0) < listingKey("aaaaaaaa", T0 + 1));
});

test("the document's open choice and what the host says about it", () => {
  assert.equal(lobbyOf(null).open, false);
  assert.equal(lobbyOf({ open: "yes" }).open, false);
  const opened = setAccess(null, true);
  assert.equal(opened.open, true);
  assert.equal(setAccess(opened, true), undefined, "no change, no write");
  assert.equal(setAccess(opened, false).open, false);

  const members = [
    { id: "a", connected: true },
    { id: "b", connected: true },
    { id: "c", connected: false },
  ];
  assert.equal(openListing({ open: false }, members), null);
  assert.deepEqual(openListing(opened, members), {
    players: 2,
    seats: SEATS,
    state: "waiting",
  });
  const playing = { ...opened, started: true, match: { n: 1 } };
  assert.equal(openListing(playing, members).state, "playing");
  assert.equal(openListing(playing, members, { over: true }).state, "over");
  assert.equal(SEATS, 12);
  assert.ok(SEATS <= LIMITS.seatsMax);
  // what the browser sends is what the server accepts
  assert.deepEqual(
    checkOpen(openListing(playing, members)),
    openListing(playing, members),
  );
});
