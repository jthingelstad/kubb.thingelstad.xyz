// Keep a replay for a pitch whose match ended before replays (docs/ROOMS.md section 10),
// from the room's records in the games bucket. Pull them first, as cloud-engineer, with
// `npm run games:pull -- --room <code>` into build/games/ (never in git: names).
//
//   node tools/backfill-replay.mjs --room <code> [--dir build/games]
//       builds the replay of the room's last finished match from its records and plays
//       it through this checkout's engine, comparing the hash after every action with
//       the one the players' browsers committed. Writes nothing.
//   node tools/backfill-replay.mjs --room <code> --write
//       then, as cloud-engineer, does for that one room what a `keep` would have: writes
//       the room's replay item and keeps the room and its document a year from the end
//       of that match. Only while the room's document still shows that very match (the
//       same number, ending on the same snapshot), and never over a kept replay.
//
// The replay sets out from the match's first snapshot (`start`): a document from before
// replays has no `setup`. The pitch offers it to anyone who arrives at the finished match
// (src/net/pitch.js lookForKept). The games bucket is only read, on this machine, to make
// the replay; it is served from the rooms table like any other.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { asciiJson, LIMITS } from "../backend/rooms/core.mjs";
import { isReplay, REPLAY_VERSION } from "../src/net/lobby.js";
import { matchesOf, parseRecord } from "./games.mjs";

// A recorded match ({ start, steps } from matchesOf) as { replay, at } (at: when its
// last action was recorded), or { why } when its records cannot make a whole one.
export function replayFromMatch(match) {
  if (!match.start) return { why: "its start was not recorded" };
  const log = [];
  let at = match.start.t;
  for (const [i, r] of match.steps.entries()) {
    const m = r.doc.match;
    if (m.seq !== i + 1) return { why: `a gap before action ${i + 1}` };
    const a =
      r.with && r.with.n === m.n && r.with.seq === m.seq ? r.with.a : null;
    if (!a) return { why: `action ${m.seq} was not recorded` };
    log.push({ a, h: m.hash });
    at = r.t;
  }
  const first = match.start.doc.match;
  const last = match.steps.at(-1)?.doc.match ?? first;
  const replay = {
    v: REPLAY_VERSION,
    n: match.n,
    start: first.snap,
    h0: first.hash,
    log,
    snap: last.snap,
    hash: last.hash,
    players: match.players,
    cpu: match.cpu ?? null,
  };
  return isReplay(replay) ? { replay, at } : { why: "not a replay" };
}

// A replay through `engine`, as a viewer would see it played: { actions, same,
// firstDiffers (1-based, or null), over (it ended), end (on the recorded snapshot's hash) }.
export function checkReplay(engine, replay) {
  engine.replayLoad(replay);
  let same = 0;
  let firstDiffers = null;
  let info = engine.replayInfo();
  while (!info.done) {
    const r = engine.replayStep();
    info = r.replay;
    if (r.ok && engine.hash().hash === replay.log[info.i - 1].h) same++;
    else firstDiffers ??= info.i;
  }
  const out = {
    actions: info.total,
    same,
    firstDiffers,
    over: engine.need().kind === "over",
    end: engine.hash().hash === replay.hash,
  };
  engine.replayEnd();
  return out;
}

// Whether a recorded snapshot is a finished match: the recorded one, not the replay's
// end (a finished match can play out otherwise under newer physics).
export function finished(engine, snap) {
  engine.restore(snap);
  return engine.need().kind === "over";
}

// Every match of a room's records, judged; `best` is the last finished one that makes a
// whole replay (a match still in play is never kept).
export function roomReplays(engine, records) {
  const found = [];
  for (const match of matchesOf(records)) {
    const r = replayFromMatch(match);
    if (!r.replay) {
      found.push({ n: match.n, why: r.why });
      continue;
    }
    const check = checkReplay(engine, r.replay);
    found.push({
      n: match.n,
      ...r,
      check,
      finished: finished(engine, r.replay.snap),
    });
  }
  return {
    found,
    best: found.filter((f) => f.replay && f.finished).at(-1) ?? null,
  };
}

