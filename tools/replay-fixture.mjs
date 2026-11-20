// tests/fixtures/replay-north-south.json: a kept replay (src/net/lobby.js replayOf) of a
// whole computer-against-computer match, North against South (South topples the king in
// turn 18 under kubb-engine 0.2.0 and 0.3.0; the tests read "South 1, North 0"), played through this
// checkout's engine. The embed and pitch pages tests serve it; tests/engine/fixtures
// fails when the engine no longer plays it to the hashes it carries. After an engine
// change that moves hashes (a new minor version), write it again, and if South no
// longer wins choose another seed:
//
//   node tools/replay-fixture.mjs           write the fixture
//   node tools/replay-fixture.mjs --check   fail unless the file is what it would write
//
// Each older engine the site carries (docs/ENGINES.md) keeps its own,
// tests/fixtures/replay-north-south-<major.minor>.json, played on that engine:
// `--engine <major.minor>` writes or checks it. When a new minor is vendored with
// --keep, the fixture the old newest played moves to its major.minor's name.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { Engine } from "../src/engine/index.js";
import { replayOf, useRoomEngine } from "../src/net/lobby.js";
import { bundleLua, carriedEngines } from "./lua-bundle.mjs";

export const FIXTURE = "tests/fixtures/replay-north-south.json";

// The fixture a carried engine plays: the newest's is FIXTURE.
export function fixtureFor(mm, newest = carriedEngines()[0].mm) {
  return mm === newest
    ? FIXTURE
    : `tests/fixtures/replay-north-south-${mm}.json`;
}

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
  useRoomEngine(engine);
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
  const args = process.argv.slice(2);
  const i = args.indexOf("--engine");
  const mm = i < 0 ? carriedEngines()[0].mm : args[i + 1];
  const file = fixtureFor(mm);
  const text = await playFixture(bundleLua(mm));
  const again = `node tools/replay-fixture.mjs${i < 0 ? "" : ` --engine ${mm}`}`;
  if (args.includes("--check")) {
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== text) {
      console.error(`${file} is stale: ${again}`);
      process.exit(1);
    }
    console.log(`${file} is current`);
  } else {
    fs.writeFileSync(file, text);
    const n = JSON.parse(text).log.length;
    console.log(`wrote ${file}: ${n} actions`);
  }
}
