// Every committed version of a room's document, kept for good in S3: the lobby as it
// fills, the match's start, and the snapshot after every action with the action that made
// it (the `with` of the `set`). tools/games.mjs pulls them and replays the matches through
// the engine, which is how a throw that went wrong on someone's screen becomes a test.
//
//   games/<room>/<epoch ms, 13 digits>-<v, 6 digits>.json.gz
//
// One object a version, gzipped JSON: { room, v, t, by, with, doc }. The names players
// typed are in the document, so the bucket is private and nothing here is ever served.
// A room code used again after its room expired starts at v 1 again: the time in the key
// keeps the two apart.

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { gzipSync } from "node:zlib";

export const RECORD_PREFIX = "games/";

export function recordKey({ room, v, t }) {
  return `${RECORD_PREFIX}${room}/${String(t).padStart(13, "0")}-${String(v).padStart(6, "0")}.json.gz`;
}

// `doc` and `with` arrive as ASCII JSON text and go in as they are, byte for byte: a
// snapshot is opaque text whose hash must still match when it is read back.
export function recordText({ room, v, t, by, doc, with: rider }) {
  const head = JSON.stringify({ room, v, t, by });
  return `${head.slice(0, -1)},"with":${rider ?? "null"},"doc":${doc}}`;
}

export function s3Recorder({ client, bucket }) {
  return async function record(entry) {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: recordKey(entry),
        Body: gzipSync(recordText(entry)),
        ContentType: "application/json",
        ContentEncoding: "gzip",
      }),
    );
  };
}
