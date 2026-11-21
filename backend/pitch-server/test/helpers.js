// Test helpers for the Workers pool: sockets to the Worker, an inbox per socket.
import { exports } from "cloudflare:workers";
import { expect } from "vitest";

const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";
let n = 0;
// A made-up pitch code, new for every test.
export function newCode(prefix = "t") {
  n++;
  const r = Array.from(
    crypto.getRandomValues(new Uint8Array(10)),
    (b) => ALPHA[b % ALPHA.length],
  ).join("");
  return `${prefix}${ALPHA[n % ALPHA.length]}${r}`;
}

export const member = (name) => `${name}-member-0001`;

export async function raw(path, init = {}) {
  return exports.default.fetch(`http://pitch.test${path}`, init);
}

export async function connect(code, { origin } = {}) {
  const headers = { Upgrade: "websocket" };
  if (origin) headers.Origin = origin;
  const res = await raw(`/ws?pitch=${code}`, { headers });
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  ws.accept();
  const c = {
    ws,
    inbox: [],
    waiters: [],
    closed: null,
    send: (o) => ws.send(typeof o === "string" ? o : JSON.stringify(o)),
    // the first frame matching pred that has not been taken yet
    next(pred, ms = 3000) {
      const i = c.inbox.findIndex(pred);
      if (i >= 0) return Promise.resolve(c.inbox.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        c.waiters.push(w);
        setTimeout(() => {
          const j = c.waiters.indexOf(w);
          if (j >= 0) {
            c.waiters.splice(j, 1);
            reject(
              new Error(
                `timeout waiting; inbox ${JSON.stringify(c.inbox.map((f) => f.t))}`,
              ),
            );
          }
        }, ms);
      });
    },
    take() {
      const out = c.inbox;
      c.inbox = [];
      return out;
    },
    close() {
      try {
        ws.close(1000, "done");
      } catch {}
    },
  };
  ws.addEventListener("message", (ev) => {
    const msg = ev.data === "pong" ? { t: "PONG" } : JSON.parse(ev.data);
    const w = c.waiters.find((x) => x.pred(msg));
    if (w) {
      c.waiters.splice(c.waiters.indexOf(w), 1);
      w.resolve(msg);
    } else c.inbox.push(msg);
  });
  ws.addEventListener("close", (ev) => {
    c.closed = { code: ev.code, reason: ev.reason };
  });
  return c;
}

export async function join(code, name, extra = {}, opts = {}) {
  const c = await connect(code, opts);
  c.send({ t: "join", member: member(name), ...extra });
  c.joined = await c.next((f) => f.t === "joined" || f.t === "error");
  return c;
}

export const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms));

export const startMsg = (n = 1, base = 0) => ({
  t: "start",
  id: `go${n}`,
  base,
  doc: { started: true },
  n,
  h: `h0-${n}`,
  snap: "S".repeat(2000),
  meta: { engine: "0.9.0", setup: { seed: 1 } },
});

export const actMsg = (seq, n = 1, extra = {}) => ({
  t: "act",
  id: `act-${n}-${seq}`,
  n,
  seq,
  a: { k: "throw", x: seq },
  h: `h-${n}-${seq}`,
  snap: "s".repeat(3000),
  ...extra,
});

export async function waitUntil(fn, ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("waitUntil: timed out");
    await settle(25);
  }
}

export const receiverGet = async (path) =>
  (await fetch(`https://receiver.test${path}`)).json();
export const receiverPost = async (path, body = {}) =>
  (
    await fetch(`https://receiver.test${path}`, {
      method: "POST",
      body: JSON.stringify(body),
    })
  ).json();
