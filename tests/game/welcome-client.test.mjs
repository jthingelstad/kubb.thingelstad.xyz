// The pitch link's welcome (the Throwing Wood 1.0 design, "Pitch link welcome";
// src/ui/welcome.js) in a real browser on the local pitch server: a device that has
// never played sees one card before the lobby, naming who invited it, with two
// sentences on kubb, its generated name and SHUFFLE, JOIN THE GAME and the quiet JUST
// WATCH and HOW TO THROW; a device that has played, and the host who made the pitch,
// go straight to the lobby. Skipped with a notice when Playwright's Chromium is not
// installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, VIEWPORTS } from "./browser.mjs";
import { startPitchServer } from "../../tools/pitch-dev.mjs";
import { makePitchCode } from "../../src/net/pitch-client.js";
import { WELCOME_WORDS } from "../../src/ui/welcome.js";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/welcome-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
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

// A page on the pitch, with these prefs kept on the device before it loads.
async function arrive(code, prefs, kind = "desktop") {
  const ctx = await env.browser.newContext(VIEWPORTS[kind]);
  await ctx.addInitScript((prefs) => {
    for (const [k, v] of Object.entries(prefs))
      localStorage.setItem(`kubb:${k}`, JSON.stringify(v));
  }, prefs);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(
    `${env.base}/p/${code}?pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`,
  );
  await page.waitForSelector("body[data-ready='1']", { timeout: 30000 });
  return page;
}
const visible = (page, t) => page.isVisible(`[data-test=${t}]`);
const text = (page, t) => page.textContent(`[data-test=${t}]`);

browserTest(
  "a device new to the game: the welcome first, naming the host; JOIN THE GAME is the lobby",
  async () => {
    const code = makePitchCode();
    // the host made the pitch, and has played before
    const host = await arrive(code, {
      name: "Cheerful Cedar",
      throwsMade: 4,
      howtoSeen: true,
    });
    const guest = await arrive(code, {}, "portrait");
    try {
      await host.waitForSelector("[data-test=lobby]");
      assert.equal(await visible(host, "welcome"), false);

      await guest.waitForSelector("[data-test=welcome]");
      assert.equal(await visible(guest, "lobby"), false, "before the lobby");
      // who invited them, once the pitch says
      await guest.waitForFunction(
        (t) =>
          document.querySelector("[data-test=welcome-title]")?.textContent ===
          t,
        WELCOME_WORDS.invited("Cheerful Cedar"),
        { timeout: 10000 },
      );
      const card = await text(guest, "welcome");
      assert.match(card, /KUBB: THROWING WOOD/);
      assert.ok(card.includes(WELCOME_WORDS.kubb), "two sentences on kubb");
      // the auto how-to waits: the card offers it
      assert.equal(await visible(guest, "howto"), false);
      // their generated name with SHUFFLE (no steppers, no KEEP)
      const rolled = await text(guest, "welcome-name-text");
      assert.equal(
        await guest.evaluate(
          (n) => window.__kubb.game.names.valid("player", n).ok,
          rolled,
        ),
        true,
      );
      assert.equal(
        await guest.textContent("[data-test=welcome-you] .you-caption"),
        "You will be",
      );
      assert.equal(
        await guest.locator("[data-test=welcome] [data-test*=prev]").count(),
        0,
      );
      await guest.click("[data-test=welcome-name-shuffle]");
      await guest.waitForFunction(
        (r) =>
          document.querySelector("[data-test=welcome-name-text]")
            ?.textContent !== r,
        rolled,
      );
      const picked = await text(guest, "welcome-name-text");
      // the buttons: JOIN THE GAME the one go, JUST WATCH and HOW TO THROW quiet,
      // each at least 44 px tall to a finger
      const kinds = await guest.$$eval("[data-test=welcome] .btn", (bs) =>
        bs.map((b) => ({
          t: b.dataset.test,
          go: b.classList.contains("go"),
          quiet: b.classList.contains("quiet"),
          h: b.getBoundingClientRect().height,
        })),
      );
      assert.deepEqual(
        kinds.filter((k) => k.go).map((k) => k.t),
        ["welcome-join"],
      );
      for (const t of ["welcome-watch", "welcome-howto"])
        assert.ok(kinds.find((k) => k.t === t).quiet, t);
      assert.ok(
        kinds.every((k) => k.h >= 44),
        JSON.stringify(kinds),
      );
      // HOW TO THROW, and back to the welcome
      await guest.click("[data-test=welcome-howto]");
      await guest.waitForSelector("[data-test=howto]");
      await guest.click("[data-test=howto-close]");
      await guest.waitForSelector("[data-test=welcome]");
      // JOIN THE GAME: the lobby, under the name picked; the host sees it
      await guest.click("[data-test=welcome-join]");
      await guest.waitForSelector("[data-test=lobby]");
      assert.equal(await visible(guest, "welcome"), false);
      assert.equal(await text(guest, "lobby-name-text"), picked);
      await guest.click("[data-test=join-B]");
      await host.waitForFunction(
        (n) =>
          [
            ...document.querySelectorAll("[data-test=team-B] .member-name"),
          ].some((e) => e.textContent === n),
        picked,
        { timeout: 10000 },
      );
      assert.deepEqual([...host.errors, ...guest.errors], []);
    } finally {
      await host.context().close();
      await guest.context().close();
    }
  },
);

browserTest(
  "a device that has played goes straight to the lobby; so does a new host; JUST WATCH watches",
  async () => {
    const code = makePitchCode();
    // a host new to the game made this pitch: no welcome for them
    const host = await arrive(code, { name: "Cheerful Cedar" });
    const back = await arrive(code, { name: "Plucky Plum", throwsMade: 2 });
    const fresh = await arrive(code, {});
    try {
      await host.waitForSelector("[data-test=lobby]");
      assert.equal(await visible(host, "welcome"), false, "the host");
      await back.waitForSelector("[data-test=lobby]");
      assert.equal(await visible(back, "welcome"), false, "a returning device");
      // JUST WATCH: the same link as an observer
      await fresh.waitForSelector("[data-test=welcome]");
      await fresh.click("[data-test=welcome-watch]");
      await fresh.waitForURL(/[?&]observe=1/);
      await fresh.waitForSelector("body[data-ready='1']");
      assert.equal(
        await fresh.evaluate(() => window.__kubb.pitch?.observe),
        true,
      );
      assert.deepEqual([...host.errors, ...back.errors], []);
    } finally {
      await host.context().close();
      await back.context().close();
      await fresh.context().close();
    }
  },
);
