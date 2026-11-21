// The reel function's store in memory, for the reel tests: a kept replay and its reel
// item, with the same rules as backend/reels/aws.mjs's reelStore (the renderer's side)
// and the api store's putReel (the side that starts a render), and the rule that an item
// past its `exp` (epoch seconds) is not there. Kept from the old rooms server's memory
// store when that server was retired (2026-11-21).

import { REEL_TRIES } from "../../backend/reels/tag.mjs";

export function memoryReels({ now = Date.now } = {}) {
  const replays = new Map(); // code -> { v, t, data, exp }
  const reels = new Map(); // code -> { v, tag, job, state, at, tries, ..., exp }

  const live = (item) => (item && item.exp * 1000 > now() ? item : null);
  const copy = (item) => (item ? structuredClone(item) : null);

  return {
    replays,
    reels,

    async putReplay(code, item) {
      if ((live(replays.get(code))?.v ?? 0) >= item.v) return false;
      replays.set(code, copy(item));
      return true;
    },
    async getReplay(code) {
      return copy(live(replays.get(code)));
    },

    async getReel(code) {
      return copy(live(reels.get(code)));
    },
    async putReel(code, { v, tag, job, at, exp, tries = 0 }, { staleBefore }) {
      const had = live(reels.get(code));
      const may =
        !had ||
        had.v < v ||
        (had.v === v && had.tag !== tag) ||
        (had.job === job &&
          had.state === "rendering" &&
          had.at < staleBefore &&
          (had.tries ?? 0) === tries &&
          (had.tries ?? 0) < REEL_TRIES);
      if (!may) return false;
      reels.set(code, { v, tag, job, state: "rendering", at, tries, exp });
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
  };
}
