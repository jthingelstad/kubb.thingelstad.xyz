// What the api function keeps in the private games bucket, for good. Nothing in it is
// ever served; tools/games.mjs and tools/reports.mjs pull it.
//
//   games/pitch/<code>/<made>/<n>-<seq>.json.gz   every push of a pitch's start and actions,
//                                                 the signed envelope byte for byte
//                                                 (backend/api/push.mjs pushKey)
//   games/browser/<yyyy-mm-dd>/<ms>-<random>.json.gz   a match played on one device:
//                                                 { t, game }, as the rooms function kept it
//   reports/<yyyy-mm-dd>/<ms>-<random>.json.gz    a player's report: { t, report }, the same
//
// The players' names are in them. Nothing names the sender: no address, browser
// string or member id is added here (a push's actions carry the pitch's member ids, as
// the rooms function's records did).

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function randomTail(n = 8) {
  let out = "";
  for (const b of randomBytes(n)) out += ALPHABET[b % ALPHABET.length];
  return out;
}

const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const stamp = (t) => String(t).padStart(13, "0");

export const reportKey = ({ t, tail = randomTail() }) =>
  `reports/${dayOf(t)}/${stamp(t)}-${tail}.json.gz`;
export const gameKey = ({ t, tail = randomTail() }) =>
  `games/browser/${dayOf(t)}/${stamp(t)}-${tail}.json.gz`;

// `report` and `game` arrive as ASCII JSON text and go in as they are.
export const reportText = ({ t, report }) =>
  `{"t":${Number(t)},"report":${report}}`;
export const gameText = ({ t, game }) => `{"t":${Number(t)},"game":${game}}`;

const put = (client, bucket, key, body, extra = {}) =>
  client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: gzipSync(body),
      ContentType: "application/json",
      ContentEncoding: "gzip",
      ...extra,
    }),
  );

// A push recorded once: S3's conditional write (If-None-Match: *) refuses a second object
// under the same key, so a retried push is "had" and the first copy stays.
export function s3Pushes({ client, bucket }) {
  return async function recordPush({ key, raw }) {
    if (!key.startsWith("games/pitch/"))
      throw new Error(`not a push key: ${key}`);
    try {
      await put(client, bucket, key, raw, { IfNoneMatch: "*" });
      return "kept";
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 412) return "had";
      throw error; // 409 (the same key being written at once) is retried by the pitch
    }
  };
}

export function s3Reports({ client, bucket }) {
  return async (entry) => {
    const key = reportKey(entry);
    await put(client, bucket, key, reportText(entry));
    return key;
  };
}

export function s3Games({ client, bucket }) {
  return async (entry) => {
    const key = gameKey(entry);
    await put(client, bucket, key, gameText(entry));
    return key;
  };
}

// For the tests: the same keys and texts, kept in `kept` (key -> Buffer or text).
export function memoryRecords() {
  const kept = new Map();
  return {
    kept,
    async recordPush({ key, raw }) {
      if (kept.has(key)) return "had";
      kept.set(key, Buffer.from(raw));
      return "kept";
    },
    async keepReport(entry) {
      const key = reportKey(entry);
      kept.set(key, reportText(entry));
      return key;
    },
    async recordGame(entry) {
      const key = gameKey(entry);
      kept.set(key, gameText(entry));
      return key;
    },
  };
}
