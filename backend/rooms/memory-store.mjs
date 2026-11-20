// The room store in memory: the local server (tools/rooms-dev.mjs) and the tests. Same
// contract as dynamo-store.mjs (see core.mjs), including the conditional writes and the
// rule that an item past its `exp` (epoch seconds) is not there.

import { listingKey } from "./core.mjs";
import { REEL_TRIES } from "../reels/tag.mjs";

export function memoryStore({ now = Date.now } = {}) {
  const rooms = new Map();
  const docs = new Map();
  const conns = new Map();
  const replays = new Map(); // code -> { v, t, data, exp }
  const reels = new Map(); // code -> { v, tag, job, state, at, tries, ..., exp }
  const reelDays = new Map(); // day -> { n, exp }
  const parts = new Map(); // "conn id" -> { exp, got: Map(i -> text) }
  const listings = new Map(); // "<made 13>#<code>" -> { room, made, players, seats, state, exp }

  const live = (item) => (item && item.exp * 1000 > now() ? item : null);
  const copy = (item) => (item ? structuredClone(item) : null);

  return {
    rooms,
    docs,
    conns,
    replays,
    reels,
    reelDays,
    parts,
    listings,

    async getRoom(code) {
      return copy(live(rooms.get(code)));
    },
    async putRoom(code, room, prevRev) {
      if ((live(rooms.get(code))?.rev ?? 0) !== prevRev) return false;
      rooms.set(code, copy(room));
      return true;
    },

    async getDoc(code) {
      return copy(live(docs.get(code)));
    },
    async putDoc(code, doc, base) {
      if ((live(docs.get(code))?.v ?? 0) !== base) return false;
      docs.set(code, copy(doc));
      return true;
    },

    async touchDoc(code, exp) {
      const doc = live(docs.get(code));
      if (doc) doc.exp = exp;
    },

    async putReplay(code, item) {
      if ((live(replays.get(code))?.v ?? 0) >= item.v) return false;
      replays.set(code, copy(item));
      return true;
    },
    async getReplay(code) {
      return copy(live(replays.get(code)));
    },

    // Highlight reels (core.mjs; the renderer's side is in backend/reels/job.mjs).
    async getReel(code) {
      return copy(live(reels.get(code)));
    },
    async putReel(code, { v, tag, job, at, exp }, { staleBefore }) {
      const had = live(reels.get(code));
      const may =
        !had ||
        had.v < v ||
        (had.v === v && had.tag !== tag) ||
        (had.job === job &&
          had.state === "rendering" &&
          had.at < staleBefore &&
          (had.tries ?? 0) < REEL_TRIES);
      if (!may) return false;
      reels.set(code, {
        v,
        tag,
        job,
        state: "rendering",
        at,
        tries: 0,
        exp,
      });
      return true;
    },
    async dropReel(code, job) {
      if (reels.get(code)?.job === job) reels.delete(code);
    },
    async countReel(day, cap, exp) {
      const had = live(reelDays.get(day));
      if ((had?.n ?? 0) >= cap) return false;
      reelDays.set(day, { n: (had?.n ?? 0) + 1, exp });
      return true;
    },
    // The renderer's side: one more try of this very render, while it is rendering.
    async attemptReel(code, job) {
      const had = live(reels.get(code));
      if (!had || had.job !== job || had.state !== "rendering") return null;
      had.tries = (had.tries ?? 0) + 1;
      return { tries: had.tries };
    },
    async finishReel(code, job, fields) {
      const had = live(reels.get(code));
      if (!had || had.job !== job) return false;
      Object.assign(had, structuredClone(fields));
      return true;
    },

    async putConn(conn, who) {
      conns.set(conn, copy(who));
    },
    async getConn(conn) {
      return copy(live(conns.get(conn)));
    },
    async delConn(conn) {
      conns.delete(conn);
      for (const key of parts.keys())
        if (key.startsWith(`${conn} `)) parts.delete(key);
    },

    // Kept only when newer than what is there (by the room's rev); false when stale.
    async putListing(code, entry) {
      const key = listingKey(code, entry.made);
      const had = listings.get(key);
      if (had && had.rev >= entry.rev) return false;
      listings.set(key, { room: code, ...entry });
      return true;
    },
    async listOpen({ since, limit, now: seconds }) {
      return [...listings.entries()]
        .filter(([key]) => key >= String(since).padStart(13, "0"))
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .slice(0, limit)
        .map(([, item]) => item)
        .filter((item) => item.exp > seconds && item.listed)
        .map((item) => structuredClone(item));
    },

    async addChunk(conn, id, i, n, text, exp) {
      const key = `${conn} ${id}`;
      const entry = live(parts.get(key)) ?? { exp, got: new Map() };
      entry.got.set(i, text);
      parts.set(key, entry);
      if (entry.got.size < n) return null;
      parts.delete(key);
      let whole = "";
      for (let k = 0; k < n; k++) whole += entry.got.get(k) ?? "";
      return whole;
    },
  };
}
