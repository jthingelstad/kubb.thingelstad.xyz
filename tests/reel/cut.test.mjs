// A cut that is not the shared reel (docs/REEL.md "The prototype"): the command line may
// give the reel's own lengths (an App Store preview is 15 to 30 s and carries no end
// card) and ask for the App Preview sizes. With nothing given, the reel is the reel.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { scanReplay } from "../../backend/reels/scan.mjs";
import { pickHighlights, tune } from "../../backend/reels/highlights.mjs";
import {
  FORMATS,
  FPS,
  planFrames,
  renderReel,
} from "../../backend/reels/render.mjs";
import { layoutFor } from "../../backend/reels/overlay.mjs";
import { bundleLua } from "../../tools/lua-bundle.mjs";

const kept = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/replay-north-south.json", import.meta.url),
    "utf8",
  ),
);
const sources = bundleLua();
const scan = await scanReplay(kept, { sources });
const PREVIEW = {
  titleSeconds: 1.2,
  endSeconds: 0,
  minSeconds: 25,
  maxSeconds: 29.5,
};

test("no cut given: the shared reel, its title and its end card", () => {
  const edit = pickHighlights(scan);
  assert.deepEqual(pickHighlights(scan, {}), edit);
  assert.equal(edit.title, tune.titleSeconds);
  assert.equal(edit.endCard, tune.endSeconds);
  const frames = planFrames(edit);
  assert.equal(
    frames.filter((f) => f.card === "title").length,
    Math.round(tune.titleSeconds * FPS),
  );
  assert.equal(
    frames.filter((f) => f.card === "end").length,
    Math.round(tune.endSeconds * FPS),
  );
});

test("a preview's cut: under 30 s, a short title, no end card, the match's end last", () => {
  const whole = pickHighlights(scan);
  const edit = pickHighlights(scan, PREVIEW);
  assert.equal(edit.title, 1.2);
  assert.equal(edit.endCard, 0);
  assert.ok(edit.seconds >= 25 && edit.seconds <= 29.5, `${edit.seconds} s`);
  // whole moments, fewer of them: never one cut short
  assert.ok(edit.moments.length <= whole.moments.length);
  assert.equal(edit.moments.at(-1).i, whole.moments.at(-1).i);
  const frames = planFrames(edit);
  assert.equal(frames.filter((f) => f.card === "end").length, 0);
  assert.equal(frames.at(-1).moment, edit.moments.length - 1);
  assert.ok(frames.length / FPS < 30, `${frames.length} frames`);
  // play starts when the title ends
  assert.equal(
    frames.findIndex((f) => f.moment === 0),
    Math.round(1.2 * FPS),
  );
});

test("a title of 0 s is left out too", () => {
  const edit = pickHighlights(scan, { ...PREVIEW, titleSeconds: 0 });
  const frames = planFrames(edit);
  assert.equal(frames.filter((f) => f.card).length, 0);
  assert.equal(frames[0].moment, 0);
});

test("the App Preview sizes are the tall reel in another shape", () => {
  assert.deepEqual(
    [FORMATS.iphone.W, FORMATS.iphone.H, FORMATS.iphone.as],
    [886, 1920, "tall"],
  );
  assert.deepEqual(
    [FORMATS.ipad.W, FORMATS.ipad.H, FORMATS.ipad.as],
    [1200, 1600, "tall"],
  );
  // the tall reel's own layout is as it was: its type in whole pixels of a 1080 frame
  const T = layoutFor("tall", 1080, 1920);
  assert.deepEqual(
    [T.caption, T.kicker, T.score, T.tag, T.top, T.bottom, T.unit],
    [74, 38, 58, 42, 293, 1508, 1],
  );
  // a narrower frame takes the type in proportion, inside the same margins
  const P = layoutFor("tall", 886, 1920);
  assert.equal(P.caption, Math.round((74 * 886) / 1080));
  assert.ok(P.left < P.right && P.right <= 886);
});

test("the renderer plans a preview in its own shape", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "reel-cut-"));
  try {
    const seen = new Set();
    const r = await renderReel({
      replay: kept,
      code: "abcdefgh23",
      out,
      sources,
      formats: ["iphone"],
      cut: PREVIEW,
      capture: (f) => seen.add(f),
      log: () => {},
    });
    assert.deepEqual([...seen], ["iphone"]);
    assert.equal(r.edit.endCard, 0);
    assert.ok(r.frames / FPS >= 25 && r.frames / FPS < 30, `${r.frames}`);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
