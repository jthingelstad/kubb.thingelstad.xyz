// A kept match made on an engine the site no longer carries, in a real browser
// (docs/ENGINES.md "Looking back at a match"; the owner, 2026-11-21: "Let's force all
// clients to the most recent engine"). The site carries the newest alone, so a replay of
// 0.9 (a finished pitch's, a shared match's, an embed's) cannot be played again: each
// place it can be opened says so in one sentence, with nothing broken around it, and a
// shared match's reel (a stored video, which needs no engine) is still offered.
// Skipped with a notice when Playwright's Chromium is not installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve } from "./browser.mjs";
import { startPitchServer } from "../../tools/pitch-dev.mjs";
import { injectPreview, pitchState } from "../../backend/pages/pitch.mjs";
import { OLD_REPLAY } from "../../src/replay/player.js";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/engines-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

const REPLAY = JSON.parse(
  fs.readFileSync("tests/fixtures/replay-north-south.json", "utf8"),
);
const CODES = {
  older: "kkkkmmmm", // a finished pitch whose kept replay is 0.9's
  sealed: "sssskkkk", // a shared match of 0.9
  current: "ccccmmmm", // a finished pitch on the newest
};

let env, rooms;
before(async () => {
  if (!available) return;
  rooms = await startPitchServer();
  const store = rooms.api.store;
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const { snap, hash, n } = REPLAY;
  const half = (engine) => {
    const { snap: _, ...rest } = { ...REPLAY, engine };
    return JSON.stringify(rest);
  };
  const keep = async (code, engine) => {
    await store.putFinal(code, { made: 1, n, snap, exp });
    await store.putKept(code, {
      made: 1,
      n,
      v: 9,
      data: half(engine),
      hash,
      exp,
    });
  };
  await keep(CODES.older, "0.9");
  await keep(CODES.current, REPLAY.engine);
  await store.keepShare(`fixture-${CODES.sealed}`, CODES.sealed, {
    state: {
      made: 9,
      n,
      seq: REPLAY.log.length,
      over: true,
      snap,
      hash,
      sealed: true,
      rev: 1,
      exp,
    },
    replay: { made: 9, n, v: 9, data: half("0.9"), snap, hash, exp },
  });
  env = await serve({
    build: true,
    page: (html, { uri, query }) => {
      const code = query?.pitch?.value;
      if (uri === "/embed/index.html" && code)
        return injectPreview(html, {
          code,
          s: pitchState({
            kept: { v: 5, made: 1, n, hash, snap },
          }),
          path: `/e/${code}`,
          embed: true,
        });
      return html;
    },
  });
});
after(async () => {
  if (env) await env.close();
  if (rooms) await rooms.close();
});

async function open(url) {
  const ctx = await env.browser.newContext({
    viewport: { width: 1200, height: 760 },
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(`${env.base}${url}`);
  await page.waitForSelector("body[data-ready='1']", { timeout: 30000 });
  return { page, ctx };
}

const rq = () =>
  `pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`;

browserTest(
  "an embed of a 0.9 match says it can no longer be replayed",
  async () => {
    const { page, ctx } = await open(
      `/e/${CODES.older}?api=${encodeURIComponent(rooms.apiUrl)}`,
    );
    await page.waitForSelector("[data-test=embed-card]");
    assert.equal(
      await page.getAttribute("[data-test=embed-card]", "data-state"),
      "old",
    );
    assert.match(
      await page.textContent("[data-test=embed-card]"),
      new RegExp(OLD_REPLAY.replace(".", "\\.")),
    );
    // the link to the pitch is there; no game was made for it
    assert.equal(await page.locator("[data-test=embed-card] a.btn").count(), 1);
    assert.equal(await page.evaluate(() => window.__kubb.embed.state), "old");
    assert.deepEqual(page.errors, []);
    await ctx.close();
  },
);

browserTest(
  "a shared match of 0.9: the one sentence, its reel, and HOME",
  async () => {
    const { page, ctx } = await open(`/p/${CODES.sealed}?${rq()}&nohowto=1`);
    await page.waitForSelector("[data-test=sealed-old]", { timeout: 30000 });
    assert.match(
      await page.textContent("[data-test=sealed-old]"),
      /no longer be replayed/,
    );
    assert.equal(
      await page
        .locator("[data-test=sealed-old] button:has-text('HIGHLIGHT REEL')")
        .count(),
      1,
    );
    assert.equal(
      await page
        .locator("[data-test=sealed-old] button:has-text('HOME')")
        .count(),
      1,
    );
    // the reel's card opens (its video, when made, needs no engine)
    await page.click(
      "[data-test=sealed-old] button:has-text('HIGHLIGHT REEL')",
    );
    await page.waitForSelector("[data-test=reel-card]");
    assert.equal(await page.evaluate(() => window.__kubb.pitch.mode), "gone");
    assert.deepEqual(page.errors, []);
    await ctx.close();
  },
);

browserTest(
  "a pitch's last match from 0.9: WATCH THE LAST MATCH says so, the lobby stays",
  async () => {
    const { page, ctx } = await open(`/p/${CODES.older}?${rq()}&nohowto=1`);
    await page.waitForSelector("[data-test=lobby]");
    await page.waitForSelector("[data-test=lobby-replay]:not([hidden])", {
      timeout: 30000,
    });
    await page.click("[data-test=lobby-replay]");
    await page.waitForSelector("[data-test=replay-refused]");
    assert.equal(
      await page.textContent("[data-test=replay-refused] p:not(.kicker)"),
      OLD_REPLAY,
    );
    await page.click("[data-test=replay-refused] button:has-text('OK')");
    // back to the lobby as it was: nothing broken
    await page.waitForSelector("[data-test=lobby]");
    assert.equal(await page.evaluate(() => window.__kubb.pitch.mode), "lobby");
    assert.deepEqual(page.errors, []);
    await ctx.close();
  },
);

browserTest(
  "a pitch's last match on the newest engine still plays",
  async () => {
    const { page, ctx } = await open(`/p/${CODES.current}?${rq()}&nohowto=1`);
    await page.waitForSelector("[data-test=lobby-replay]:not([hidden])", {
      timeout: 30000,
    });
    await page.click("[data-test=lobby-replay]");
    await page.waitForSelector("[data-test=replay-bar]");
    assert.equal(await page.evaluate(() => window.__kubb.pitch.mode), "replay");
    assert.deepEqual(page.errors, []);
    await ctx.close();
  },
);
