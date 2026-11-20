// One highlight reel render, start to end, over injected adapters, so the same code is
// the reel function on AWS (handler.mjs: DynamoDB + S3) and the local server
// (tools/rooms-dev.mjs: the memory store + files). docs/REEL.md, docs/ROOMS.md
// section 12.
//
//   store   getReplay(code) -> { v, data, exp } | null        the kept replay (JSON text)
//           attemptReel(code, job) -> { tries } | null   one more try of this very render,
//                       only while the reel item carries `job` and says "rendering"
//           finishReel(code, job, fields) -> bool        sets the reel item's outcome,
//                       only while it still carries `job`
//   upload(key, file, contentType)                       one file to the site bucket
//   render({ replay, code, out }) -> { files: { tall, wide, edit }, edit }
//
// It renders only a match played on the engine it carries: the tag names the engine's
// major.minor, the replay says what it was played on, and both must be `engine`'s and
// among `engines` (REEL_ENGINES). It logs the step, the engine and the outcome, never a
// name: the replay's team and player names stay in the reel and the edit list.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  REEL_TAG,
  REEL_TRIES,
  majorMinor,
  reelJob,
  reelKeys,
  reelPaths,
  tagEngine,
} from "./tag.mjs";

const ROOM_CODE = /^[2-9a-hjkmnp-z]{8,24}$/; // as backend/rooms/core.mjs

export const REEL_CACHE = "public, max-age=31536000, immutable";

export const REEL_TYPES = {
  tall: "video/mp4",
  wide: "video/mp4",
  edit: "application/json",
};

export async function runReel({
  input,
  store,
  upload,
  render,
  engine, // the engine version this renderer carries, "0.7.1"
  engines, // REEL_ENGINES, parsed: ["0.7"]
  tmp = os.tmpdir(),
  now = Date.now,
  log = (entry) => console.log(JSON.stringify(entry)),
}) {
  const { room, v, tag } = input ?? {};
  const carried = majorMinor(engine);
  const say = (step, extra = {}) =>
    log({ reel: room, v, tag, engine, step, ...extra });
  if (
    typeof room !== "string" ||
    !ROOM_CODE.test(room) ||
    !Number.isInteger(v) ||
    v < 1 ||
    typeof tag !== "string" ||
    !REEL_TAG.test(tag)
  ) {
    say("refused", { why: "input" });
    return { state: "refused", why: "input" };
  }
  const job = reelJob(v, tag);
  const tried = await store.attemptReel(room, job);
  if (!tried) {
    // done already, failed, or a newer request took the item over
    say("skipped");
    return { state: "skipped" };
  }
  const fail = async (why) => {
    await store.finishReel(room, job, { state: "failed", why, done: now() });
    say("failed", { why, tries: tried.tries });
    return { state: "failed", why };
  };

  let out = null;
  try {
    const kept = await store.getReplay(room);
    if (!kept || kept.v !== v) return await fail("replay");
    const replay = JSON.parse(kept.data);
    const played = majorMinor(replay?.engine);
    if (
      !carried ||
      tagEngine(tag) !== carried ||
      played !== carried ||
      !engines.includes(carried)
    )
      return await fail("engine");

    say("render", { tries: tried.tries });
    out = fs.mkdtempSync(path.join(tmp, "reel-"));
    const result = await render({ replay, code: room, out });
    const keys = reelKeys(room, v, tag);
    for (const f of ["tall", "wide", "edit"])
      await upload(keys[f], result.files[f], REEL_TYPES[f]);
    const paths = reelPaths(room, v, tag);
    const seconds = Math.round((result.edit?.seconds ?? 0) * 10) / 10;
    const mine = await store.finishReel(room, job, {
      state: "done",
      ...paths,
      seconds,
      done: now(),
    });
    say("done", { seconds, kept: mine });
    return { state: "done", ...paths, seconds };
  } catch (error) {
    say("error", {
      tries: tried.tries,
      error: error?.name,
      message: String(error?.message ?? "").slice(0, 200),
    });
    // Lambda tries an asynchronous invoke once more when it fails; after the last try
    // the reel is marked failed for good (a new look tag renders it again).
    if (tried.tries >= REEL_TRIES) return await fail("render");
    throw error;
  } finally {
    if (out) fs.rmSync(out, { recursive: true, force: true });
  }
}
