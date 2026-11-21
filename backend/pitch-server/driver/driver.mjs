#!/usr/bin/env node
// Simulated players and observers for the pitch server, on the real protocol
// (PROTOCOL.md). Synthetic payloads only, sized like real ones. One process, one clock:
// casts and actions carry their sender's send time inside their opaque payloads, so
// sender -> pitch -> receiver latency is read directly.
//
//   node driver/driver.mjs --url ws://127.0.0.1:8797 --scenario turns --players 12 --observers 20 --duration 60
//
// Scenarios: turns, order (relay-first against write-first), simul, idle (hibernation),
// resume, rtt. --exec-at/--exec run a command part way (a redeploy). With DEV_KEY (the
// environment or .dev.vars) it reads each pitch's stats from /dev/pitch and wipes the
// pitch at the end, so test pitches leave nothing behind.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const here = dirname(fileURLToPath(import.meta.url));
const now = () => performance.timeOrigin + performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";
const rand = (n) =>
  Array.from(randomBytes(n), (b) => ALPHA[b % ALPHA.length]).join("");
// A made-up pitch code. "wf" codes play write-first on a Worker with
// DEV_WRITE_FIRST_PREFIX=wf; the others never start with it.
const newCode = (writeFirst = false) => {
  if (writeFirst) return `wf${rand(10)}`;
  for (;;) {
    const c = rand(12);
    if (!c.startsWith("wf")) return c;
  }
};
const pad = (n) =>
  randomBytes(Math.ceil(n * 0.75))
    .toString("base64")
    .slice(0, n);
const STAMPED = new Set(["member", "left", "host", "doc", "start", "act"]);

function parseArgs(argv) {
  const a = {
    url: "ws://127.0.0.1:8797",
    scenario: "turns",
    players: 12,
    observers: 20,
    duration: 60, // seconds of turns
    castSec: 3, // aim before each action
    hz: 15,
    idleSec: 30,
    rounds: 8, // simul
    execAt: null, // seconds into the run
    exec: null, // a shell command to run then (a redeploy)
    out: null,
    pitch: null,
    label: null,
    keep: "no", // "yes": leave the pitch, do not wipe it
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i]
      .replace(/^--/, "")
      .replace(/-(\w)/g, (_, c) => c.toUpperCase());
    const v = argv[i + 1];
    if (!(k in a)) throw new Error(`unknown flag ${argv[i]}`);
    a[k] = typeof a[k] === "number" || k === "execAt" ? Number(v) : v;
    i++;
  }
  return a;
}

function readDevKey() {
  if (process.env.DEV_KEY) return process.env.DEV_KEY;
  const file = join(here, "..", ".dev.vars");
  if (!existsSync(file)) return null;
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((l) => l.startsWith("DEV_KEY="));
  return line ? line.slice("DEV_KEY=".length).trim() : null;
}

const tally = { connects: 0, sent: 0, bytesSent: 0, devCalls: 0 };
const runId = rand(6);

