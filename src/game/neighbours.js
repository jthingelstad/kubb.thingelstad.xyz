// The Tournament's neighbouring pitches, live (the engine's docs/SESSION.md
// "Neighbours", docs/CLIENTS.md "0.15.1 on top", docs/notes/tournament.md; this site's
// docs/SCENES.md "Tournament"): the pitches round the player's play real
// computer-against-computer matches, as scenery. A second engine in a Web Worker
// (src/engine/neighbours-worker.js, its messages in src/engine/neighbours-host.js)
// plays them; this is the page's half: it posts the match clock once a frame, keeps
// each pitch from the events that come back, plays each throw's recording at real
// speed, and hands src/render/tournament.js's drawNeighbours the field as it stands.
// No people play them (the owner, 2026-11-22): pieces only, and their sounds
// (src/game/neighbour-sound.js): each throw's cues, timed on the match clock.
//
// Scenery only: nothing here touches the player's match, its engine, its snapshot or
// its hashes, and the page never waits on the worker. While the field is not open yet,
// or the worker is slow, or it failed, the neighbours stay as they were (or are the
// scene's still pitches, as before).
//
//   const nb = new Neighbours({ workerUrl, luaUrl, wasmUrl });
//   nb.open({ seed, layout }, key)  a field for this match (again for a new key)
//   nb.tick(dt)                     once a frame: the match clock moves on by dt
//   nb.field(turned)                the pitches to draw, or null (draw the still ones)
//   nb.takeCues()                   the sounds due by now: [{ id, kind, at, offset }]
//   nb.destroy()                    close it and end the worker
import { cuesOf, tune as soundTune } from "./neighbour-sound.js";

export const tune = {
  budgetMs: 2, // ms of the worker's work an advance may take (docs/CLIENTS.md)
  openWaitMs: 20000, // ms for the field to open before the still pitches are kept
  answerWaitMs: 10000, // ms for an advance to be answered before the worker is ended
  closeWaitMs: 500, // ms the worker is given to close before it is ended anyway
  // the layout: always the ring of 8 round the pitch ("grid"; the owner: "a grid of
  // pitches that are all live"). A row either side, the engine's "row", puts every
  // neighbour outside the thrower's camera on a phone held sideways, and the wide view
  // looks across the grid's nearer side row, so it is never asked for.
  layout: "grid",
  // between pitch origins, m, or null for the engine's ({ x: 8, y: 12 }: the pitch
  // ahead's near baseline 4 m past the far rope, where the thrower's view sees it)
  spacing: null,
  // No people (the owner, 2026-11-22: "Tournament mode should not have people. Just
  // pitches with live play."): with nobody to throw or carry, a baton is seen only once
  // it is in the air, and pieces stand up with a short rise rather than appear standing:
  rise: 0.6, // s a kubb takes to stand up when a pitch's kubbs are raised
  riseEvery: 0.15, // s between the kubbs of one raise
  setupRise: 0.5, // s a piece takes to stand when a fresh pitch sets out
  setupEvery: 0.07, // s between its pieces, in the engine's order
};

// A client's playback of a neighbour's recording, copied from the engine's
// tests/node/neighbours.test.mjs (docs/CLIENTS.md "0.15.1 on top"; the iPhone's
// Playback.pieces(at:)): the items the pitch stood in, each moved body between its two
// poses around t (before its start where the items have it, after its last pose
// there), new bodies added. Keep it the engine's, line for line.
export function playRecording(items, rec, t) {
  const out = items.map((it) => ({ ...it }));
  const at = new Map(out.map((it, i) => [it.id, i]));
  const u = t / rec.frameDt;
  const f = Math.floor(u);
  const a = u - f;
  const k = rec.poseScale;
  for (const b of rec.bodies) {
    let i = at.get(b.id);
    if (i === undefined) {
      out.push({ id: b.id, kind: b.kind, team: b.team, toppled: false });
      i = out.length - 1;
      at.set(b.id, i);
    }
    const it = out[i];
    if (f + 1 >= b.start) {
      const pose = (g) => {
        if (g < b.start) return [it.x, it.y, it.z, it.qw, it.qx, it.qy, it.qz];
        const j = Math.min(g - b.start, b.frames - 1) * 7;
        return b.poses.slice(j, j + 7).map((v) => v / k);
      };
      const p0 = pose(f);
      let p1 = a === 0 ? p0 : pose(f + 1);
      if (p0[3] * p1[3] + p0[4] * p1[4] + p0[5] * p1[5] + p0[6] * p1[6] < 0) {
        p1 = [p1[0], p1[1], p1[2], -p1[3], -p1[4], -p1[5], -p1[6]];
      }
      const m = p0.map((v, n) => v + (p1[n] - v) * a);
      [it.x, it.y, it.z, it.qw, it.qx, it.qy, it.qz] = m;
    }
    if (b.toppleT !== undefined && b.toppleT <= t) it.toppled = true;
  }
  return out;
}

