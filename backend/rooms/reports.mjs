// Reports: a player says a throw looked wrong (MENU, REPORT A THROW), in their own words,
// and the browser sends the game as it stood, so the throw can be played again offline
// and tested (Jamie, 2026-11-16). docs/ROOMS.md section 8.
//
//   reports/<yyyy-mm-dd>/<epoch ms, 13 digits>-<random>.json.gz
//
// One object a report, gzipped JSON: { t, report }. `t` is the server's clock; `report`
// is what the browser sent (src/net/report.js), as ASCII JSON text. Nothing names the
// person: no connection id, member id, address or browser string is added here. The
// games bucket is private and nothing in it is ever served. tools/reports.mjs pulls them.

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";

export const REPORT_PREFIX = "reports/";

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function randomTail(n = 8) {
  const bytes = randomBytes(n);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function reportKey({ t, tail = randomTail() }) {
  const day = new Date(t).toISOString().slice(0, 10);
  return `${REPORT_PREFIX}${day}/${String(t).padStart(13, "0")}-${tail}.json.gz`;
}

// `report` arrives as ASCII JSON text and goes in as it is.
export function reportText({ t, report }) {
  return `{"t":${Number(t)},"report":${report}}`;
}

export function s3Reporter({ client, bucket }) {
  return async function keepReport(entry) {
    const key = reportKey(entry);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: gzipSync(reportText(entry)),
        ContentType: "application/json",
        ContentEncoding: "gzip",
      }),
    );
    return key;
  };
}

// For the tests and the local server: keeps { key, t, report, text } in `kept`.
export function memoryReporter() {
  const kept = [];
  async function keepReport(entry) {
    const key = reportKey(entry);
    kept.push({ key, t: entry.t, text: reportText(entry) });
    return key;
  }
  keepReport.kept = kept;
  return keepReport;
}
