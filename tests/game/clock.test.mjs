// src/game/clock.js: a match's start and its actions' stamps on one basis (Codex on
// #117). The engine subtracts wall-clock fields with no time zone, so a stamp must be
// on the start's own clock: the host's offset at the start, from the sender's UTC.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  startStamp,
  stampOn,
  minutesOf,
  MAX_MINUTES,
} from "../../src/game/clock.js";

const utc = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h, mi);
// a start as a host at `offset` minutes east of UTC writes it at the UTC instant `at`
const startAt = (at, offset) => {
  const t = new Date(at + offset * 60000);
  return {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
    hour: t.getUTCHours(),
    min: t.getUTCMinutes(),
    utcOffset: offset,
  };
};

test("the start is the local wall clock with its offset", () => {
  const d = new Date(2026, 10, 22, 14, 5);
  const s = startStamp(d);
  assert.deepEqual(
    [s.year, s.month, s.day, s.hour, s.min],
    [2026, 11, 22, 14, 5],
  );
  assert.equal(s.utcOffset, -d.getTimezoneOffset());
});

test("a member two hours away resigns ten minutes in: ten minutes", () => {
  // the host in Chicago (UTC-6), the resigner anywhere: only their UTC clock counts
  const t0 = utc(2026, 11, 22, 20, 0);
  const start = startAt(t0, -360);
  const at = stampOn(start, t0 + 10 * 60000);
  assert.equal(minutesOf(start, at), 10);
  assert.deepEqual([at.hour, at.min], [14, 10], "on the host's clock");
});

test("across midnight, a month's end and a year's end", () => {
  for (const [t0, offset] of [
    [utc(2026, 11, 23, 5, 50), -360], // 23:50 in Chicago on the 22nd
    [utc(2026, 11, 30, 23, 45), 0], // the last of November
    [utc(2026, 12, 31, 22, 55), 60], // New Year's Eve in Stockholm
  ]) {
    const start = startAt(t0, offset);
    const at = stampOn(start, t0 + 25 * 60000);
    assert.equal(minutesOf(start, at), 25, JSON.stringify(start));
  }
});

test("a daylight-saving change during the match moves nothing", () => {
  // the US falls back at 2026-11-01 07:00 UTC: a match begun at 01:40 CDT (UTC-5)
  // and resigned 40 minutes later, at 01:20 CST on the host's new clock, is 40 minutes
  const t0 = utc(2026, 11, 1, 6, 40);
  const start = startAt(t0, -300);
  const at = stampOn(start, t0 + 40 * 60000);
  assert.equal(minutesOf(start, at), 40);
});

test("a stamp that cannot be true is not made; an old start gets none", () => {
  const t0 = utc(2026, 11, 22, 20, 0);
  const start = startAt(t0, -360);
  assert.equal(stampOn(start, t0 - 5 * 60000), null, "before the start");
  assert.equal(
    stampOn(start, t0 + (MAX_MINUTES + 1) * 60000),
    null,
    "absurdly long",
  );
  const old = { year: 2026, month: 11, day: 22, hour: 14, min: 0 };
  assert.equal(stampOn(old, t0), null, "no offset: no stamp");
  assert.equal(minutesOf(start, { ...start, hour: start.hour - 1 }), null);
  assert.equal(minutesOf(start, null), null);
});

test("solo, watch and a pitch's START make the start with the same function", () => {
  const main = fs.readFileSync("src/main.js", "utf8");
  const pitch = fs.readFileSync("src/net/pitch.js", "utf8");
  assert.equal((main.match(/start: startStamp\(now\)/g) || []).length, 2);
  assert.equal((pitch.match(/start: startStamp\(now\)/g) || []).length, 1);
  for (const src of [main, pitch])
    assert.ok(!/getMinutes\(\)/.test(src), "no start stamped by hand");
});
