// The throw's coach line in a real browser (src/game/coach.js, Hud.showCoach;
// a tester, 2026-11-19: "Does it matter how quickly or slowly I track my
// finger"): shown to a new device and after a SLOW flick, over the meter's
// prompt, clear of the plan, the minimap and MENU, and gone for a learned
// device.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, open, waitPhase, dialGeometry, nextFrame } from "./browser.mjs";
import { LINES } from "../../src/game/coach.js";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/coach-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

let env;
before(async () => {
  if (available) env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
});

const overlaps = (a, b) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

const coach = (page) =>
  page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const el = document.querySelector("[data-test=coach]");
    const lead = el.querySelector(".coach-lead");
    return {
      shown: !el.hidden,
      line: el.querySelector(".coach-line").textContent,
      lead: lead.hidden ? null : lead.textContent,
      box: box(el),
      // one style (the 1.0 design): one inverted ink chip, lead and line in it
      chips: el.querySelectorAll(".coach-chip").length,
      ink: getComputedStyle(el.querySelector(".coach-chip")).backgroundColor,
      plans: [...document.querySelectorAll("[data-test=plans] > *")].map(box),
      menu: box(document.querySelector("[data-test=menu]")),
    };
  });

for (const [kind, prefs, name] of [
  ["portrait", {}, "a tall phone with the clock"],
  ["portrait", { meter: "linear" }, "a tall phone with the linear meter"],
  ["desktop", {}, "a wide screen with the clock"],
  [
    "desktop",
    { meter: "linear", meterSide: "left" },
    "a wide screen, linear on the left",
  ],
]) {
  browserTest(`a new device is coached over the prompt: ${name}`, async () => {
    const page = await open(env, "/practice/?nohowto=1", kind, {
      prefs: { ...prefs, throwsMade: 0 },
    });
    try {
      await waitPhase(page, "aim", 10000);
      await nextFrame(page);
      const c = await coach(page);
      assert.equal(c.shown, true);
      assert.equal(c.line, LINES.rest);
      assert.equal(c.line, "PULL BACK TO THE STRIPES");
      assert.equal(c.lead, null);
      assert.equal(c.chips, 1, "one chip");
      assert.equal(c.ink, "rgb(22, 19, 15)", "inverted: ink");
      const L = await page.evaluate(() => window.__kubb.game.L);
      let meter = L.dial;
      if (L.meter !== "linear") {
        const g = await dialGeometry(page);
        meter = {
          x: g.cx - g.r,
          y: g.cy - g.r,
          width: 2 * g.r,
          height: 2 * g.r,
        };
      }
      assert.ok(!overlaps(c.box, meter), "clear of the meter");
      assert.ok(!overlaps(c.box, L.minimap), "clear of the minimap");
      assert.ok(!overlaps(c.box, c.menu), "clear of MENU");
      c.plans.forEach((p, i) =>
        assert.ok(!overlaps(c.box, p), `clear of plan control ${i}`),
      );
      assert.ok(c.box.x >= 0 && c.box.x + c.box.width <= L.W, "on the screen");
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  });
}

browserTest(
  "a learned device is not coached, until a SLOW flick: then the next throw is",
  async () => {
    const page = await open(env, "/practice/?nohowto=1", "portrait", {
      prefs: { throwsMade: 3 },
    });
    try {
      await waitPhase(page, "aim", 10000);
      await nextFrame(page);
      assert.equal((await coach(page)).shown, false, "learned: no coach");
      // what playFrame sets from this player's own SLOW verdict
      await page.evaluate(() => (window.__kubb.game.coachSlow = true));
      await nextFrame(page);
      const c = await coach(page);
      assert.equal(c.shown, true);
      assert.equal(c.lead, "SLOW FLICK. FLICK FASTER.");
      assert.equal(c.line, LINES.rest);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);
