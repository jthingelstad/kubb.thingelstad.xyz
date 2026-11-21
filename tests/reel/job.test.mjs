// The reel function's job (backend/reels/job.mjs) over the memory store with a stand-in
// renderer, and its AWS adapters (backend/reels/aws.mjs) against fakes: what it reads,
// what it writes and where, and how a failure ends.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { memoryStore } from "../../backend/rooms/memory-store.mjs";
import {
  REEL_FIELDS,
  reelStore,
  s3Uploader,
} from "../../backend/reels/aws.mjs";
import { REEL_CACHE, runReel } from "../../backend/reels/job.mjs";
import { reelPaths } from "../../backend/reels/tag.mjs";
import { NoHighlights } from "../../backend/reels/highlights.mjs";

const ROOM = "abcdefgh23";
const T0 = 1_700_000_000_000;
const REPLAY = {
  v: 1,
  n: 1,
  engine: "0.7.1",
  log: [{ a: { type: "throw", how: "baton" } }],
  snap: "{}",
};
const JOB = "4-r1-0.7";

async function setup({ replay = REPLAY, v = 4 } = {}) {
  const store = memoryStore({ now: () => T0 });
  const exp = T0 / 1000 + 3600;
  await store.putReplay(ROOM, { v, t: T0, data: JSON.stringify(replay), exp });
  await store.putReel(
    ROOM,
    { v: 4, tag: "r1-0.7", job: JOB, at: T0, exp },
    { staleBefore: 0 },
  );
  const uploads = [];
  const logs = [];
  const fakeRender = async ({ out }) => {
    const files = {};
    for (const f of ["tall", "wide", "edit"]) {
      files[f] = `${out}/${f}`;
      fs.writeFileSync(files[f], f);
    }
    return { files, edit: { seconds: 39.27 } };
  };
  const run = (over = {}) =>
    runReel({
      input: { room: ROOM, v: 4, tag: "r1-0.7" },
      store,
      upload: async (key, file, type) =>
        uploads.push({ key, type, body: fs.readFileSync(file, "utf8") }),
      render: fakeRender,
      engine: "0.7.1",
      engines: ["0.7"],
      now: () => T0 + 5,
      log: (e) => logs.push(e),
      ...over,
    });
  return { store, uploads, logs, run };
}

test("a render: three files under reels/<code>/<v>-<tag>/, then the item says done", async () => {
  const h = await setup();
  const out = await h.run();
  assert.equal(out.state, "done");
  assert.deepEqual(
    h.uploads.map((u) => [u.key, u.type]),
    [
      [`reels/${ROOM}/4-r1-0.7/tall.mp4`, "video/mp4"],
      [`reels/${ROOM}/4-r1-0.7/wide.mp4`, "video/mp4"],
      [`reels/${ROOM}/4-r1-0.7/edit.json`, "application/json"],
    ],
  );
  const item = await h.store.getReel(ROOM);
  assert.equal(item.state, "done");
  assert.equal(item.tries, 1);
  assert.equal(item.seconds, 39.3);
  assert.deepEqual(
    { tall: item.tall, wide: item.wide, edit: item.edit },
    reelPaths(ROOM, 4, "r1-0.7"),
  );
  // the log names the step and the engine, never a team or player
  for (const e of h.logs) {
    assert.equal(e.engine, "0.7.1");
    assert.ok(e.step);
  }
  // done is done: a second invoke does nothing
  assert.equal((await h.run()).state, "skipped");
});

test("a replay of another engine, or a renderer without that engine, is failed, never rendered", async () => {
  for (const [replay, over] of [
    [{ ...REPLAY, engine: "0.8.0" }, {}],
    [{ ...REPLAY, engine: undefined }, {}],
    [REPLAY, { engine: "0.8.0" }],
    [REPLAY, { engines: [] }],
  ]) {
    const h = await setup({ replay });
    let rendered = false;
    const out = await h.run({
      ...over,
      render: async () => {
        rendered = true;
      },
    });
    assert.equal(out.state, "failed");
    assert.equal(out.why, "engine");
    assert.equal(rendered, false);
    assert.equal((await h.store.getReel(ROOM)).state, "failed");
  }
});

test("a replay gone or of another version is failed", async () => {
  const h = await setup({ v: 5 });
  assert.equal((await h.run()).why, "replay");
});

test("bad input is refused without touching the store", async () => {
  const h = await setup();
  for (const input of [
    null,
    { room: "no", v: 4, tag: "r1-0.7" },
    { room: ROOM, v: "4", tag: "r1-0.7" },
    { room: ROOM, v: 4, tag: "../x" },
  ]) {
    const out = await h.run({ input });
    assert.equal(out.state, "refused");
  }
  assert.equal((await h.store.getReel(ROOM)).tries, 0);
});

test("a render that throws is thrown again for Lambda's retry, then failed on the last try", async () => {
  const h = await setup();
  const boom = async () => {
    throw new Error("ffmpeg 1");
  };
  await assert.rejects(h.run({ render: boom }), /ffmpeg 1/);
  assert.equal((await h.store.getReel(ROOM)).state, "rendering");
  const last = await h.run({ render: boom });
  assert.deepEqual(last, { state: "failed", why: "render" });
  const item = await h.store.getReel(ROOM);
  assert.equal(item.state, "failed");
  assert.equal(item.tries, 2);
  assert.equal(h.uploads.length, 0);
});

