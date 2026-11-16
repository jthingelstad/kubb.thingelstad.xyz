// One message to the room server on a socket of its own, and its answer: a report
// (src/net/report.js), a match played in this browser (src/net/record.js). The socket opens, the message goes (in parts when it is longer
// than a frame, docs/ROOMS.md section 2.1), the answer comes back or the time runs out, and
// the socket closes. Never touches a room.
//
//   const answer = await ask({ url, message, done: "reported", re: "report" });
//
// Resolves the answer (the message whose `t` is `done` and whose `id` is the message's);
// rejects an AskError whose code is the server's error code (for an `error` with `re`), or
// timeout, closed, unavailable.
import { asciiJson, toFrames } from "./room.js";

export class AskError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function ask({
  url,
  message,
  done,
  re,
  WebSocket = globalThis.WebSocket,
  timeoutMs = 15000,
  frame = 30000,
}) {
  return new Promise((resolve, reject) => {
    if (!url || !WebSocket) {
      reject(new AskError("unavailable", "The server cannot be reached here."));
      return;
    }
    let ws;
    let settled = false;
    const finish = (error, answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        // already closed
      }
      if (error) reject(error);
      else resolve(answer ?? true);
    };
    const timer = setTimeout(
      () => finish(new AskError("timeout", "No answer from the server.")),
      timeoutMs,
    );
    try {
      ws = new WebSocket(url);
    } catch {
      finish(new AskError("closed", "Could not reach the server."));
      return;
    }
    const id = message.id ?? null;
    ws.onopen = () => {
      try {
        for (const f of toFrames(asciiJson(message), frame)) ws.send(f);
      } catch {
        finish(new AskError("closed", "Could not reach the server."));
      }
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(typeof e.data === "string" ? e.data : "");
      } catch {
        return;
      }
      if (m.t === done && (m.id ?? null) === id) finish(null, m);
      else if (m.t === "error" && m.re === re)
        finish(new AskError(m.code || "error", m.message || "Refused."));
    };
    ws.onerror = () =>
      finish(new AskError("closed", "Could not reach the server."));
    ws.onclose = () => finish(new AskError("closed", "The connection closed."));
  });
}
