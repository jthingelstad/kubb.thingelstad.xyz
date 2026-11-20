// A match in a scene, shared and made into a reel (docs/SCENES.md, docs/REEL.md): the
// start a solo device sends names its scene (the engine's `scene`, engine 0.9 on), the
// renderer's check keeps it in the document and the replay it hands the room, and the
// reel of that replay is drawn in it. A scene this copy does not draw is drawn as the
// day; the physics never reads it, so the match is the same throw for throw.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundleLua } from "../../tools/lua-bundle.mjs";
import { playSolo, soloSetup } from "../../tools/reel/solo.mjs";
import { checkShare } from "../../backend/reels/check.mjs";
import { renderReel } from "../../backend/reels/render.mjs";
import engineInfo from "../../vendor/engine.json" with { type: "json" };

const sources = bundleLua();
const ENGINE = engineInfo.tag.replace(/^v/, "");
const MM = ENGINE.split(".").slice(0, 2).join(".");

async function shared(scene) {
  const played = await playSolo(soloSetup(2, { scene }), sources);
  const out = await checkShare({
    g: {
      engine: ENGINE,
      start: played.start,
      log: played.log,
      end: { winner: played.end.winner, throws: played.end.throws },
    },
    sources,
    engine: ENGINE,
    engines: [MM],
  });
  return { played, out };
}

// The reel's frames, planned and stepped but not drawn or encoded.
async function reelScene(replay) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "reel-scene-"));
  try {
    const r = await renderReel({
      replay,
      code: "abcdefgh23",
      out,
      sources,
      formats: ["wide"],
      capture: () => {},
      log: () => {},
    });
    return r.scene;
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

const day = await shared(undefined);

test("a night match shared from a device keeps its scene to the reel", async () => {
  const { played, out } = await shared("night");
  assert.equal(JSON.parse(played.start).opts.scene, "night");
  assert.equal(out.ok, true, JSON.stringify(out));
  const doc = JSON.parse(out.document);
  const replay = JSON.parse(out.replay);
  assert.equal(doc.match.setup.scene, "night");
  assert.equal(replay.setup.scene, "night");
  // a look only: the same match as the day's, throw for throw
  assert.deepEqual(played.log, day.played.log);
  assert.equal(await reelScene(replay), "night");
});

test("a day match's reel is the day; a scene this copy does not draw is the day", async () => {
  assert.equal(day.out.ok, true);
  assert.equal(JSON.parse(day.out.replay).setup.scene, undefined);
  assert.equal(await reelScene(JSON.parse(day.out.replay)), "day");
  const { out } = await shared("dusk");
  assert.equal(out.ok, true, JSON.stringify(out));
  const replay = JSON.parse(out.replay);
  assert.equal(
    replay.setup.scene,
    "dusk",
    "kept as sent: the engine takes any id",
  );
  assert.equal(await reelScene(replay), "day");
});