class Client {
  constructor(opts, pitch, role, name) {
    Object.assign(this, { opts, pitch, role, name });
    this.member = `drv-${runId}-${name}`; // 8+ characters
    this.s = 0;
    this.v = 0;
    this.n = null;
    this.head = 0;
    this.acts = new Map(); // seq -> "seq|id|h"
    this.base = 0; // a join with the whole state: the log is known only after this
    this.fullResyncs = 0;
    this.sJumps = 0;
    this.castS = 0; // casts whose s was not the last stamp seen
    this.errors = {};
    this.lat = { cast: [], act: [], ok: [], join: [], refused: [] };
    this.obsCasts = []; // observers: { m, ts }
    this.castsGot = 0;
    this.steadyCastsGot = 0; // casts not marked `all`
    this.castsSent = 0;
    this.pending = new Map(); // act id -> { resolve, sentAt, h }
    this.waiters = [];
    this.reconnects = 0;
    this.closes = [];
    this.joinsAt = [];
    this.auto = true;
  }
  url() {
    const u = new URL(this.opts.url);
    u.pathname = "/ws";
    u.search = new URLSearchParams({ pitch: this.pitch }).toString();
    return u.toString();
  }
  connect() {
    tally.connects++;
    const t0 = now();
    this.ws = new WebSocket(this.url(), { perMessageDeflate: false });
    const ready = new Promise((resolve, reject) => {
      this.ws.once("open", () => {
        const j = { t: "join", member: this.member, role: this.role, me: {} };
        if (this.v) j.v = this.v;
        if (this.n !== null) Object.assign(j, { n: this.n, seq: this.head });
        this.send(j);
      });
      this.ws.once("error", reject);
      this.onJoined = (f) => {
        this.lat.join.push(now() - t0);
        this.joinsAt.push(now());
        resolve(f);
      };
    });
    this.ws.on("message", (data) => this.onMessage(data.toString()));
    this.ws.on("close", (code, reason) => {
      this.closes.push({ at: now(), code, reason: reason.toString() });
      if (this.auto) {
        this.reconnects++;
        setTimeout(() => this.auto && this.connect().catch(() => {}), 250);
      }
    });
    return ready;
  }
  close(leave = false) {
    this.auto = false;
    try {
      if (leave) this.send({ t: "leave" });
      this.ws.close(1000, "done");
    } catch {}
  }
  send(o) {
    const text = typeof o === "string" ? o : JSON.stringify(o);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(text);
    tally.sent++;
    tally.bytesSent += text.length;
    return true;
  }
  waitFor(pred, ms = 5000) {
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      this.waiters.push(w);
      setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) {
          this.waiters.splice(i, 1);
          reject(new Error(`${this.name}: timeout`));
        }
      }, ms);
    });
  }
  stampSeen(s) {
    if (s !== this.s + 1) this.sJumps++;
    this.s = Math.max(this.s, s);
  }
  addAct(seq, id, h) {
    const line = `${seq}|${id}|${h}`;
    if (seq <= this.head) {
      if (this.acts.has(seq) && this.acts.get(seq) !== line)
        this.conflict = (this.conflict || 0) + 1;
      return;
    }
    if (seq !== this.head + 1) {
      this.gap = (this.gap || 0) + 1;
      this.send({ t: "resync" });
      return;
    }
    this.acts.set(seq, line);
    this.head = seq;
  }
  onMessage(raw) {
    const at = now();
    if (raw === "pong") return this.resolve({ t: "PONG" });
    const f = JSON.parse(raw);
    if (STAMPED.has(f.t)) this.stampSeen(f.s);
    switch (f.t) {
      case "joined":
        this.s = f.s;
        this.v = f.v;
        if (f.match) {
          if (this.n !== f.match.n) {
            this.n = f.match.n;
            this.head = 0;
            this.base = 0;
            this.acts = new Map();
          }
          if (f.match.full) {
            if (this.joinsAt.length) this.fullResyncs++; // a rejoin that got the whole state
            this.head = f.match.seq;
            this.base = f.match.seq;
            this.acts = new Map();
          } else for (const x of f.match.acts) this.addAct(x.seq, x.id, x.h);
        }
        if (this.onJoined) {
          const cb = this.onJoined;
          this.onJoined = null;
          cb(f);
        }
        break;
      case "state":
        this.s = f.s;
        break;
      case "doc":
        this.v = f.v;
        break;
      case "start":
        this.v = f.v;
        this.n = f.n;
        this.head = 0;
        this.base = 0;
        this.acts = new Map();
        break;
      case "cast":
        this.castsGot++;
        if (f.s !== this.s) this.castS++;
        if (typeof f.d?.st === "number") this.lat.cast.push(at - f.d.st);
        if (this.role === "observer") this.obsCasts.push({ m: f.m, ts: f.ts });
        if (!f.d?.rel) this.steadyCastsGot++;
        break;
      case "act":
        if (typeof f.a?.st === "number") this.lat.act.push(at - f.a.st);
        this.addAct(f.seq, f.id, f.h);
        break;
      case "ok": {
        if (f.re !== "act") {
          if (!f.dup) this.stampSeen(f.s);
          if (f.v) this.v = f.v;
          if (f.re === "start") {
            this.n = f.n;
            this.head = 0;
            this.base = 0;
            this.acts = new Map();
          }
          break;
        }
        if (!f.dup) this.stampSeen(f.s);
        const p = this.pending.get(f.id);
        if (p) {
          this.lat.ok.push(at - p.sentAt);
          this.pending.delete(f.id);
          this.addAct(f.seq, f.id, p.h);
          p.resolve(f);
        }
        break;
      }
      case "refused": {
        const p = this.pending.get(f.id);
        if (p) {
          this.lat.refused.push(at - p.sentAt);
          this.pending.delete(f.id);
          p.resolve(f);
        }
        break;
      }
      case "error":
        this.errors[f.code] = (this.errors[f.code] || 0) + 1;
        break;
    }
    this.resolve(f);
  }
  resolve(f) {
    for (const w of [...this.waiters])
      if (w.pred(f)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(f);
      }
  }
  cast(all = false) {
    const m = { t: "cast", d: { t: "aim", st: now(), p: pad(300) } };
    if (all) {
      m.all = true;
      m.d.rel = true; // the release: reaches observers unthinned
    } else this.castsSent++;
    return this.send(m);
  }
  act(seq, ms = 8000) {
    const id = `${this.name}-${seq}-${rand(6)}`;
    const h = createHash("sha256").update(id).digest("hex").slice(0, 16);
    const sentAt = now();
    const p = new Promise((resolve) =>
      this.pending.set(id, { resolve, sentAt, h }),
    );
    this.send({
      t: "act",
      id,
      n: this.n,
      seq,
      a: { st: sentAt, p: pad(600) },
      h,
      snap: pad(12000),
      c: "drv",
    });
    return Promise.race([p, sleep(ms).then(() => ({ t: "timeout", id }))]);
  }
  async rpc(o, pred, ms = 5000) {
    const w = this.waitFor(pred, ms);
    this.send(o);
    return w;
  }
}

