// The api store in memory, for the tests and a local server: the same rules as
// dynamo-store.mjs (backend/api/core.mjs lists the methods), the same conditions, no AWS.
// `items` is the table, keyed "<pk>|<sk>", values as DynamoDB would hold them (snapshots
// and replays as text rather than gzipped).

import { REEL_TRIES } from "../reels/tag.mjs";
import { withSnap } from "./push.mjs";

export function memoryStore({ now = Date.now } = {}) {
  const items = new Map();
  const seconds = () => Math.floor(now() / 1000);
  const live = (x) => (x && x.exp > seconds() ? x : null);
  const get = (pk, sk) => live(items.get(`${pk}|${sk}`)) ?? null;
  const put = (pk, sk, item) => items.set(`${pk}|${sk}`, { ...item });
  const del = (pk, sk) => items.delete(`${pk}|${sk}`);
  const writes = { state: 0, replay: 0 };

  // the half item for (made, n): fields set on this match's item when `ok(item)`, or
  // a fresh item for a later match; nothing for an earlier match. Then the replay made
  // whole from it when both halves are in (never over a later match, a sealed pitch or
  // the same replay kept later).
  function half(code, { made, n }, fields, ok) {
    const pk = `pitch#${code}`;
    const had = get(pk, "half");
    let wrote = false;
    if (had && had.made === made && had.n === n) {
      if (ok(had)) {
        put(pk, "half", { ...had, ...fields });
        wrote = true;
      }
    } else if (!had || had.made < made || (had.made === made && had.n < n)) {
      put(pk, "half", { made, n, ...fields });
      wrote = true;
    }
    if (wrote) writes.replay++;
    const h = get(pk, "half");
    if (h && h.made === made && h.n === n && h.v && h.z && h.s) {
      const r = get(pk, "replay");
      if (
        !r ||
        (!r.sealed &&
          (r.made < made ||
            (r.made === made && (r.n < n || (r.n === n && r.v < h.v)))))
      )
        put(pk, "replay", { ...h });
    }
    return wrote;
  }

  return {
    items,
    writes,
    async getState(code) {
      const s = get(`pitch#${code}`, "state");
      return s ? { ...s } : null;
    },
    async putState(code, state, prevRev) {
      const had = get(`pitch#${code}`, "state");
      if ((had?.rev ?? 0) !== prevRev) return false;
      put(`pitch#${code}`, "state", state);
      writes.state++;
      return true;
    },
    async putFinal(code, { made, n, snap, exp }) {
      return half(code, { made, n }, { s: snap, exp }, (had) => !had.s);
    },
    async putKept(code, { made, n, v, data, hash = null, cpu, level, exp }) {
      return half(
        code,
        { made, n },
        { v, z: data, hash, cpu, level, exp },
        (had) => !(had.v >= v),
      );
    },
    async getReplay(code) {
      const r = get(`pitch#${code}`, "replay");
      if (!r || !r.v || !r.s || !r.z) return null;
      return {
        v: r.v,
        made: r.made,
        n: r.n,
        sealed: !!r.sealed,
        data: withSnap(r.z, r.s),
        exp: r.exp,
      };
    },

    async getReel(code) {
      const r = get(`pitch#${code}`, "reel");
      return r ? { ...r } : null;
    },
    async putReel(code, { v, tag, job, at, exp, tries = 0 }, { staleBefore }) {
      const had = get(`pitch#${code}`, "reel");
      const may =
        !had ||
        had.v < v ||
        (had.v === v && had.tag !== tag) ||
        (had.job === job &&
          had.state === "rendering" &&
          had.at < staleBefore &&
          had.tries === tries &&
          had.tries < REEL_TRIES);
      if (!may) return false;
      put(`pitch#${code}`, "reel", {
        v,
        tag,
        job,
        state: "rendering",
        at,
        tries,
        exp,
      });
      return true;
    },
    async dropReel(code, job, { at = null } = {}) {
      const had = items.get(`pitch#${code}|reel`);
      if (!had || had.job !== job) return;
      if (at != null) had.at = at;
      else del(`pitch#${code}`, "reel");
    },
    async countReel(day, cap, exp) {
      return count(`reels#${day}`, cap, exp);
    },

    async getShare(hash) {
      const s = get(`share#${hash}`, "share");
      return s ? { code: s.code, exp: s.exp } : null;
    },
    async keepShare(hash, code, { state, replay }, { stale = null } = {}) {
      const pk = `pitch#${code}`;
      const key = get(`share#${hash}`, "share");
      if (get(pk, "state") || get(pk, "replay")) return false;
      if (key && key.code !== stale) return false;
      put(pk, "state", state);
      put(pk, "replay", {
        made: replay.made,
        n: replay.n,
        v: replay.v,
        z: replay.data,
        s: replay.snap,
        hash: replay.hash ?? null,
        cpu: replay.cpu,
        level: replay.level,
        sealed: true,
        exp: replay.exp,
      });
      put(`share#${hash}`, "share", { code, exp: state.exp });
      return true;
    },
    async countShare(day, cap, exp) {
      return count(`shares#${day}`, cap, exp);
    },
  };

  function count(pk, cap, exp) {
    const had = items.get(`${pk}|count`);
    if ((had?.n ?? 0) >= cap) return false;
    items.set(`${pk}|count`, { n: (had?.n ?? 0) + 1, exp });
    return true;
  }
}
