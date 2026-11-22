// Version admission through the real controller and the local pitch server
// (tools/pitch-dev.mjs). The
// existing multiplayer scenarios remain unchanged in multiplayer.test.mjs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, VIEWPORTS, played } from "./browser.mjs";
import { startPitchServer } from "../../tools/pitch-dev.mjs";
import { makePitchCode } from "../../src/net/pitch-client.js";

const available = fs.existsSync(chromium.executablePath());
const browserTest = available ? test : test.skip;
if (!available) console.log("# room-version: SKIPPED, no Playwright Chromium");
let env, rooms;
before(async () => {
  if (!available) return;
  rooms = await startPitchServer();
  env = await serve();
});
after(async () => {
  if (env) await env.close();
  if (rooms) await rooms.close();
});

async function join(code, kind = "desktop") {
  const context = await env.browser.newContext(VIEWPORTS[kind]);
  await played(context);
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type())) page.errors.push(m.text());
  });
  await page.goto(
    `${env.base}/p/${code}?nohowto=1&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`,
  );
  await page.waitForFunction(
    () => window.__kubb?.pitch?.room.status === "open",
  );
  return page;
}

browserTest(
  "join advertises the engines; START refuses a mismatch until the other tab reloads",
  async () => {
    const code = makePitchCode();
    const host = await join(code);
    const guest = await join(code);
    try {
      await host.click("[data-test=join-A]");
      await guest.click("[data-test=join-B]");
      await host.waitForFunction(
        () => window.__kubb.pitch.room.doc?.teams.B.length === 1,
      );
      const newest = await guest.evaluate(() =>
        window.__kubb.engine.version.split(".").slice(0, 2).join("."),
      );
      await guest.waitForFunction(
        (mm) => window.__kubb.pitch.room.me.engine === `${mm}+engines`,
        newest,
      );
      assert.deepEqual(
        await guest.evaluate(() => window.__kubb.pitch.room.me.engines),
        await guest.evaluate(() => window.__kubb.engines.carried()),
      );
      // an older tab of the guest's: a lone engine the host carries no longer
      await guest.evaluate(() => {
        window.__kubb.pitch.speak = () => {};
        window.__kubb.pitch.room.setMe({ engine: "0.3" });
      });
      await host.waitForFunction(() =>
        window.__kubb.pitch.room.members.some((m) => m.me.engine === "0.3"),
      );
      await host.waitForSelector("[data-test=lobby-engine]:not([hidden])");
      assert.match(
        await host.textContent("[data-test=lobby-engine]"),
        /has an older version of the game\. This pitch needs the newest version of the game\./,
      );
      await host.evaluate(() => window.__kubb.pitch.start());
      assert.equal(
        await host.evaluate(() => window.__kubb.pitch.room.doc.started),
        false,
      );
      await guest.reload();
      await host.waitForFunction(
        (mm) =>
          window.__kubb.pitch.room.members.some(
            (m) =>
              m.id !== window.__kubb.pitch.you &&
              m.connected &&
              m.me.engine === `${mm}+engines`,
          ),
        newest,
      );
      await host.waitForSelector("[data-test=lobby-engine]", {
        state: "hidden",
      });
      await host.click("[data-test=lobby-start]");
      await host.waitForFunction(
        (mm) => window.__kubb.pitch.room.doc.match?.engine === mm,
        newest,
      );
      await guest.waitForFunction(() => window.__kubb.pitch.mode === "match");
      assert.deepEqual(host.errors, []);
      assert.deepEqual(guest.errors, []);
    } finally {
      await host.context().close();
      await guest.context().close();
    }
  },
);

for (const [engine, kind, seated, text, reload] of [
  [
    "1.0",
    "desktop",
    true,
    "This pitch is playing on a newer version of the game. Reload the page to update.",
    true,
  ],
  [
    "0.3",
    "portrait",
    false,
    "This pitch is playing on an older version of the game, which this page no longer plays. This pitch needs the newest version of the game: the host must update to play.",
    false,
  ],
]) {
  browserTest(
    `a running ${engine} pitch refuses this client's seat and CPU control`,
    async () => {
      const page = await join(makePitchCode(), kind);
      try {
        // A match on a different engine, started on the local pitch server only (the
        // page's own `start` message, as an older or newer client's would be), then the
        // whole pitch asked for again. The second case is a host watching: it must not
        // run the CPU when it has no player on a team.
        await page.evaluate(
          async ({ engine, seated }) => {
            const { pitch, engine: e } = window.__kubb;
            e.newMatch({ seed: 6, cpu: "B" });
            const id = seated ? pitch.you : "other-member";
            const players = { A: [{ id, name: "Player 1" }], B: [] };
            const h = e.hash().hash;
            const r = await pitch.room.start({
              doc: {
                v: 1,
                teams: { A: [id], B: [] },
                started: true,
                n: 1,
                match: { n: 1, players, cpu: "B", host: pitch.you, engine },
              },
              n: 1,
              h,
              snap: e.snapshot(),
              meta: { v: 1, engine, players, cpu: "B" },
            });
            if (!r) throw new Error("the start was refused");
            pitch.room.resync();
          },
          { engine, seated },
        );
        await page.waitForSelector("[data-test=engine-differs]");
        assert.equal(
          await page.textContent("[data-test=engine-differs] p:not(.kicker)"),
          text,
        );
        assert.equal(
          await page
            .getByRole("button", { name: "RELOAD", exact: true })
            .count(),
          reload ? 1 : 0,
        );
        const blocked = await page.evaluate(() => ({
          control: window.__kubb.pitch.control,
          side: window.__kubb.game.localSide,
          mayAct: window.__kubb.game.mayAct(),
        }));
        assert.deepEqual(blocked, {
          control: { sides: [], cpu: false },
          side: null,
          mayAct: false,
        });
        if (reload) {
          await page
            .getByRole("button", { name: "RELOAD", exact: true })
            .click();
          await page.waitForSelector("[data-test=engine-differs]");
        }
        const fits = await page
          .locator("[data-test=engine-differs]")
          .evaluate((el) => {
            const r = el.getBoundingClientRect();
            return (
              r.left >= 0 &&
              r.right <= innerWidth &&
              r.top >= 0 &&
              r.bottom <= innerHeight
            );
          });
        assert.ok(fits, "the card fits the viewport");
        await page.getByRole("button", { name: "WATCH", exact: true }).click();
        assert.equal(
          await page.locator("[data-test=engine-differs]").count(),
          0,
        );
        // The render loop and controller clock repeatedly ask about seats and the
        // actor. Warm the caches, then count actual room calls over many frames.
        await page.waitForTimeout(300);
        await page.evaluate(() => {
          const e = window.__kubb.engine;
          const call = e.call.bind(e);
          window.__roomCalls = 0;
          e.call = (method, ...args) => {
            if (method.startsWith("pitch.")) window.__roomCalls++;
            return call(method, ...args);
          };
        });
        await page.waitForTimeout(700);
        assert.equal(
          await page.evaluate(() => window.__roomCalls),
          0,
          "no room bridge calls every frame or idle tick",
        );
        assert.deepEqual(page.errors, []);
      } finally {
        await page.context().close();
      }
    },
  );
}
