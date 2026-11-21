// The open games list, as pure logic over a plain store. `LobbyDO` keeps the entries in
// SQLite and calls these; the node tests call them on a Map.
//
// Each pitch reports its own entry (the core's `listing` effect: an entry, or null to
// take it off) with a revision `[at, seq]` that only goes up for one pitch. A report
// older than the one held is ignored, so reports that arrive out of order cannot list a
// pitch again after a later report took it off: a take-off is kept as a tombstone until
// it expires. An entry the pitch has not said again within `ttlMs` expires (the pitch
// says it every 5 minutes while listed, so a pitch that died quietly drops off).

export const LOBBY = Object.freeze({
  ttlMs: 15 * 60 * 1000, // an entry not reported again in this long is gone
  maxAgeMs: 24 * 3600 * 1000, // nothing made longer ago than this is listed
  listMax: 20, // the newest this many
  seatsMax: 12,
});

const STATES = ["waiting", "playing"];
const PITCH = /^[2-9a-hjkmnp-z]{8,24}$/;

const isCount = (n, max) => Number.isInteger(n) && n >= 0 && n <= max;

// A listing entry from the core, checked, or null when it is not one.
export function cleanEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const { made, players, watchers, seats, state } = entry;
  if (!Number.isFinite(made)) return null;
  if (!isCount(seats, LOBBY.seatsMax) || seats < 1) return null;
  if (!isCount(players, 1000) || !isCount(watchers, 1000)) return null;
  if (!STATES.includes(state)) return null;
  return { made, players, watchers, seats, state };
}

const newer = (a, b) => a.at > b.at || (a.at === b.at && a.seq > b.seq);

// Apply one report to `store` (get/set/delete by pitch code). Returns true when it
// changed what is held.
export function report(store, { pitch, entry, at, seq = 0 }, now) {
  if (typeof pitch !== "string" || !PITCH.test(pitch)) return false;
  if (!Number.isFinite(at)) return false;
  const held = store.get(pitch);
  const rev = { at, seq };
  if (held && !newer(rev, held)) return false;
  const e = entry === null ? null : cleanEntry(entry);
  if (entry !== null && !e) return false;
  store.set(pitch, { pitch, at, seq, exp: now + LOBBY.ttlMs, entry: e });
  return true;
}

// What the page gets: the newest listMax live entries made in the last day, newest
// first. Counts, state and age only: never names or member ids.
export function listing(rows, now) {
  return rows
    .filter(
      (r) => r.entry && r.exp > now && now - r.entry.made <= LOBBY.maxAgeMs,
    )
    .sort((a, b) => b.entry.made - a.entry.made || (a.pitch < b.pitch ? -1 : 1))
    .slice(0, LOBBY.listMax)
    .map(({ pitch, entry: e }) => ({
      pitch,
      made: e.made,
      age: Math.max(0, now - e.made),
      players: e.players,
      watchers: e.watchers,
      seats: e.seats,
      state: e.state,
    }));
}