// Should the field be live? Only in the Tournament scene, in a match or practice (a
// replay and watching are matches here), never with reduced motion, never once the
// worker has failed, and never started under a card (once open, a card only stops
// its clock).
export function neighboursWanted({
  scene,
  mode,
  reduced = false,
  available = true,
  failed = false,
  modal = false,
  open = false,
} = {}) {
  if (!available || failed || reduced) return false;
  if (scene !== "tournament") return false;
  if (mode !== "match" && mode !== "practice") return false;
  return open || !modal;
}

// The frame the pitch is drawn in now, Team A's or Team B's, so the neighbours' field
// is drawn in the same (fieldFor turns it for "B"). One decision for every drawing
// path the Game has:
// - the raise and punishment screens (Game.drawStill over a `raise` or `punish`
//   need, whoever acts, the hand-off and a watcher's wait included): the defender's,
//   `need.side`, in every view: the engine gives their poses in the defender's frame
//   (Session:raiseInfo, punishInfo) and the wide view leaves a need as it is;
// - everything else in the wide view: the world frame, Team A's (session/wide.lua
//   un-turns the pitch, the aim and the playback);
// - a throw being aimed or played back (its hand-off over it): its thrower's,
//   `need.side` (the need stays the throw's while it plays);
// - between throws (the winner card over the pitch, a restored match before its next
//   throw): the last throw's thrower's, `thrower` (the engine's Session.frameSide; an
//   adopted snapshot's own `side`);
// - practice: Team A's.
export function pitchFrameOf({
  need = null,
  wide = false,
  mode = "match",
  thrower = "A",
} = {}) {
  const B = (side) => (side === "B" ? "B" : "A");
  if (mode !== "match") return "A";
  if (need?.kind === "raise" || need?.kind === "punish") return B(need.side);
  if (wide) return "A";
  if (need?.kind === "throw" && need.side) return B(need.side);
  return B(thrower);
}

// ---------- the field, kept from the events ----------

// The model of one opening: each pitch's items as the events leave them (the
// engine's docs/SESSION.md "What a client keeps for each pitch"), its recording while
// one plays, and the pieces rising after a raise or a setup.
export class Field {
  constructor(open) {
    this.stakes = open.stakes || [];
    this.pitches = open.pitches.map((p) => ({
      id: p.id,
      offset: p.offset,
      items: p.items || [],
      teams: p.teams,
      phase: p.phase || "setup",
      at: p.at ?? 0,
      rec: null,
      recAt: 0,
      side: null, // the side of the last throw
      from: {}, // where each side last threw from
      winner: null,
      rise: null, // { at, from, dur, every }: pieces standing up (shownAt)
    }));
    this.byId = new Map(this.pitches.map((p) => [p.id, p]));
    this.cues = []; // the sounds to come, { id, kind, at }, in time order
  }

  // A recording played out: its last poses are the pitch's items.
  settle(p) {
    if (!p.rec) return;
    p.items = playRecording(p.items, p.rec, p.rec.duration);
    p.rec = null;
  }

