// src/net/room.js against a scripted fake socket: the paths a real server rarely shows
// (a set whose answer never comes, a set lost with the socket, stale events out of order).
import assert from "node:assert/strict";
import { test } from "node:test";
import { connect } from "../../src/net/room.js";

function fakeSockets() {
  const sockets = [];
  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      sockets.push(this);
      setImmediate(() => {
        this.readyState = 1;
        this.onopen?.();
      });
    }
    send(text) {
      this.sent.push(JSON.parse(text));
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      setImmediate(() => this.onclose?.({ code: 1000 }));
    }
    serve(msg) {
      this.onmessage?.({ data: JSON.stringify(msg) });
    }
  }
  return { sockets, FakeSocket };
}

const tick = () => new Promise((r) => setTimeout(r, 5));
const until = async (fn) => {
  for (let i = 0; i < 400 && !fn(); i++) await tick();
  assert.ok(fn(), "condition not met");
};
const joined = (extra) => ({
  t: "joined",
  room: "abcdefgh",
  you: "member-one",
  host: "member-one",
  rev: 1,
  members: [{ id: "member-one", connected: true, joined: 1, since: 1, me: {} }],
  v: 0,
  by: null,
  sid: null,
  limits: { frame: 30000 },
  doc: null,
  ...extra,
});

function setup() {
  const { sockets, FakeSocket } = fakeSockets();
  const room = connect({
    url: "ws://x",
    room: "abcdefgh",
    member: "member-one",
    WebSocket: FakeSocket,
    backoff: [1, 2],
    answerMs: 30,
  });
  return { room, sockets };
}

test("a set with no answer reconnects; the join shows it landed (by sid)", async () => {
  const { room, sockets } = setup();
  await until(() => sockets[0]?.sent.length === 1);
  sockets[0].serve(joined({ v: 4, doc: { n: 4 } }));
  await room.ready;
  const p = room.update((doc) => ({ n: doc.n + 1 }));
  await until(() => sockets[0].sent.some((m) => m.t === "set"));
  const set = sockets[0].sent.find((m) => m.t === "set");
  assert.equal(set.base, 4);
  // Nothing comes back; the client gives up waiting and reconnects.
  await until(() => sockets.length === 2 && sockets[1].sent.length === 1);
  assert.equal(sockets[1].sent[0].v, 4);
  sockets[1].serve(
    joined({
      rev: 2,
      v: 5,
      by: "member-one",
      sid: String(set.id),
      doc: { n: 5 },
    }),
  );
  assert.deepEqual(await p, { v: 5, doc: { n: 5 } });
  assert.equal(room.v, 5);
  room.close();
});

test("a set lost with the socket: not landed is sent again; someone else wrote is uncertain", async () => {
  const { room, sockets } = setup();
  await until(() => sockets[0]?.sent.length === 1);
  sockets[0].serve(joined({ v: 1, doc: { n: 1 } }));
  await room.ready;

  const p = room.update((doc) => ({ n: doc.n + 1 }));
  await until(() => sockets[0].sent.some((m) => m.t === "set"));
  sockets[0].close();
  await until(() => sockets[1]?.sent.length === 1);
  sockets[1].serve(joined({ rev: 2, v: 1, doc: { n: 1 } })); // it never arrived
  await until(() => sockets[1].sent.some((m) => m.t === "set"));
  const again = sockets[1].sent.find((m) => m.t === "set");
  assert.equal(again.base, 1);
  sockets[1].serve({ t: "ok", id: again.id, v: 2 });
  assert.deepEqual(await p, { v: 2, doc: { n: 2 } });

  const q = room.update((doc) => ({ n: doc.n + 10 }));
  await until(() => sockets[1].sent.filter((m) => m.t === "set").length === 2);
  sockets[1].close();
  await until(() => sockets[2]?.sent.length === 1);
  sockets[2].serve(
    joined({ rev: 3, v: 4, by: "member-two", sid: "9", doc: { n: 40 } }),
  );
  await assert.rejects(q, (e) => e.code === "uncertain");
  assert.deepEqual(room.doc, { n: 40 });
  room.close();
});

test("stale events are ignored: older doc versions and older member revs", async () => {
  const { room, sockets } = setup();
  await until(() => sockets[0]?.sent.length === 1);
  sockets[0].serve(joined({ rev: 5, v: 3, doc: { n: 3 } }));
  await room.ready;
  sockets[0].serve({ t: "doc", v: 5, by: "member-two", doc: { n: 5 } });
  sockets[0].serve({ t: "doc", v: 4, by: "member-two", doc: { n: 4 } }); // late
  assert.deepEqual(room.doc, { n: 5 });
  const two = (connected) => ({
    id: "member-two",
    connected,
    joined: 2,
    since: 2,
    me: {},
  });
  sockets[0].serve({ t: "member", rev: 8, member: two(true) });
  sockets[0].serve({ t: "member", rev: 7, member: two(false) }); // late
  assert.equal(room.members.find((m) => m.id === "member-two").connected, true);
  sockets[0].serve({ t: "host", host: "member-two", rev: 4 }); // older than the join
  assert.equal(room.host, "member-one");
  room.close();
});

test("replaced: another tab took over, so this one stops for good", async () => {
  const { room, sockets } = setup();
  await until(() => sockets[0]?.sent.length === 1);
  sockets[0].serve(joined());
  await room.ready;
  sockets[0].serve({ t: "error", code: "replaced", message: "elsewhere" });
  sockets[0].close();
  await tick();
  await tick();
  assert.equal(room.status, "replaced");
  assert.equal(sockets.length, 1);
});

test("rejoin: the leave goes first, then a new socket joins (an observer steps back)", async () => {
  const { room, sockets } = setup();
  await until(() => sockets[0]?.sent.length === 1);
  sockets[0].serve(joined({ v: 2, doc: { n: 2 } }));
  await room.ready;
  assert.equal(room.rejoin({ settleMs: 5, againMs: 5 }), true);
  assert.equal(sockets[0].sent.at(-1).t, "leave");
  assert.equal(room.status, "reconnecting");
  // nothing more is written meanwhile, and a second ask is refused
  assert.equal(room.rejoin(), false);
  assert.equal(room.claimHost(), false);
  // the old socket's late news is not taken
  sockets[0].serve({ t: "host", host: "member-two", rev: 9 });
  assert.equal(room.host, "member-one");
  await until(() => sockets[0].readyState === 3);
  await until(() => sockets[1]?.sent.length === 1);
  assert.equal(sockets[1].sent[0].t, "join");
  assert.equal(sockets[1].sent[0].member, "member-one");
  sockets[1].serve(joined({ rev: 3, v: 2, doc: { n: 2 } }));
  await until(() => room.status === "open");
  // closed rooms do not rejoin
  room.close();
  assert.equal(room.rejoin(), false);
});
