// The pitch server's Worker (docs/PITCH-SERVER.md, wire protocol PROTOCOL.md). It checks
// each request and hands it on; the pitches themselves are PitchDO, the open games list
// LobbyDO.
//
//   GET /health                  "ok <VERSION>"
//   GET /ws?pitch=<code>         WebSocket upgrade, to the pitch's PitchDO by name
//   GET /open                    the open games list (JSON, CORS for the site origins)
//   GET|POST /dev/pitch?pitch=   dev only: a pitch's stats, or ?op=wipe (needs DEV_KEY)
import { PITCH_CODE } from "../core.mjs";
import { corsHeaders, parseOrigins, sameKey, socketOriginOk } from "./http.mjs";

export { PitchDO } from "./pitch-do.mjs";
export { LobbyDO } from "./lobby-do.mjs";

const text = (body, status = 200, headers = {}) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });

// The open games list, kept for a few seconds in this isolate so a crowd of pages
// polling it costs one LobbyDO request per isolate per OPEN_CACHE_MS, not one each.
const OPEN_CACHE_MS = 5000;
let openCache = { at: 0, body: null };

async function openGames(request, env, origin, allowed) {
  const cors = corsHeaders(origin, allowed);
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  if (request.method !== "GET") return text("method not allowed", 405, cors);
  const now = Date.now();
  if (!openCache.body || now - openCache.at >= OPEN_CACHE_MS) {
    const lobby = env.LOBBY.get(env.LOBBY.idFromName("open"));
    const games = await lobby.list(now);
    openCache = { at: now, body: JSON.stringify({ now, games }) };
  }
  return new Response(openCache.body, {
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${OPEN_CACHE_MS / 1000}`,
      ...cors,
    },
  });
}

// The seam for Turnstile (an open owner decision, docs/PITCH-SERVER.md section 11).
// Return a Response to refuse the connection, or null to let it through. Turnstile has
// no native iPhone path, so a check here would have to let the app in some other way.
function admit(request, url, env) {
  return null;
}

async function socket(request, url, env, origin, allowed) {
  if ((request.headers.get("Upgrade") ?? "").toLowerCase() !== "websocket")
    return text("expected a websocket", 426);
  const code = url.searchParams.get("pitch") ?? "";
  if (!PITCH_CODE.test(code)) return text("not a pitch code", 400);
  if (!socketOriginOk(origin, allowed)) return text("origin not allowed", 403);
  const refused = admit(request, url, env);
  if (refused) return refused;
  return env.PITCH.get(env.PITCH.idFromName(code)).fetch(request);
}

async function devPitch(request, url, env) {
  const key = (request.headers.get("authorization") ?? "").replace(
    /^Bearer /,
    "",
  );
  if (!env.DEV_KEY || !sameKey(key, env.DEV_KEY)) return text("not found", 404);
  const code = url.searchParams.get("pitch") ?? "";
  if (!PITCH_CODE.test(code)) return text("not a pitch code", 400);
  const inner = new URL(request.url);
  inner.pathname = "/dev";
  return env.PITCH.get(env.PITCH.idFromName(code)).fetch(
    new Request(inner, { method: request.method }),
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed = parseOrigins(env.ALLOWED_ORIGINS);
    switch (url.pathname) {
      case "/health":
        return text(`ok ${env.VERSION ?? "0"}`);
      case "/ws":
        return socket(request, url, env, origin, allowed);
      case "/open":
        return openGames(request, env, origin, allowed);
      case "/dev/pitch":
        return devPitch(request, url, env);
      default:
        return text("not found", 404);
    }
  },
};
