// Highlight reels on this machine, for `npm run dev`'s room server (tools/rooms-dev.mjs):
// the reel function's own job (backend/reels/job.mjs) over the local server's memory
// store, rendering with this checkout's engine and the ffmpeg on the PATH (or FFMPEG),
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
import { majorMinor } from "../backend/reels/tag.mjs";
import { bundleLua, engineVersion } from "./lua-bundle.mjs";

export const REELS_DEV_DIR = "build/reels-dev";

export const devReelEngines = () => [majorMinor(engineVersion())];

export function devReelRenderer({
  dir = REELS_DEV_DIR,
  log = (...a) => console.log(new Date().toISOString(), ...a),
} = {}) {
  let sources = null;
  return (store) =>
    async function startReel(input) {
      sources ??= bundleLua();
      const once = () =>
        runReel({
          input,
          store,
          engine: engineVersion(),
          engines: devReelEngines(),
          upload: async (key, file) => {
            const to = path.join(dir, key);
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.copyFileSync(file, to);
          },
          render: ({ replay, code, out }) =>
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
  log = (...a) => console.log(new Date().toISOString(), ...a),
} = {}) {
  let sources = null;
  return async function check(g) {
    sources ??= bundleLua();
    const t0 = Date.now();
    const out = await checkShare({
      g,
      sources,
      engine: engineVersion(),
      engines: devReelEngines(),
    });
    const ms = Date.now() - t0;
    log("share check", out.ok ? "ok" : `${out.why} (${out.step})`, `${ms} ms`);
    if (ms > waitMs) throw new ShareBusy("the check took too long");
    return out;
  };
}
