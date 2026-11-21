#!/usr/bin/env node
// Simulated clients for the Durable Object rooms relay proof of concept.
// Synthetic payloads only. One process, one clock: every frame carries its sender's
// send time, so sender -> server -> receiver latency is read directly.
//
//   node driver/driver.mjs --url ws://127.0.0.1:8799 --scenario turns --players 12 --observers 20 --duration 60
//
// Scenarios: turns, simul, idle, resume, replay, order, rtt. See parseArgs for flags.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const here = dirname(fileURLToPath(import.meta.url));
const now = () => performance.timeOrigin + performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";
const code = (n = 12) =>
  Array.from(randomBytes(n), (b) => ALPHA[b % ALPHA.length]).join("");
const pad = (n) =>
  randomBytes(Math.ceil(n * 0.75))
    .toString("base64")
    .slice(0, n);

function parseArgs(argv) {
  const a = {
    url: "ws://127.0.0.1:8799",
    scenario: "turns",
    players: 12,
    observers: 20,
    duration: 60, // seconds of traffic (turns, order, simul pacing)
    castSec: 3,
    hz: 15,
    idleSec: 30,
    rounds: 8, // simul
    order: "write-first",
    replayFile: join(here, "..", ".data", "replay-timing.json"),
    replayCapSec: 600,
    execAt: null, // seconds into the run
    exec: null, // shell command to run then (local stand-in for a redeploy)
    out: null,
    room: null,
    label: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i]
      .replace(/^--/, "")
      .replace(/-(\w)/g, (_, c) => c.toUpperCase());
    const v = argv[i + 1];
    if (!(k in a)) throw new Error(`unknown flag ${argv[i]}`);
    a[k] = typeof a[k] === "number" ? Number(v) : v;
    i++;
  }
  return a;
}

function readKey() {
  if (process.env.POC_KEY) return process.env.POC_KEY;
  const line = readFileSync(join(here, "..", ".dev.vars"), "utf8")
    .split("\n")
    .find((l) => l.startsWith("POC_KEY="));
  return line.slice("POC_KEY=".length).trim();
}

const tally = { connects: 0, sent: 0, bytesSent: 0 };

