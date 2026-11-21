// A pitch's kept replay, by its code, without joining the pitch: GET /api/replay
// (backend/api/API.md). This is the seam the pitch page uses when it opens on a finished
// match, and the one an embed or a share image can use with nothing but the code.
//
//   const r = await fetchReplay({ url: config.apiUrl, code });
//   // { v, n, setup, h0, log, snap, hash, players, cpu, at, kept, sealed } or null
//
// Null when the pitch keeps no replay (a match in progress, none finished yet, a pitch
// gone), when what came back is not one this build can play, or when the server cannot
// be reached. Never throws. The check is the engine's (room.isReplay), so it needs the
// page's engine; the embed, which loads the engine only once there is a replay, passes
// `check: null` and checks it after (src/embed/embed.js). `sealed`: a shared match
// against the computer, a pitch that is watched and never joined.
import { apiCall } from "../net/api.js";
import { isReplay } from "../net/lobby.js";

export async function fetchReplay({ url, code, check = isReplay, fetch }) {
  const a = await askReplay({ url, code, fetch });
  const r = a?.replay;
  if (!r || typeof r !== "object" || (check && !check(r))) return null;
  return {
    ...r,
    at: a.at ?? null,
    kept: a.v ?? null,
    sealed: a.sealed === true,
  };
}

// The answer itself ({ pitch, v, at, sealed, replay }), or null when it could not be
// had. Never throws.
export async function askReplay({ url, code, fetch }) {
  try {
    return await apiCall({
      base: url,
      call: "replay",
      query: { pitch: code },
      ...(fetch ? { fetch } : {}),
    });
  } catch {
    return null;
  }
}
