// The engine's golden corpus, whole: every engine the site carries (docs/ENGINES.md)
// plays its own golden/ under this repository's wasmoon, hash for hash.
//
// It takes minutes, and it can only come out differently when the engine, wasmoon or
// the host that loads them changes. So `npm run check` plays it only then
// (tools/golden-due.mjs names what counts), and otherwise it is played when asked for:
//
//   npm run golden              this file alone
//   npm run check -- --golden   the whole check, the corpus with it
//
// The engine's own CI plays the same corpus on every change to the engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { carriedEngines } from "../../tools/lua-bundle.mjs";
import { playGolden } from "./golden-play.mjs";

const manifest = JSON.parse(
  fs.readFileSync(new URL("../../vendor/engine/engine.json", import.meta.url)),
);

test("the engine's golden corpus, every hash, under this wasmoon", async () => {
  const carried = carriedEngines();
  assert.equal(carried[0].version, manifest.version);
  const played = [];
  for (const { dir, version } of carried)
    played.push([version, await playGolden(dir)]);
  // 1.4.0's corpus: 21 matches, 886 actions (the throw to go's batons among them);
  // 1.0.0's, carried for the iPhone app (docs/ENGINES.md): 21 matches, 880 actions.
  assert.deepEqual(played, [
    [manifest.version, 886],
    ["1.0.0", 880],
  ]);
});