// The write, against a room store (backend/rooms/dynamo-store.mjs): what `keep` does,
// for a match that ended at `at` (ms). Returns what happened, as text.
export async function keepBackfill(store, room, { replay, at }) {
  const data = asciiJson(replay);
  if (data.length > LIMITS.replayBytes)
    throw new Error(`the replay is ${data.length} bytes, over the limit`);
  const [current, stored] = await Promise.all([
    store.getRoom(room),
    store.getDoc(room),
  ]);
  if (!current || !stored?.doc)
    throw new Error(`${room}: the room is gone: there is nothing to keep`);
  const m = JSON.parse(stored.doc).match;
  if (!m || m.n !== replay.n || m.snap !== replay.snap)
    throw new Error(`${room}: the pitch no longer shows match ${replay.n}`);
  if ((current.keep?.v ?? 0) >= stored.v)
    return `${room}: a replay is kept already; nothing written`;
  // A replay item already there is this run's own only when it is this very replay (a
  // run that wrote it and stopped before the room): then the room is finished below.
  const there = await store.getReplay(room);
  if (there && (there.v !== stored.v || there.data !== data))
    return `${room}: a replay is kept already; nothing written`;
  const until = Math.floor(at / 1000) + LIMITS.keepTtl;
  if (
    !there &&
    !(await store.putReplay(room, { v: stored.v, t: at, data, exp: until }))
  )
    return `${room}: a replay is kept already; nothing written`;
  // the room record, on its revision: a visitor may write it meanwhile, so read again
  let next = null;
  for (let tries = 0; tries < 5 && !next; tries++) {
    const now = tries ? await store.getRoom(room) : current;
    if (!now) throw new Error(`${room}: the room went while writing`);
    if ((now.keep?.v ?? 0) >= stored.v) {
      next = now;
      break;
    }
    const want = {
      ...now,
      rev: now.rev + 1,
      exp: Math.max(now.exp, until),
      keep: { v: stored.v, until },
    };
    if (await store.putRoom(room, want, now.rev)) next = want;
  }
  if (!next)
    throw new Error(
      `${room}: the room kept changing; run it again (it finishes what is left)`,
    );
  await store.touchDoc(room, Math.max(next.exp, until));
  return `${room}: kept match ${replay.n} (version ${stored.v}, ${data.length} bytes) until ${new Date(until * 1000).toISOString().slice(0, 10)}`;
}

async function liveStore() {
  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb");
  const { CloudFormationClient, DescribeStacksCommand } =
    await import("@aws-sdk/client-cloudformation");
  const { STSClient, GetCallerIdentityCommand } =
    await import("@aws-sdk/client-sts");
  const { dynamoStore } = await import("../backend/rooms/dynamo-store.mjs");
  const config = JSON.parse(await fs.readFile("infra/deployment.json", "utf8"));
  const settings = { region: config.region, maxAttempts: 5 };
  const identity = await new STSClient(settings).send(
    new GetCallerIdentityCommand({}),
  );
  if (identity.Account !== config.account)
    throw new Error(`Unexpected AWS account ${identity.Account}`);
  const { Stacks } = await new CloudFormationClient(settings).send(
    new DescribeStacksCommand({ StackName: config.stacks.rooms }),
  );
  const table = Stacks[0].Outputs.find(
    (o) => o.OutputKey === "TableName",
  )?.OutputValue;
  if (!table) throw new Error("the rooms stack names no table");
  return dynamoStore({
    client: DynamoDBDocumentClient.from(new DynamoDBClient(settings)),
    table,
  });
}

async function readRoom(dir, room) {
  const names = (await fs.readdir(path.join(dir, room))).sort();
  const out = [];
  for (const name of names)
    if (/\.json(\.gz)?$/.test(name))
      out.push(parseRecord(await fs.readFile(path.join(dir, room, name))));
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i < 0 ? undefined : args[i + 1];
  };
  const room = flag("room");
  const dir = flag("dir") ?? "build/games";
  if (!room || !/^[2-9a-hjkmnp-z]{8,24}$/.test(room))
    throw new Error(
      "Usage: node tools/backfill-replay.mjs --room <code> [--write]",
    );
  const { Engine } = await import("../src/engine/index.js");
  const { bundleLua } = await import("./lua-bundle.mjs");
  const engine = await Engine.create({ sources: await bundleLua() });
  const { found, best } = roomReplays(engine, await readRoom(dir, room));
  for (const f of found)
    console.log(
      f.check
        ? `${room} match ${f.n}: ${f.check.actions} actions, ${f.check.same} on the players' hash${f.check.firstDiffers ? `, the first to differ is action ${f.check.firstDiffers} (${f.replay.log[f.check.firstDiffers - 1].a.type})` : ""}; ${f.check.over ? "it ends" : "it does not end"}${f.check.end ? " on the recorded result" : ", not on the recorded snapshot (the pitch shows that one)"}`
        : `${room} match ${f.n}: no replay (${f.why})`,
      f.check && !f.finished ? " (not finished as recorded: not kept)" : "",
    );
  if (!best) throw new Error(`${room}: no finished match makes a whole replay`);
  if (args.includes("--write"))
    console.log(await keepBackfill(await liveStore(), room, best));
  else console.log("Nothing written (--write writes it).");
}
