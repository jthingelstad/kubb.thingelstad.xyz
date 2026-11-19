// A match a person played against the computer, made here with no network and no
// recorded games: side A is driven through the session as a phone or a browser drives
// it (a target and a stance, then the dial: wind back, flick, lift), side B is the
// computer, raising is by hand. A second engine (the planner) only picks where side A
// aims and stands, the way the iPhone's synthetic fixtures do; the throw itself goes
// through the dial, so it is a pointer throw with verdicts, not a scripted one.
//
//   node tools/reel/solo.mjs 5 9                 write build/reel/matches/solo-<n>.json
//   node tools/reel/solo.mjs --level beginner 3  both sides at that level (club by default)
//
// The file is what a phone keeps of a solo match today (docs/REEL.md "The iPhone"): the
// first snapshot and every action, no hashes. `end` is what the device would claim: the
// winner and the number of throws (and the hash after the last action, which a device
// that renamed its side before sending would not claim). The script replays the file
// from its start, as the server would, and says whether it reaches the claimed end.
//
// The teams are "Riverside" (an invented team name, typed by the player in a real match)
// and "Computer".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Engine } from "../../src/engine/index.js";
import { useRoomEngine } from "../../src/net/lobby.js";
import { bundleLua } from "../lua-bundle.mjs";

export const OUT = "build/reel/matches";

// The iPhone's startSolo setup (SoloPitch.swift), with a fixed date.
export function soloSetup(seed, opts = {}) {
  const level = opts.level || "club";
  return {
    seed,
    cpu: "B",
    first: "A",
    raising: "hand",
    maxTurns: 40,
    teams: {
      A: { name: "Riverside", players: [{ name: "Riverside", level }] },
      B: { name: "Computer", players: [{ name: "Computer", level }] },
    },
    start: { year: 2026, month: 11, day: 19, hour: 12, min: 0 },
    ...opts,
  };
}

