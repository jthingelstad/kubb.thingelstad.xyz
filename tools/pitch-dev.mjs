#!/usr/bin/env node
// The pitch server and the api function on this machine, for `npm run dev` and the tests,
// on 127.0.0.1 only. No Cloudflare and no AWS: the pitch core
// (backend/pitch-server/core.mjs) runs in this process over the `ws` package, its effects
// carried out as the Durable Object does (as tests/pitch-server/harness.mjs does, without
// the storage: a pitch here never sleeps), and the api core (backend/api/core.mjs) over
// its in-memory store (backend/api/memory-store.mjs). Pushes go from one to the other in
// this process, signed with a made-up local key, so the api's pitch records, final
// snapshots and kept replays are made exactly as on AWS.
//
//   node tools/pitch-dev.mjs [--port 8797]              pitch server and api on one port
//   node tools/pitch-dev.mjs --api-only [--port 8798]   the api alone (beside `wrangler dev`)
//
// One port answers:
//   GET  /ws?pitch=<code>   the WebSocket (PROTOCOL.md); a literal "ping" is answered "pong"
//   GET  /open              the open games list, as the Worker's
//   GET  /health            "ok"
//   *    /api/<call>        the api (backend/api/API.md); /api/push takes signed pushes
//
// startPitchServer() for the tests: `url` (ws://...), `apiUrl` (http://.../api),
// `httpUrl`, `pitch(code)` (the core's state), `dropAll()` / `drop(code)` (every socket,
// or a pitch's, cut at once as a deploy or a network change would), `api` (its store and
// records) and `close()`.
//
// Reels are not rendered here (`reel` answers unavailable) unless a test passes its own
// `startReel({ room, v, tag })` (createApi's option; a test's only notes the job, with
// `reelEngines` to say which it renders). Shares are checked in this process by the
// reel function's own check when `shareChecker: true` (or from the command line).

import http from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import {
  rebuildPitch,
  step,
  PITCH_CODE,
} from "../backend/pitch-server/core.mjs";
import { report, listing } from "../backend/pitch-server/src/lobby.mjs";
import { pushRequest } from "../backend/pitch-server/src/push.mjs";
import { corsHeaders } from "../backend/pitch-server/src/http.mjs";
import { createApi } from "../backend/api/core.mjs";
import { memoryStore } from "../backend/api/memory-store.mjs";
import { memoryRecords } from "../backend/api/records.mjs";

// Not a secret: the key this machine's pitch server and api sign and check pushes with.
export const LOCAL_PUSH_KEY = "local-dev-pushes-only";
export const DEV_ORIGINS = ["http://localhost", "http://127.0.0.1"];

