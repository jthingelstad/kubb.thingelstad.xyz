import { env, exports } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const KEY = "test-key";
let roomN = 0;
const newRoom = () =>
  `testroom${"abcdefghjk"[roomN++ % 10]}${Date.now()
    .toString(36)
    .replace(/[^a-z2-9]/g, "a")}`.replace(/[ilo01]/g, "a");

async function connect(room, role, m) {
  const res = await exports.default.fetch(
    `http://x/ws?room=${room}&role=${role}&m=${m}&key=${KEY}`,
    {
      headers: { Upgrade: "websocket" },
    },
  );
  expect(res.status).toBe(101);
  const ws = res.webSocket;
  ws.accept();
  const inbox = [];
  const waiters = [];
  ws.addEventListener("message", (ev) => {
    const msg = ev.data === "pong" ? { t: "pong" } : JSON.parse(ev.data);
    inbox.push(msg);
    for (const w of [...waiters])
      if (w.pred(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
  });
  return {
    ws,
    inbox,
    send: (o) => ws.send(typeof o === "string" ? o : JSON.stringify(o)),
    next(pred, ms = 2000) {
      const found = inbox.find(pred);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        waiters.push(w);
        setTimeout(() => reject(new Error("timeout")), ms);
      });
    },
  };
}

const act = (id, seq, extra = {}) => ({
  t: "act",
  id,
  seq,
  a: "a".repeat(600),
  h: `h${seq}`,
  snap: "s".repeat(12000),
  st: 0,
  ...extra,
});
const settle = () => new Promise((r) => setTimeout(r, 50));

describe("RoomDO", () => {
  it("gates on the key and validates the room", async () => {
    expect(
      (
        await exports.default.fetch(
          "http://x/ws?room=abcdefgh&role=player&m=p&key=nope",
          { headers: { Upgrade: "websocket" } },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await exports.default.fetch(
          `http://x/ws?room=bad&role=player&m=p&key=${KEY}`,
          { headers: { Upgrade: "websocket" } },
        )
      ).status,
    ).toBe(400);
    expect(
      await (await exports.default.fetch("http://x/health")).text(),
    ).toMatch(/^ok/);
  });

  it("relays casts in the same s order to every receiver, observers thinned", async () => {
    const room = newRoom();
    const p = await Promise.all(
      ["p1", "p2", "p3"].map((m) => connect(room, "player", m)),
    );
    const o = await connect(room, "observer", "o1");
    for (let i = 0; i < 10; i++)
      p[0].send({ t: "cast", st: i, c: "x".repeat(300) });
    p[1].send(act("a1", 1));
    await p[0].next((m) => m.t === "act");
    await p[2].next((m) => m.t === "act");
    await o.next((m) => m.t === "act");
    await p[1].next((m) => m.t === "ok");
    await settle();
    const order = (c) =>
      c.inbox.filter((m) => m.t === "cast" || m.t === "act").map((m) => m.s);
    const casts = (c) => c.inbox.filter((m) => m.t === "cast").map((m) => m.s);
    expect(casts(p[1]).length).toBe(10);
    expect(casts(p[2])).toEqual(casts(p[1]));
    // p3 sees every frame in s order, the act at the s the sender was acked with
    const okS = p[1].inbox.find((m) => m.t === "ok").s;
    expect(order(p[2])).toEqual([...casts(p[1]), okS].sort((x, y) => x - y));
    const os = order(o);
    expect(os.length).toBeLessThan(11); // casts sent back to back: thinned
    for (let i = 1; i < os.length; i++)
      expect(os[i]).toBeGreaterThan(os[i - 1]);
    expect(p[0].inbox.some((m) => m.t === "cast")).toBe(false);
  });

  it("acks a duplicate act, refuses out of sequence, picks one of two simultaneous acts", async () => {
    const room = newRoom();
    const a = await connect(room, "player", "pa");
    const b = await connect(room, "player", "pb");
    a.send(act("x1", 1));
    expect((await a.next((m) => m.t === "ok" && m.id === "x1")).seq).toBe(1);
    a.send(act("x1", 1));
    await settle();
    expect(
      a.inbox.filter((m) => m.t === "ok" && m.id === "x1").at(-1).dup,
    ).toBe(true);
    a.send(act("x9", 5));
    expect((await a.next((m) => m.t === "refused")).head).toBe(1);
    a.send(act("ra", 2));
    b.send(act("rb", 2));
    await settle();
    const outcome = [a, b].map(
      (c) =>
        c.inbox.find(
          (m) =>
            (m.t === "ok" || m.t === "refused") &&
            (m.id === "ra" || m.id === "rb"),
        )?.t,
    );
    expect(outcome.sort()).toEqual(["ok", "refused"]);
    const stats = await (async () => {
      a.send({ t: "stats" });
      return a.next((m) => m.t === "stats");
    })();
    expect(stats.actsStored).toBe(2);
    expect(
      b.inbox.filter((m) => m.t === "act").length +
        a.inbox.filter((m) => m.t === "act").length,
    ).toBe(2);
  });

  it("resume returns missed acts, and state survives an eviction with a new epoch", async () => {
    const room = newRoom();
    const a = await connect(room, "player", "pa");
    for (let i = 1; i <= 3; i++) {
      a.send(act(`k${i}`, i));
      await a.next((m) => m.t === "ok" && m.id === `k${i}`);
    }
    a.send({ t: "stats" });
    const before = await a.next((m) => m.t === "stats");
    const stub = env.ROOM.get(env.ROOM.idFromName(room));
    await evictDurableObject(stub);
    const c = await connect(room, "player", "pc");
    c.send({ t: "join", last: 1 });
    const j = await c.next((m) => m.t === "joined");
    expect(j.head).toBe(3);
    expect(j.acts.map((x) => x.seq)).toEqual([2, 3]);
    expect(j.acts.every((x) => !("snap" in x))).toBe(true);
    expect(j.e).toBe(before.e + 1);
    c.send(act("k4", 4));
    expect((await c.next((m) => m.t === "ok" && m.id === "k4")).seq).toBe(4);
  });

  it("answers the literal ping and resets the room", async () => {
    const room = newRoom();
    const a = await connect(room, "player", "pa");
    a.send("ping");
    await a.next((m) => m.t === "pong");
    a.send(act("z1", 1));
    await a.next((m) => m.t === "ok");
    a.send({ t: "reset", key: KEY });
    await a.next((m) => m.t === "reset");
    const b = await connect(room, "player", "pb");
    b.send({ t: "join", last: 0 });
    const j = await b.next((m) => m.t === "joined");
    expect(j.head).toBe(0);
    expect(j.acts).toEqual([]);
  });
});
