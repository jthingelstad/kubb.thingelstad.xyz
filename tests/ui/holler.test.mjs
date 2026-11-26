// HOLLER (src/net/hollers.js, src/ui/holler.js; docs/MULTIPLAYER.md "Being there"): the
// fixed list, the casts it makes and the only ones it draws, and where the panel
// stands: never over the tray or the meter.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HOLLER_GROUPS,
  HOLLER_PHRASES,
  HOLLER_EMOJI,
  hollerCast,
  hollerOf,
} from "../../src/net/hollers.js";
import { hollerPlace, hollerKeep, hollerTune } from "../../src/ui/holler.js";
import { layoutFor } from "../../src/game/layout.js";

test("the list: four groups in order, six phrases each, twelve emoji, exactly", () => {
  assert.deepEqual(
    HOLLER_GROUPS.map((g) => [g.id, g.name, g.phrases]),
    [
      [
        "cheers",
        "Cheers",
        [
          "NICE!",
          "NICE STICK!",
          "HOLY COW!",
          "LIGHTS OUT!",
          "YOU CAN DO IT!",
          "NEXT ONE!",
        ],
      ],
      [
        "groans",
        "Groans",
        [
          "OOH!",
          "UNLUCKY",
          "OH NO!",
          "TICKLED IT!",
          "KNOCKERHEAD!",
          "SO CLOSE!",
        ],
      ],
      [
        "banter",
        "Banter",
        [
          "SHORT PORCH!",
          "WOOD ON WOOD!",
          "CHERRY PICKED!",
          "NO PRESSURE",
          "WATCH THIS",
          "TOO EASY",
        ],
      ],
      [
        "calls",
        "Calls",
        [
          "TOK!",
          "DOUBLE!",
          "WOODPILE!",
          "IN THE BASKET!",
          "EIGHT METER!",
          "KING SHOT!",
        ],
      ],
    ],
  );
  assert.equal(HOLLER_PHRASES.length, 24);
  assert.equal(new Set(HOLLER_PHRASES).size, 24);
  assert.deepEqual(HOLLER_EMOJI, [
    "🎯",
    "🔥",
    "🎉",
    "😮",
    "😬",
    "😅",
    "😭",
    "😏",
    "😂",
    "👀",
    "👑",
    "🪵",
  ]);
  // the one source the docs name for the iPhone app
  const doc = readFileSync(
    new URL("../../docs/MULTIPLAYER.md", import.meta.url),
    "utf8",
  );
  assert.ok(doc.includes("src/net/hollers.json"));
  for (const w of HOLLER_PHRASES) assert.ok(doc.includes(w), w);
  for (const e of HOLLER_EMOJI) assert.ok(doc.includes(e), e);
});

test("a phrase casts { w }, an emoji { e } with no w", () => {
  assert.deepEqual(hollerCast({ phrase: "TOK!" }), { t: "shout", w: "TOK!" });
  assert.deepEqual(hollerCast({ emoji: "🪵" }), { t: "shout", e: "🪵" });
  assert.equal("w" in hollerCast({ emoji: "🪵" }), false);
});

test("a receiver draws only a member of the list, exactly; anything else is dropped", () => {
  assert.deepEqual(hollerOf({ t: "shout", w: "KING SHOT!" }), {
    phrase: "KING SHOT!",
  });
  assert.deepEqual(hollerOf({ t: "shout", e: "👑" }), { emoji: "👑" });
  // the four words of before are still on the list where they are on it
  assert.deepEqual(hollerOf({ t: "shout", w: "NICE!" }), { phrase: "NICE!" });
  for (const d of [
    { t: "shout", w: "ANYTHING I LIKE" },
    { t: "shout", w: "tok!" },
    { t: "shout", w: "TOK! " },
    { t: "shout", w: "WOW" },
    { t: "shout", e: "💩" },
    { t: "shout", e: "🪵🪵" },
    { t: "shout", w: ["TOK!"] },
    { t: "shout" },
    { t: "aim", w: "TOK!" },
    null,
    "TOK!",
  ])
    assert.equal(hollerOf(d), null, JSON.stringify(d));
});

const meets = (a, b) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

test("the panel never covers the tray or the meter, upright, on its side and on a desktop", () => {
  const sizes = [
    [360, 640],
    [360, 740],
    [390, 844],
    [740, 360],
    [844, 390],
    [1280, 768],
  ];
  for (const [W, H] of sizes)
    for (const meter of ["clock", "linear"])
      for (const side of ["right", "left"]) {
        const L = layoutFor(W, H, {}, false, meter, { side, coarse: W < 900 });
        const keep = hollerKeep(L);
        assert.ok(keep.length >= 2, "the tray and the meter");
        // the HOLLER button: under the rail, at the left
        const anchor = { x: 12, y: L.tall ? 150 : 92, width: 84, height: 32 };
        const at = hollerPlace({ W, H, safe: L.safe, anchor, keep });
        const box = { x: at.x, y: at.y, width: at.width, height: at.height };
        const why = `${W}x${H} ${meter} ${side}: ${JSON.stringify(at)}`;
        for (const k of keep) assert.ok(!meets(box, k), why);
        assert.ok(at.width >= hollerTune.minW, why);
        assert.ok(at.height >= hollerTune.minH, why);
        assert.ok(at.x >= 8 && at.x + at.width <= W - 8, why);
        assert.ok(at.y + at.height <= H - 8, why);
        if (W >= 844) assert.equal(at.wide, true, why);
      }
});

test("with nowhere clear the panel still opens, under the button, and scrolls", () => {
  const at = hollerPlace({
    W: 360,
    H: 640,
    anchor: { x: 12, y: 150, width: 84, height: 32 },
    keep: [{ x: 0, y: 0, width: 360, height: 640 }],
  });
  assert.equal(at.wide, false);
  assert.equal(at.y, 188);
  assert.ok(at.width <= hollerTune.narrowW);
});
