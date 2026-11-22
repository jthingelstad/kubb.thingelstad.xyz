// Engine 0.14 and 0.15 in a real browser: every match and practice names its scene
// (even Park, which the engine then leaves out of the start), and a Kid match from the
// solo card's Computer row draws its Kid line and says so on the hand-off
// (docs/CLIENT.md "The scene, first" and "Kid matches").
// Skipped with a notice when Playwright's Chromium is not installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, open, waitPhase } from "./browser.mjs";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/kid-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
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

// Every `new` the page asks of the engine from now on, with its options.
const spyNew = (page) =>
  page.evaluate(() => {
    const e = window.__kubb.game.engine;
    window.__news = [];
    const call = e.call.bind(e);
    e.call = (name, args) => {
      if (name === "new") window.__news.push(args);
      return call(name, args);
    };
  });
const news = (page) => page.evaluate(() => window.__news);

browserTest(
  "the scene is always sent: a Park match, a practice's new scene",
  async () => {
    const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1", "desktop", {
      prefs: { solo: { scene: "day", computer: "club" }, throwsMade: 5 },
    });
    try {
      await page.waitForSelector("[data-test=options]");
      await spyNew(page);
      await page.click("[data-test=start]");
      await page.waitForFunction(() => window.__kubb.game.mode === "match");
      const [m] = (await news(page)).filter((a) => a.mode === "match");
      assert.equal(m.scene, "day", "Park is named");
      assert.equal(m.surface, "grass");
      assert.equal(m.set, "classic");
      // the engine keeps no scene for Park: the start is as every match's was
      const opts = await page.evaluate(
        () => JSON.parse(window.__kubb.game.engine.snapshot()).opts,
      );
      assert.equal(opts.scene, undefined);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
    const practice = await open(env, "/practice/?nohowto=1", "desktop", {
      prefs: { practiceScene: "day" },
    });
    try {
      await waitPhase(practice, "aim", 15000);
      await spyNew(practice);
      await practice.click("[data-test=menu]");
      await practice.click("[data-test=menu-scene] [data-value=beach]");
      await practice.waitForFunction(() => window.__news.length > 0);
      const [p] = await news(practice);
      assert.equal(p.scene, "beach");
      assert.equal(
        await practice.evaluate(() => window.__kubb.game.viewData.surface),
        "sand",
        "the scene decides the ground",
      );
      assert.deepEqual(practice.errors, []);
    } finally {
      await practice.context().close();
    }
  },
);

browserTest(
  "a Kid match: Kid first on the Computer row, the Kid line drawn, Kid match on the hand-off",
  async () => {
    const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1", "desktop", {
      prefs: { solo: { scene: "day", computer: "kid" }, throwsMade: 5 },
    });
    try {
      await page.waitForSelector("[data-test=options]");
      assert.deepEqual(
        await page.$$eval("[data-test=solo-opt-computer] [data-value]", (bs) =>
          bs.map((b) => b.dataset.value),
        ),
        ["kid", "beginner", "club", "pro"],
      );
      assert.equal(
        await page.getAttribute(
          "[data-test=solo-opt-computer] [aria-checked=true]",
          "data-value",
        ),
        "kid",
        "a kept Kid stays Kid",
      );
      await page.click("[data-test=start]");
      await page.waitForSelector("[data-test=handoff-kid]");
      assert.equal(
        await page.textContent("[data-test=handoff-kid]"),
        "Kid match · throw from the cones",
      );
      assert.doesNotMatch(
        await page.textContent("[data-test=handoff]"),
        /punish/i,
      );
      await page.click("[data-test=handoff-go]");
      await waitPhase(page, "aim", 15000);
      const st = await page.evaluate(() => {
        const g = window.__kubb.game;
        const snap = JSON.parse(g.engine.snapshot());
        return {
          kid: g.need.kid,
          kidY: g.out?.aim?.kidY ?? g.engine.aim().aim.kidY,
          mapKidY: g.viewData?.minimap?.kidY,
          rules: snap.opts.rules,
          baseB: g.items.filter((i) => i.kind === "kubb" && i.team === "B")
            .length,
          adv: document.querySelector("[data-test=rail]")?.textContent ?? "",
        };
      });
      assert.equal(st.kid, true);
      assert.equal(st.rules, "kid");
      assert.equal(st.kidY, 2);
      assert.equal(st.mapKidY, 2);
      assert.equal(st.baseB, 3, "three base kubbs a side");
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);
