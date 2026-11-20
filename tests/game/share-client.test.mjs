// The share card in the browser, once (docs/CLIENT.md "Sharing a match"): a match
// against the computer, won, MAKE A HIGHLIGHT REEL on its winner card, the share card,
// a name typed, SHARE AND MAKE THE REEL against the local room server with the reel
// function's own check, and the reel card for the new code with its link. The words and
// every answer are tests/net/share-client.test.mjs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, open } from "./browser.mjs";
import { startRoomsServer } from "../../tools/rooms-dev.mjs";
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
    const rooms = await startRoomsServer({
      port: 0,
      reelEngines: devReelEngines(),
      reelRenderer: () => async (job) => asked.push(job), // no render here
      shareChecker: devShareChecker({ log: () => {} }),
    });
    try {
      const page = await open(
        env,
        `/p/abcdefgh?solo=1&nohowto=1&rooms=${encodeURIComponent(rooms.url)}`,
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
      // nothing has gone yet; the stand-in "You" is not offered as the name
      assert.equal(await page.inputValue("[data-test=share-name]"), "");
      assert.ok(await page.isDisabled("[data-test=share-send]"));
      await page.fill("[data-test=share-name]", "you");
      assert.match(
        await page.textContent("[data-test=share-say]"),
        /not "You"/,
      );
      await page.fill("[data-test=share-name]", "Lakeside");
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
      // the shared room keeps the name typed on the card
      const doc = await rooms.store.getDoc(code);
      assert.match(doc.doc, /Lakeside/);
      assert.deepEqual(page.errors, []);
      await page.context().close();
    } finally {
      await rooms.close();
    }
  },
);