class Client {
  constructor(opts, room, role, m) {
    Object.assign(this, { opts, room, role, m });
    this.head = 0;
    this.acts = []; // index seq-1 -> "seq|id|h"
    this.frames = []; // {t, s, e, m, ts}
    this.lat = { cast: [], act: [], ok: [], join: [], refused: [] };
    this.pending = new Map(); // act id -> {resolve, sentAt}
    this.waiters = [];
    this.reconnects = 0;
    this.closes = [];
    this.gapRepairs = 0;
    this.epochs = new Set();
    this.auto = true;
    this.ready = null;
  }
  url() {
    const u = new URL(this.opts.url);
    u.pathname = "/ws";
    u.search = new URLSearchParams({
      room: this.room,
      role: this.role,
      m: this.m,
      key: this.opts.key,
    }).toString();
    return u.toString();
  }
  connect() {
    tally.connects++;
    const t0 = now();
    this.ws = new WebSocket(this.url(), { perMessageDeflate: false });
    this.ready = new Promise((resolve, reject) => {
      this.ws.once("open", () => {
        this.send({ t: "join", last: this.head });
      });
      this.ws.once("error", reject);
      this.onJoined = (j) => {
        this.lat.join.push(now() - t0);
        (this.joinsAt ||= []).push(now());
        resolve(j);
      };
    });
    this.ws.on("message", (data) => this.onMessage(data.toString()));
    this.ws.on("close", (codeN, reason) => {
      this.closes.push({ at: now(), code: codeN, reason: reason.toString() });
      if (this.auto) {
        this.reconnects++;
        setTimeout(() => this.auto && this.connect().catch(() => {}), 250);
      }
    });
    return this.ready;
  }
  close() {
    this.auto = false;
    try {
      this.ws.close(1000, "done");
    } catch {}
  }
  send(o) {
    const s = typeof o === "string" ? o : JSON.stringify(o);
    if (this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(s);
    tally.sent++;
    tally.bytesSent += s.length;
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
          reject(new Error(`${this.m}: timeout`));
        }
      }, ms);
    });
  }
  addAct(seq, id, h) {
    const line = `${seq}|${id}|${h}`;
    if (seq <= this.head) {
      if (this.acts[seq - 1] !== line) this.conflict = (this.conflict || 0) + 1;
      return;
    }
    if (seq !== this.head + 1) {
      // a hole: ask the room for what we missed
      this.gapRepairs++;
      this.send({ t: "join", last: this.head });
      return;
    }
    this.acts.push(line);
    this.head = seq;
  }
  onMessage(raw) {
    const at = now();
    if (raw === "pong") {
      this.lastPong = at;
      return this.resolveWaiters({ t: "pong" });
    }
    const f = JSON.parse(raw);
    if (f.e) this.epochs.add(f.e);
    switch (f.t) {
      case "cast":
        this.lat.cast.push(at - f.st);
        this.frames.push({ t: "cast", s: f.s, e: f.e, m: f.m, ts: f.ts, at });
        break;
      case "act":
        if (typeof f.st === "number") this.lat.act.push(at - f.st);
        this.frames.push({
          t: "act",
          s: f.s,
          e: f.e,
          m: f.m,
          ts: f.ts,
          seq: f.seq,
          at,
        });
        this.addAct(f.seq, f.id, f.h);
        break;
      case "ok": {
        const p = this.pending.get(f.id);
        if (p) {
          this.lat.ok.push(at - p.sentAt);
          this.pending.delete(f.id);
          if (!f.dup)
            this.frames.push({
              t: "act",
              s: f.s,
              e: f.e,
              m: this.m,
              ts: f.ts,
              seq: f.seq,
              own: true,
              at,
            });
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
      case "joined":
        for (const x of f.acts) this.addAct(x.seq, x.id, x.h);
        this.lastJoined = f;
        if (this.onJoined) {
          const cb = this.onJoined;
          this.onJoined = null;
          cb(f);
        }
        break;
    }
    this.resolveWaiters(f);
  }
  resolveWaiters(f) {
    for (const w of [...this.waiters]) {
      if (w.pred(f)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(f);
      }
    }
  }
  cast() {
    return this.send({ t: "cast", st: now(), c: pad(300) });
  }
  act(seq, ms = 8000) {
    const id = `${this.m}-${seq}-${code(6)}`;
    const h = createHash("sha256").update(id).digest("hex").slice(0, 16);
    const sentAt = now();
    const p = new Promise((resolve) =>
      this.pending.set(id, { resolve, sentAt, h }),
    );
    this.send({
      t: "act",
      id,
      seq,
      a: pad(600),
      h,
      snap: pad(12000),
      st: sentAt,
    });
    return Promise.race([p, sleep(ms).then(() => ({ t: "timeout", id }))]);
  }
  async rpc(o, t, ms = 5000) {
    const w = this.waitFor((f) => f.t === t, ms);
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

async function makeRoom(opts, room) {
  const players = [];
  const observers = [];
  for (let i = 0; i < opts.players; i++)
    players.push(new Client(opts, room, "player", `p${i + 1}`));
  for (let i = 0; i < opts.observers; i++)
    observers.push(new Client(opts, room, "observer", `o${i + 1}`));
  const all = [...players, ...observers];
  // connect in small batches: be gentle
  for (let i = 0; i < all.length; i += 8)
    await Promise.all(all.slice(i, i + 8).map((c) => c.connect()));
  return { room, players, observers, all };
}

// One thrower casts at hz for castSec, then commits an act; the turn passes round-robin.
async function throwTurn(opts, thrower, castMs = opts.castSec * 1000) {
  const n = Math.round((castMs / 1000) * opts.hz);
  const t0 = now();
  for (let i = 0; i < n; i++) {
    thrower.cast();
    const next = t0 + ((i + 1) * 1000) / opts.hz;
    await sleep(Math.max(0, next - now()));
  }
  return thrower.act(thrower.head + 1);
}

async function runTurns(opts, R, seconds, onTick) {
  const end = now() + seconds * 1000;
  let turn = 0;
  const outcomes = { ok: 0, refused: 0, timeout: 0 };
  while (now() < end) {
    const live = R.players.filter(
      (p) => p.auto && p.ws.readyState === WebSocket.OPEN,
    );
    if (!live.length) {
      // every player is away at once (a redeploy cut them all): wait for the first back
      outcomes.allAwayWaits = (outcomes.allAwayWaits || 0) + 1;
      await sleep(50);
      continue;
    }
    const thrower = live[turn % live.length];
    turn++;
    const r = await throwTurn(opts, thrower);
    outcomes[r.t === "ok" ? "ok" : r.t] =
      (outcomes[r.t === "ok" ? "ok" : r.t] || 0) + 1;
    if (onTick) await onTick(turn);
    await sleep(250);
  }
  return { turns: turn, outcomes };
}

function analyse(R, extra = {}) {
  // a client that was away (dropped on purpose, or cut by a deploy) missed casts by design;
  // its acts are judged by the log hash instead
  const evaluated = R.all.filter((c) => c.closes.length === 0 && !c.dropped);
  // every frame the room relayed, as seen by anyone
  const G = new Map();
  for (const c of R.all) for (const f of c.frames) G.set(`${f.e}:${f.s}`, f);
  const res = {
    sockets: R.all.length,
    players: R.players.length,
    observers: R.observers.length,
  };
  const lat = (role, type) =>
    pct(R.all.filter((c) => c.role === role).flatMap((c) => c.lat[type]));
  res.latency = {
    castToPlayers: lat("player", "cast"),
    castToObservers: lat("observer", "cast"),
    actToPlayers: lat("player", "act"),
    actToObservers: lat("observer", "act"),
    actAckToSender: lat("player", "ok"),
    refusedToSender: lat("player", "refused"),
    join: pct(R.all.flatMap((c) => c.lat.join)),
  };
  // ordering: s strictly increasing within each epoch, per receiver
  let reorders = 0;
  for (const c of R.all) {
    const byE = new Map();
    for (const f of c.frames) {
      const last = byE.get(f.e);
      if (last !== undefined && f.s <= last) reorders++;
      byE.set(f.e, f.s);
    }
  }
  // gaps: a player must get every frame not its own; an observer every act
  let playerMissing = 0;
  let observerActMissing = 0;
  for (const c of evaluated) {
    const mine = new Set(c.frames.map((f) => `${f.e}:${f.s}`));
    for (const [k, f] of G) {
      if (mine.has(k)) continue;
      if (c.role === "player" && f.m !== c.m) playerMissing++;
      if (c.role === "observer" && f.t === "act") observerActMissing++;
    }
  }
  // observer thinning: server ts between casts of one sender >= 100 ms
  let thinViolations = 0;
  let obsCasts = 0;
  for (const o of R.observers) {
    const last = new Map();
    for (const f of o.frames.filter((f) => f.t === "cast")) {
      obsCasts++;
      const k = `${f.e}:${f.m}`;
      if (last.has(k) && f.ts - last.get(k) < 100) thinViolations++;
      last.set(k, f.ts);
    }
  }
  const hashes = new Map();
  for (const c of R.all) {
    const h = createHash("sha256")
      .update(c.acts.join("\n"))
      .digest("hex")
      .slice(0, 12);
    hashes.set(h, (hashes.get(h) || 0) + 1);
  }
  res.ordering = {
    framesRelayed: G.size,
    reorders,
    playerFramesMissing: playerMissing,
    observerActsMissing: observerActMissing,
    observerCastsReceived: obsCasts,
    observerThinViolations: thinViolations,
    actLogHashes: Object.fromEntries(hashes),
    identical: hashes.size === 1,
    actsInLog: Math.max(...R.all.map((c) => c.head)),
    conflicts: R.all.reduce((n, c) => n + (c.conflict || 0), 0),
    gapRepairs: R.all.reduce((n, c) => n + c.gapRepairs, 0),
    epochsSeen: [...new Set(R.all.flatMap((c) => [...c.epochs]))].sort(),
    unexpectedCloses: R.all.reduce((n, c) => n + c.closes.length, 0),
    reconnects: R.all.reduce((n, c) => n + c.reconnects, 0),
  };
  return { ...res, ...extra };
}

async function finish(opts, R, result) {
  const st = await R.players[0]
    .rpc({ t: "stats" }, "stats")
    .catch((e) => ({ error: String(e) }));
  result.serverStats = st;
  await R.players[0]
    .rpc({ t: "reset", key: opts.key }, "reset")
    .catch(() => {});
  for (const c of R.all) c.close();
  await sleep(300);
  return result;
}

async function healthRtt(opts, n = 20) {
  const u = new URL(opts.url);
  u.protocol = u.protocol === "wss:" ? "https:" : "http:";
  u.pathname = "/health";
  const xs = [];
  let body = null;
  for (let i = 0; i < n; i++) {
    const t0 = now();
    const r = await fetch(u, { cache: "no-store" });
    body = await r.text();
    xs.push(now() - t0);
    await sleep(100);
  }
  return {
    health: body,
    rtt: pct(xs),
    samples: xs.map((x) => Math.round(x * 10) / 10),
  };
}

async function scenarioTurns(opts) {
  const R = await makeRoom(opts, opts.room || code());
  if (opts.order !== "write-first")
    await R.players[0].rpc(
      { t: "opt", order: opts.order, key: opts.key },
      "opt",
    );
  let execResult = null;
  const res0 = {};
  const t00 = now();
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
  const before = await R.players[0].rpc({ t: "stats" }, "stats");
  const runT0 = now() - 0;
  res0.runStartIso = new Date().toISOString();
  const run = await runTurns(opts, R, opts.duration);
  await sleep(1500); // let reconnects settle and resume
  const res = analyse(R, {
    ...res0,
    run,
    order: opts.order,
    epochBefore: before.e,
    versionBefore: before.version,
    exec: execResult,
    execAtSecIntoRun:
      opts.execAt != null
        ? Math.round((t00 + opts.execAt * 1000 - runT0) / 100) / 10
        : null,
  });
  if (opts.execAt != null) {
    res.closes = R.all.flatMap((c) =>
      c.closes.map((x) => {
        const back = (c.joinsAt || []).find((t) => t > x.at);
        return {
          m: c.m,
          code: x.code,
          reason: x.reason,
          atSec: Math.round((x.at - runT0) / 100) / 10,
          outMs: back ? Math.round(back - x.at) : null,
        };
      }),
    );
    const stA = await R.players[0].rpc({ t: "stats" }, "stats");
    res.epochAfter = stA.e;
    res.versionAfter = stA.version;
    // everyone, reconnected or not, must hold the same log after resume
  }
  return finish(opts, R, res);
}

async function scenarioSimul(opts) {
  const R = await makeRoom(opts, opts.room || code());
  const rounds = [];
  for (let r = 0; r < opts.rounds; r++) {
    const A = R.players[(2 * r) % R.players.length];
    const B = R.players[(2 * r + 1) % R.players.length];
    await throwTurn(opts, A, 1000); // a normal turn first, so heads move
    await sleep(300);
    const seq = A.head + 1;
    if (B.head + 1 !== seq)
      rounds.push({ note: "heads differ", a: A.head, b: B.head });
    const [ra, rb] = await Promise.all([A.act(seq), B.act(seq)]);
    await sleep(400);
    const winner = ra.t === "ok" ? ra.id : rb.t === "ok" ? rb.id : null;
    const seen = new Set(
      R.all.map((c) => (c.acts[seq - 1] || "").split("|")[1]),
    );
    rounds.push({
      seq,
      a: ra.t,
      b: rb.t,
      oneAccepted: [ra.t, rb.t].sort().join() === "ok,refused",
      sameEverywhere: seen.size === 1 && seen.has(winner),
    });
  }
  return finish(opts, R, analyse(R, { rounds }));
}

async function scenarioIdle(opts) {
  const R = await makeRoom(opts, opts.room || code());
  await runTurns(opts, R, 8);
  const s0 = await R.players[0].rpc({ t: "stats" }, "stats");
  const phases = [];
  for (const withPing of [false, true]) {
    let pings = 0;
    const t0 = now();
    while (now() - t0 < opts.idleSec * 1000) {
      await sleep(5000);
      if (withPing) {
        for (const c of R.all) c.send("ping");
        pings += R.all.length;
      }
    }
    // first message after the gap: one cast, timed to every other player
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
    const st = await R.players[0].rpc({ t: "stats" }, "stats");
    phases.push({
      idleSec: opts.idleSec,
      appPingsDuringIdle: pings,
      firstCastLatency: firstCast,
      firstActAck: okAct.t,
      epochBefore: (phases.at(-1) || { epochAfter: s0.e }).epochAfter,
      epochAfter: st.e,
      hibernatedAndRebuilt:
        st.e !== (phases.at(-1) || { epochAfter: s0.e }).epochAfter,
      headAfter: st.head,
      actsStoredAfter: st.actsStored,
      serverSinceWakeMs: st.sinceWakeMs,
    });
  }
  const res = analyse(R, { phases });
  return finish(opts, R, res);
}

async function scenarioResume(opts) {
  const R = await makeRoom(opts, opts.room || code());
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
  for (const c of drop) {
    c.auto = true;
    const j = await c.connect();
    resumed.push({
      m: c.m,
      lastBefore: headAtDrop[drop.indexOf(c)],
      headServer: j.head,
      missedReturned: j.acts.length,
      caughtUp: c.head === j.head,
    });
  }
  await runTurns(opts, R, 6);
  await sleep(500);
  return finish(opts, R, analyse(R, { resumed }));
}

async function scenarioReplay(opts) {
  const timing = JSON.parse(
    readFileSync(opts.replayFile, "utf8"),
  ).offsetsMs.filter((t) => t <= opts.replayCapSec * 1000);
  const R = await makeRoom(opts, opts.room || code());
  const t0 = now() - timing[0] + 500;
  let k = 0;
  let casts = 0;
  const outcomes = { ok: 0, refused: 0, timeout: 0 };
  for (let i = 0; i < timing.length; i++) {
    const at = t0 + timing[i];
    const thrower = R.players[k++ % R.players.length];
    // 15 Hz casts until the act is due
    while (now() < at - 1000 / opts.hz) {
      thrower.cast();
      casts++;
      await sleep(1000 / opts.hz);
    }
    await sleep(Math.max(0, at - now()));
    const r = await thrower.act(thrower.head + 1);
    outcomes[r.t] = (outcomes[r.t] || 0) + 1;
  }
  await sleep(500);
  return finish(
    opts,
    R,
    analyse(R, {
      replay: {
        acts: timing.length,
        spanSec: Math.round((timing.at(-1) - timing[0]) / 1000),
        casts,
        outcomes,
      },
    }),
  );
}

async function scenarioOrder(opts) {
  const out = {};
  for (const order of ["write-first", "relay-first"]) {
    out[order] = await scenarioTurns({ ...opts, order, room: code() });
  }
  return {
    compare: Object.fromEntries(
      Object.entries(out).map(([k, v]) => [
        k,
        {
          actToPlayers: v.latency.actToPlayers,
          actToObservers: v.latency.actToObservers,
          actAckToSender: v.latency.actAckToSender,
          castToPlayers: v.latency.castToPlayers,
        },
      ]),
    ),
    full: out,
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  opts.key = readKey();
  const loop = monitorEventLoopDelay({ resolution: 1 });
  loop.enable();
  const startedAt = new Date().toISOString();
  const t0 = now();
  let result;
  switch (opts.scenario) {
    case "turns":
      result = await scenarioTurns(opts);
      break;
    case "simul":
      result = await scenarioSimul(opts);
      break;
    case "idle":
      result = await scenarioIdle(opts);
      break;
    case "resume":
      result = await scenarioResume(opts);
      break;
    case "replay":
      result = await scenarioReplay(opts);
      break;
    case "order":
      result = await scenarioOrder(opts);
      break;
    case "rtt":
      result = await healthRtt(opts);
      break;
    default:
      throw new Error(`unknown scenario ${opts.scenario}`);
  }
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
    billing: {
      connects: tally.connects,
      inboundMessages: tally.sent,
      billedRequestsEstimate: Math.ceil(tally.sent / 20) + tally.connects,
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
