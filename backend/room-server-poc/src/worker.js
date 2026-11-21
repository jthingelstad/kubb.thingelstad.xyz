// Throwing Wood rooms relay: a throwaway proof of concept on Cloudflare Durable Objects.
// Synthetic payloads only. Not the product; see the driver for what is measured.
import { DurableObject } from "cloudflare:workers";
import {
  ROOM_CODE,
  ObserverThinner,
  decideAct,
  relayAct,
  relayCast,
} from "./logic.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(`ok ${env.POC_VERSION || "0"}`, {
        headers: { "content-type": "text/plain", "cache-control": "no-store" },
      });
    }
    if (url.pathname !== "/ws")
      return new Response("not found", { status: 404 });
    if (!env.POC_KEY || url.searchParams.get("key") !== env.POC_KEY) {
      return new Response("forbidden", { status: 403 });
    }
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const room = url.searchParams.get("room") || "";
    const role = url.searchParams.get("role");
    const m = url.searchParams.get("m") || "";
    if (
      !ROOM_CODE.test(room) ||
      !["player", "observer"].includes(role) ||
      !/^[\w-]{1,32}$/.test(m)
    ) {
      return new Response("bad request", { status: 400 });
    }
    return env.ROOM.get(env.ROOM.idFromName(room)).fetch(request);
  },
};

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS acts (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, m TEXT NOT NULL, a TEXT NOT NULL, h TEXT NOT NULL, snap TEXT NOT NULL, s INTEGER NOT NULL, ts INTEGER NOT NULL, e INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS head (k INTEGER PRIMARY KEY CHECK (k = 1), seq INTEGER NOT NULL, h TEXT NOT NULL)",
];

