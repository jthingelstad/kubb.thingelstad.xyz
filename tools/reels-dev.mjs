// The reel function's check of a shared match on this machine, for `npm run dev`'s api
// stand-in (tools/pitch-dev.mjs): the reel function's own check
// (backend/reels/check.mjs), on each match's own engine among this checkout's
// (docs/ENGINES.md), with the same wait as on AWS. `npm run dev` renders no reels.
import { LIMITS } from "../backend/api/checks.mjs";
import { ShareBusy } from "../backend/api/core.mjs";
import { checkShare } from "../backend/reels/check.mjs";
import { bundleLua, carriedEngines } from "./lua-bundle.mjs";

// The engines this checkout carries, newest first: REEL_ENGINES as tools/infra.mjs sets it.
export const devReelEngines = (vendorDir) =>
  carriedEngines(vendorDir).map((e) => e.mm);

// The checkout's engines as the package carries them: mm -> { engine, sources }, each
// bundle read the first time a match of it comes.
export function devCarried(vendorDir) {
  const byMinor = new Map(carriedEngines(vendorDir).map((e) => [e.mm, e]));
  const read = new Map();
  return (mm) => {
    const e = byMinor.get(mm);
    if (!e) return null;
    if (!read.has(mm))
      read.set(mm, { engine: e.version, sources: bundleLua(e.dir) });
    return read.get(mm);
  };
}

// The check of a shared match, in this process. It blocks the process while it plays
// (a long match takes seconds); over `waitMs` it is answered busy, as on AWS.
export function devShareChecker({
  waitMs = LIMITS.shareWaitMs,
  vendorDir,
  log = (...a) => console.log(new Date().toISOString(), ...a),
} = {}) {
  const carried = devCarried(vendorDir);
  return async function check(g) {
    const t0 = Date.now();
    const out = await checkShare({
      g,
      carried,
      engines: devReelEngines(vendorDir),
    });
    const ms = Date.now() - t0;
    log("share check", out.ok ? "ok" : `${out.why} (${out.step})`, `${ms} ms`);
    if (ms > waitMs) throw new ShareBusy("the check took too long");
    return out;
  };
}