test("a render taken over by a newer request does not write over it", async () => {
  const h = await setup();
  await h.store.putReel(
    ROOM,
    { v: 9, tag: "r1-0.7", job: "9-r1-0.7", at: T0, exp: T0 / 1000 + 3600 },
    { staleBefore: 0 },
  );
  assert.equal((await h.run()).state, "skipped");
  assert.equal((await h.store.getReel(ROOM)).job, "9-r1-0.7");
});

// ---------- the AWS adapters ----------

class ConditionalCheckFailedException extends Error {
  name = "ConditionalCheckFailedException";
}

test("the AWS store asks for exactly the replay's attributes and updates only the reel item's", async () => {
  const calls = [];
  const reel = {
    pk: `pitch#${ROOM}`,
    sk: "reel",
    job: JOB,
    state: "rendering",
  };
  const client = {
    async send(cmd) {
      const i = cmd.input;
      calls.push([cmd.constructor.name, i]);
      if (cmd.constructor.name === "GetCommand")
        return {
          Item: {
            v: 4,
            z: gzipSync(JSON.stringify({ ...REPLAY, snap: undefined })),
            s: gzipSync('{"final":true}'),
            exp: T0 / 1000 + 10,
          },
        };
      const n = i.ExpressionAttributeNames;
      const v = i.ExpressionAttributeValues;
      if (reel.job !== v[":job"]) throw new ConditionalCheckFailedException();
      if (/ADD/.test(i.UpdateExpression)) {
        reel.tries = (reel.tries ?? 0) + 1;
        return { Attributes: { tries: reel.tries } };
      }
      for (const [alias, name] of Object.entries(n))
        if (alias.startsWith("#f")) reel[name] = v[`:${alias.slice(1)}`];
      return {};
    },
  };
  const store = reelStore({ client, table: "rooms", now: () => T0 });
  const kept = await store.getReplay(ROOM);
  assert.equal(kept.v, 4);
  assert.equal(JSON.parse(kept.data).engine, "0.7.1");
  // the final snapshot is put on the kept replay, as the api function serves it
  assert.equal(JSON.parse(kept.data).snap, '{"final":true}');
  const get = calls[0][1];
  assert.deepEqual(get.Key, { pk: `pitch#${ROOM}`, sk: "replay" });
  assert.deepEqual(Object.values(get.ExpressionAttributeNames).sort(), [
    "exp",
    "s",
    "v",
    "z",
  ]);
  assert.deepEqual(await store.attemptReel(ROOM, JOB), { tries: 1 });
  assert.equal(await store.attemptReel(ROOM, "9-r1-0.7"), null);
  assert.equal(
    await store.finishReel(ROOM, JOB, { state: "done", wide: "/w" }),
    true,
  );
  assert.equal(reel.state, "done");
  assert.equal(await store.finishReel(ROOM, "x", { state: "failed" }), false);
  await assert.rejects(store.finishReel(ROOM, JOB, { doc: "x" }), /not a reel/);
  // every update names only the reel item's own attributes and the key
  for (const [name, i] of calls.filter(([n]) => n === "UpdateCommand")) {
    assert.deepEqual(i.Key.sk, "reel", name);
    for (const attr of Object.values(i.ExpressionAttributeNames))
      assert.ok(
        [...REEL_FIELDS, "job"].includes(attr),
        `${attr} is a reel field`,
      );
  }
});

test("the uploader writes only under reels/, typed and cached for good", async () => {
  const sent = [];
  const upload = s3Uploader({
    s3: { send: async (cmd) => sent.push(cmd.input) },
    bucket: "site",
  });
  const file = new URL("../fixtures/snap-over.json", import.meta.url);
  await upload("reels/a/1-r1-0.7/edit.json", file, "application/json");
  assert.equal(sent[0].Bucket, "site");
  assert.equal(sent[0].ContentType, "application/json");
  assert.equal(sent[0].CacheControl, REEL_CACHE);
  assert.equal(REEL_CACHE, "public, max-age=31536000, immutable");
  await assert.rejects(upload("index.html", file, "text/html"), /reel key/);
});

test("a match with no throw (resigned before the first) is failed empty at once, never rendered", async () => {
  const h = await setup({ replay: { ...REPLAY, log: [] } });
  let rendered = false;
  const out = await h.run({
    render: async () => {
      rendered = true;
    },
  });
  assert.deepEqual(out, { state: "failed", why: "empty" });
  assert.equal(rendered, false);
  const item = await h.store.getReel(ROOM);
  assert.equal(item.state, "failed");
  assert.equal(item.why, "empty");
  assert.equal(item.tries, 1);
  assert.ok(h.logs.some((e) => e.step === "failed" && e.why === "empty"));
  assert.equal(h.uploads.length, 0);
});

test("a render that finds no moment is failed empty on its first try, not retried", async () => {
  const h = await setup();
  const out = await h.run({
    render: async () => {
      throw new NoHighlights();
    },
  });
  assert.deepEqual(out, { state: "failed", why: "empty" });
  assert.equal((await h.store.getReel(ROOM)).tries, 1);
  // a retry that came anyway finds it failed and does nothing
  assert.equal((await h.run()).state, "skipped");
});

test("a job never renders past its tries, whatever invokes it", async () => {
  const h = await setup();
  let renders = 0;
  const hang = () => {
    renders++;
    return new Promise(() => {});
  };
  // two tries die silently (a timeout), the third is refused before rendering
  for (let i = 0; i < 2; i++) {
    h.run({ render: hang });
    await new Promise((r) => setImmediate(r));
  }
  const third = await h.run({ render: hang });
  assert.deepEqual(third, { state: "failed", why: "render" });
  assert.equal(renders, 2);
});
