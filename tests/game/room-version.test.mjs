// Version admission through the real controller and local room server. The
// existing multiplayer scenarios remain unchanged in multiplayer.test.mjs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, VIEWPORTS } from "./browser.mjs";
import { startRoomsServer } from "../../tools/rooms-dev.mjs";
import { makeRoomCode } from "../../src/net/room.js";

const available = fs.existsSync(chromium.executablePath());
const browserTest = available ? test : test.skip;
if (!available) console.log("# room-version: SKIPPED, no Playwright Chromium");
let env, rooms;
before(async () => {
  if (!available) return;
  rooms = await startRoomsServer({ port: 0 });
  env = await serve();
});
after(async () => {
  if (env) await env.close();
  if (rooms) await rooms.close();
});

async function join(code, kind = "desktop") {
  const context = await env.browser.newContext(VIEWPORTS[kind]);
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type())) page.errors.push(m.text());
  });
  await page.goto(
    `${env.base}/p/${code}?nohowto=1&rooms=${encodeURIComponent(rooms.url)}`,
  );
  await page.waitForFunction(
    () => window.__kubb?.pitch?.room.status === "open",
  );
  return page;
}

browserTest(
  "join advertises the engine; START refuses a mismatch and asks an untagged tab to reload",
  async () => {
    const code = makeRoomCode();
    const host = await join(code);
    const guest = await join(code);
    try {
      await host.click("[data-test=join-A]");
      await guest.click("[data-test=join-B]");
      await host.waitForFunction(
        () => window.__kubb.pitch.room.doc?.teams.B.length === 1,
      );
      assert.equal(
        await guest.evaluate(() => window.__kubb.pitch.room.me.engine),
        await guest.evaluate(() =>
          window.__kubb.engine.version.split(".").slice(0, 2).join("."),
        ),
      );
      await guest.evaluate(() =>
        window.__kubb.pitch.room.setMe({ engine: "0.3" }),
      );
      await host.waitForFunction(() =>
        window.__kubb.pitch.room.members.some((m) => m.me.engine === "0.3"),
      );
      await host.click("[data-test=lobby-start]");
      await host.waitForSelector("[data-test=lobby-note]:not([hidden])");
      assert.match(
        await host.textContent("[data-test=lobby-note]"),
        /another version/,
      );
      assert.equal(
        await host.evaluate(() => window.__kubb.pitch.room.doc.started),
        false,
      );
      await guest.evaluate(() =>
        window.__kubb.pitch.room.setMe({ engine: null }),
      );
      await host.waitForFunction(() =>
        window.__kubb.pitch.room.members.some(
          (m) => m.id !== window.__kubb.pitch.you && !m.me.engine,
        ),
      );
      await guest.waitForSelector("[data-test=engine-differs]");
      assert.match(
        await guest.textContent("[data-test=engine-differs]"),
        /Reload to join/,
      );
      await host.click("[data-test=lobby-start]");
      await host.waitForSelector("[data-test=lobby-note]:not([hidden])");
      assert.equal(
        await host.evaluate(() => window.__kubb.pitch.room.doc.started),
        false,
      );
      await guest.getByRole("button", { name: "RELOAD", exact: true }).click();
      await host.waitForFunction(() =>
        window.__kubb.pitch.room.members.some(
          (m) =>
            m.id !== window.__kubb.pitch.you &&
            m.connected &&
            m.me.engine === window.__kubb.pitch.room.me.engine,
        ),
      );
      await host.click("[data-test=lobby-start]");
      await host.waitForFunction(
        () =>
          window.__kubb.pitch.room.doc.match?.engine ===
          window.__kubb.engine.version.split(".").slice(0, 2).join("."),
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
    "This pitch is playing on a newer version of Throwing Wood. Reload to join.",
    true,
  ],
  [
    "0.3",
    "portrait",
    false,
    "This pitch is playing on an older version of Throwing Wood. Ask the host to reload.",
    false,
  ],
]) {
  browserTest(
    `a running ${engine} pitch refuses this client's seat and CPU control`,
    async () => {
      const page = await join(makeRoomCode(), kind);
      try {
        // A different engine's document in the local server only. The second case is
        // a host watching: it must not run the CPU when it has no player on a team.
        await page.evaluate(
          async ({ engine, seated }) => {
            const { pitch, engine: e } = window.__kubb;
            e.newMatch({ seed: 6, cpu: "B" });
            const id = seated ? pitch.you : "other-member";
            await pitch.room.update(() => ({
              v: 1,
              teams: { A: [id], B: [] },
              started: true,
              n: 1,
              match: {
                n: 1,
                seq: 0,
                engine,
                players: { A: [{ id, name: "Player" }], B: [] },
                cpu: "B",
                snap: e.snapshot(),
                hash: e.hash().hash,
              },
            }));
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
            if (method.startsWith("room.")) window.__roomCalls++;
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