  apply(events) {
    for (const ev of events || []) {
      const p = this.byId.get(ev.id);
      if (!p) continue;
      this.settle(p);
      if (ev.phase === "throw") {
        p.rec = ev.recording;
        p.recAt = ev.at;
        for (const c of cuesOf(ev.recording))
          this.cues.push({ id: p.id, kind: c.kind, at: ev.at + c.t });
        this.cues.sort((a, b) => a.at - b.at);
        p.side = ev.side;
        if (ev.from) p.from[ev.side] = ev.from;
      } else if (ev.items) {
        // kubbs raised, or a fresh pitch: they rise rather than appear standing
        if (ev.phase === "raise" || ev.phase === "setup")
          p.rise = {
            at: ev.at,
            from: new Map(p.items.map((it) => [it.id, it])),
            setup: ev.phase === "setup",
          };
        p.items = ev.items;
      }
      if (ev.phase === "over") p.winner = ev.winner ?? null;
      if (ev.phase === "setup") {
        p.winner = null;
        p.side = null;
        p.from = {};
        if (ev.teams) p.teams = ev.teams;
      }
      p.phase = ev.phase;
      p.at = ev.at;
    }
  }

  // A pitch as view gives it (a pitch coming into view, or after a pause).
  adopt(v) {
    const p = this.byId.get(v?.id);
    if (!p) return;
    p.items = v.items || p.items;
    p.rec = null;
    if (v.recording) {
      p.rec = v.recording;
      p.recAt = v.at;
      p.side = v.side ?? p.side;
    }
    if (v.teams) p.teams = v.teams;
    p.phase = v.phase || p.phase;
    p.at = v.at ?? p.at;
  }

  // The cues due by `now`, taken off the list (those more than soundTune.stale late are
  // dropped): [{ id, kind, at, offset }].
  takeCues(now) {
    const out = [];
    while (this.cues.length && this.cues[0].at <= now) {
      const c = this.cues.shift();
      if (now - c.at <= soundTune.stale)
        out.push({ ...c, offset: this.byId.get(c.id)?.offset });
    }
    return out;
  }

  // Each pitch's pieces at `now` on the match clock (the engine's model: equal to
  // neighbours.view, tests/engine/neighbours.test.mjs).
  itemsAt(p, now) {
    if (p.rec && now >= p.recAt + p.rec.duration) this.settle(p);
    if (!p.rec) return p.items;
    return playRecording(p.items, p.rec, Math.max(0, now - p.recAt));
  }

  // The pieces as drawn at `now`: itemsAt, with kubbs just raised (and a fresh pitch's
  // pieces) rising to stand rather than appearing standing (riseOf).
  shownAt(p, now) {
    const items = this.itemsAt(p, now);
    const r = p.rise;
    if (!r || p.rec) return items;
    const t = now - r.at;
    const dur = r.setup ? tune.setupRise : tune.rise;
    const every = r.setup ? tune.setupEvery : tune.riseEvery;
    let k = 0;
    let busy = false;
    const out = items.map((it) => {
      if (!risesFrom(it, r.from.get(it.id), r.setup)) return it;
      const u = (t - every * k++) / dur;
      if (u >= 1) return it;
      busy = true;
      return riseOf(r.from.get(it.id), it, u, r.setup);
    });
    if (!busy) p.rise = null;
    return out;
  }
}

// Quaternions [w, x, y, z].
function qmul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}
const qOf = (it) => [it.qw ?? 1, it.qx ?? 0, it.qy ?? 0, it.qz ?? 0];
const uprightOf = (it) => {
  const [, qx, qy] = qOf(it);
  return Math.abs(1 - 2 * (qx * qx + qy * qy)) > 0.7;
};
const HALF_SIDE = { kubb: 0.035, king: 0.045 };

// Does this piece stand up now: a kubb or the king standing that lay before (or, on a
// fresh pitch, any standing kubb or king; a stake never).
function risesFrom(it, was, setup) {
  if (it.kind !== "kubb" && it.kind !== "king") return false;
  if (it.toppled || !uprightOf(it)) return false;
  if (setup) return true;
  return !!was && (was.toppled || !uprightOf(was));
}

