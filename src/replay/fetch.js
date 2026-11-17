// A pitch's kept replay, by its code, without joining the room (docs/ROOMS.md section 10):
// one `replay` message on a socket of its own (src/net/ask.js). This is the seam the pitch
// page uses when it opens on a finished match, and the one an embed or a share image can
// use with nothing but the code.
//
//   const r = await fetchReplay({ url: config.roomsUrl, code });
//   // { v, n, setup, h0, log, snap, hash, players, cpu, at } or null
//
// Null when the room keeps no replay (a match in progress, a match from before replays, a
// room gone), when what came back is not one this build can play, or when the server
// cannot be reached. Never throws. The check is the engine's (room.isReplay), so it
// needs the page's engine; the embed, which loads the engine only once there is a
// replay, passes `check: null` and checks it after (src/embed/embed.js).
import { ask } from "../net/ask.js";
import { isReplay } from "../net/lobby.js";

export async function fetchReplay({ url, code, check = isReplay, ...rest }) {
  let answer;
  try {
    answer = await ask({
      url,
      message: { t: "replay", id: 1, room: code },
      done: "replay",
      re: "replay",
      ...rest,
    });
  } catch {
    return null;
  }
  const r = answer?.replay;
  if (!r || typeof r !== "object" || (check && !check(r))) return null;
  return { ...r, at: answer.at ?? null, kept: answer.v ?? null };
}
