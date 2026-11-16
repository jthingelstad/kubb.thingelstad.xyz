// The game client in a real browser: Playwright's Chromium against the
// `npm run build` output, served by tools/preview.mjs on a free 127.0.0.1
// port (tests/game/browser.mjs). Skipped with a notice when Chromium is not
// installed (npx playwright install chromium).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import {
  serve,
  open,
  state,
  swing,
  sweep,
  waitPhase,
  watchThrows,
  dialGeometry,
} from "./browser.mjs";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

let env;
before(async () => {
  if (available) env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
});

// A swing at the middle of the power band, released on the plan's release
// mark. The Playwright mouse and CDP touch need two animation frames a step
// (a round trip each), so the flick is given twice the per-frame speed a
// hand gives (docs/CLIENT.md "Swing feel").
async function throwOnce(page, opts = {}) {
  const p = (await state(page)).plan;
  assert.ok(p, "an aim plan");
  const arms = sweep({
    back: (p.powerLo + p.powerHi) / 2,
    stop: p.release,
    backDps: 900,
    flickDps: 3600,
  });
  await swing(page, arms, opts);
}

browserTest("practice loads with no console errors", async () => {
  const page = await open(env, "/practice/?nohowto=1");
  await waitPhase(page, "aim", 10000);
  const s = await state(page);
  assert.equal(s.phase, "aim");
  assert.ok(s.dial, "the dial is drawn");
  assert.equal(
    await page.locator("[data-test=loading]").count(),
    0,
    "the loading card is gone",
  );
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

browserTest(
  "a mouse swing on the dial throws and returns to aiming",
  async () => {
    const page = await open(env, "/practice/?nohowto=1");
    await waitPhase(page, "aim", 10000);
    await watchThrows(page);
    await throwOnce(page);
    await waitPhase(page, "play", 5000);
    await waitPhase(page, "aim", 20000);
    const throws = await page.evaluate(() => window.__throws);
    assert.equal(throws.length, 1);
    assert.equal(throws[0].local, true);
    assert.ok(throws[0].result, "the throw has a result");
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },
);

browserTest(
  "dragging the target circle moves the engine's target",
  async () => {
    const page = await open(env, "/practice/?nohowto=1");
    await waitPhase(page, "aim", 10000);
    const before = await page.evaluate(() => window.__kubb.engine.aimState());
    const at = await page.evaluate(() => {
      const g = window.__kubb.game;
      return g.screenOf(g.out.aim.marker);
    });
    assert.ok(at, "the circle is on the screen");
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++)
      await page.mouse.move(at.x - i * 12, at.y + i * 4);
    await page.mouse.up();
    const after = await page.evaluate(() => window.__kubb.engine.aimState());
    assert.notDeepEqual(after, before, "the aim state changed");
    const s = await state(page);
    assert.equal(s.phase, "aim", "a drag on the circle does not throw");
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },
);

browserTest(
  "a solo match plays your throw, the computer's WATCH and a hand-off",
  async () => {
    const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1");
    await page.click("[data-test=start]");
    await page.waitForSelector("[data-test=handoff]");
    await page.click("[data-test=handoff-go]");
    await watchThrows(page);
    // our two batons
    for (let i = 0; i < 2; i++) {
      await waitPhase(page, "aim", 10000);
      await throwOnce(page);
      await waitPhase(page, "play", 5000);
      await page.evaluate(() => window.__kubb.game.skip());
    }
    // the computer's turn: WATCH
    await page.waitForFunction(() => window.__kubb.game.need?.cpu, null, {
      timeout: 20000,
    });
    await page.waitForFunction(
      () =>
        document.querySelector("[data-test=status]")?.textContent === "WATCH",
      null,
      { timeout: 5000 },
    );
    // play on (skipping playback, raising automatically) until a hand-off
    // card gives the pitch back to us
    const deadline = Date.now() + 90000;
    let handed = false;
    while (Date.now() < deadline && !handed) {
      handed = await page.evaluate(() => {
        const g = window.__kubb.game;
        const card = document.querySelector("[data-test=handoff]");
        if (card && g.need && !g.need.cpu) return true;
        if (g.phase === "play") g.skip();
        const go = document.querySelector(
          "[data-test=handoff-go], [data-test=pass] .btn, [data-test=settle] .btn",
        );
        if (go && g.need?.cpu) go.click();
        if (g.phase === "raise" && g.mayAct(g.need))
          document.querySelector("[data-test=raise-auto]")?.click();
        if (g.phase === "punish" && g.mayAct(g.need)) g.punish();
        return false;
      });
      if (!handed) await page.waitForTimeout(100);
    }
    assert.ok(handed, "a hand-off card back to us");
    const throws = await page.evaluate(() => window.__throws);
    assert.ok(throws.filter((t) => t.local).length >= 2, "our throws");
    assert.ok(
      throws.some((t) => !t.local),
      "the computer's throws",
    );
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },
);

browserTest(
  "watching the computer: both sides throw, in a hidden tab too, and the next match starts by itself",
  async () => {
    const page = await open(env, "/p/abcdefgh?watch=1");
    assert.equal(await page.locator("[data-test=options]").count(), 0);
    await watchThrows(page);
    await page.waitForFunction(() => window.__kubb.game.need?.cpu, null, {
      timeout: 10000,
    });
    // a throw from each side with nobody touching anything (playback skipped)
    const sides = new Set();
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline && sides.size < 2) {
      const s = await page.evaluate(() => {
        const g = window.__kubb.game;
        if (g.phase === "play") g.skip();
        return { side: g.need?.side, card: !!document.querySelector(".card") };
      });
      assert.equal(s.card, false, "no card waits for anyone");
      if (s.side) sides.add(s.side);
      await page.waitForTimeout(100);
    }
    assert.equal(sides.size, 2, "both teams throw");
    assert.ok((await page.evaluate(() => window.__throws.length)) >= 2);

    // hidden: the timer steps it, drawing nothing
    const before = await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      return window.__throws.length;
    });
    assert.ok(await page.evaluate(() => !!window.__kubb.game.hiddenTimer));
    await page.waitForFunction((n) => window.__throws.length >= n + 2, before, {
      timeout: 30000,
    });
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(
      await page.evaluate(() => window.__kubb.game.hiddenTimer),
      null,
    );

    // the end: resign one side, the winner card, then the next match by itself
    await page.evaluate(() => {
      window.__kubb.watchTune.nextMs = 1500;
      window.__kubb.game.resign("A");
    });
    while (!(await page.locator("[data-test=winner]").count())) {
      await page.evaluate(() => {
        const g = window.__kubb.game;
        if (g.phase === "play") g.skip();
      });
      await page.waitForTimeout(100);
    }
    const over = await page.evaluate(() => window.__kubb.game.need);
    assert.equal(over.kind, "over");
    assert.ok(over.file?.text, "the game file");
    assert.equal(await page.locator("[data-test=winner-note]").count(), 1);
    await page.waitForSelector("[data-test=winner]", {
      state: "detached",
      timeout: 5000,
    });
    const next = await page.evaluate(() => window.__kubb.game.need);
    assert.equal(next.kind, "throw");
    assert.equal(next.turn, 1, "a new match");
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },
);

browserTest("a portrait phone throws by touch", async () => {
  const page = await open(env, "/practice/?nohowto=1", "portrait");
  await waitPhase(page, "aim", 10000);
  const g = await dialGeometry(page);
  assert.ok(g.cy < 844 && g.cx > 100 && g.cx < 290, "the dial is lower centre");
  await watchThrows(page);
  await throwOnce(page, { touch: true });
  await waitPhase(page, "play", 5000);
  await waitPhase(page, "aim", 20000);
  const throws = await page.evaluate(() => window.__throws);
  assert.equal(throws.length, 1);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});
