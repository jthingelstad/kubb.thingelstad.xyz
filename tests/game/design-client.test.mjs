// The Throwing Wood 1.0 design on the web game's own screens, in a real browser: the
// Play the computer card's order and its buttons, the header's words, the winner
// card's buttons, and the system's floor on every card (nothing under 14 px in #ui,
// every control at least 44 px to a finger, one go button). Skipped with a notice when
// Playwright's Chromium is not installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, open } from "./browser.mjs";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/design-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
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

const PREFS = { name: "Mighty Maple", howtoSeen: true, throwsMade: 5 };

// What the system holds every shown card to: no type under 14 px in #ui, every
// button and segment at least 44 px tall (48 on a touchscreen), and at most one go.
async function floor(page, sel, { coarse = false } = {}) {
  return page.evaluate(
    ({ sel, coarse }) => {
      const root = document.querySelector(sel);
      const small = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!n.textContent.trim() || !el.offsetParent) continue;
        if (el.closest(".visually-hidden")) continue;
        const px = parseFloat(getComputedStyle(el).fontSize);
        if (px < 14) small.push(`${n.textContent.trim()} ${px}`);
      }
      const short = [];
      for (const b of root.querySelectorAll("button, a.btn")) {
        if (!b.offsetParent) continue;
        const r = b.getBoundingClientRect();
        if (r.height < (coarse ? 48 : 44))
          short.push(`${b.textContent} ${r.height}`);
      }
      const go = [...root.querySelectorAll(".btn.go")].filter(
        (b) => b.offsetParent,
      ).length;
      return { small, short, go };
    },
    { sel, coarse },
  );
}

browserTest(
  "Play the computer: the name row, Scene tiles, Computer level, Opening, Raising, Wind, Surface; no Kubbs; HOME quiet at the left, START go at the right",
  async () => {
    const page = await open(env, "/p/abcdefgh?solo=1", "portrait", {
      prefs: { ...PREFS, solo: { set: "usa", wind: "light" } },
    });
    try {
      await page.waitForSelector("[data-test=options]");
      const order = await page.$$eval("[data-test=options] > *", (els) =>
        els.map((e) => e.dataset.test).filter((t) => t && t !== "start-row"),
      );
      assert.deepEqual(order, [
        "solo-you",
        "solo-opt-scene",
        "solo-opt-computer",
        "solo-opt-opening",
        "solo-opt-raising",
        "solo-opt-wind",
        "solo-opt-surface",
      ]);
      assert.equal(await page.locator("[data-test=solo-opt-set]").count(), 0);
      // the foot: HOME quiet first, START the one go, last
      const foot = await page.$$eval(
        "[data-test=options] .card-foot .btn",
        (bs) => bs.map((b) => [b.textContent, b.className]),
      );
      assert.equal(foot.length, 2);
      assert.equal(foot[0][0], "HOME");
      assert.match(foot[0][1], /\bquiet\b/);
      assert.equal(foot[1][0], "START");
      assert.match(foot[1][1], /\bgo\b/);
      const f = await floor(page, "[data-test=options]", { coarse: true });
      assert.deepEqual(f.small, [], "nothing under 14 px");
      assert.deepEqual(f.short, [], "every control 48 px to a finger");
      assert.equal(f.go, 1);
      // the scene decides the set: a kept USA set plays Classic
      await page.click("[data-test=start]");
      await page.waitForFunction(() => window.__kubb.game.mode === "match");
      const opts = await page.evaluate(
        () => JSON.parse(window.__kubb.game.engine.snapshot()).opts,
      );
      assert.equal(opts.set, "classic");
      assert.equal(opts.wind, "light", "the kept options stand");
      assert.deepEqual(
        page.errors.filter((e) => !/404/.test(e)),
        [],
      );
    } finally {
      await page.context().close();
    }
  },
);

browserTest(
  "the header: Turn N · baton n of m over the name, the kubbs standing on the team colours, MENU in the plate; the winner card's buttons",
  async () => {
    const page = await open(env, "/p/abcdefgh?solo=1", "desktop", {
      prefs: { ...PREFS, solo: { opening: "2-4-6" } },
    });
    try {
      await page.click("[data-test=start]");
      await page.waitForFunction(() => window.__kubb.game.mode === "match");
      await page.click("[data-test=handoff-go]");
      await page.waitForFunction(
        () => document.querySelector("[data-test=rail-what]")?.textContent,
      );
      const h = await page.evaluate(() => {
        const q = (t) => document.querySelector(`[data-test=${t}]`);
        const c = (el) => getComputedStyle(el);
        return {
          what: q("rail-what").textContent,
          caps: c(q("rail-what")).textTransform,
          name: q("rail-name").textContent,
          a: q("rail-n-A").textContent,
          b: q("rail-n-B").textContent,
          aBg: c(q("rail-n-A")).backgroundColor,
          bBg: c(q("rail-n-B")).backgroundColor,
          label: q("rail-score").getAttribute("aria-label"),
          menuIn: !!q("rail").querySelector("[data-test=menu]"),
        };
      });
      assert.deepEqual(h, {
        what: "Turn 1 · baton 1 of 2",
        caps: "uppercase",
        name: "Mighty Maple",
        a: "5",
        b: "5",
        aBg: "rgb(242, 183, 5)",
        bBg: "rgb(142, 68, 173)",
        label: "Kubbs standing: Mighty Maple 5, Computer 5",
        menuIn: true,
      });
      // a card that dims the pitch takes the header away (its words fell under 4.5:1)
      await page.click("[data-test=menu]");
      assert.equal(
        await page.$eval(
          "[data-test=rail]",
          (r) => getComputedStyle(r).visibility,
        ),
        "hidden",
      );
      const m = await floor(page, "[data-test=menu-card]");
      assert.deepEqual(m.small, []);
      assert.deepEqual(m.short, []);
      assert.equal(m.go, 1);
      await page.keyboard.press("Escape");
      // the winner card: REMATCH go across the card, SCORE SHEET plain, SHARE when
      // there is somewhere to share to, HOME quiet at the foot
      await page.evaluate(() => window.__kubb.game.resign("A"));
      await page.waitForSelector("[data-test=winner]");
      const w = await page.$$eval("[data-test=winner] .btn", (bs) =>
        bs.map((b) => [b.dataset.test, b.className]),
      );
      const kind = Object.fromEntries(w);
      assert.equal(w[0][0], "rematch");
      assert.match(kind.rematch, /\bgo\b/);
      assert.doesNotMatch(kind["winner-sheet"], /\b(go|quiet)\b/);
      assert.match(kind["winner-home"], /\bquiet\b/);
      assert.equal(w.at(-1)[0], "winner-home");
      const f = await floor(page, "[data-test=winner]");
      assert.deepEqual(f.small, []);
      assert.equal(f.go, 1);
    } finally {
      await page.context().close();
    }
  },
);
