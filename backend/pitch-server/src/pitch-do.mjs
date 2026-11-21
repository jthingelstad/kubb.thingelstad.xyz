// PitchDO: one Durable Object per pitch, named by its code. It owns the sockets, the
// SQLite storage and the alarm, and drives the pure pitch core (../core.mjs), carrying
// out every effect the core returns in the order given (PROTOCOL.md section 10).
//
// Nothing lives only in memory. After every wake (hibernation, eviction, a deploy) the
// constructor rebuilds the core's state from SQLite and the sockets' attachments with
// rebuildPitch, inside blockConcurrencyWhile, before any event is delivered.
//
// Commit order and output gates. A Durable Object holds back every outgoing message
// (WebSocket frames, fetch, RPC) sent while a storage write is still being made durable,
// and releases them once it is. Messages sent before the write was issued go at once.
// The core already orders the effects for its `commitOrder`, so applying them in order,
// synchronously, gives each order exactly:
//
//   relay-first (the default): the `send` effects come before the `persist`. The frames
//     leave on ws.send() before the SQL write exists, so no gate holds them; the write
//     follows in the same synchronous turn. If the object dies between the two, the
//     action was shown and not kept: the next action's `seq` or the hash check catches
//     it and the clients resync (tests/pitch-server). (A write still in flight from an
//     earlier event can hold these frames too; the gate is per object, not per write.)
//   write-first: the `persist` comes first. Every frame sent after it is held by the
//     output gate until SQLite has confirmed the write, so nobody sees an action that
//     could be lost.
//
// `push`, `listing` and `alarm` always come last, after the persist, so the AWS request
// and the lobby call are held until the change they report is durable.
import { DurableObject } from "cloudflare:workers";
import { PITCH_CODE, rebuildPitch, step } from "../core.mjs";
import { PUSH, pushRequest, retryDelay } from "./push.mjs";

// Five small records as JSON (pitch, doc, members, match, head), the current match's
// action log, and the outbox of pushes AWS has not confirmed, with their retry state.
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS records (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS acts (n INTEGER NOT NULL, seq INTEGER NOT NULL, rec TEXT NOT NULL, PRIMARY KEY (n, seq)) WITHOUT ROWID",
  "CREATE TABLE IF NOT EXISTS outbox (k TEXT PRIMARY KEY, topic TEXT NOT NULL, body TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL DEFAULT 0)",
];
const RECORDS = ["pitch", "doc", "members", "match", "head"];

// The owner's open calls, from the Worker's environment (README.md "Configuration").
export function pitchOptions(env, code) {
  const o = {};
  const wf = env.DEV_WRITE_FIRST_PREFIX;
  if (wf && code.startsWith(wf)) o.commitOrder = "write-first";
  else if (env.COMMIT_ORDER) o.commitOrder = env.COMMIT_ORDER;
  if (env.UNKNOWN_PITCH) o.unknownPitch = env.UNKNOWN_PITCH;
  const observers = Number(env.OBSERVERS_MAX);
  if (Number.isInteger(observers) && observers > 0) o.limits = { observers };
  return o;
}

const ALPHA = "abcdefghijklmnopqrstuvwxyz0123456789";
const newConn = () =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(12)),
    (b) => ALPHA[b % 36],
  ).join("");

// A close code the runtime lets a server send back.
const replyCode = (code) =>
  Number.isInteger(code) &&
  ((code >= 3000 && code < 5000) ||
    (code >= 1000 && code < 1015 && ![1004, 1005, 1006].includes(code)))
    ? code
    : 1000;