// A small seeded generator for the person's hand (not the engine's).
function hand(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// Where the computer would aim and stand for this throw.
function plan(planner, snapshot) {
  const d = JSON.parse(snapshot);
  d.opts.cpu = ["A", "B"];
  planner.restore(JSON.stringify(d));
  for (let f = 0; f < 400; f++) {
    const a = planner.frame({ dt: 0.1 }).action;
    if (a) return a;
  }
  return null;
}

// One throw by the dial: press at 6, wind back to `back`, flick forward to `stop`, lift.
function dialThrow(engine, back, stop, flickDps) {
  let out = engine.frame({ dt: 1 / 60, arm: 0 });
  const windFrames = Math.max(6, Math.round(back / 4));
  for (let i = 1; i <= windFrames; i++)
    out = engine.frame({ dt: 1 / 60, arm: -(back * i) / windFrames });
  const span = back + stop;
  const fwdFrames = Math.max(3, Math.round((span / flickDps) * 60));
  for (let i = 1; i <= fwdFrames && !out.action; i++)
    out = engine.frame({ dt: 1 / 60, arm: -back + (span * i) / fwdFrames });
  for (let i = 0; i < 60 && !out.action; i++)
    out = engine.frame({ dt: 1 / 60, arm: null });
  return out.action || null;
}

export async function playSolo(setup, sources = bundleLua()) {
  const engine = await Engine.create({ sources });
  const planner = await Engine.create({ sources });
  useRoomEngine(engine);
  engine.newMatch(setup);
  engine.setControl({ sides: ["A"], cpu: true });
  const start = engine.snapshot();
  const rnd = hand(setup.seed);
  const log = [];
  let human = 0;
  let misses = 0;
  for (let steps = 0; engine.need().kind !== "over"; steps++) {
    if (steps > 2e6) throw new Error(`seed ${setup.seed} never ended`);
    const need = engine.need();
    if (need.kind === "throw" && need.cpu) {
      const out = engine.frame({ dt: 1 / 60 });
      if (out.action) log.push({ a: out.action });
      continue;
    }
    if (need.kind === "throw") {
      const p = plan(planner, engine.snapshot());
      if (p?.stance) engine.setStance(p.stance.x, p.stance.y);
      if (p?.target) {
        // a person's aim is a little off the computer's
        const j = 0.06;
        engine.setTarget(
          p.target.x + (rnd() - 0.5) * j,
          p.target.y + (rnd() - 0.5) * j,
          true,
        );
      }
      const d = engine.need().dial || engine.frame({ dt: 1 / 60 }).dial || {};
      const lo = d.powerLo ?? 112;
      const hi = d.powerHi ?? 130;
      const rlo = d.releaseLo ?? 72;
      const rhi = d.releaseHi ?? 108;
      // a fair hand: mostly inside the power and release windows, sometimes not
      const back = lo - 4 + rnd() * (hi - lo + 8);
      const stop = rlo - 6 + rnd() * (rhi - rlo + 12);
      const action = dialThrow(engine, back, stop, 1050 + rnd() * 450);
      if (!action) {
        if (++misses > 20) throw new Error("the dial made no throw");
        continue;
      }
      human++;
      log.push({ a: action });
      continue;
    }
    let action;
    if (need.kind === "raise") action = { type: "raise" };
    else if (need.kind === "punish")
      action = { type: "punish", x: need.cursor.x, y: need.cursor.y };
    else throw new Error(`unexpected need ${need.kind}`);
    const r = engine.apply(action);
    if (!r.ok) throw new Error(`${need.kind} refused`);
    log.push({ a: action });
  }
  const need = engine.need();
  const throws = log.filter((e) => e.a.type === "throw").length;
  const end = {
    throws,
    hash: engine.hash().hash,
    winner: need.winner?.winner ?? null,
    how: need.how ?? null,
    turns: need.winner?.turns ?? null,
  };
  planner.lua.global.close();
  engine.lua.global.close();
  return { start, log, end, human };
}

// The server's check: play the submitted match from its start through this engine and
// compare with what the device claims. The end alone does not prove the computer's
// throws: a changed throw that knocks nothing reaches the same end. So each of the
// computer's throws is also made again here, by a second engine from the snapshot
// before it (the computer's choice is seeded by the match), and must be the same
// action, byte for byte.
const sameThrow = (a, b) =>
  JSON.stringify([a.launch, a.stance, a.target, a.swing]) ===
  JSON.stringify([b.launch, b.stance, b.target, b.swing]);

export async function verifySolo(sub, sources = bundleLua()) {
  const engine = await Engine.create({ sources });
  const cpu = await Engine.create({ sources });
  useRoomEngine(engine);
  engine.replayLoad({ start: sub.start, log: sub.log });
  let refused = 0;
  let cpuThrows = 0;
  let cpuForged = 0;
  for (let i = 0; i < sub.log.length; i++) {
    const a = sub.log[i].a;
    if (a.type === "throw" && a.scripted) {
      cpuThrows++;
      cpu.restore(engine.snapshot());
      let own = null;
      for (let f = 0; f < 2000 && !own; f++)
        own = cpu.frame({ dt: 1 / 60 }).action;
      if (!own || !sameThrow(own, a)) cpuForged++;
    }
    const r = engine.replayStep();
    if (!r.ok) refused++;
  }
  const info = engine.replayInfo();
  const need = engine.need();
  const hash = engine.hash().hash;
  engine.lua.global.close();
  cpu.lua.global.close();
  return {
    over: need.kind === "over",
    refused,
    differs: info.differs,
    cpuThrows,
    cpuForged,
    hash,
    // a device that renamed its side before sending claims no hash (docs/REEL.md)
    matches:
      (sub.end.hash == null || hash === sub.end.hash) &&
      (need.winner?.winner ?? null) === sub.end.winner &&
      info.throws === sub.end.throws &&
      cpuForged === 0,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const li = process.argv.indexOf("--level");
  const level = li > 0 ? process.argv[li + 1] : "club";
  const seeds = process.argv
    .slice(2)
    .filter((a, i, all) => all[i - 1] !== "--level" && a !== "--level")
    .map(Number)
    .filter(Number.isFinite);
  if (!seeds.length) {
    console.error(
      "usage: node tools/reel/solo.mjs [--level beginner|club|pro] <seed> [<seed> ...]",
    );
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const sources = bundleLua();
  for (const seed of seeds) {
    const t0 = Date.now();
    const { human, ...sub } = await playSolo(
      soloSetup(seed, { level }),
      sources,
    );
    const t1 = Date.now();
    const v = await verifySolo(sub, sources);
    const file = path.join(OUT, `solo-${seed}.json`);
    const text = JSON.stringify(sub);
    fs.writeFileSync(file, text + "\n");
    console.log(
      `${file}: ${sub.log.length} actions (${human} by the dial), ${sub.end.winner} by ${sub.end.how}, ` +
        `${(Buffer.byteLength(text) / 1024).toFixed(1)} KB, played ${((t1 - t0) / 1000).toFixed(1)} s; ` +
        `replayed from its start: over ${v.over}, refused ${v.refused}, differs ${v.differs}, ` +
        `computer's throws made again ${v.cpuThrows - v.cpuForged} of ${v.cpuThrows}, ` +
        `claimed end ${v.matches ? "reached" : "NOT reached"} (${((Date.now() - t1) / 1000).toFixed(1)} s)`,
    );
  }
}