// A piece part way up (u, 0 to 1): from where it lay (or, on a fresh pitch, lying where
// it will stand, along the pitch) to standing, its turn eased.
export function riseOf(was, it, u, setup = false) {
  const e = u <= 0 ? 0 : u * u * (3 - 2 * u);
  const lay =
    setup || !was
      ? (() => {
          const q = qmul(qOf(it), [Math.SQRT1_2, -Math.SQRT1_2, 0, 0]);
          const z = HALF_SIDE[it.kind] ?? 0.035;
          return {
            x: it.x,
            y: it.y,
            z,
            qw: q[0],
            qx: q[1],
            qy: q[2],
            qz: q[3],
          };
        })()
      : was;
  let a = qOf(lay);
  const b = qOf(it);
  if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0)
    a = a.map((v) => -v);
  const q = a.map((v, n) => v + (b[n] - v) * e);
  const l = Math.hypot(...q) || 1;
  return {
    ...it,
    x: lay.x + (it.x - lay.x) * e,
    y: lay.y + (it.y - lay.y) * e,
    z: (lay.z ?? 0) + ((it.z ?? 0) - (lay.z ?? 0)) * e,
    qw: q[0] / l,
    qx: q[1] / l,
    qy: q[2] / l,
    qz: q[3] / l,
    toppled: false,
  };
}

// The long axis (local z) of a pose in the pitch frame.
function axisOf(it) {
  const qw = it.qw ?? 1,
    qx = it.qx ?? 0,
    qy = it.qy ?? 0,
    qz = it.qz ?? 0;
  return [
    2 * (qx * qz + qw * qy),
    2 * (qy * qz - qw * qx),
    1 - 2 * (qx * qx + qy * qy),
  ];
}

// The field as drawNeighbours takes it (src/render/tournament.js): each pitch's near
// baseline's middle in the drawn frame, its pieces from there (no people). `turned`:
// the player's pitch is drawn in Team B's frame (the thrower's view of Team B), so the
// whole field turns half about (0, 4) with it, as the engine's docs/SESSION.md "The
// pitch frame" says: a point (ox + x, oy + y) is drawn at (-(ox + x), 8 - (oy + y)).
export function fieldFor(field, now, turned = false) {
  const out = [];
  const pt = turned ? (x, y) => [-x, 8 - y] : (x, y) => [x, y];
  const stakes = field.stakes.map((s) => {
    const [x, y] = pt(s.x, s.y);
    return { x, y };
  });
  for (const p of field.pitches) {
    const items = field.shownAt(p, now);
    const pieces = [];
    for (const it of items) {
      if (it.kind === "stake") continue;
      const [x, y] = pt(it.x, it.y);
      const a = axisOf(it);
      pieces.push({
        kind: it.kind,
        team: it.team,
        x,
        y,
        z: it.z ?? 0,
        axis: turned ? [-a[0], -a[1], a[2]] : a,
      });
    }
    out.push({
      id: p.id,
      x: turned ? -p.offset.x : p.offset.x,
      y: turned ? -p.offset.y : p.offset.y,
      pieces,
      stakes,
      live: true,
    });
  }
  return out;
}

// ---------- the worker ----------

const wall = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

export class Neighbours {
  constructor({
    workerUrl,
    luaUrl,
    wasmUrl,
    makeWorker = (url) => new Worker(url, { type: "module" }),
    now = wall,
  } = {}) {
    this.opts = { workerUrl, luaUrl, wasmUrl };
    this.makeWorker = makeWorker;
    this.wall = now;
    this.worker = null;
    this.gen = 0;
    this.key = null;
    this.clock = 0; // the match clock, s since this field opened
    this.sent = 0; // the last clock sent
    this.fieldData = null; // the Field, once opened
    this.pending = null; // { type, at }: a message the worker has not answered
    this.failed = false;
    this.stats = { messages: 0, bytes: 0, maxBytes: 0, openBytes: 0, late: 0 };
  }