export class PitchDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.clock = () => Date.now(); // the tests move it to reach the idle wipe
    this.state = null; // the core's, opaque; null until the code is known
    this.code = null;
    this.made = null; // the pitch's `made`, to match push confirmations to this life
    this.sockets = new Map(); // conn -> WebSocket
    this.retry = new Map(); // push k -> { tries, due }: pushes that failed
    this.inflight = new Set(); // push k being sent now
    this.coreAlarm = null; // what the core asked for
    this.alarmSet = null; // what is scheduled
    this.listSeq = 0;
    this.wiping = null;
    this.bornAt = Date.now();
    this.woke = { stored: false, sockets: 0 };
    // A literal "ping" is answered "pong" by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
    ctx.blockConcurrencyWhile(() => this.wake());
  }

  schema() {
    for (const q of SCHEMA) this.sql.exec(q);
  }

  async wake() {
    this.schema();
    this.alarmSet = (await this.ctx.storage.getAlarm()) ?? null;
    const stored = this.readStored();
    const conns = [];
    let code = stored.pitch?.code ?? null;
    for (const ws of this.ctx.getWebSockets()) {
      const at = ws.deserializeAttachment();
      if (!at?.conn) continue;
      this.sockets.set(at.conn, ws);
      code ??= at.code ?? null;
      conns.push({
        conn: at.conn,
        member: at.member ?? null,
        role: at.role ?? null,
      });
    }
    this.woke = { stored: Boolean(stored.pitch), sockets: conns.length };
    // A pitch nobody has used and nobody is on: built on its first connection.
    if (code) this.build(code, stored, conns);
  }

  readStored() {
    const out = {};
    for (const r of this.sql.exec("SELECT k, v FROM records"))
      out[r.k] = JSON.parse(r.v);
    if (!out.pitch) return {};
    out.acts = this.sql
      .exec("SELECT rec FROM acts ORDER BY n, seq")
      .toArray()
      .map((r) => JSON.parse(r.rec));
    out.outbox = [];
    for (const r of this.sql.exec(
      "SELECT k, topic, body, tries, due FROM outbox ORDER BY rowid",
    )) {
      out.outbox.push({ k: r.k, topic: r.topic, body: JSON.parse(r.body) });
      if (r.tries > 0) this.retry.set(r.k, { tries: r.tries, due: r.due });
    }
    return out;
  }

  build(code, stored, conns) {
    this.code = code;
    this.made = stored.pitch?.made ?? null;
    this.coreAlarm = stored.pitch?.alarmAt ?? null;
    const r = rebuildPitch({
      code,
      stored: stored.pitch ? stored : null,
      conns,
      now: this.clock(),
      options: pitchOptions(this.env, code),
      // The real alarm. It is the earlier of the core's and a push retry's, so when a
      // retry is pending the core sees a difference and asks again; syncAlarm then
      // finds nothing to change.
      alarm: this.alarmSet,
    });
    this.state = r.state;
    this.apply(r.effects);
  }

  // ---------- events ----------

  async fetch(request) {
    if (this.wiping) await this.wiping;
    const url = new URL(request.url);
    const code = url.searchParams.get("pitch") ?? "";
    if (!PITCH_CODE.test(code))
      return new Response("bad pitch", { status: 400 });
    if (url.pathname === "/dev") return this.dev(request, url, code);
    if (!this.state) this.build(code, {}, []);
    const [client, server] = Object.values(new WebSocketPair());
    const conn = newConn();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ conn, member: null, role: null, code });
    this.sockets.set(conn, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // No await on the way through unless a wipe is still being made: the relay path from
  // receive to send is synchronous.
  async webSocketMessage(ws, message) {
    if (this.wiping) await this.wiping;
    const at = ws.deserializeAttachment();
    if (!at?.conn || !this.state) return;
    if (!this.sockets.has(at.conn)) this.sockets.set(at.conn, ws);
    this.handle({ type: "frame", conn: at.conn, text: message });
  }

  async webSocketClose(ws, code, reason) {
    // The runtime should answer a client's close itself; answer it in case it did not
    // (a second close() is ignored).
    try {
      ws.close(replyCode(code), String(reason ?? "").slice(0, 120));
    } catch {}
    await this.gone(ws);
  }

  async webSocketError(ws) {
    await this.gone(ws);
  }

  async gone(ws) {
    if (this.wiping) await this.wiping;
    const at = ws.deserializeAttachment();
    if (!at?.conn) return;
    this.sockets.delete(at.conn);
    if (this.state) this.handle({ type: "close", conn: at.conn });
  }

  async alarm() {
    if (this.wiping) await this.wiping;
    this.alarmSet = null; // it fired
    if (!this.state) return;
    // The alarm is shared by the core's deadlines and the push retries; a tick the core
    // did not need changes nothing.
    this.handle({ type: "tick" });
    if (this.wiping) return; // the tick wiped the pitch
    const now = this.clock();
    for (const r of this.sql
      .exec(
        "SELECT k, topic, body FROM outbox WHERE due <= ? ORDER BY rowid",
        now,
      )
      .toArray())
      this.push({
        k: r.k,
        made: this.made,
        topic: r.topic,
        body: JSON.parse(r.body),
      });
    this.syncAlarm();
  }

  handle(event) {
    const r = step(this.state, { ...event, now: this.clock() });
    this.apply(r.effects);
  }

  // ---------- effects ----------

  apply(effects) {
    for (const e of effects) {
      switch (e.kind) {
        case "send": {
          const text = JSON.stringify(e.frame); // once, for every receiver
          for (const conn of e.to) {
            const ws = this.sockets.get(conn);
            if (!ws) continue;
            try {
              ws.send(text);
            } catch {
              // closing already; its close event follows
            }
          }
          break;
        }
        case "close": {
          const ws = this.sockets.get(e.conn);
          this.sockets.delete(e.conn);
          try {
            ws?.close(e.code, e.reason);
          } catch {}
          break;
        }
        case "attach": {
          const ws = this.sockets.get(e.conn);
          if (!ws) break;
          const at = ws.deserializeAttachment() ?? {};
          ws.serializeAttachment({
            ...at,
            conn: e.conn,
            member: e.member,
            role: e.role,
          });
          break;
        }
        case "persist":
          this.persist(e);
          break;
        case "push":
          this.push(e);
          break;
        case "listing":
          this.listing(e);
          break;
        case "alarm":
          this.coreAlarm = e.at;
          this.syncAlarm();
          break;
        case "wipe":
          this.wipe();
          break;
        default:
          throw new Error(`unknown effect ${e.kind}`);
      }
    }
  }

  // One transaction. SQLite in a Durable Object is synchronous: the write is in place
  // when this returns, and the output gate holds what is sent after it until durable.
  persist(e) {
    const sql = this.sql;
    this.ctx.storage.transactionSync(() => {
      for (const k of RECORDS)
        if (e[k] !== undefined)
          sql.exec(
            "INSERT OR REPLACE INTO records (k, v) VALUES (?, ?)",
            k,
            JSON.stringify(e[k]),
          );
      if (e.clearActs) sql.exec("DELETE FROM acts");
      for (const a of e.acts ?? [])
        sql.exec(
          "INSERT OR REPLACE INTO acts (n, seq, rec) VALUES (?, ?, ?)",
          a.n,
          a.seq,
          JSON.stringify(a),
        );
      for (const o of e.outbox ?? [])
        sql.exec(
          "INSERT OR REPLACE INTO outbox (k, topic, body, tries, due) VALUES (?, ?, ?, 0, 0)",
          o.k,
          o.topic,
          JSON.stringify(o.body),
        );
      for (const k of e.unbox ?? [])
        sql.exec("DELETE FROM outbox WHERE k = ?", k);
    });
    if (e.pitch) this.made = e.pitch.made;
  }

  pushConfigured() {
    return Boolean(this.env.PUSH_URL && this.env.PUSH_SECRET);
  }

  // Send one push, unless the receiver is not configured (it waits in the outbox, and
  // nothing else changes), it is on its way already, or its retry is not due yet.
  push(e) {
    if (!this.pushConfigured()) return;
    if (this.inflight.has(e.k)) return;
    const r = this.retry.get(e.k);
    if (r && r.due > this.clock()) return this.syncAlarm();
    this.inflight.add(e.k);
    const p = this.attempt(e).finally(() => this.inflight.delete(e.k));
    this.ctx.waitUntil?.(p);
  }

  async attempt(e) {
    let status = 0;
    // A timer of our own, cleared on the answer: AbortSignal.timeout's timer would run
    // on after the answer and keep the object awake (and in-flight) for its full span.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), PUSH.timeoutMs);
    try {
      const req = await pushRequest({
        url: this.env.PUSH_URL,
        secret: this.env.PUSH_SECRET,
        pitch: this.code,
        made: e.made,
        k: e.k,
        topic: e.topic,
        body: e.body,
        sent: this.clock(),
      });
      const res = await fetch(req.url, {
        ...req.init,
        signal: abort.signal,
      });
      status = res.status;
      await res.body?.cancel();
    } catch {
      status = 0; // no answer
    } finally {
      clearTimeout(timer);
    }
    // Answered: from here its retry time counts for the alarm again (syncAlarm below).
    this.inflight.delete(e.k);
    if (this.wiping) await this.wiping;
    // A push from an earlier life of this code (wiped since) confirms nothing now.
    if (!this.state || e.made !== this.made) return;
    if (status >= 200 && status < 300) {
      this.retry.delete(e.k);
      this.handle({ type: "pushed", k: e.k });
      this.syncAlarm();
      return;
    }
    const still = this.sql
      .exec("SELECT 1 AS x FROM outbox WHERE k = ?", e.k)
      .toArray().length;
    if (!still) return;
    const tries = (this.retry.get(e.k)?.tries ?? 0) + 1;
    const due = this.clock() + retryDelay(tries);
    this.retry.set(e.k, { tries, due });
    this.sql.exec(
      "UPDATE outbox SET tries = ?, due = ? WHERE k = ?",
      tries,
      due,
      e.k,
    );
    if (tries === 1 || tries % 10 === 0)
      console.warn(`push ${e.k} failed (${status}), try ${tries}`);
    this.syncAlarm();
  }

  // One alarm for the core's deadline and the earliest push retry. A push on its way
  // is left out: its due time has passed, and an alarm set in the past fires at once,
  // again and again while a slow receiver answers. Its answer calls this again.
  syncAlarm() {
    let at = this.coreAlarm ?? null;
    if (this.pushConfigured())
      for (const [k, r] of this.retry)
        if (!this.inflight.has(k) && (at === null || r.due < at)) at = r.due;
    if (at === this.alarmSet) return;
    this.alarmSet = at;
    const p =
      at === null
        ? this.ctx.storage.deleteAlarm()
        : this.ctx.storage.setAlarm(at);
    p?.catch?.((err) => console.error("alarm", err?.message));
  }

  listing(e) {
    const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName("open"));
    const p = lobby
      .report({
        pitch: e.pitch,
        entry: e.entry,
        at: this.clock(),
        seq: this.listSeq++,
      })
      .catch((err) => console.warn("listing", err?.message));
    this.ctx.waitUntil?.(p);
  }

  // The pitch is new again: every row and the alarm go. The tables are made again once
  // deleteAll is done; events wait for it.
  wipe() {
    this.retry.clear();
    this.made = null;
    this.coreAlarm = null;
    this.alarmSet = null;
    this.wiping = this.ctx.storage.deleteAll().then(() => {
      this.schema();
      this.wiping = null;
    });
    this.ctx.waitUntil?.(this.wiping);
  }

  // ---------- dev only (the Worker answers 404 here without DEV_KEY) ----------

  async dev(request, url, code) {
    if (request.method === "POST" && url.searchParams.get("op") === "wipe") {
      for (const ws of this.ctx.getWebSockets())
        try {
          ws.close(4000, "reset");
        } catch {}
      this.sockets.clear();
      if (this.state) this.listing({ pitch: code, entry: null });
      this.wipe();
      await this.wiping;
      this.state = null;
      this.code = null;
      return Response.json({ wiped: true });
    }
    const rec = (k) => {
      const r = this.sql
        .exec("SELECT v FROM records WHERE k = ?", k)
        .toArray()[0];
      return r ? JSON.parse(r.v) : null;
    };
    const head = rec("head");
    const count = (t) =>
      this.sql.exec(`SELECT COUNT(*) AS n FROM ${t}`).toArray()[0].n;
    return Response.json({
      pitch: code,
      version: this.env.VERSION ?? "0",
      commitOrder: pitchOptions(this.env, code).commitOrder ?? "relay-first",
      bornAt: this.bornAt,
      sinceWakeMs: Date.now() - this.bornAt,
      wokeFrom: this.woke,
      sockets: this.ctx.getWebSockets().length,
      s: rec("pitch")?.s ?? 0,
      head: head ? { n: head.n, seq: head.seq, over: head.over } : null,
      acts: count("acts"),
      outbox: count("outbox"),
      retrying: this.retry.size,
      alarm: this.alarmSet,
      dbBytes: this.sql.databaseSize,
    });
  }
}
