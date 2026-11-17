// tests/fixtures/replay-north-south.json: a kept replay (src/net/lobby.js replayOf) of a
// whole computer-against-computer match, North against South (South topples the king in
// turn 18 under kubb-engine 0.2.0; the tests read "South 1, North 0"), played through this
// checkout's engine. The embed and pitch pages tests serve it; tests/engine/fixtures
// fails when the engine no longer plays it to the hashes it carries. After an engine
// change that moves hashes (a new minor version), write it again, and if South no
// longer wins choose another seed:
//
//   node tools/replay-fixture.mjs           write the fixture
//   node tools/replay-fixture.mjs --check   fail unless the file is what it would write
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Engine } from "../src/engine/index.js";
import { replayOf } from "../src/net/lobby.js";
import { bundleLua } from "./lua-bundle.mjs";

export const FIXTURE = "tests/fixtures/replay-north-south.json";

export const SETUP = {
  seed: 6,
  cpu: "both",
  start: { year: 2026, month: 11, day: 15, hour: 10, min: 0 },
  maxTurns: 40,
  teams: {
    A: { name: "North", players: [{ name: "North" }] },
    B: { name: "South", players: [{ name: "South" }] },
  },
};

// The match played to its end: the replay as the rooms table keeps it, as text.
export async function playFixture(sources = bundleLua()) {
  const engine = await Engine.create({ sources });
  engine.newMatch(SETUP);
  const h0 = engine.hash().hash;
  const log = [];
  for (let frames = 0; engine.need().kind !== "over"; frames++) {
    if (frames > 1e6) throw new Error("the fixture match never ended");
    const out = engine.frame({ dt: 1 / 60 });
    if (out.action) log.push({ a: out.action, h: engine.hash().hash });
  }
  const replay = replayOf({
    over: true,
    n: 1,
    seq: log.length,
    setup: SETUP,
    h0,
    log,
    snap: engine.snapshot(),
    hash: engine.hash().hash,
    players: { A: [], B: [] },
    cpu: "both",
  });
  return JSON.stringify(replay) + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = await playFixture();
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(FIXTURE, "utf8") !== text) {
      console.error(`${FIXTURE} is stale: node tools/replay-fixture.mjs`);
      process.exit(1);
    }
    console.log(`${FIXTURE} is current`);
  } else {
    fs.writeFileSync(FIXTURE, text);
    const n = JSON.parse(text).log.length;
    console.log(`wrote ${FIXTURE}: ${n} actions`);
  }
}