function pct(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const r = (x) => Math.round(x * 10) / 10;
  return {
    n: s.length,
    p50: r(q(0.5)),
    p95: r(q(0.95)),
    p99: r(q(0.99)),
    max: r(s[s.length - 1]),
    over250: s.filter((x) => x > 250).length,
    over1000: s.filter((x) => x > 1000).length,
  };
}

function httpUrl(opts, path) {
  const u = new URL(opts.url);
  u.protocol = u.protocol === "wss:" ? "https:" : "http:";
  u.pathname = path;
  u.search = "";
  return u;
}

async function dev(opts, pitch, op = null) {
  if (!opts.devKey) return null;
  tally.devCalls++;
  const u = httpUrl(opts, "/dev/pitch");
  u.searchParams.set("pitch", pitch);
  if (op) u.searchParams.set("op", op);
  try {
    const r = await fetch(u, {
      method: op ? "POST" : "GET",
      headers: { authorization: `Bearer ${opts.devKey}` },
    });
    return r.ok ? r.json() : { error: r.status };
  } catch (e) {
    return { error: String(e) };
  }
}

// The host joins first and starts match 1; then everyone else joins, gently.
async function makePitch(opts, pitch) {
  const players = [];
  const observers = [];
  for (let i = 0; i < opts.players; i++)
    players.push(new Client(opts, pitch, "player", `p${i + 1}`));
  for (let i = 0; i < opts.observers; i++)
    observers.push(new Client(opts, pitch, "observer", `o${i + 1}`));
  const host = players[0];
  await host.connect();
  await host.rpc(
    {
      t: "start",
      id: "go",
      base: host.v,
      doc: { started: true, teams: { A: [], B: [] } },
      n: 1,
      h: "h0",
      snap: pad(12000),
      meta: { engine: "0.0.0", setup: { synthetic: true } },
    },
    (f) => f.t === "ok" && f.re === "start",
  );
  const rest = [...players.slice(1), ...observers];
  for (let i = 0; i < rest.length; i += 8)
    await Promise.all(rest.slice(i, i + 8).map((c) => c.connect()));
  return { pitch, players, observers, all: [...players, ...observers] };
}

