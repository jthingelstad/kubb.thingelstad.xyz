// A finished match with no throw (a player resigned before the first): the scan finds
// none, the picker picks nothing (no title, no end card) and the renderer declines it
// before it starts an encoder (backend/reels/render.mjs, docs/REEL.md).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { scanReplay } from "../../backend/reels/scan.mjs";
import {
  NoHighlights,
  REEL_EMPTY,
  pickHighlights,
} from "../../backend/reels/highlights.mjs";
import { renderReel } from "../../backend/reels/render.mjs";
import { bundleLua } from "../../tools/lua-bundle.mjs";

const kept = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/replay-north-south.json", import.meta.url),
    "utf8",
  ),
);
// the same match's start, resigned before the first throw
const resigned = { ...kept, log: [] };
const sources = bundleLua();

test("a match resigned before the first throw: no throws, no moments, no title or end card", async () => {
  const scan = await scanReplay(resigned, { sources });
  assert.equal(scan.throws.length, 0);
  const edit = pickHighlights(scan);
  assert.deepEqual(edit.moments, []);
  assert.equal(edit.seconds, 0);
  assert.equal(edit.title, undefined);
  assert.equal(edit.endCard, undefined);
});

test("the renderer declines it before any encoder starts", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "reel-empty-"));
  try {
    await assert.rejects(
      renderReel({
        replay: resigned,
        code: "abcdefgh23",
        out,
        sources,
        // an encoder started would fail on this, not with NoHighlights
        ffmpeg: path.join(out, "no-ffmpeg-here"),
        log: () => {},
      }),
      (error) => error instanceof NoHighlights && error.code === REEL_EMPTY,
    );
    assert.deepEqual(fs.readdirSync(out), []);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
