#!/usr/bin/env node
// The room server on this machine: backend/rooms/core.mjs over an in-memory store and the
// `ws` package, on 127.0.0.1 only. Same limits as AWS, including API Gateway's 32 KB frame
// rule: a bigger frame closes the connection with 1009, as API Gateway does, so the
// client's chunking is really exercised.
//
//   node tools/rooms-dev.mjs [--port 8788]      ws://127.0.0.1:8788
//
// ROOMS_ORIGINS (comma separated) is the Origin allow-list, default any port of
// http://localhost and http://127.0.0.1. A connection with no Origin at all (Node's own
// WebSocket in the tests, command-line tools) is let in here; API Gateway's handler refuses it.

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import {
  LIMITS,
  createRooms,
  originAllowed,
  parseOrigins,
} from "../backend/rooms/core.mjs";
import { memoryStore } from "../backend/rooms/memory-store.mjs";

export const FRAME_MAX = 32 * 1024; // API Gateway WebSocket frame size quota

export async function startRoomsServer({
  port = 8788,
  host = "127.0.0.1",
  origins = parseOrigins(
    process.env.ROOMS_ORIGINS ?? "http://localhost,http://127.0.0.1",
  ),
  limits = LIMITS,
  now = Date.now,
  log = () => {},
} = {}) {
  const sockets = new Map(); // conn -> ws
  const store = memoryStore({ now });
  const rooms = createRooms({
    store,
    now,
    limits,
    async send(conn, text) {
      const ws = sockets.get(conn);
      if (!ws || ws.readyState !== ws.OPEN) return false;
      ws.send(text);
      return true;
    },
    async close(conn) {
      sockets.get(conn)?.close(4000, "replaced");
    },
  });

  const wss = new WebSocketServer({
    host,
    port,
    maxPayload: FRAME_MAX,
    verifyClient: ({ origin }) => !origin || originAllowed(origin, origins),
  });
  await new Promise((resolve, reject) => {
    wss.once("listening", resolve);
    wss.once("error", reject);
  });

  wss.on("connection", (ws) => {
    const conn = randomUUID();
    sockets.set(conn, ws);
    log("connect", conn);
    ws.on("message", (data, isBinary) => {
      // Not awaited: like Lambda, messages from one room are handled concurrently.
      rooms
        .message(conn, isBinary ? null : data.toString("utf8"))
        .catch((error) => log("error", error));
    });
    ws.on("close", () => {
      sockets.delete(conn);
      log("disconnect", conn);
      rooms.disconnect(conn).catch((error) => log("error", error));
    });
    ws.on("error", () => {});
  });

  const actual = wss.address().port;
  return {
    port: actual,
    url: `ws://${host}:${actual}`,
    store,
    sockets,
    // Cut connections without a close handshake, the way a network drop does.
    drop(conn) {
      sockets.get(conn)?.terminate();
    },
    async close() {
      for (const ws of wss.clients) ws.terminate();
      await new Promise((resolve) => wss.close(resolve));
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const i = process.argv.indexOf("--port");
  const port =
    i > 0 ? Number(process.argv[i + 1]) : Number(process.env.PORT ?? 8788);
  const server = await startRoomsServer({
    port,
    log: (...a) => console.log(new Date().toISOString(), ...a),
  });
  console.log(`rooms: ${server.url} (Ctrl-C to stop)`);
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
