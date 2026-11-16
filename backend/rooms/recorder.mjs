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
//
// A match played in one browser (against the computer, or watching the computer play
// itself) has no room. The browser sends it whole when it ends (a `game` message,
// docs/ROOMS.md section 7) and it is kept beside the rooms' records:
//
//   games/browser/<yyyy-mm-dd>/<epoch ms, 13 digits>-<8 random>.json.gz
//
// holding { t, game }: the server's time and the match as the browser sent it
// (src/net/record.js). "browser" cannot be a room code (room codes are 8 to 24
// characters and have no "o"), so the two never meet. Nothing names the sender.

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { gzipSync } from "node:zlib";
import { randomTail } from "./reports.mjs";

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

export const BROWSER_PREFIX = `${RECORD_PREFIX}browser/`;

export function browserGameKey({ t, tail = randomTail() }) {
  const day = new Date(t).toISOString().slice(0, 10);
  return `${BROWSER_PREFIX}${day}/${String(t).padStart(13, "0")}-${tail}.json.gz`;
}

// `game` arrives as ASCII JSON text and goes in as it is (its snapshots are opaque text).
export function browserGameText({ t, game }) {
  return `{"t":${Number(t)},"game":${game}}`;
}

export function s3GameRecorder({ client, bucket }) {
  return async function recordGame(entry) {
    const key = browserGameKey(entry);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: gzipSync(browserGameText(entry)),
        ContentType: "application/json",
        ContentEncoding: "gzip",
      }),
    );
    return key;
  };
}

// For the tests: keeps { key, t, text } in `kept`.
export function memoryGameRecorder() {
  const kept = [];
  async function recordGame(entry) {
    const key = browserGameKey(entry);
    kept.push({ key, t: entry.t, text: browserGameText(entry) });
    return key;
  }
  recordGame.kept = kept;
  return recordGame;
}
