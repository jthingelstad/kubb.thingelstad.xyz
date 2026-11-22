// PLAY NOW on the landing page (the Throwing Wood 1.0 build list, "The website" 1):
// a device with no kept match options is dropped straight into a match against the
// computer on Park (the day scene), a Beginner computer, 2-4-6, raising by hand and
// no wind; a device that has played before gets the options card, as ever
// (src/main.js startSolo, src/ui/cards.js FIRST_MATCH and soloKept). The pure rule
// runs everywhere; the browser part is skipped with a notice when Playwright's
// Chromium is not installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, waitPhase, VIEWPORTS } from "./browser.mjs";
import { FIRST_MATCH, SOLO_DEFAULTS, soloKept } from "../../src/ui/cards.js";

test("the first match's options, and what counts as kept options", () => {
  assert.deepEqual(FIRST_MATCH, {
    ...SOLO_DEFAULTS,
    computer: "beginner",
    scene: "day",
    opening: "2-4-6",
    raising: "hand",
    wind: "off",
  });
  assert.equal(soloKept(null), false);
  assert.equal(soloKept({}), false);
  assert.equal(soloKept({ name: "Aspen" }), false, "a name is not options");
  assert.equal(soloKept("x"), false);
  assert.equal(soloKept({ wind: "light" }), true);
  assert.equal(soloKept({ level: "pro" }), true, "an older card's level");
  assert.equal(soloKept(FIRST_MATCH), true);
});

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/play-now-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

let env;
before(async () => {
  if (!available) return;
  env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
});

// The landing page in a fresh browser (prefs: what this device keeps), then PLAY NOW.
async function playNow(kind, prefs = {}) {
  const ctx = await env.browser.newContext(VIEWPORTS[kind]);
  await ctx.addInitScript((prefs) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    // HOW TO THROW seen: the overlay is not what this test is about
    localStorage.setItem("kubb:howtoSeen", "true");
    for (const [k, v] of Object.entries(prefs))
      localStorage.setItem(`kubb:${k}`, JSON.stringify(v));
  }, prefs);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(env.base + "/");
  const href = await page.getAttribute("[data-test=play-now]", "href");
  // start.js points it at a pitch of its own
  assert.match(href, /^\/p\/[2-9a-hjkmnp-z]{8}\?solo=1&play=1$/);
  await page.click("[data-test=play-now]");
  await page.waitForURL(/\/p\/[2-9a-hjkmnp-z]{8}\?solo=1&play=1$/);
  await page.waitForSelector("body[data-ready='1']", { timeout: 30000 });
  return page;
}

const matchOpts = (page) =>
  page.evaluate(() => JSON.parse(window.__kubb.game.engine.snapshot()).opts);

for (const kind of ["portrait", "desktop"])
  browserTest(
    `PLAY NOW, first visit (${kind}): straight into a match on the first-time defaults`,
    async () => {
      const page = await playNow(kind);
      try {
        await waitPhase(page, "aim", 20000);
        assert.equal(
          await page.locator("[data-test=options]").count(),
          0,
          "no options card",
        );
        const opts = await matchOpts(page);
        // Park, the day: a day match carries no scene, as every match did
        // (tests/game/scenes-client.test.mjs), and draws the day
        assert.equal(opts.scene, undefined);
        assert.equal(
          await page.evaluate(() => window.__kubb.game.stage.id),
          "day",
        );
        assert.equal(opts.opening, "2-4-6");
        assert.equal(opts.raising, "hand");
        assert.equal(opts.wind, "off");
        // the computer plays B at Beginner, the device's own name on A
        assert.equal(opts.computer, "beginner");
        const game = await page.evaluate(
          () => JSON.parse(window.__kubb.game.engine.snapshot()).save.game,
        );
        assert.equal(
          game.teams.A.name,
          await page.evaluate(() => window.__kubb.game.playerName),
        );
        assert.equal(game.teams.B.name, "Computer");
        // kept as the card's options, so the next PLAY NOW opens the card
        assert.deepEqual(
          await page.evaluate(() =>
            JSON.parse(localStorage.getItem("kubb:solo")),
          ),
          {
            computer: "beginner",
            surface: "grass",
            opening: "2-4-6",
            raising: "hand",
            wind: "off",
            set: "classic",
            scene: "day",
          },
        );
        await page.goto(env.base + "/");
        await page.click("[data-test=play-now]");
        await page.waitForSelector("[data-test=options]", { timeout: 30000 });
        assert.equal(
          await page.getAttribute(
            "[data-test=solo-opt-computer] [aria-checked=true]",
            "data-value",
          ),
          "beginner",
        );
        assert.deepEqual(page.errors, []);
      } finally {
        await page.context().close();
      }
    },
  );

browserTest(
  "PLAY NOW, a device that has played: the options card, its kept options on it",
  async () => {
    const page = await playNow("desktop", {
      solo: { computer: "pro", wind: "light", scene: "neon" },
    });
    try {
      await page.waitForSelector("[data-test=options]", { timeout: 30000 });
      assert.equal(
        await page.evaluate(() => window.__kubb.game.mode),
        "practice",
      );
      for (const [row, value] of [
        ["computer", "pro"],
        ["wind", "light"],
        ["scene", "neon"],
      ])
        assert.equal(
          await page.getAttribute(
            `[data-test=solo-opt-${row}] [aria-checked=true]`,
            "data-value",
          ),
          value,
          row,
        );
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

browserTest("PLAY NOW with only a name kept is a first visit", async () => {
  const page = await playNow("desktop", { solo: { name: "Aspen" } });
  try {
    await waitPhase(page, "aim", 20000);
    assert.equal(await page.locator("[data-test=options]").count(), 0);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});
