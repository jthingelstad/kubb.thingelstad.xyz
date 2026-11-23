// The control surface's words in a real browser (the audit of 2026-11-19,
// Jamie: "It is all a hangover from us starting on play date"): practice's
// BATONS and KUBBS show which is in use, the rail counts kubbs in plain
// words, and the menu's rows each show their value, its foot the version label.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, open, waitPhase, nextFrame } from "./browser.mjs";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/labels-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

let env;
before(async () => {
  if (available) env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
});

const rail = (page) =>
  page.evaluate(() => ({
    // the header's line over the name (shown in capitals)
    what: document.querySelector(".rail-what").textContent,
    name: document.querySelector(".rail-name").textContent,
    batons: document
      .querySelector("[data-test=batons]")
      .getAttribute("aria-pressed"),
    kubbs: document
      .querySelector("[data-test=drill]")
      .getAttribute("aria-pressed"),
  }));

browserTest(
  "practice shows BATONS and KUBBS, the one in use pressed, and the rail agrees",
  async () => {
    const page = await open(env, "/practice/?nohowto=1", "portrait");
    try {
      await waitPhase(page, "aim", 10000);
      await nextFrame(page);
      let r = await rail(page);
      assert.deepEqual(r, {
        what: "Batons · 5 base kubbs",
        name: "Practice",
        batons: "true",
        kubbs: "false",
      });
      await page.tap("[data-test=drill]");
      await page.waitForFunction(
        () => window.__kubb.game.out?.aim?.projectile === "kubb",
        null,
        { timeout: 5000, polling: 50 },
      );
      await nextFrame(page);
      r = await rail(page);
      assert.match(r.what, /^Kubbs · target \d+\.\d m$/);
      assert.equal(r.kubbs, "true");
      assert.equal(r.batons, "false");
      // pressing the one in use changes nothing
      await page.tap("[data-test=drill]");
      await nextFrame(page);
      assert.equal(
        await page.evaluate(() => window.__kubb.game.out.aim.projectile),
        "kubb",
      );
      await page.tap("[data-test=batons]");
      await page.waitForFunction(
        () => window.__kubb.game.out?.aim?.projectile !== "kubb",
        null,
        { timeout: 5000, polling: 50 },
      );
      await nextFrame(page);
      r = await rail(page);
      assert.equal(r.what, "Batons · 5 base kubbs");
      assert.equal(r.batons, "true");
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

browserTest("the menu's rows say what they set and show it", async () => {
  const page = await open(env, "/practice/?nohowto=1", "desktop");
  try {
    await waitPhase(page, "aim", 10000);
    await page.click("[data-test=menu]");
    const labels = await page.$$eval(
      "[data-test=menu-card] .opt-label",
      (els) => els.map((e) => e.textContent),
    );
    // practice: the pitch's own options under the menu's grid, scene first; Park
    // leaves no Surface (engine 0.14: the scene decides it)
    assert.deepEqual(labels, ["Scene"]);
    // the device's settings in Settings (src/ui/settings.js)
    await page.click("[data-test=menu-settings]");
    const device = await page.$$eval("[data-test=settings] .opt-label", (els) =>
      els.map((e) => e.textContent),
    );
    assert.deepEqual(device, ["Your name", "Sound", "Meter", "Meter side"]);
    const sound = () =>
      page.$$eval("[data-test=mute] [role=radio]", (els) =>
        els.map((e) => `${e.textContent}:${e.getAttribute("aria-checked")}`),
      );
    assert.deepEqual(await sound(), ["On:true", "Off:false"]);
    await page.click("[data-test=mute] >> text=Off");
    assert.deepEqual(await sound(), ["On:false", "Off:true"]);
    assert.equal(await page.evaluate(() => window.__kubb.sound.muted), true);
    await page.click("[data-test=mute] >> text=On");
    assert.equal(await page.evaluate(() => window.__kubb.sound.muted), false);
    await page.click("[data-test=settings-done]");
    // at the foot, small: the version label, the newest engine in the parentheses;
    // no "Also plays" line, as the site carries the newest engine alone
    assert.equal(
      await page.textContent("[data-test=menu-version-label]"),
      "1.0.1 (1.0.0)",
    );
    assert.equal(
      await page.locator("[data-test=menu-version-also]").count(),
      0,
    );
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});