export async function startPitchServer({
  port = 0,
  host = "127.0.0.1",
  pitches = true,
  options = {},
  origins = DEV_ORIGINS,
  shareChecker = false,
  reelEngines = [],
  startReel = null,
  log = () => {},
} = {}) {
  const store = memoryStore();
  const records = memoryRecords();
  let checkShare = null;
  if (shareChecker === true) {
    const { devShareChecker } = await import("./reels-dev.mjs");
    checkShare = devShareChecker({ log });
  } else if (typeof shareChecker === "function") checkShare = shareChecker;
  const api = createApi({
    store,
    recordPush: records.recordPush,
    keepReport: records.keepReport,
    recordGame: records.recordGame,
    checkShare,
    reelEngines,
    startReel,
    secret: async () => LOCAL_PUSH_KEY,
    origins,
    log,
  });

  const lobby = new Map(); // the open games list: pitch code -> row (lobby.mjs)
  const live = new Map(); // pitch code -> { state, sockets: Map(conn -> ws), timer }
  let connSeq = 0;
  let listSeq = 0;

  async function apiHandle(req, body) {
    const url = new URL(req.url, "http://127.0.0.1");
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k] = v;
    return api.handle({
      method: req.method,
      path: url.pathname,
      query: url.searchParams,
      headers,
      body,
    });
  }

  // ---------- one pitch ----------

  function pitchOf(code) {
    let p = live.get(code);
    if (!p) {
      const r = rebuildPitch({
        code,
        stored: null,
        conns: [],
        now: Date.now(),
        options,
      });
      p = { code, state: r.state, sockets: new Map(), timer: null };
      live.set(code, p);
      apply(p, r.effects);
    }
    return p;
  }

  function event(p, e) {
    const r = step(p.state, { ...e, now: Date.now() });
    apply(p, r.effects);
  }

  function apply(p, effects) {
    for (const e of effects) {
      switch (e.kind) {
        case "send": {
          const text = JSON.stringify(e.frame);
          for (const to of e.to) {
            const ws = p.sockets.get(to);
            if (ws && ws.readyState === 1) ws.send(text);
          }
          break;
        }
        case "close": {
          const ws = p.sockets.get(e.conn);
          p.sockets.delete(e.conn);
          try {
            ws?.close(e.code ?? 1000, String(e.reason ?? "").slice(0, 120));
          } catch {}
          break;
        }
        case "attach":
        case "persist":
          break; // nothing sleeps here, so nothing need be kept
        case "push":
          deliver(p, e);
          break;
        case "listing":
          report(
            lobby,
            { pitch: p.code, entry: e.entry, at: Date.now(), seq: ++listSeq },
            Date.now(),
          );
          break;
        case "alarm":
          clearTimeout(p.timer);
          p.timer = null;
          if (e.at != null)
            p.timer = setTimeout(
              () => event(p, { type: "tick" }),
              Math.max(0, e.at - Date.now()),
            );
          break;
        case "wipe":
          clearTimeout(p.timer);
          if (p.sockets.size === 0) live.delete(p.code);
          break;
        default:
          throw new Error(`unknown effect ${e.kind}`);
      }
    }
  }

  // A push to the api, signed as the Worker signs it, then confirmed to the core.
  async function deliver(p, e) {
    const req = await pushRequest({
      url: "/api/push",
      secret: LOCAL_PUSH_KEY,
      pitch: p.code,
      made: e.made,
      k: e.k,
      topic: e.topic,
      body: e.body,
      sent: Date.now(),
    });
    const res = await api.handle({
      method: "POST",
      path: "/push",
      query: new URLSearchParams(),
      headers: req.init.headers,
      body: Buffer.from(req.init.body),
    });
    if (res.status >= 200 && res.status < 300 && live.get(p.code) === p)
      event(p, { type: "pushed", k: e.k });
    else if (res.status >= 300) log("push refused", res.status, res.body);
  }

  // ---------- the server ----------

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const origin = req.headers.origin ?? null;
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("ok");
    }
    if (url.pathname === "/open" && pitches) {
      const h = corsHeaders(origin, origins);
      if (req.method === "OPTIONS") {
        res.writeHead(204, h);
        return res.end();
      }
      const now = Date.now();
      res.writeHead(200, {
        ...h,
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      return res.end(
        JSON.stringify({ now, games: listing([...lobby.values()], now) }),
      );
    }
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const out = await apiHandle(req, Buffer.concat(chunks));
      res.writeHead(out.status, out.headers ?? {});
      return res.end(out.body ?? "");
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const code = url.searchParams.get("pitch") ?? "";
    const origin = req.headers.origin;
    const originOk =
      origin == null ||
      origins.some((o) => {
        try {
          const a = new URL(o);
          const b = new URL(origin);
          return (
            a.protocol === b.protocol &&
            a.hostname === b.hostname &&
            (a.port === "" || a.port === b.port)
          );
        } catch {
          return false;
        }
      });
    if (
      !pitches ||
      url.pathname !== "/ws" ||
      !PITCH_CODE.test(code) ||
      !originOk
    ) {
      socket.write("HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const p = pitchOf(code);
      const conn = `c${++connSeq}`;
      p.sockets.set(conn, ws);
      ws.on("message", (data, isBinary) => {
        const text = isBinary ? null : data.toString("utf8");
        if (text === "ping") {
          ws.send("pong");
          return;
        }
        if (live.get(code) !== p) return;
        event(p, { type: "frame", conn, text: text ?? data });
      });
      ws.on("close", () => {
        if (!p.sockets.has(conn)) return;
        p.sockets.delete(conn);
        if (live.get(code) === p) event(p, { type: "close", conn });
      });
      ws.on("error", () => {});
    });
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  const at = `${host}:${server.address().port}`;

  return {
    url: `ws://${at}`,
    httpUrl: `http://${at}`,
    apiUrl: `http://${at}/api`,
    port: server.address().port,
    api: { store, records, handle: api.handle },
    lobby,
    /** The core's state of a pitch (read only), or null. */
    pitch(code) {
      return live.get(code)?.state ?? null;
    },
    /** Cut every socket at once (a deploy, a network change): no close frame. */
    dropAll() {
      for (const p of live.values())
        for (const ws of p.sockets.values()) ws.terminate();
    },
    drop(code) {
      for (const ws of live.get(code)?.sockets.values() ?? []) ws.terminate();
    },
    async close() {
      for (const p of live.values()) {
        clearTimeout(p.timer);
        for (const ws of p.sockets.values()) ws.terminate();
      }
      live.clear();
      wss.close();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const apiOnly = args.includes("--api-only");
  const i = args.indexOf("--port");
  const port = Number(i >= 0 ? args[i + 1] : apiOnly ? 8798 : 8797);
  const s = await startPitchServer({
    port,
    pitches: !apiOnly,
    shareChecker: true,
    log: (...a) => console.log(new Date().toISOString(), ...a),
  });
  console.log(
    apiOnly
      ? `api on ${s.apiUrl} (pushes to ${s.apiUrl}/push)`
      : `pitch server on ${s.url}, api on ${s.apiUrl}`,
  );
  const stop = () => s.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
