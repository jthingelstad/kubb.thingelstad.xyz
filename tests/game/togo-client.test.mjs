// The throw to go in a real browser (engine 1.4; the engine's docs/SESSION.md "The
// throw to go"): on by default on the solo card, a short card before this browser's
// own baton at the king, the baton aimed and thrown like any other, the computer's
// thrown blind, the two played back together and the verdict's words on the flag,
// then the match (or a second round). Off on the card, the match opens on the first
// throw's hand-off as before.
// Skipped with a notice when Playwright's Chromium is not installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, open, waitPhase, state, sweep, swing } from "./browser.mjs";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/togo-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

let env;
before(async () => {
  if (!available) return;
  env = await serve({ build: true, togo: true });
});
after(async () => {
  if (env) await env.close();
});

async function throwOnce(page) {
  const p = (await state(page)).plan;
  assert.ok(p, "an aim plan");
  await swing(
    page,
    sweep({
      back: (p.powerLo + p.powerHi) / 2,
      stop: p.release,
      backDps: 900,
      flickDps: 3600,
    }),
  );
}

const matchOpts = (page) =>
  page.evaluate(() => JSON.parse(window.__kubb.game.engine.snapshot()).opts);

for (const kind of ["desktop", "phone"])
  browserTest(
    `solo (${kind}): the throw to go is on, its card, the baton, the verdict, then the match`,
    async () => {
      const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1", kind, {
        prefs: { throwsMade: 5 },
      });
      try {
        await page.waitForSelector("[data-test=options]");
        assert.equal(
          await page.getAttribute(
            "[data-test=solo-opt-togo] [aria-checked=true]",
            "data-value",
          ),
          "on",
          "on by default",
        );
        await page.click("[data-test=start]");
        const o = await matchOpts(page);
        assert.equal(!!o.togo, true, "newMatch has togo");
        let saw = null;
        for (let round = 1; round <= 4; round++) {
          await page.waitForSelector("[data-test=togo]", { timeout: 15000 });
          assert.equal(
            await page.textContent("[data-test=togo-title]"),
            "Your turn",
          );
          assert.match(
            await page.textContent("[data-test=togo-line]"),
            round === 1 ? /^Throw to go\./ : /^Throw again\./,
          );
          await page.click("[data-test=togo-go]");
          await waitPhase(page, "aim", 10000);
          const s = await state(page);
          assert.equal(s.need.kind, "togo");
          assert.deepEqual(s.need.owe, ["A"], "the computer's is in, blind");
          // nothing of the computer's baton is drawn before ours is in
          const drawn = await page.evaluate(() =>
            (window.__kubb.game.items || [])
              .filter((i) => i.kind === "baton")
              .map((i) => i.id),
          );
          assert.deepEqual(drawn, [], "no baton on the pitch while aiming");
          await throwOnce(page);
          await waitPhase(page, "play", 10000);
          // the flag says who goes first, or to throw again
          await page.waitForFunction(
            () =>
              /GOES FIRST|THROW AGAIN/.test(
                document.querySelector("[data-test=flag]")?.textContent || "",
              ),
            null,
            { timeout: 20000 },
          );
          saw = await page.textContent("[data-test=flag]");
          await page.waitForFunction(
            () => window.__kubb.game.phase !== "play",
            null,
            { timeout: 30000 },
          );
          const n = (await state(page)).need;
          if (n.kind !== "togo") break;
        }
        assert.ok(saw, "a verdict");
        const n = (await state(page)).need;
        assert.notEqual(n.kind, "togo", "the match itself is on");
        const first = /GOES FIRST/.test(saw);
        assert.ok(first, `a side went first: ${saw}`);
        assert.deepEqual(page.errors, []);
      } finally {
        await page.context().close();
      }
    },
  );

browserTest(
  "solo: the throw to go off on the card opens on the first throw's hand-off",
  async () => {
    const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1", "desktop", {
      prefs: { throwsMade: 5 },
    });
    try {
      await page.waitForSelector("[data-test=options]");
      await page.click("[data-test=solo-opt-togo] [data-value=off]");
      await page.click("[data-test=start]");
      await page.waitForSelector("[data-test=handoff]", { timeout: 15000 });
      assert.equal(await page.locator("[data-test=togo]").count(), 0);
      const o = await matchOpts(page);
      assert.ok(!o.togo, "newMatch without togo");
      const saved = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("kubb:solo")),
      );
      assert.equal(saved.togo, "off", "kept on the device");
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);