// One thrower aims at hz for castMs, the last cast marked `all` (the release), then
// commits an action; the turn passes round the players still on.
async function throwTurn(opts, thrower, castMs = opts.castSec * 1000) {
  const n = Math.round((castMs / 1000) * opts.hz);
  const t0 = now();
  for (let i = 0; i < n; i++) {
    thrower.cast(i === n - 1);
    const next = t0 + ((i + 1) * 1000) / opts.hz;
    await sleep(Math.max(0, next - now()));
  }
  return thrower.act(thrower.head + 1);
}

async function runTurns(opts, R, seconds) {
  const end = now() + seconds * 1000;
  let turn = 0;
  const outcomes = {};
  while (now() < end) {
    const live = R.players.filter(
      (p) => p.auto && p.ws.readyState === WebSocket.OPEN,
    );
    if (!live.length) {
      outcomes.allAwayWaits = (outcomes.allAwayWaits || 0) + 1;
      await sleep(50);
      continue;
    }
    const thrower = live[turn % live.length];
    turn++;
    const r = await throwTurn(opts, thrower);
    const k =
      r.t === "ok" ? "ok" : r.t === "refused" ? `refused:${r.why}` : r.t;
    outcomes[k] = (outcomes[k] || 0) + 1;
    await sleep(250);
  }
  return { turns: turn, outcomes };
}

function analyse(opts, R, extra = {}) {
  const lat = (role, type) =>
    pct(R.all.filter((c) => c.role === role).flatMap((c) => c.lat[type]));
  const res = {
    pitch: R.pitch,
    sockets: R.all.length,
    players: R.players.length,
    observers: R.observers.length,
    latency: {
      castToPlayers: lat("player", "cast"),
      castToObservers: lat("observer", "cast"),
      actToPlayers: lat("player", "act"),
      actToObservers: lat("observer", "act"),
      actAckToSender: lat("player", "ok"),
      refusedToSender: lat("player", "refused"),
      join: pct(R.all.flatMap((c) => c.lat.join)),
    },
  };
  // the observers' thinned feed: per sender, the closest two casts and the rate
  let minGap = Infinity;
  let under50 = 0;
  for (const o of R.observers) {
    const last = new Map();
    for (const f of o.obsCasts) {
      if (last.has(f.m)) {
        const g = f.ts - last.get(f.m);
        minGap = Math.min(minGap, g);
        if (g < 50) under50++;
      }
      last.set(f.m, f.ts);
    }
  }
  const avg = (xs) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  // the observers' share of every steady (not `all`) cast sent gives their rate
  const steady = R.all.filter((c) => c.closes.length === 0 && !c.dropped);
  const sent = R.players.reduce((n, c) => n + c.castsSent, 0);
  const oGot = avg(
    steady.filter((c) => c.role === "observer").map((c) => c.steadyCastsGot),
  );
  res.observerFeed = {
    castsSent: sent,
    perObserverCasts: Math.round(oGot),
    observerHzFrom15: sent
      ? Math.round((opts.hz * oGot * 10) / sent) / 10
      : null,
    minGapMs: Number.isFinite(minGap) ? minGap : null,
    gapsUnder50ms: under50,
  };
  // every client's log over the stretch they all hold
  const from = Math.max(...R.all.map((c) => c.base)) + 1;
  const to = Math.min(...R.all.map((c) => c.head));
  const hashes = new Map();
  for (const c of R.all) {
    const lines = [];
    for (let q = from; q <= to; q++) lines.push(c.acts.get(q) ?? "?");
    const h = createHash("sha256")
      .update(lines.join("\n"))
      .digest("hex")
      .slice(0, 12);
    hashes.set(h, (hashes.get(h) || 0) + 1);
  }
  const sum = (f) => R.all.reduce((n, c) => n + f(c), 0);
  const errors = {};
  for (const c of R.all)
    for (const [k, v] of Object.entries(c.errors))
      errors[k] = (errors[k] || 0) + v;
  res.ordering = {
    actLogHashes: Object.fromEntries(hashes),
    identical: hashes.size === 1,
    comparedSeqs: [from, to],
    actsInLog: Math.max(...R.all.map((c) => c.head)),
    sJumps: sum((c) => c.sJumps),
    castsOffStamp: sum((c) => c.castS),
    conflicts: sum((c) => c.conflict || 0),
    gaps: sum((c) => c.gap || 0),
    fullResyncs: sum((c) => c.fullResyncs),
    unexpectedCloses: sum((c) => c.closes.length),
    reconnects: sum((c) => c.reconnects),
    errors,
  };
  return { ...res, ...extra };
}