  ensureWorker() {
    if (this.worker || this.failed) return this.worker;
    try {
      this.worker = this.makeWorker(this.opts.workerUrl);
    } catch {
      this.fail();
      return null;
    }
    this.worker.onmessage = (e) => this.onMessage(e.data);
    this.worker.onerror = () => this.fail();
    this.worker.onmessageerror = () => this.fail();
    return this.worker;
  }

  open(args, key) {
    this.key = key;
    this.gen += 1;
    this.clock = 0;
    this.sent = 0;
    this.fieldData = null;
    const w = this.ensureWorker();
    if (!w) return;
    this.pending = { type: "open", at: this.wall(), gen: this.gen };
    w.postMessage({
      type: "open",
      gen: this.gen,
      luaUrl: this.opts.luaUrl,
      wasmUrl: this.opts.wasmUrl,
      args: {
        scene: "tournament",
        ...(tune.spacing ? { spacing: tune.spacing } : {}),
        ...args,
        now: 0,
      },
    });
  }

  // Once a frame: the match clock moves on by dt (0 while the match is paused), and the
  // worker is asked for what happened by then unless it is still busy with the last
  // ask. Never waits.
  tick(dt) {
    if (this.failed || !this.worker) return;
    if (this.pending) {
      const wait =
        this.pending.type === "open" ? tune.openWaitMs : tune.answerWaitMs;
      if (this.wall() - this.pending.at > wait) this.fail();
      if (this.fieldData) this.clock += dt;
      return;
    }
    if (!this.fieldData) return;
    // the engine's clock never goes back
    this.clock = Math.max(this.clock + dt, this.sent);
    this.sent = this.clock;
    this.pending = { type: "advance", at: this.wall(), gen: this.gen };
    this.worker.postMessage({
      type: "advance",
      gen: this.gen,
      now: this.clock,
      budgetMs: tune.budgetMs,
    });
  }

  onMessage(m) {
    if (!m || this.failed) return;
    if (m.type === "closed") {
      if (this.ending) this.end();
      return;
    }
    if (m.gen !== this.gen) {
      // an answer for a field since closed: the next ask may go
      if (this.pending?.gen === m.gen) this.pending = null;
      return;
    }
    this.pending = null;
    const bytes = typeof m.text === "string" ? m.text.length : 0;
    this.stats.messages += 1;
    this.stats.bytes += bytes;
    if (m.type !== "opened")
      this.stats.maxBytes = Math.max(this.stats.maxBytes, bytes);
    if (m.type === "error") return this.fail();
    let data;
    try {
      data = JSON.parse(m.text);
    } catch {
      return this.fail();
    }
    if (m.type === "opened") {
      this.stats.openBytes = bytes;
      this.fieldData = new Field(data);
    } else if (m.type === "events" && this.fieldData) {
      this.fieldData.apply(data.events);
      this.stats.late = data.late ?? 0;
    } else if (m.type === "view" && this.fieldData) {
      for (const v of data.pitches || [data]) this.fieldData.adopt(v);
    }
  }

  // The pitches to draw now, or null: draw the still ones.
  field(turned = false) {
    if (this.failed || !this.fieldData) return null;
    return fieldFor(this.fieldData, this.clock, turned);
  }

  // The sounds due by the match clock now (Field.takeCues), or [].
  takeCues() {
    if (this.failed || !this.fieldData) return [];
    return this.fieldData.takeCues(this.clock);
  }

  get isOpen() {
    return !!this.fieldData;
  }

  fail() {
    this.failed = true;
    this.fieldData = null;
    this.end();
  }

  end() {
    clearTimeout(this.closeTimer);
    this.ending = false;
    try {
      this.worker?.terminate();
    } catch {
      // gone already
    }
    this.worker = null;
    this.pending = null;
  }

  // Close the field and end the worker (given a moment to close first).
  destroy() {
    this.fieldData = null;
    this.key = null;
    if (!this.worker) return;
    this.ending = true;
    try {
      this.worker.postMessage({ type: "close", gen: this.gen });
    } catch {
      return this.end();
    }
    this.closeTimer = setTimeout(() => this.end(), tune.closeWaitMs);
  }
}
