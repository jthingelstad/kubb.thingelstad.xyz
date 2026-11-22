// The share card in the browser, once (docs/CLIENT.md "Sharing a match"): a match
// against the computer, won, MAKE A HIGHLIGHT REEL on its winner card, the share card,
// a name typed, SHARE AND MAKE THE REEL against the local api (tools/pitch-dev.mjs) with
// the reel function's own check, and the reel card for the new code with its link. The
// words and every answer are tests/net/share-client.test.mjs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, open } from "./browser.mjs";
import { startPitchServer } from "../../tools/pitch-dev.mjs";
import { devReelEngines, devShareChecker } from "../../tools/reels-dev.mjs";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/share-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

let env;
before(async () => {
  if (available) env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
});

browserTest(
  "a match against the computer: the winner card's button, the share card, then the reel card for its link",
  async () => {
    const asked = [];
    const rooms = await startPitchServer({
      reelEngines: devReelEngines(),
      startReel: async (job) => void asked.push(job), // no render here
      shareChecker: devShareChecker({ log: () => {} }),
    });
    try {
      const page = await open(
        env,
        `/p/abcdefgh?solo=1&nohowto=1&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`,
      );
      await page.click("[data-test=start]");
      await page.waitForSelector("[data-test=handoff]");
      await page.click("[data-test=handoff-go]");
      await page.waitForFunction(
        () => window.__kubb.game.need?.kind === "throw",
      );
      await page.evaluate(() => window.__kubb.game.resign("A"));
      await page.waitForFunction(
        () => {
          const g = window.__kubb.game;
          if (g.phase === "play") g.skip();
          return g.need?.kind === "over";
        },
        null,
        { timeout: 30000, polling: 100 },
      );
      await page.waitForSelector("[data-test=winner-reel]");
      assert.equal(
        await page.textContent("[data-test=winner-reel]"),
        "MAKE A HIGHLIGHT REEL",
      );
      await page.click("[data-test=winner-reel]");
      await page.waitForSelector("[data-test=share-card]");
      // nothing has gone yet; the name row starts with the name the match was played
      // under (the device's generated name), and no text field is offered
      const played = await page.evaluate(() => window.__kubb.game.playerName);
      assert.equal(
        await page.textContent("[data-test=share-name-text]"),
        played,
      );
      assert.equal(
        await page.locator("[data-test=share-card] input").count(),
        0,
      );
      assert.ok(await page.isEnabled("[data-test=share-send]"));
      // SHUFFLE, then the second word's picker: the reel's name is a generated one
      await page.click("[data-test=share-name-shuffle]");
      const w = await page.$eval("[data-test=share-name-word-1]", (el) =>
        [...el.options].map((o) => o.value).find((v) => v !== el.value),
      );
      await page.selectOption("[data-test=share-name-word-1]", w);
      const chosen = await page.textContent("[data-test=share-name-text]");
      assert.equal(chosen.split(" ")[1], w);
      assert.ok(await page.isEnabled("[data-test=share-send]"));
      assert.match(
        await page.textContent("[data-test=share-card]"),
        /day and time the match was played/,
      );
      await page.click("[data-test=share-send]");

      // the reel card for the new code, with its link, asking for the reel
      await page.waitForSelector("[data-test=reel-card]", { timeout: 30000 });
      const link = await page.textContent("[data-test=reel-link]");
      const code = link.match(/throwingwood\.com\/p\/([2-9a-hjkmnp-z]+)/)?.[1];
      assert.ok(code, link);
      assert.equal(await page.locator("[data-test=reel-copy]").count(), 1);
      // asked once the server says it renders (one render started, for this code)
      await page.waitForFunction(
        () => window.__kubb.share?.reel?.state.polled,
        null,
        {
          timeout: 15000,
        },
      );
      assert.equal(
        await page.getAttribute("[data-test=reel-card]", "data-reel"),
        "asking",
      );
      assert.equal(
        await page.textContent("[data-test=winner-reel]"),
        "MAKING YOUR REEL",
      );
      assert.equal(asked.length, 1);
      assert.equal(asked[0].room, code);
      // the shared pitch is sealed, and its replay keeps the name picked on the card
      const state = await rooms.api.store.getState(code);
      assert.equal(state.sealed, true);
      const kept = await rooms.api.store.getReplay(code);
      assert.ok(kept.data.includes(chosen), chosen);
      assert.deepEqual(page.errors, []);
      await page.context().close();
    } finally {
      await rooms.close();
    }
  },
);