async function finish(opts, R, result) {
  result.serverStats = await dev(opts, R.pitch);
  for (const c of R.all) c.close(true);
  await sleep(500);
  if (opts.keep !== "yes") result.wiped = await dev(opts, R.pitch, "wipe");
  return result;
}

async function healthRtt(opts, n = 20) {
  const u = httpUrl(opts, "/health");
  const xs = [];
  let body = null;
  for (let i = 0; i < n; i++) {
    const t0 = now();
    const r = await fetch(u, { cache: "no-store" });
    body = await r.text();
    xs.push(now() - t0);
    await sleep(100);
  }
  return { health: body, rtt: pct(xs) };
}

async function scenarioTurns(opts, writeFirst = false) {
  const R = await makePitch(opts, opts.pitch || newCode(writeFirst));
  let execResult = null;
  const runT0 = now();
  if (opts.execAt != null && opts.exec) {
    setTimeout(() => {
      const t0 = now();
      const p = spawn("sh", ["-c", opts.exec], { stdio: "inherit" });
      p.on(
        "exit",
        (c) =>
          (execResult = {
            code: c,
            ms: Math.round(now() - t0),
            at: opts.execAt,
          }),
      );
    }, opts.execAt * 1000);
  }
  const before = await dev(opts, R.pitch);
  const run = await runTurns(opts, R, opts.duration);
  await sleep(1500); // let reconnects settle and resume
  const res = analyse(opts, R, {
    order: writeFirst ? "write-first" : "relay-first",
    run,
    exec: execResult,
    versionBefore: before?.version,
  });
  if (opts.execAt != null) {
    res.closes = R.all.flatMap((c) =>
      c.closes.map((x) => {
        const back = c.joinsAt.find((t) => t > x.at);
        return {
          m: c.name,
          code: x.code,
          atSec: Math.round((x.at - runT0) / 100) / 10,
          outMs: back ? Math.round(back - x.at) : null,
        };
      }),
    );
  }
  return finish(opts, R, res);
}

async function scenarioOrder(opts) {
  const out = {};
  out["relay-first"] = await scenarioTurns({ ...opts, pitch: null }, false);
  out["write-first"] = await scenarioTurns({ ...opts, pitch: null }, true);
  return {
    compare: Object.fromEntries(
      Object.entries(out).map(([k, v]) => [
        k,
        {
          actToPlayers: v.latency.actToPlayers,
          actToObservers: v.latency.actToObservers,
          actAckToSender: v.latency.actAckToSender,
          castToPlayers: v.latency.castToPlayers,
          identical: v.ordering.identical,
        },
      ]),
    ),
    full: out,
  };
}

async function scenarioSimul(opts) {
  const R = await makePitch(opts, opts.pitch || newCode());
  const rounds = [];
  for (let r = 0; r < opts.rounds; r++) {
    const A = R.players[(2 * r) % R.players.length];
    const B = R.players[(2 * r + 1) % R.players.length];
    await throwTurn(opts, A, 1000);
    await sleep(300);
    const seq = A.head + 1;
    const [ra, rb] = await Promise.all([A.act(seq), B.act(seq)]);
    await sleep(400);
    const winner = ra.t === "ok" ? ra.id : rb.t === "ok" ? rb.id : null;
    const seen = new Set(
      R.all.map((c) => (c.acts.get(seq) || "").split("|")[1]),
    );
    rounds.push({
      seq,
      oneAccepted: [ra.t, rb.t].sort().join() === "ok,refused",
      sameEverywhere: seen.size === 1 && seen.has(winner),
    });
  }
  return finish(opts, R, analyse(opts, R, { rounds }));
}

