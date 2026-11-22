// The Tournament's neighbouring pitches, live (the engine's docs/SESSION.md
// "Neighbours", docs/CLIENTS.md "0.15.1 on top", docs/notes/tournament.md; this site's
// docs/SCENES.md "Tournament"): the pitches round the player's play real
// computer-against-computer matches, as scenery. A second engine in a Web Worker
// (src/engine/neighbours-worker.js, its messages in src/engine/neighbours-host.js)
// plays them; this is the page's half: it posts the match clock once a frame, keeps
// each pitch from the events that come back, plays each throw's recording at real
// speed, and hands src/render/tournament.js's drawNeighbours the field as it stands.
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
//   nb.destroy()                    close it and end the worker
import { TOURNAMENT } from "../render/palette.js";

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
  // the people (pitch frame metres and seconds)
  team: 3, // figures a team, at most
  behind: 0.8, // m behind its baseline a team stands
  spread: 1.3, // m between its figures
  armUp: 0.6, // s the thrower's arm is up after the release
  walk: 18, // s the teams take to go out on the walk and come back
  raise: 8, // s a figure stands at the kubbs being raised
  cheer: 7, // s the winners cheer
  setup: 6, // s the new teams take to walk on
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

const other = (side) => (side === "A" ? "B" : "A");

// ---------- the field, kept from the events ----------

// The model of one opening: each pitch's items as the events leave them (the
// engine's docs/SESSION.md "What a client keeps for each pitch"), its recording while
// one plays, and what the people do.
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
      shirts: shirtsOf(p.teams, p.id),
    }));
    this.byId = new Map(this.pitches.map((p) => [p.id, p]));
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
        p.side = ev.side;
        if (ev.from) p.from[ev.side] = ev.from;
      } else if (ev.items) p.items = ev.items;
      if (ev.phase === "over") p.winner = ev.winner ?? null;
      if (ev.phase === "setup") {
        p.winner = null;
        p.side = null;
        p.from = {};
        if (ev.teams) {
          p.teams = ev.teams;
          p.shirts = shirtsOf(ev.teams, p.id);
        }
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

  // Each pitch's pieces at `now` on the match clock.
  itemsAt(p, now) {
    if (p.rec && now >= p.recAt + p.rec.duration) this.settle(p);
    if (!p.rec) return p.items;
    return playRecording(p.items, p.rec, Math.max(0, now - p.recAt));
  }
}

function textHash(s = "") {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

// Each team's shirt (an index into TOURNAMENT.shirts), from its name: two teams on a
// pitch never share one. The names themselves are never drawn.
export function shirtsOf(teams, id = 0) {
  const n = TOURNAMENT.shirts.length;
  const a = (textHash(teams?.A?.name) + id) % n;
  let b = (textHash(teams?.B?.name) + id * 3) % n;
  if (b === a) b = (b + 1) % n;
  return { A: a, B: b };
}

const baseY = (side) => (side === "A" ? -tune.behind : 8 + tune.behind);

// The people on a pitch at `now`, in its own frame (Team A's baseline at y = 0): each
// team behind its baseline, the thrower at `from` before and as a throw goes, the teams
// going out and back on the walk, a figure at the kubbs being raised, the winners'
// arms going up, new teams walking on after setup.
export function peopleOf(p, now) {
  const t = Math.max(0, now - p.at);
  const people = [];
  const thrower =
    p.rec || p.phase === "throw" || p.phase === "aim" || p.phase === "raise"
      ? p.side
      : p.phase === "walk" && p.side
        ? other(p.side)
        : null;
  for (const side of ["A", "B"]) {
    const n = Math.max(
      1,
      Math.min(tune.team, p.teams?.[side]?.players ?? tune.team),
    );
    const y0 = baseY(side);
    const far = baseY(other(side));
    for (let i = 0; i < n; i++) {
      let x = (i - (n - 1) / 2) * tune.spread;
      let y = y0;
      let arm = 0;
      if (i === 0 && side === thrower) {
        const from = p.from[side];
        if (from) x = from.x;
        y = (from?.y ?? (side === "A" ? 0 : 8)) + (side === "A" ? -0.3 : 0.3);
        if (p.rec && now - p.recAt < tune.armUp) arm = 1;
      } else if (p.phase === "walk" && t < tune.walk) {
        // out and back: the side that threw fetches its batons from the far end, the
        // other picks up its felled kubbs short of the middle
        const u = Math.sin((Math.PI * t) / tune.walk);
        const to = side === p.side ? far : 4;
        const k = side === p.side ? 0.85 : 0.55;
        y = y0 + (to - y0) * k * u;
        x += (side === "A" ? -0.4 : 0.4) * u;
      } else if (p.phase === "over" && side === p.winner && t < tune.cheer) {
        arm = Math.floor(t * 3 + i) % 2 ? 1 : 0.5;
      } else if (p.phase === "setup" && t < tune.setup) {
        const u = Math.min(1, t / tune.setup);
        x = 4.5 + i * 0.6 + (x - 4.5 - i * 0.6) * u;
      }
      people.push({ x, y, shirt: p.shirts[side], arm });
    }
  }
  if (p.phase === "raise" && t < tune.raise && p.side) {
    const k = p.items.find(
      (it) => it.kind === "kubb" && it.y > 0.6 && it.y < 7.4,
    );
    if (k)
      people.push({
        x: k.x + 0.35,
        y: k.y + (p.side === "A" ? 0.2 : -0.2),
        shirt: p.shirts[other(p.side)],
        arm: 0,
      });
  }
  return people;
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
// baseline's middle in the drawn frame, its pieces and people from there. `turned`:
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
    const items = field.itemsAt(p, now);
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
    // the pitches in line with the player's (straight ahead and behind) play without
    // their people: a person a few metres past the far kubbs stands taller on the
    // screen than anything the player aims at, and one behind over the near end
    const people = (p.offset.x === 0 ? [] : peopleOf(p, now)).map((q) => {
      const [x, y] = pt(q.x, q.y);
      return { ...q, x, y };
    });
    out.push({
      id: p.id,
      x: turned ? -p.offset.x : p.offset.x,
      y: turned ? -p.offset.y : p.offset.y,
      pieces,
      people,
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
