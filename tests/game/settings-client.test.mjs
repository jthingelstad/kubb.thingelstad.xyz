// The settings in a real browser, where each lives by its scope (docs/CLIENT.md
// "Settings"): the device's (your name, a generated one picked in the name row; the
// meter and its side, the sound; no level of your own since engine 0.13, though a
// stored one is kept)
// in one place, MENU in every mode and the /settings/ page from the web game's page;
// a match's options on the solo card, the practice MENU and the lobby, nowhere else;
// the part-way raising on the raise panel and MENU's Raising row. The 1.0 design: the
// name row is the name and SHUFFLE (no KEEP, no pickers), with a stepper per word in
// Settings only; every two to four way choice is a segmented bar, one Tab stop with
// the arrow keys inside. Skipped with a notice when Playwright's Chromium is not
// installed.
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
// steps a word on in its stepper (Settings); returns the word it shows then
async function stepWord(page, key, slot, dir = "next") {
  await page.click(`[data-test=${key}-${dir}-${slot}]`);
  return text(page, `${key}-word-${slot}`);
}
// MENU, then its SETTINGS: the device's rows
async function openSettings(page) {
  await page.click("[data-test=menu]");
  await page.click("[data-test=menu-settings]");
  await page.waitForSelector("[data-test=settings] [data-test=settings-name]");
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
      // the second word stepped on: the first stays
      const before = await text(page, "settings-name-text");
      const word = await stepWord(page, "settings-name", 1);
      assert.notEqual(word, before.split(" ")[1]);
      const picked = await text(page, "settings-name-text");
      assert.equal(picked.split(" ")[1], word);
      assert.equal(await pref(page, "name"), picked);
      await pick(page, "menu-meter", "linear");
      await pick(page, "menu-side", "left");
      await pick(page, "mute", "off");
      await page.click("[data-test=settings-done]");
      // DONE goes HOME, the landing page's #play
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
  "the first run rolls a name; SHUFFLE rolls a whole new one, with no KEEP; the steppers step one word; the row works by keyboard",
  async () => {
    const page = await open(env, "/settings/", "desktop", { prefs: {} });
    try {
      await page.waitForSelector("[data-test=settings-name]");
      const first = await text(page, "settings-name-text");
      assert.equal(await valid(page, first), true, first);
      assert.equal(await pref(page, "name"), first, "rolled and kept");
      // the row is a labelled group of native buttons: no picker, no KEEP
      assert.equal(
        await page.getAttribute("[data-test=settings-name]", "role"),
        "group",
      );
      assert.equal(
        await page.getAttribute("[data-test=settings-name]", "aria-label"),
        "Your name",
      );
      for (const sel of [
        "select",
        "[data-test*=lock]",
        "button:has-text('KEEP')",
      ])
        assert.equal(
          await page.locator(`[data-test=settings-name] ${sel}`).count(),
          0,
          `no ${sel}`,
        );
      assert.equal(
        await page.getAttribute(
          "[data-test=settings-name-prev-0]",
          "aria-label",
        ),
        "Previous first word",
      );
      assert.equal(
        await page.getAttribute(
          "[data-test=settings-name-next-1]",
          "aria-label",
        ),
        "Next second word",
      );
      // SHUFFLE rolls a whole new name: over a few, both words change
      const firsts = new Set();
      const seconds = new Set();
      for (let i = 0; i < 10; i++) {
        await page.focus("[data-test=settings-name-shuffle]");
        await page.keyboard.press("Enter");
        const n = await text(page, "settings-name-text");
        assert.equal(await valid(page, n), true, n);
        firsts.add(n.split(" ")[0]);
        seconds.add(n.split(" ")[1]);
      }
      assert.ok(firsts.size > 1 && seconds.size > 1, "both words change");
      // a stepper steps its word and keeps the other (names.step)
      const n0 = await text(page, "settings-name-text");
      const w1 = await stepWord(page, "settings-name", 1, "next");
      const n1 = await text(page, "settings-name-text");
      assert.equal(n1, `${n0.split(" ")[0]} ${w1}`);
      assert.notEqual(n1, n0);
      const back = await stepWord(page, "settings-name", 1, "prev");
      assert.equal(back, n0.split(" ")[1], "previous takes it back");
      // the keyboard reaches every control in order: SHUFFLE, then each word's
      // previous and next
      await page.focus("[data-test=settings-name-shuffle]");
      const order = [];
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("Tab");
        order.push(
          await page.evaluate(() => document.activeElement?.dataset.test),
        );
      }
      assert.deepEqual(order, [
        "settings-name-prev-0",
        "settings-name-next-0",
        "settings-name-prev-1",
        "settings-name-next-1",
      ]);
      // Enter on the first word's next: the word moves, the focus stays on it
      await page.focus("[data-test=settings-name-next-0]");
      await page.keyboard.press("Enter");
      const after = await text(page, "settings-name-text");
      assert.equal(
        after.split(" ")[0],
        await text(page, "settings-name-word-0"),
      );
      assert.equal(
        await page.evaluate(() => document.activeElement?.dataset.test),
        "settings-name-next-0",
      );
      assert.equal(await valid(page, after), true);
      assert.equal(await pref(page, "name"), after);
      // what a screen reader hears when it changes
      assert.match(
        await page.textContent("[data-test=settings-name] [aria-live]"),
        new RegExp(`^Your name: ${after}$`),
      );
      // each stepper is at least 44 px square to a finger
      const step = await page
        .locator("[data-test=settings-name-prev-0]")
        .boundingBox();
      assert.ok(step.width >= 44 && step.height >= 44, JSON.stringify(step));
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

browserTest(
  "a segmented bar is one Tab stop: the arrow keys move the choice inside it, Home and End too",
  async () => {
    const page = await open(env, "/settings/", "desktop", {
      prefs: { name: "Brave Birch", meter: "clock" },
    });
    try {
      await page.waitForSelector("[data-test=menu-meter] .seg");
      const bar = "[data-test=menu-meter] .seg";
      assert.equal(await page.getAttribute(bar, "role"), "radiogroup");
      assert.equal(await page.getAttribute(bar, "aria-label"), "Meter");
      // the chosen part alone takes Tab; the others are out of the Tab order
      const tabs = await page.$$eval(`${bar} .seg-btn`, (bs) =>
        bs.map((b) => [
          b.dataset.value,
          b.tabIndex,
          b.getAttribute("aria-checked"),
        ]),
      );
      assert.deepEqual(tabs, [
        ["clock", 0, "true"],
        ["linear", -1, "false"],
      ]);
      // from the bar before, one Tab lands on the chosen part, the next leaves the bar
      await page.focus("[data-test=mute] .seg-btn[aria-checked=true]");
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement.dataset.value),
        "clock",
      );
      // the arrow keys pick, and the focus follows the choice (the rows are drawn
      // again after a pick)
      await page.keyboard.press("ArrowRight");
      assert.equal(await pref(page, "meter"), "linear");
      assert.equal(
        await page
          .evaluate(() => [
            document.activeElement.dataset.value,
            document.activeElement.getAttribute("aria-checked"),
          ])
          .then((v) => v.join()),
        "linear,true",
      );
      await page.keyboard.press("ArrowRight"); // round to the first
      assert.equal(await pref(page, "meter"), "clock");
      await page.keyboard.press("End");
      assert.equal(await pref(page, "meter"), "linear");
      await page.keyboard.press("Home");
      assert.equal(await pref(page, "meter"), "clock");
      await page.keyboard.press("ArrowLeft");
      assert.equal(await pref(page, "meter"), "linear");
      await page.keyboard.press("Tab");
      assert.notEqual(
        await page.evaluate(() =>
          document.activeElement.closest("[data-test=menu-meter]") ? 1 : 0,
        ),
        1,
        "Tab leaves the bar",
      );
      // the chosen part is ink with paper type; the focus ring is 3 px of ink, 2 px off
      const look = await page.$eval(`${bar} [aria-checked=true]`, (b) => {
        const c = getComputedStyle(b);
        return [c.backgroundColor, c.color];
      });
      assert.deepEqual(look, ["rgb(22, 19, 15)", "rgb(247, 240, 222)"]);
      await page.focus(`${bar} [aria-checked=true]`);
      await page.keyboard.press("ArrowRight");
      const ring = await page.$eval(bar, (el) => {
        const c = getComputedStyle(el);
        return [
          c.outlineStyle,
          c.outlineWidth,
          c.outlineOffset,
          c.outlineColor,
        ];
      });
      assert.deepEqual(ring, ["solid", "3px", "2px", "rgb(22, 19, 15)"]);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

browserTest(
  "MENU: the grid, Settings with the device's rows and DONE, the practice pitch's options in practice only, Raising in a match by hand",
  async () => {
    const prefs = { name: "Brave Birch", howtoSeen: true, throwsMade: 3 };
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
      // MENU is a word in the header's plate
      assert.equal(
        await practice.locator("[data-test=rail] [data-test=menu]").count(),
        1,
      );
      await practice.click("[data-test=menu]");
      for (const t of ["menu-settings", "menu-howto", "menu-scene"])
        assert.ok(await has(practice, t), `practice MENU has ${t}`);
      // a Surface row only where the scene leaves one (engine 0.14): Black & White
      assert.equal(await has(practice, "menu-surface"), false);
      await practice.click("[data-test=menu-scene] [data-value=bw]");
      await practice.waitForSelector("[data-test=menu-surface]");
      assert.deepEqual(
        await practice.$$eval("[data-test=menu-surface] [data-value]", (bs) =>
          bs.map((b) => b.dataset.value),
        ),
        ["grass", "sand", "snow"],
      );
      await practice.click("[data-test=menu-scene] [data-value=day]");
      // practice has no match: no score sheet, no Raising, no RESIGN
      for (const t of [
        "menu-sheet",
        "menu-raising",
        "menu-resign",
        "menu-level",
      ])
        assert.equal(
          await has(practice, t),
          false,
          `practice MENU has no ${t}`,
        );
      assert.equal(
        await practice.textContent("[data-test=menu-back]"),
        "BACK TO THE PITCH",
      );
      await practice.click("[data-test=menu-settings]");
      for (const t of ["settings-name", "menu-meter", "menu-side", "mute"])
        assert.ok(await has(practice, t), `Settings has ${t}`);
      assert.equal(
        await practice.textContent("[data-test=settings-name-text]"),
        "Brave Birch",
      );
      // DONE, at the bottom right, back to the menu; Escape closes the menu
      await practice.click("[data-test=settings-done]");
      assert.equal(await has(practice, "settings"), false);
      assert.ok(await practice.isVisible("[data-test=menu-card]"));
      await practice.keyboard.press("Escape");
      assert.equal(await has(practice, "menu-card"), false);

      await solo.waitForSelector("[data-test=options]");
      await solo.click("[data-test=start]");
      await solo.waitForFunction(() => window.__kubb.game.mode === "match");
      await solo.click("[data-test=handoff-go]");
      await solo.click("[data-test=menu]");
      // the grid of four, in its order, then Raising, BACK TO THE MATCH, RESIGN, HOME
      const grid = await solo.$$eval(
        "[data-test=menu-card] .menu-grid .btn",
        (bs) => bs.map((b) => b.textContent),
      );
      assert.deepEqual(grid.slice(0, 3), [
        "SETTINGS",
        "SCORE SHEET",
        "HOW TO THROW",
      ]);
      assert.ok(await has(solo, "menu-raising"), "a match raising by hand");
      assert.equal(
        await solo.textContent("[data-test=menu-back]"),
        "BACK TO THE MATCH",
      );
      assert.ok(await has(solo, "menu-resign"));
      assert.ok(await has(solo, "menu-home"));
      for (const t of [
        "menu-surface",
        "menu-scene",
        "menu-level",
        "settings-name",
      ])
        assert.equal(await has(solo, t), false, `match MENU has no ${t}`);
      // Raising: Automatic hands every raise to the engine, as REST OF GAME does
      await pick(solo, "menu-raising", "auto");
      assert.equal(
        await solo.evaluate(() => window.__kubb.game.autoRaise.game),
        true,
      );
      await pick(solo, "menu-raising", "hand");
      assert.equal(
        await solo.evaluate(() => window.__kubb.game.autoRaise.game),
        false,
      );
      // the buttons' kinds: BACK TO THE MATCH the one go, RESIGN and HOME quiet
      const kinds = await solo.$$eval("[data-test=menu-card] .btn", (bs) =>
        bs.map((b) => [b.dataset.test, b.className]),
      );
      assert.equal(kinds.filter(([, c]) => /\bgo\b/.test(c)).length, 1);
      assert.match(Object.fromEntries(kinds)["menu-resign"], /quiet/);
      assert.match(Object.fromEntries(kinds)["menu-home"], /quiet/);
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
      // the name and SHUFFLE on one line: no stepper, no KEEP here (Settings has them)
      for (const t of [
        "solo-name-prev-0",
        "solo-name-word-0",
        "solo-name-lock-0",
      ])
        assert.equal(await has(page, t), false, t);
      await page.click("[data-test=solo-name-shuffle]");
      await page.waitForFunction(
        (r) =>
          document.querySelector("[data-test=solo-name-text]")?.textContent !==
          r,
        rolled,
        { timeout: 5000 },
      );
      const picked = await text(page, "solo-name-text");
      assert.notEqual(picked, rolled);
      assert.equal(await valid(page, picked), true, picked);
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
      await openSettings(page);
      assert.equal(await text(page, "settings-name-text"), picked);
      await stepWord(page, "settings-name", 1);
      const fromMenu = await text(page, "settings-name-text");
      // Escape closes Settings, then the menu
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      assert.equal(await has(page, "menu-card"), false);
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
      // the name and SHUFFLE on one line, under "You are"
      assert.equal(
        await page.textContent("[data-test=lobby-you] .you-caption"),
        "You are",
      );
      assert.equal(await has(page, "lobby-name-prev-0"), false);
      await page.click("[data-test=lobby-name-shuffle]");
      const now = await text(page, "lobby-name-text");
      assert.notEqual(now, "Brave Birch");
      await page.waitForFunction(
        (n) =>
          document.querySelector("[data-test=team-A] .member-name")
            ?.textContent === n,
        now,
        { timeout: 10000 },
      );
      assert.equal(await pref(page, "name"), now);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);
