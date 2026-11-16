// Recording: the core hands every committed document version to `record`, the S3
// recorder writes it as one gzipped object, and a recorder that fails costs nobody a move.
import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { asciiJson, createRooms } from "../../backend/rooms/core.mjs";
import { memoryStore } from "../../backend/rooms/memory-store.mjs";
import {
  recordKey,
  recordText,
  s3Recorder,
} from "../../backend/rooms/recorder.mjs";

const ROOM = "abcdefgh";
const A = "member-a-1";
const B = "member-b-1";

function harness(record) {
  let t = 1_700_000_000_000;
  const inbox = new Map();
  const rooms = createRooms({
    store: memoryStore({ now: () => t }),
    now: () => t,
    record,
    async send(conn, text) {
      if (!inbox.has(conn)) inbox.set(conn, []);
      inbox.get(conn).push(JSON.parse(text));
      return true;
    },
  });
  const say = (conn, msg) => rooms.message(conn, asciiJson(msg));
  const last = (conn) => inbox.get(conn).at(-1);
  return { say, last, tick: (ms) => (t += ms) };
}

test("a committed version is recorded with its action; a lost one is not", async () => {
  const seen = [];
  const h = harness(async (entry) => void seen.push(entry));
  await h.say("c1", { t: "join", room: ROOM, member: A, name: "Åsa" });
  await h.say("c2", { t: "join", room: ROOM, member: B });
  assert.equal(seen.length, 0, "joining records nothing");

  await h.say("c1", {
    t: "set",
    id: 1,
    base: 0,
    doc: { teams: { A: ["Åsa"] } },
  });
  h.tick(5);
  await h.say("c2", {
    t: "set",
    id: 2,
    base: 1,
    doc: { started: true },
    with: { n: 1, seq: 1, a: { type: "throw" } },
  });
  await h.say("c1", { t: "set", id: 3, base: 1, doc: { late: true } });
  assert.equal(h.last("c1").t, "no", "the loser of the compare-and-set");

  assert.equal(seen.length, 2);
  assert.deepEqual(
    seen.map((e) => [e.room, e.v, e.by, e.t]),
    [
      [ROOM, 1, A, 1_700_000_000_000],
      [ROOM, 2, B, 1_700_000_000_005],
    ],
  );
  assert.equal(seen[0].with, null);
  assert.deepEqual(JSON.parse(seen[1].with), {
    n: 1,
    seq: 1,
    a: { type: "throw" },
  });
  assert.match(seen[0].doc, /^[\x00-\x7e]+$/, "ASCII JSON text, as stored");
  assert.deepEqual(JSON.parse(seen[0].doc), { teams: { A: ["Åsa"] } });
});

test("a recorder that fails does not cost the room its move", async (t) => {
  t.mock.method(console, "error", () => {});
  const h = harness(async () => {
    throw new Error("no bucket");
  });
  await h.say("c1", { t: "join", room: ROOM, member: A });
  await h.say("c2", { t: "join", room: ROOM, member: B });
  await h.say("c1", { t: "set", id: 1, base: 0, doc: { x: 1 } });
  assert.deepEqual(h.last("c1"), { t: "ok", id: 1, v: 1 });
  assert.equal(h.last("c2").t, "doc");
  assert.equal(console.error.mock.callCount(), 1);
});

test("the S3 recorder writes one gzipped object a version", async () => {
  const sent = [];
  const record = s3Recorder({
    client: { send: async (command) => void sent.push(command.input) },
    bucket: "games-bucket",
  });
  const entry = {
    room: ROOM,
    v: 12,
    t: 1_700_000_000_000,
    by: A,
    doc: '{"match":{"snap":"{\\"a\\":1.0}"}}',
    with: '{"n":1,"seq":3,"a":{"type":"raise"}}',
  };
  await record(entry);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].Bucket, "games-bucket");
  assert.equal(sent[0].Key, "games/abcdefgh/1700000000000-000012.json.gz");
  assert.equal(sent[0].Key, recordKey(entry));
  assert.equal(sent[0].ContentEncoding, "gzip");
  const text = gunzipSync(sent[0].Body).toString("utf8");
  assert.equal(text, recordText(entry));
  const back = JSON.parse(text);
  assert.equal(
    back.doc.match.snap,
    '{"a":1.0}',
    "the snapshot text, byte for byte",
  );
  assert.deepEqual(back.with, { n: 1, seq: 3, a: { type: "raise" } });
  assert.deepEqual(JSON.parse(recordText({ ...entry, with: null })).with, null);
});