// Idle with no messages, then idle with only literal pings (answered by the runtime):
// each time, did the object sleep (a new instance afterwards, bornAt moved), and how
// slow was the first message after it?
async function scenarioIdle(opts) {
  const R = await makePitch(opts, opts.pitch || newCode());
  await runTurns(opts, R, 8);
  const phases = [];
  for (const withPing of [false, true]) {
    const s0 = await dev(opts, R.pitch);
    let pings = 0;
    const t0 = now();
    while (now() - t0 < opts.idleSec * 1000) {
      await sleep(5000);
      if (withPing) {
        for (const c of R.all) c.send("ping");
        pings += R.all.length;
      }
    }
    const thrower = R.players[1];
    const sentAt = now();
    const marks = R.players
      .filter((p) => p !== thrower)
      .map((p) =>
        p.waitFor((f) => f.t === "cast", 10000).then(() => now() - sentAt),
      );
    thrower.cast();
    const firstCast = pct(await Promise.all(marks));
    const okAct = await thrower.act(thrower.head + 1);
    const s1 = await dev(opts, R.pitch);
    phases.push({
      idleSec: opts.idleSec,
      literalPingsDuringIdle: pings,
      firstCastLatency: firstCast,
      firstActAck: okAct.t,
      bornBefore: s0?.bornAt,
      bornAfter: s1?.bornAt,
      sleptAndRebuilt: s0 && s1 ? s1.bornAt !== s0.bornAt : null,
      wokeFrom: s1?.wokeFrom,
      headAfter: s1?.head,
    });
  }
  return finish(opts, R, analyse(opts, R, { phases }));
}

async function scenarioResume(opts) {
  const R = await makePitch(opts, opts.pitch || newCode());
  await runTurns(opts, R, 6);
  const drop = R.players.slice(-3);
  for (const c of drop) {
    c.dropped = true;
    c.close();
  }
  await sleep(300);
  const headAtDrop = drop.map((c) => c.head);
  await runTurns(opts, R, Math.max(10, opts.duration / 3));
  const resumed = [];
  for (const [i, c] of drop.entries()) {
    c.auto = true;
    const j = await c.connect();
    resumed.push({
      m: c.name,
      lastBefore: headAtDrop[i],
      headServer: j.match?.seq,
      full: j.match?.full,
      missedReturned: j.match?.acts?.length ?? null,
      caughtUp: c.head === j.match?.seq,
    });
  }
  await runTurns(opts, R, 6);
  await sleep(500);
  return finish(opts, R, analyse(opts, R, { resumed }));
}

async function main() {
  const opts = parseArgs(process.argv);
  opts.devKey = readDevKey();
  const loop = monitorEventLoopDelay({ resolution: 1 });
  loop.enable();
  const startedAt = new Date().toISOString();
  const t0 = now();
  const run = {
    turns: () => scenarioTurns(opts, opts.pitch?.startsWith("wf")),
    order: () => scenarioOrder(opts),
    simul: () => scenarioSimul(opts),
    idle: () => scenarioIdle(opts),
    resume: () => scenarioResume(opts),
    rtt: () => healthRtt(opts),
  }[opts.scenario];
  if (!run) throw new Error(`unknown scenario ${opts.scenario}`);
  const result = await run();
  loop.disable();
  const out = {
    scenario: opts.scenario,
    label: opts.label,
    target: new URL(opts.url).host,
    startedAt,
    wallSec: Math.round((now() - t0) / 100) / 10,
    driverLoopDelayMs: {
      p50: loop.percentile(50) / 1e6,
      p99: loop.percentile(99) / 1e6,
      max: loop.max / 1e6,
    },
    // Durable Object requests: a WebSocket connect is one, inbound messages are billed
    // 20 to 1, each /dev/pitch call one. Outgoing messages are not billed.
    billing: {
      connects: tally.connects,
      inboundMessages: tally.sent,
      devCalls: tally.devCalls,
      billedRequestsEstimate:
        Math.ceil(tally.sent / 20) + tally.connects + tally.devCalls,
      bytesSent: tally.bytesSent,
    },
    ...result,
  };
  const file =
    opts.out ||
    join(
      here,
      "..",
      "results",
      `${opts.label || opts.scenario}-${Date.now()}.json`,
    );
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 2));
  const brief = { ...out };
  delete brief.full;
  console.log(JSON.stringify(brief, null, 2));
  console.error(`wrote ${file}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
