// Highlight reels on this machine, for `npm run dev`'s room server (tools/rooms-dev.mjs):
// the reel function's own job (backend/reels/job.mjs) over the local server's memory
// store, rendering each match on its own engine among this checkout's (docs/ENGINES.md)
// and with the ffmpeg on the PATH (or FFMPEG),
// and "uploading" by copying into build/reels-dev/, where the preview server
// (tools/preview.mjs) serves /reels/... as CloudFront serves the bucket's reels/.
//
//   startRoomsServer({ reelRenderer: devReelRenderer(), reelEngines: devReelEngines() })
//
// A render runs in this process, after the request is answered, and is tried twice
// like Lambda's asynchronous invoke. A shared match's check (`share`, docs/ROOMS.md
// section 13) runs here too, the reel function's own check (backend/reels/check.mjs),
// with the same wait as on AWS: startRoomsServer({ shareChecker: devShareChecker() }).
import fs from "node:fs";
import path from "node:path";
import { LIMITS, ShareBusy } from "../backend/rooms/core.mjs";
import { checkShare } from "../backend/reels/check.mjs";
import { runReel } from "../backend/reels/job.mjs";
import { renderReel } from "../backend/reels/render.mjs";
import { bundleLua, carriedEngines } from "./lua-bundle.mjs";

export const REELS_DEV_DIR = "build/reels-dev";

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

export function devReelRenderer({
  dir = REELS_DEV_DIR,
  vendorDir,
  log = (...a) => console.log(new Date().toISOString(), ...a),
} = {}) {
  const carried = devCarried(vendorDir);
  return (store) =>
    async function startReel(input) {
      const once = () =>
        runReel({
          input,
          store,
          carried,
          engines: devReelEngines(vendorDir),
          upload: async (key, file) => {
            const to = path.join(dir, key);
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.copyFileSync(file, to);
          },
          render: ({ replay, code, out, sources }) =>
            renderReel({ replay, code, out, sources, log: (l) => log(l) }),
          log: (entry) => log("reel", JSON.stringify(entry)),
        });
      setImmediate(() =>
        once()
          .catch(() => once())
          .catch((error) => log("reel failed", error?.message)),
      );
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
