// The two levels in a real browser (src/game/throw-level.js): the level you throw at
// is this device's, set in MENU only; the computer's is a match option ("Computer
// level", engine 0.9 on), on the solo card and, set by the host, in a pitch's lobby.
// Skipped with a notice when Playwright's Chromium is not installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, open, waitPhase, VIEWPORTS } from "./browser.mjs";
import { startRoomsServer } from "../../tools/rooms-dev.mjs";
import { makeRoomCode } from "../../src/net/room.js";
import { memoryReporter } from "../../backend/rooms/reports.mjs";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/levels-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

let env, rooms;
before(async () => {
  if (!available) return;
  rooms = await startRoomsServer({ port: 0, report: memoryReporter() });
  env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
  if (rooms) await rooms.close();
});

// The running match's newMatch options, from the Game's engine.
const matchOpts = (page) =>
  page.evaluate(() => JSON.parse(window.__kubb.game.engine.snapshot()).opts);

browserTest(
  "solo on 0.9: the Computer level row sets the computer, you throw at MENU's level",
  async () => {
    // a device from before: its solo card's Level row said Pro, no level of its own
    const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1", "desktop", {
      prefs: { solo: { name: "Birch", level: "pro", wind: "off" } },
    });
    try {
      await page.waitForSelector("[data-test=options]");
      // nobody's level resets: the old choice is the device's and the computer's
      assert.equal(await page.evaluate(() => window.__kubb.game.level), "pro");
      assert.equal(
        await page.textContent("[data-test=solo-level] .opt-value"),
        "Throwing at Pro.",
      );
      const checked = (key) =>
        page.getAttribute(
          `[data-test=solo-opt-${key}] [aria-checked=true]`,
          "data-value",
        );
      assert.equal(await checked("computer"), "pro");
      assert.equal(
        await page.textContent("[data-test=solo-opt-computer] .opt-label"),
        "Computer level",
      );
      // MENU, opened from the card, changes the device's level; the card follows
      await page.click("[data-test=solo-level-menu]");
      await page.waitForSelector("[data-test=menu-card]");
      assert.equal(
        await page.textContent("[data-test=menu-level] .opt-note"),
        "A change applies from your next throw.",
      );
      await page.click("[data-test=menu-level] .seg-btn:has-text('Club')");
      await page.keyboard.press("Escape");
      assert.equal(
        await page.textContent("[data-test=solo-level] .opt-value"),
        "Throwing at Club.",
      );
      await page.click("[data-test=solo-opt-computer] [data-value=beginner]");
      await page.click("[data-test=start]");
      await waitPhase(page, "aim", 15000);
      const o = await matchOpts(page);
      assert.equal(o.computer, "beginner", "a game setting since 0.9");
      assert.deepEqual(
        [o.teams.A.players[0].level, o.teams.B.players[0].level],
        ["club", "beginner"],
      );
      const saved = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("kubb:solo")),
      );
      assert.equal(saved.computer, "beginner");
      assert.equal(saved.level, undefined, "the card no longer keeps a level");
      assert.equal(
        await page.evaluate(() =>
          JSON.parse(localStorage.getItem("kubb:level")),
        ),
        "club",
      );
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

async function join(code, name, level) {
  const ctx = await env.browser.newContext(VIEWPORTS.desktop);
  await ctx.addInitScript(
    (l) => localStorage.setItem("kubb:level", JSON.stringify(l)),
    level,
  );
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") page.errors.push(m.text());
  });
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(
    `${env.base}/p/${code}?nohowto=1&rooms=${encodeURIComponent(rooms.url)}`,
  );
  await page.waitForSelector("body[data-ready='1']", { timeout: 30000 });
  await page.waitForSelector("[data-test=lobby]");
  await page.fill("[data-test=lobby-name]", name);
  await page.press("[data-test=lobby-name]", "Enter");
  await page.waitForFunction(
    () => window.__kubb.pitch?.state().status === "open",
  );
  return page;
}

browserTest(
  "a pitch on 0.9: the host sets the computer's level, the computer throws at it",
  async () => {
    const code = makeRoomCode();
    const host = await join(code, "Hanna", "beginner");
    const guest = await join(code, "Ola", "pro");
    try {
      // no level picker in the lobby: the line says MENU's
      assert.equal(
        await host.textContent("[data-test=lobby-level] .opt-value"),
        "Throwing at Beginner.",
      );
      assert.equal(
        await host.locator("[data-test=lobby-level] .seg").count(),
        0,
      );
      await host.click("[data-test=join-A]");
      await host.waitForSelector("[data-test=lobby-opt-computer] .seg");
      await host.click("[data-test=lobby-opt-computer] [data-value=pro]");
      await guest.waitForFunction(
        () =>
          document.querySelector("[data-test=lobby-opt-computer] .opt-value")
            ?.textContent === "Pro",
        null,
        { timeout: 20000, polling: 50 },
      );
      assert.equal(
        await guest.textContent("[data-test=lobby-opt-computer] .opt-label"),
        "Computer level",
      );
      await host.waitForFunction(
        () => window.__kubb.pitch.room.doc?.settings?.computer === "pro",
        null,
        { timeout: 20000, polling: 50 },
      );
      const doc = await host.evaluate(() => window.__kubb.pitch.room.doc);
      assert.deepEqual(doc.settings, { computer: "pro" });
      assert.equal(doc.options.computer, undefined, "not one of the five");
      // the host's choice is remembered for its next pitch
      assert.equal(
        await host.evaluate(
          () => JSON.parse(localStorage.getItem("kubb:pitchOptions")).computer,
        ),
        "pro",
      );
      await host.click("[data-test=lobby-start]");
      await guest.waitForFunction(
        () => window.__kubb.pitch.mode === "match",
        null,
        {
          timeout: 20000,
        },
      );
      const setup = await host.evaluate(
        () => window.__kubb.pitch.room.doc.match.setup,
      );
      assert.equal(setup.computer, "pro");
      for (const page of [host, guest]) {
        const o = await matchOpts(page);
        assert.equal(o.cpu.join(), "B");
        assert.deepEqual(
          [o.teams.A.players[0].level, o.teams.B.players[0].level],
          ["beginner", "pro"],
          "Hanna throws at her device's level, the computer at the host's choice",
        );
      }
      for (const p of [host, guest]) assert.deepEqual(p.errors, []);
    } finally {
      await Promise.all([host, guest].map((p) => p.context().close()));
    }
  },
);
