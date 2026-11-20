// What every throw of a kept replay did, read from the engine's own recordings: the
// match played again through this checkout's engine (session/replay.lua), action by
// action, as the replay player plays it. The facts are plain data for
// backend/reels/highlights.mjs, which knows no engine. `sources` is the engine's Lua
// module map (tools/lua-bundle.mjs bundleLua; the function carries it as a file).
//
//   const { throws, end } = await scanReplay(replay, { sources })
//
// The wide view is on (engine.setWide), so every recording is in the world frame:
// Team A's baseline at y = 0, Team B's at y = 8, whoever throws.
import { Engine } from "../../src/engine/index.js";
import { useRoomEngine } from "../../src/net/lobby.js";

// Any box works for the facts; the renderer sets its own.
export const FACT_BOX = { left: 0, top: 0, right: 400, bottom: 240 };

const onBase = (y) => Math.abs(y) < 0.25 || Math.abs(y - 8) < 0.25;

export const inHalf = (p, half) =>
  !!p &&
  Math.abs(p.x) < 2.5 &&
  (half === "A" ? p.y > 0 && p.y < 4 : p.y > 4 && p.y < 8);

// The field kubbs standing in one half, where they stand (world frame).
export function fieldKubbs(items, half) {
  return (items || [])
    .filter(
      (it) =>
        it.kind === "kubb" && !it.toppled && !onBase(it.y) && inHalf(it, half),
    )
    .map((it) => ({ id: it.id, x: it.x, y: it.y }));
}

// Kubbs standing in each half, field kubbs (off a baseline) apart.
export function piecesCount(items) {
  const out = {
    A: { base: 0, field: 0 },
    B: { base: 0, field: 0 },
    king: true,
  };
  for (const it of items || []) {
    if (it.kind === "king") {
      if (it.toppled) out.king = false;
      continue;
    }
    if (it.kind !== "kubb" || it.toppled) continue;
    const half = it.y < 4 ? "A" : "B";
    out[half][onBase(it.y) ? "base" : "field"]++;
  }
  return out;
}

export async function openReplay(replay, { sources, box } = {}) {
  const engine = await Engine.create({ sources });
  useRoomEngine(engine);
  engine.setWide(box || FACT_BOX);
  const view = engine.replayLoad(replay);
  return { engine, view };
}

// Every throw's facts, and how the match ended.
export async function scanReplay(replay, opts = {}) {
  const { engine, view } = await openReplay(replay, opts);
  const throws = [];
  let need = view.need;
  let before = piecesCount(view.items);
  let end = null;
  // the kubbs thrown in since the last baton: when the next baton comes, each learns
  // how its half stood once they were raised (and a punishment kubb was placed)
  let run = [];
  const punishIds = new Set();
  for (let i = 0; i < replay.log.length; i++) {
    const act = replay.log[i]?.a;
    if (run.length && act?.type === "throw" && act.how !== "drill") {
      const items = engine.view().items;
      const half = run[0].side === "A" ? "B" : "A";
      const settled = { at: i, kubbs: fieldKubbs(items, half) };
      // the ruling "out twice" comes on the throw that ends the round, which need
      // not be the punished kubb's. The punished kubb is the one the engine asks to
      // be placed (a person places it); when the computer places it unasked, it is
      // the kubb thrown twice that stands well away from where it came to rest.
      const called = run.some((f) => f.outTwice);
      for (const f of run) {
        f.settled = settled;
        const again = run.filter((g) => g.kubb === f.kubb);
        if (!called || again.length < 2 || again.at(-1) !== f) continue;
        const k = items.find((it) => it.id === f.kubb);
        const moved =
          k && f.rest ? Math.hypot(k.x - f.rest.x, k.y - f.rest.y) : 0;
        if (punishIds.size ? punishIds.has(f.kubb) : moved > 0.4) {
          f.punished = true;
          f.placed = k ? { x: k.x, y: k.y } : null;
        }
      }
      run = [];
      punishIds.clear();
    }
    const was = need;
    const r = engine.replayStep();
    need = r.need;
    if (need?.kind === "punish" && need.kubb) punishIds.add(need.kubb);
    const rec = r.recording;
    if (r.action?.type !== "throw" || !rec) {
      if (need?.kind === "over") end = endOf(need);
      before = piecesCount(engine.view().items);
      continue;
    }
    const tl = rec.timeline || {};
    const res = rec.result || {};
    const pid = rec.projectile?.id;
    const last = engine.showAt(rec.duration);
    const after = piecesCount(last.items);
    const setup = was?.setup || {};
    const side = setup.side || was?.side;
    const first = engine.showAt(0).items.find((it) => it.id === pid);
    // the result's landing and first hit stay in the thrower's frame (the wide
    // view un-turns the pieces and the bursts, not these): Team B's are turned
    const turn = (p) =>
      p && side === "B" && p.x != null ? { ...p, x: -p.x, y: 8 - p.y } : p;
    const fact = {
      i,
      turn: r.replay.turn,
      side,
      team: was?.teams?.[side] ?? side,
      how: r.action.how, // "baton" | "drill" (a kubb thrown in)
      n: setup.n ?? null,
      of: setup.of ?? null,
      kingShot: !!setup.kingShot,
      flag: res.flag ?? null,
      ruling: res.ruling?.text ?? "",
      short: res.ruling?.short ?? "",
      down: res.down ?? 0,
      toppled: res.toppled ?? [],
      hit: res.hit ?? null,
      distance: res.distance ?? null,
      from: first ? { x: first.x, y: first.y } : null,
      land: turn({ x: res.landX ?? null, y: res.landY ?? null }),
      touches: (tl.touches || [])
        .filter((t) => t.id !== pid)
        .map((t) => ({ id: t.id, kind: t.kind, t: t.t })),
      bursts: (tl.bursts || []).map((b) => ({
        kind: b.kind,
        id: b.id,
        start: b.start,
        anchor: b.anchor,
      })),
      firstHit: turn(tl.firstHit ?? null),
      // a kubb thrown in: which kubb, when it first touched the ground, where it came
      // to rest, and whether it went out a second time (a punishment kubb)
      kubb: r.action.how === "drill" ? (pid ?? null) : null,
      landT: tl.firstContact?.t ?? rec.landing?.T ?? null,
      rest: res.restX != null ? turn({ x: res.restX, y: res.restY }) : null,
      outTwice: /^out twice/i.test(res.ruling?.text || ""),
      slow: tl.slow ?? null,
      duration: rec.duration,
      before,
      after,
      over: need?.kind === "over",
    };
    throws.push(fact);
    if (fact.how === "drill") run.push(fact);
    if (need?.kind === "over") end = endOf(need);
    before = piecesCount(engine.view().items);
  }
  engine.replayEnd();
  return { throws, end, teams: need?.teams ?? null };
}

function endOf(need) {
  return {
    winner: need.winner?.winner ?? null,
    winnerName: need.winner?.winnerName ?? null,
    how: need.how ?? "",
    short: need.short ?? "",
    text: need.text ?? "",
    turns: need.winner?.turns ?? need.turn ?? null,
    standing: need.standing ?? null,
    teams: need.teams ?? null,
  };
}
