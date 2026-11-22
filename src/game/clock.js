// A match's clock (Codex on #117): the start and the stamps on its actions on one basis.
//
// The engine takes a match's start and finish as wall-clock fields ({ year, month, day,
// hour, min }) and subtracts them with no time zone (its notation.minutesBetween). The
// start is the host's local wall clock (the game file's Start line shows it), so a stamp
// made in another member's local time could be hours off, or before the start. The start
// therefore carries the host's UTC offset at that moment (`utcOffset`, minutes east of
// UTC; the engine keeps the start table whole), and every later stamp is the sender's
// UTC clock expressed on that same offset. A daylight-saving change during the match
// moves nothing: the offset is the start's. A start without one (made before this) gets
// no stamps: no length rather than a wrong one.
//
//   startStamp(date?)           the start for a new match: solo, watch and a pitch's START
//   stampOn(start, nowMs?)      an action's `at` on the start's basis, or null
//   minutesOf(start, finish)    the length in whole minutes, or null when it cannot be true
//
// What the engine could carry instead: the start's UTC instant (or offset) as a field of
// its own, and `at` as a UTC instant, so it reckons the length itself.

// The longest a match can honestly last; past it a stamp is a clock gone wrong.
export const MAX_MINUTES = 12 * 60;

const FIELDS = ["year", "month", "day", "hour", "min"];

export function startStamp(d = new Date()) {
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    min: d.getMinutes(),
    utcOffset: -d.getTimezoneOffset(),
  };
}

const asUtc = (t) =>
  Date.UTC(t.year, t.month - 1, t.day, t.hour ?? 0, t.min ?? 0) / 60000;

export function minutesOf(start, finish) {
  if (!start || !finish) return null;
  const whole = (t) => FIELDS.every((k) => Number.isFinite(t[k]));
  if (!whole(start) || !whole(finish)) return null;
  const m = Math.round(asUtc(finish) - asUtc(start));
  return m >= 0 && m <= MAX_MINUTES ? m : null;
}

export function stampOn(start, nowMs = Date.now()) {
  if (!start || !Number.isFinite(start.utcOffset)) return null;
  const t = new Date(nowMs + start.utcOffset * 60000);
  const at = {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
    hour: t.getUTCHours(),
    min: t.getUTCMinutes(),
  };
  return minutesOf(start, at) == null ? null : at;
}
