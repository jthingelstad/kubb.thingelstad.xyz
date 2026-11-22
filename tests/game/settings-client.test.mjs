// The settings in a real browser, where each lives by its scope (docs/CLIENT.md
// "Settings"): the device's (your name, a generated one picked in the name row; the
// meter and its side, the sound; no level of your own since engine 0.13, though a
// stored one is kept)
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

const text = (page, t) => page.textContent(`[data-test=${t}]`);
// picks another word in a word's picker, from its own choices; returns the word
async function pickWord(page, t) {
  const w = await page.$eval(`[data-test=${t}]`, (el) =>
    [...el.options].map((o) => o.value).find((v) => v !== el.value),
  );
  await page.selectOption(`[data-test=${t}]`, w);
  return w;
}
const valid = (page, name) =>
  page.evaluate(
    (n) =>
      window.__kubb.names?.valid("player", n).ok ??
      window.__kubb.game.names.valid("player", n).ok,
    name,
  );

browserTest(
  "/settings/ from the landing page: a typed name from before is replaced; the rows are kept for the game",
  async () => {
    // a device from before: a typed name, and the level only on its solo card
    const ctx = await env.browser.newContext(VIEWPORTS.desktop);
    await ctx.addInitScript(() => {
      if (!localStorage.getItem("kubb:solo")) {
        localStorage.setItem("kubb:name", JSON.stringify("Aspen"));
        localStorage.setItem(
          "kubb:solo",
          JSON.stringify({ name: "Aspen", level: "pro", wind: "light" }),
        );
      }
    });
    const page = await ctx.newPage();
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(e.message));
    try {
      await page.goto(env.base + "/");
      await page.click('a[href="/settings/"]');
      await page.waitForSelector("[data-test=settings-name]");
      // the typed name is never shown: a generated one stands in its place
      const shown = await text(page, "settings-name-text");
      assert.notEqual(shown, "Aspen");
      assert.equal(await valid(page, shown), true);
      assert.equal(await pref(page, "name"), shown);
      assert.equal(
        await page.locator("[data-test=settings] input").count(),
        0,
        "no text field anywhere",
      );
      // no match option here, and no level of your own (engine 0.13: one meter)
      for (const t of [
        "menu-surface",
        "menu-scene",
        "menu-raise",
        "menu-level",
      ])
        assert.equal(await has(page, t), false, t);
      // pick a word: the second word's picker, by keyboard as a select is used
      const word = await pickWord(page, "settings-name-word-1");
      const picked = await text(page, "settings-name-text");
      assert.equal(picked.split(" ")[1], word);
      assert.equal(await pref(page, "name"), picked);
      await pick(page, "menu-meter", "linear");
      await pick(page, "menu-side", "left");
      await pick(page, "mute", "off");
      await page.click("[data-test=settings-done]");
      // DONE goes HOME, /web/, which answers 301 to the landing page's #play
      await page.waitForURL(/\/#play$/);

      // the game reads them as Settings left them
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
        name: picked,
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
  "the first run rolls a name; SHUFFLE keeps a locked word; the name row works by keyboard",
  async () => {
    const page = await open(env, "/settings/", "desktop", { prefs: {} });
    try {
      await page.waitForSelector("[data-test=settings-name]");
      const first = await text(page, "settings-name-text");
      assert.equal(await valid(page, first), true, first);
      assert.equal(await pref(page, "name"), first, "rolled and kept");
      // the row is a labelled group of native controls
      assert.equal(
        await page.getAttribute("[data-test=settings-name]", "role"),
        "group",
      );
      assert.equal(
        await page.getAttribute("[data-test=settings-name]", "aria-label"),
        "Your name",
      );
      assert.equal(
        await page.getAttribute(
          "[data-test=settings-name-word-0]",
          "aria-label",
        ),
        "Your name, first word",
      );
      // lock the second word: SHUFFLE keeps it, every time
      const kept = first.split(" ")[1];
      await page.focus("[data-test=settings-name-lock-1]");
      await page.keyboard.press("Enter");
      assert.equal(
        await page.getAttribute(
          "[data-test=settings-name-lock-1]",
          "aria-pressed",
        ),
        "true",
      );
      const seen = new Set();
      for (let i = 0; i < 8; i++) {
        await page.focus("[data-test=settings-name-shuffle]");
        await page.keyboard.press("Enter");
        const n = await text(page, "settings-name-text");
        assert.equal(n.split(" ")[1], kept, n);
        assert.equal(await valid(page, n), true, n);
        seen.add(n.split(" ")[0]);
      }
      assert.ok(seen.size > 1, "the open word changes");
      // unlocked, SHUFFLE may change both
      await page.click("[data-test=settings-name-lock-1]");
      assert.equal(
        await page.getAttribute(
          "[data-test=settings-name-lock-1]",
          "aria-pressed",
        ),
        "false",
      );
      // the keyboard reaches every control in order: SHUFFLE, then each word's
      // picker and its lock
      await page.focus("[data-test=settings-name-shuffle]");
      const order = [];
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("Tab");
        order.push(
          await page.evaluate(() => document.activeElement?.dataset.test),
        );
      }
      assert.deepEqual(order, [
        "settings-name-word-0",
        "settings-name-lock-0",
        "settings-name-word-1",
        "settings-name-lock-1",
      ]);
      // a word picked in the first word's picker (a native select: its own keys)
      const w = await pickWord(page, "settings-name-word-0");
      const after = await text(page, "settings-name-text");
      assert.equal(after.split(" ")[0], w);
      // focus stays on the picker after the row is drawn again
      assert.equal(
        await page.evaluate(() => document.activeElement?.dataset.test),
        "settings-name-word-0",
      );
      assert.equal(await valid(page, after), true);
      assert.equal(await pref(page, "name"), after);
      // what a screen reader hears when it changes
      assert.match(
        await page.textContent("[data-test=settings-name] [aria-live]"),
        new RegExp(`^Your name: ${after}$`),
      );
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

browserTest(
  "MENU: the device's rows everywhere, the practice pitch's options in practice only, no Raising",
  async () => {
    const prefs = { name: "Brave Birch", howtoSeen: true };
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
        await practice.textContent("[data-test=settings-name-text]"),
        "Brave Birch",
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
  "the solo card's You row is the name row: a pick there is the device's and the match's name",
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
      await page.waitForSelector("[data-test=solo-you] [data-test=solo-name]");
      // a new device: a rolled name, already in the row; no text field, no CHANGE IN MENU
      const rolled = await text(page, "solo-name-text");
      assert.equal(await valid(page, rolled), true, rolled);
      assert.equal(await page.locator("[data-test=options] input").count(), 0);
      assert.equal(
        await page
          .locator("[data-test=options] button:has-text('CHANGE IN MENU')")
          .count(),
        0,
      );
      const word = await pickWord(page, "solo-name-word-1");
      const picked = await text(page, "solo-name-text");
      assert.equal(picked.split(" ")[1], word);
      await page.click("[data-test=start]");
      await page.waitForFunction(() => window.__kubb.game.mode === "match");
      assert.equal(await pref(page, "name"), picked);
      // the match options are kept for the next card, the name is not among them
      assert.equal((await pref(page, "solo")).name, undefined);
      const teamA = await page.evaluate(
        () => JSON.parse(window.__kubb.game.engine.snapshot()).opts.teams.A,
      );
      assert.equal(teamA.name, picked);
      assert.equal(teamA.players[0].name, picked);

      // MENU's row during the match changes the device's name; the next card (a
      // rematch) shows it
      await page.click("[data-test=handoff-go]");
      await page.click("[data-test=menu]");
      assert.equal(await text(page, "settings-name-text"), picked);
      await pickWord(page, "settings-name-word-1");
      const fromMenu = await text(page, "settings-name-text");
      await page.keyboard.press("Escape");
      assert.equal(await pref(page, "name"), fromMenu);
      await page.evaluate(() => window.__kubb.game.resign("A"));
      await page.waitForSelector("[data-test=rematch]");
      await page.click("[data-test=rematch]");
      await page.waitForSelector("[data-test=solo-you]");
      assert.equal(await text(page, "solo-name-text"), fromMenu);
      await page.click("[data-test=start]");
      await page.waitForFunction(() => window.__kubb.game.mode === "match");
      const again = await page.evaluate(
        () =>
          JSON.parse(window.__kubb.game.engine.snapshot()).opts.teams.A.name,
      );
      assert.equal(again, fromMenu);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

browserTest(
  "the lobby's You row is the name row, and the room hears a pick",
  async () => {
    const code = makePitchCode();
    const url = `/p/${code}?nohowto=1&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`;
    const page = await open(env, url, "desktop", {
      prefs: { name: "Brave Birch", howtoSeen: true },
    });
    try {
      await page.waitForSelector(
        "[data-test=lobby-you] [data-test=lobby-name]",
      );
      assert.equal(await text(page, "lobby-name-text"), "Brave Birch");
      assert.equal(await page.locator("[data-test=lobby] input").count(), 0);
      await page.waitForFunction(
        () => window.__kubb.pitch?.state().status === "open",
      );
      await page.click("[data-test=join-A]");
      await page.waitForSelector("[data-test=team-A] .member-name");
      assert.equal(
        await page.textContent("[data-test=team-A] .member-name"),
        "Brave Birch",
      );
      await page.selectOption("[data-test=lobby-name-word-1]", "Elm");
      await page.waitForFunction(
        () =>
          document.querySelector("[data-test=team-A] .member-name")
            ?.textContent === "Brave Elm",
        null,
        { timeout: 10000 },
      );
      assert.equal(await pref(page, "name"), "Brave Elm");
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);