export class RoomDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.s = 0; // per-room frame counter, in memory only: resets with the epoch
    this.thin = new ObserverThinner();
    this.counters = {
      msgsIn: 0,
      msgsOut: 0,
      casts: 0,
      acts: 0,
      refused: 0,
      dups: 0,
    };
    this.bornAt = Date.now();
    ctx.blockConcurrencyWhile(async () => this.load());
    // Literal ping/pong answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
  }

  load() {
    for (const q of SCHEMA) this.sql.exec(q);
    const row = this.sql
      .exec("SELECT v FROM meta WHERE k = 'epoch'")
      .toArray()[0];
    this.e = (row ? Number(row.v) : 0) + 1;
    this.sql.exec(
      "INSERT OR REPLACE INTO meta (k, v) VALUES ('epoch', ?)",
      String(this.e),
    );
    const order = this.sql
      .exec("SELECT v FROM meta WHERE k = 'order'")
      .toArray()[0];
    this.order = order ? order.v : "write-first";
    const head = this.sql
      .exec("SELECT seq, h FROM head WHERE k = 1")
      .toArray()[0];
    this.head = head ? { seq: head.seq, h: head.h } : { seq: 0, h: "" };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get("role");
    const m = url.searchParams.get("m");
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ m, role });
    return new Response(null, { status: 101, webSocket: client });
  }

  send(ws, obj) {
    try {
      ws.send(typeof obj === "string" ? obj : JSON.stringify(obj));
      this.counters.msgsOut++;
    } catch {
      // socket already closing; the client resumes with join
    }
  }

  stamp() {
    return { s: ++this.s, ts: Date.now(), e: this.e };
  }

  // Everything on the relay path is synchronous: no awaits between receive and send.
  webSocketMessage(ws, message) {
    this.counters.msgsIn++;
    let f;
    try {
      f = JSON.parse(message);
    } catch {
      return this.send(ws, { t: "error", why: "json" });
    }
    const me = ws.deserializeAttachment() || {};
    switch (f.t) {
      case "cast":
        return this.onCast(ws, me, f);
      case "act":
        return this.onAct(ws, me, f);
      case "join":
        return this.onJoin(ws, f);
      case "stats":
        return this.send(ws, this.stats());
      case "opt":
        if (f.key !== this.env.POC_KEY)
          return this.send(ws, { t: "error", why: "key" });
        if (!["write-first", "relay-first"].includes(f.order))
          return this.send(ws, { t: "error", why: "order" });
        this.order = f.order;
        this.sql.exec(
          "INSERT OR REPLACE INTO meta (k, v) VALUES ('order', ?)",
          f.order,
        );
        return this.send(ws, { t: "opt", order: this.order });
      case "reset":
        return this.onReset(ws, f);
      default:
        return this.send(ws, { t: "error", why: "type" });
    }
  }

  onCast(ws, me, f) {
    if (me.role !== "player")
      return this.send(ws, { t: "error", why: "observer" });
    this.counters.casts++;
    const out = JSON.stringify(relayCast(me.m, this.stamp(), f));
    for (const p of this.ctx.getWebSockets("player"))
      if (p !== ws) this.send(p, out);
    if (this.thin.allow(me.m, Date.now())) {
      for (const o of this.ctx.getWebSockets("observer")) this.send(o, out);
    }
  }

  onAct(ws, me, f) {
    if (me.role !== "player")
      return this.send(ws, { t: "error", why: "observer" });
    if (
      typeof f.id !== "string" ||
      typeof f.h !== "string" ||
      typeof f.a !== "string"
    ) {
      return this.send(ws, { t: "error", why: "act-shape" });
    }
    const dup = this.sql
      .exec("SELECT seq, s, ts, e FROM acts WHERE id = ?", f.id)
      .toArray()[0];
    const d = decideAct(this.head.seq, f, dup ? dup.seq : null);
    if (d.kind === "dup") {
      this.counters.dups++;
      return this.send(ws, {
        t: "ok",
        id: f.id,
        seq: dup.seq,
        s: dup.s,
        ts: dup.ts,
        e: dup.e,
        dup: true,
      });
    }
    if (d.kind === "refuse") {
      this.counters.refused++;
      return this.send(ws, {
        t: "refused",
        id: f.id,
        seq: f.seq,
        head: this.head.seq,
        why: d.why,
      });
    }
    const st = this.stamp();
    const out = JSON.stringify(relayAct(me.m, st, f));
    const write = () => {
      this.sql.exec(
        "INSERT INTO acts (seq, id, m, a, h, snap, s, ts, e) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        f.seq,
        f.id,
        me.m,
        f.a,
        f.h,
        typeof f.snap === "string" ? f.snap : "",
        st.s,
        st.ts,
        st.e,
      );
      this.sql.exec(
        "INSERT OR REPLACE INTO head (k, seq, h) VALUES (1, ?, ?)",
        f.seq,
        f.h,
      );
      this.head = { seq: f.seq, h: f.h };
    };
    const relay = () => {
      for (const p of this.ctx.getWebSockets()) if (p !== ws) this.send(p, out);
      this.send(ws, {
        t: "ok",
        id: f.id,
        seq: f.seq,
        s: st.s,
        ts: st.ts,
        e: st.e,
      });
    };
    this.counters.acts++;
    if (this.order === "relay-first") {
      relay();
      write();
    } else {
      write();
      relay();
    }
  }

  onJoin(ws, f) {
    const last = Number.isInteger(f.last) ? f.last : 0;
    const rows = this.sql
      .exec(
        "SELECT seq, id, m, a, h, s, ts, e FROM acts WHERE seq > ? ORDER BY seq",
        last,
      )
      .toArray();
    const acts = rows.map((r) => ({
      t: "act",
      m: r.m,
      s: r.s,
      ts: r.ts,
      e: r.e,
      id: r.id,
      seq: r.seq,
      a: r.a,
      h: r.h,
    }));
    this.send(ws, {
      t: "joined",
      head: this.head.seq,
      e: this.e,
      order: this.order,
      acts,
    });
  }

  async onReset(ws, f) {
    if (f.key !== this.env.POC_KEY)
      return this.send(ws, { t: "error", why: "key" });
    await this.ctx.storage.deleteAll();
    this.s = 0;
    this.thin = new ObserverThinner();
    this.load(); // fresh tables, epoch 1
    this.send(ws, { t: "reset", ok: true });
    for (const w of this.ctx.getWebSockets()) {
      try {
        w.close(4000, "reset");
      } catch {}
    }
  }

  stats() {
    const n = this.sql.exec("SELECT COUNT(*) AS n FROM acts").toArray()[0].n;
    return {
      t: "stats",
      e: this.e,
      s: this.s,
      head: this.head.seq,
      order: this.order,
      actsStored: n,
      sockets: {
        players: this.ctx.getWebSockets("player").length,
        observers: this.ctx.getWebSockets("observer").length,
      },
      sinceWakeMs: Date.now() - this.bornAt,
      version: this.env.POC_VERSION || "0",
      dbBytes: this.sql.databaseSize,
      ...this.counters,
    };
  }

  webSocketClose(ws, code, reason) {
    // The runtime should reply to a client's Close itself (web_socket_auto_reply_to_close);
    // locally it did not, so answer it. The docs say a second close() is ignored.
    try {
      ws.close(code === 1005 ? 1000 : code, reason);
    } catch {}
  }
  webSocketError() {}
}
