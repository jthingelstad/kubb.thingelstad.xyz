// The settings in a real browser, where each lives by its scope (docs/CLIENT.md
// "Settings"): the device's (your name, the meter and its side, the sound; no level of
// your own since engine 0.13, though a stored one is kept)
// in one place, MENU in every mode and the /settings/ page from the web game's page;
// a match's options on the solo card, the practice MENU and the lobby, nowhere else;
// the part-way raising on the raise panel. Skipped with a notice when Playwright's
// Chromium is not installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, open, VIEWPORTS } from "./browser.mjs";
import { startPitchServer } from "../../tools/pitch-dev.mjs";
import { makePitchCode } from "../../src/net/pitch-client.js";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/settings-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

let env, rooms;
before(async () => {
  if (!available) return;
  rooms = await startPitchServer();
  env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
  if (rooms) await rooms.close();
});

const has = (page, name) =>
  page.locator(`[data-test=${name}]`).count().then(Boolean);
const pref = (page, k) =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(`kubb:${k}`)), k);
const pick = (page, row, value) =>
  page.click(`[data-test=${row}] [data-value="${value}"]`);

browserTest(
  "/settings/ from the web game's page: the device's rows, kept for the game",
  async () => {
    // a device from before: the name and the level only on its solo card
    const ctx = await env.browser.newContext(VIEWPORTS.desktop);
    await ctx.addInitScript(() => {
      if (!localStorage.getItem("kubb:solo"))
        localStorage.setItem(
          "kubb:solo",
          JSON.stringify({ name: "Aspen", level: "pro", wind: "light" }),
        );
    });
    const page = await ctx.newPage();
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(e.message));
    try {
      await page.goto(env.base + "/web/");
      await page.click('a[href="/settings/"]');
      await page.waitForSelector("[data-test=settings]");
      assert.equal(await page.inputValue("[data-test=settings-name]"), "Aspen");
      // no match option here, and no level of your own (engine 0.13: one meter)
      for (const t of [
        "menu-surface",
        "menu-scene",
        "menu-raise",
        "menu-level",
      ])
        assert.equal(await has(page, t), false, t);
      await page.fill("[data-test=settings-name]", "Oak");
      await page.press("[data-test=settings-name]", "Enter");
      await pick(page, "menu-meter", "linear");
      await pick(page, "menu-side", "left");
      await pick(page, "mute", "off");
      await page.click("[data-test=settings-done]");
      await page.waitForURL(/\/web\/$/);

      // the game reads them as MENU left them
      await page.goto(env.base + "/practice/?nohowto=1");
      await page.waitForSelector("body[data-ready='1']");
      const g = await page.evaluate(() => {
        const { game, sound } = window.__kubb;
        return {
          name: game.playerName,
          level: game.level,
          meter: game.meter,
          side: game.meterSide,
          muted: sound.muted,
        };
      });
      assert.deepEqual(g, {
        name: "Oak",
        // the older choice is kept, never reset, though nothing sets it now
        level: "pro",
        meter: "linear",
        side: "left",
        muted: true,
      });
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

browserTest(
  "MENU: the device's rows everywhere, the practice pitch's options in practice only, no Raising",
  async () => {
    const prefs = { name: "Birch", howtoSeen: true };
    const practice = await open(env, "/practice/?nohowto=1", "desktop", {
      prefs,
    });
    const solo = await open(
      env,
      `/p/abcdefgh?solo=1&nohowto=1&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`,
      "desktop",
      {
        prefs,
      },
    );
    try {
      await practice.click("[data-test=menu]");
      for (const t of [
        "settings-name",
        "menu-meter",
        "menu-side",
        "mute",
        "menu-surface",
        "menu-scene",
      ])
        assert.ok(await has(practice, t), `practice MENU has ${t}`);
      assert.equal(await has(practice, "menu-raise"), false);
      assert.equal(await has(practice, "menu-level"), false);
      assert.equal(
        await practice.inputValue("[data-test=settings-name]"),
        "Birch",
      );

      await solo.waitForSelector("[data-test=options]");
      await solo.click("[data-test=start]");
      await solo.waitForFunction(() => window.__kubb.game.mode === "match");
      await solo.click("[data-test=handoff-go]");
      await solo.click("[data-test=menu]");
      for (const t of ["settings-name", "menu-meter", "mute"])
        assert.ok(await has(solo, t), `match MENU has ${t}`);
      for (const t of [
        "menu-surface",
        "menu-scene",
        "menu-raise",
        "menu-level",
      ])
        assert.equal(await has(solo, t), false, `match MENU has no ${t}`);
      assert.deepEqual([...practice.errors, ...solo.errors], []);
    } finally {
      await practice.context().close();
      await solo.context().close();
    }
  },
);

browserTest(
  "the solo card asks a new device's name once, then one You row with CHANGE IN MENU",
  async () => {
    const page = await open(
      env,
      `/p/abcdefgh?solo=1&nohowto=1&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`,
      "desktop",
      {
        prefs: { howtoSeen: true },
      },
    );
    try {
      await page.waitForSelector("[data-test=solo-name]");
      // the box is the one You row, with one button, and no level line
      assert.equal(
        await page
          .locator("[data-test=solo-you] [data-test=solo-name]")
          .count(),
        1,
      );
      assert.equal(
        await page.locator("[data-test=solo-you] .opt-value").count(),
        0,
      );
      assert.equal(
        await page
          .locator("[data-test=options] button:has-text('CHANGE IN MENU')")
          .count(),
        1,
      );
      await page.fill("[data-test=solo-name]", "  Birch  ");
      await page.click("[data-test=start]");
      await page.waitForFunction(() => window.__kubb.game.mode === "match");
      assert.equal(await pref(page, "name"), "Birch");
      // the match options are kept for the next card, the name is not among them
      assert.equal((await pref(page, "solo")).name, undefined);
      const teamA = await page.evaluate(
        () => JSON.parse(window.__kubb.game.engine.snapshot()).opts.teams.A,
      );
      assert.equal(teamA.name, "Birch");

      // the next card (a rematch) shows the kept name, and MENU changes it
      await page.evaluate(() => window.__kubb.game.resign("A"));
      await page.waitForSelector("[data-test=rematch]");
      await page.click("[data-test=rematch]");
      await page.waitForSelector("[data-test=solo-you]");
      assert.equal(await has(page, "solo-name"), false, "asked once");
      // the name alone: no "Throwing at ..." line since engine 0.13
      const parts = await page.$$eval(
        "[data-test=solo-you] .opt-value > span",
        (els) => els.map((e) => [e.className, e.textContent]),
      );
      assert.deepEqual(parts, [["you-name", "Birch"]]);
      assert.equal(
        await page.getAttribute("[data-test=solo-you-menu]", "aria-label"),
        "Change in MENU: your name",
      );
      assert.equal(
        await page
          .locator("[data-test=options] button:has-text('CHANGE IN MENU')")
          .count(),
        1,
      );
      await page.click("[data-test=solo-you-menu]");
      await page.fill("[data-test=settings-name]", "Elm");
      await page.press("[data-test=settings-name]", "Enter");
      await page.keyboard.press("Escape");
      assert.equal(
        await page.textContent("[data-test=solo-you] .you-name"),
        "Elm",
      );
      assert.equal(await pref(page, "name"), "Elm");
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

browserTest(
  "a name set in MENU over the solo card is the name START takes, not the box's older text",
  async () => {
    const page = await open(
      env,
      `/p/abcdefgh?solo=1&nohowto=1&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`,
      "desktop",
      {
        prefs: { howtoSeen: true },
      },
    );
    try {
      await page.waitForSelector("[data-test=solo-name]");
      await page.fill("[data-test=solo-name]", "Birch");
      await page.click("[data-test=solo-you-menu]");
      await page.fill("[data-test=settings-name]", "Elm");
      await page.press("[data-test=settings-name]", "Enter");
      await page.keyboard.press("Escape");
      assert.equal(await page.inputValue("[data-test=solo-name]"), "Elm");
      await page.click("[data-test=start]");
      await page.waitForFunction(() => window.__kubb.game.mode === "match");
      assert.equal(await pref(page, "name"), "Elm");
      const teamA = await page.evaluate(
        () => JSON.parse(window.__kubb.game.engine.snapshot()).opts.teams.A,
      );
      assert.equal(teamA.name, "Elm");
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

browserTest(
  "the lobby's You row shows a kept name with CHANGE IN MENU, and the room hears a change",
  async () => {
    const code = makePitchCode();
    const url = `/p/${code}?nohowto=1&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`;
    const page = await open(env, url, "desktop", {
      prefs: { name: "Birch", howtoSeen: true },
    });
    try {
      await page.waitForSelector("[data-test=lobby-you]");
      assert.equal(await has(page, "lobby-name"), false);
      assert.equal(
        await page
          .locator("[data-test=lobby] button:has-text('CHANGE IN MENU')")
          .count(),
        1,
      );
      await page.waitForFunction(
        () => window.__kubb.pitch?.state().status === "open",
      );
      await page.click("[data-test=join-A]");
      await page.waitForSelector("[data-test=team-A] .member-name");
      assert.equal(
        await page.textContent("[data-test=team-A] .member-name"),
        "Birch",
      );
      await page.click("[data-test=lobby-you-menu]");
      await page.fill("[data-test=settings-name]", "Elm");
      await page.press("[data-test=settings-name]", "Enter");
      await page.keyboard.press("Escape");
      assert.equal(
        await page.textContent("[data-test=lobby-you] .you-name"),
        "Elm",
      );
      await page.waitForFunction(
        () =>
          document.querySelector("[data-test=team-A] .member-name")
            ?.textContent === "Elm",
        null,
        { timeout: 10000 },
      );
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);
