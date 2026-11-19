// Kept replays to cut reels from, played here: computer against computer through this
// checkout's engine, as tools/replay-fixture.mjs plays the test fixture, one match per
// seed. Nothing is fetched from the live site.
//
//   node tools/reel/matches.mjs 3 11 17     write build/reel/matches/seed-<n>.json
//
// The teams are North and South, so a reel made from one says only team names.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Engine } from "../../src/engine/index.js";
import { replayOf, useRoomEngine } from "../../src/net/lobby.js";
import { bundleLua } from "../lua-bundle.mjs";

export const OUT = "build/reel/matches";

export function setupFor(seed, opts = {}) {
  return {
    seed,
    cpu: "both",
    start: { year: 2026, month: 11, day: 15, hour: 10, min: 0 },
    maxTurns: 40,
    teams: {
      A: { name: "North", players: [{ name: "North" }] },
      B: { name: "South", players: [{ name: "South" }] },
    },
    ...opts,
  };
}

// One match played to its end: the replay as the rooms table keeps it.
export async function playMatch(setup, sources = bundleLua()) {
  const engine = await Engine.create({ sources });
  useRoomEngine(engine);
  engine.newMatch(setup);
  const h0 = engine.hash().hash;
  const log = [];
  for (let frames = 0; engine.need().kind !== "over"; frames++) {
    if (frames > 2e6) throw new Error(`seed ${setup.seed} never ended`);
    const out = engine.frame({ dt: 1 / 60 });
    if (out.action) log.push({ a: out.action, h: engine.hash().hash });
  }
  return replayOf({
    over: true,
    n: 1,
    seq: log.length,
    setup,
    h0,
    log,
    snap: engine.snapshot(),
    hash: engine.hash().hash,
    players: { A: [], B: [] },
    cpu: "both",
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const seeds = process.argv.slice(2).map(Number).filter(Number.isFinite);
  if (!seeds.length) {
    console.error("usage: node tools/reel/matches.mjs <seed> [<seed> ...]");
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const sources = bundleLua();
  for (const seed of seeds) {
    const t0 = Date.now();
    const replay = await playMatch(setupFor(seed), sources);
    const file = path.join(OUT, `seed-${seed}.json`);
    fs.writeFileSync(file, JSON.stringify(replay) + "\n");
    console.log(
      `${file}: ${replay.log.length} actions, ${((Date.now() - t0) / 1000).toFixed(1)} s`,
    );
  }
}
