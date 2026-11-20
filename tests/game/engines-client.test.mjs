// A finished match looked back at on its own engine in a real browser
// (docs/ENGINES.md): the embed's replay, a shared match's WATCH REPLAY and its score
// sheet. The page's config is given another engine for these tests besides the two
// the site carries ("0.6", the vendored sources with only the version changed, made in a
// temporary directory and served by the test), and the kept replays name 0.6 or an
// engine the page does not carry. Both engines play alike: what is checked is which
// engine each path runs, and that the Game is back on the newest after.
// Skipped with a notice when Playwright's Chromium is not installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { serve } from "./browser.mjs";
import { startRoomsServer } from "../../tools/rooms-dev.mjs";
import { bundleText } from "../../tools/lua-bundle.mjs";
import { injectPreview, pitchState } from "../../backend/pages/pitch.mjs";
import { writeEngineTree } from "../engine/engine-fixture.mjs";

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
const OLDER_URL = "/assets/lua-sources-0.6-fixture.json";
const CODES = {
  older: "kkkkmmmm", // embed: a replay of 0.6, carried
  unknown: "uuuummmm", // embed: a replay of 0.5, not carried
  sealed: "sssskkkk", // a shared match of 0.6
};
const withEngine = (engine) => JSON.stringify({ ...REPLAY, engine });

// The page config with a second engine in its engines map.
function addOlder(html) {
  return html.replace(
    /(<script type="application\/json" id="kubb-config">)([^<]*)(<\/script>)/,
    (_, open, json, close) => {
      const c = JSON.parse(json);
      c.engines = {
        ...c.engines,
        0.6: { version: "0.6.9", luaUrl: OLDER_URL },
      };
      return open + JSON.stringify(c) + close;
    },
  );
}

let env, rooms, olderDir, olderText;
before(async () => {
  if (!available) return;
  olderDir = fs.mkdtempSync(path.join(os.tmpdir(), "kubb-older-engine-"));
  writeEngineTree(olderDir, "0.6.9");
  olderText = bundleText(olderDir).text;
  rooms = await startRoomsServer({ port: 0 });
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const keep = (code, data) =>
    rooms.store.putReplay(code, { v: 9, t: Date.now(), data, exp });
  await keep(CODES.older, withEngine("0.6"));
  await keep(CODES.unknown, withEngine("0.5"));
  await rooms.store.putRoom(
    CODES.sealed,
    { host: null, members: {}, sealed: true, rev: 1, exp },
    0,
  );
  await keep(CODES.sealed, withEngine("0.6"));
  env = await serve({
    build: true,
    page: (html, { uri, query }) => {
      const code = query?.pitch?.value;
      if (uri === "/embed/index.html" && code)
        return addOlder(
          injectPreview(html, {
            code,
            s: pitchState({ doc: null, replay: withEngine("0.6") }),
            path: `/e/${code}`,
            embed: true,
          }),
        );
      if (uri === "/pitch/index.html") return addOlder(html);
      return html;
    },
  });
});
after(async () => {
  if (env) await env.close();
  if (rooms) await rooms.close();
  if (olderDir) fs.rmSync(olderDir, { recursive: true, force: true });
});

async function open(url) {
  const ctx = await env.browser.newContext({
    viewport: { width: 1200, height: 760 },
  });
  await ctx.route(`**${OLDER_URL}`, (route) =>
    route.fulfill({ contentType: "application/json", body: olderText }),
  );
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(`${env.base}${url}`);
  await page.waitForSelector("body[data-ready='1']", { timeout: 30000 });
  return { page, ctx };
}

const rq = () => `rooms=${encodeURIComponent(rooms.url)}`;

browserTest(
  "an embed plays a carried engine's match on that engine, another on the newest",
  async () => {
    {
      const { page, ctx } = await open(`/e/${CODES.older}?${rq()}`);
      const seen = await page.evaluate(() => ({
        state: window.__kubb.embed.state,
        playing: window.__kubb.embed.game.engine.version,
        older: window.__kubb.engines.loaded("0.6")?.version ?? null,
        newest: window.__kubb.engines.loaded("0.8")?.version ?? null,
      }));
      assert.deepEqual(seen, {
        state: "replay",
        playing: "0.6.9",
        older: "0.6.9",
        newest: "0.8.1",
      });
      assert.deepEqual(page.errors, []);
      await ctx.close();
    }
    {
      const { page, ctx } = await open(`/e/${CODES.unknown}?${rq()}`);
      const seen = await page.evaluate(() => ({
        playing: window.__kubb.embed.game.engine.version,
        older: window.__kubb.engines.loaded("0.6"),
      }));
      // not carried: the newest plays it, and the older engine is never fetched
      assert.deepEqual(seen, { playing: "0.8.1", older: null });
      assert.deepEqual(page.errors, []);
      await ctx.close();
    }
  },
);

browserTest(
  "a shared match of a carried engine: its replay and its score sheet on that engine",
  async () => {
    const { page, ctx } = await open(`/p/${CODES.sealed}?${rq()}&nohowto=1`);
    await page.waitForSelector("[data-test=winner]", { timeout: 30000 });
    assert.equal(
      await page.evaluate(() => window.__kubb.engines.loaded("0.6")),
      null,
      "nothing of 0.6 loads until it is looked at",
    );

    // SCORE SHEET: read from 0.6, set to the match's last snapshot
    await page.evaluate(async () => {
      const e = await window.__kubb.engines.loadEngine("0.6");
      const sheet = e.sheet.bind(e);
      window.__olderSheets = 0;
      e.sheet = () => (window.__olderSheets++, sheet());
    });
    await page.click("[data-test=winner-sheet]");
    await page.waitForSelector("[data-test=sheet-text]");
    const sheet = await page.evaluate(() => ({
      text: document.querySelector("[data-test=sheet-text]").textContent,
      read: window.__olderSheets,
      game: window.__kubb.game.engine.version,
    }));
    assert.match(sheet.text, /\[Win "Team B"\]/);
    assert.equal(sheet.read, 1);
    assert.equal(sheet.game, "0.8.1");
    await page.click("[data-test=sheet-back]");

    // WATCH REPLAY: the Game draws from 0.6 while it plays, and from the newest after
    await page.click("[data-test=watch-replay]");
    await page.waitForSelector("[data-test=replay-bar]");
    assert.equal(
      await page.evaluate(() => window.__kubb.game.engine.version),
      "0.6.9",
    );
    await page.click("[data-test=replay-close]");
    await page.waitForSelector("[data-test=winner]", { timeout: 30000 });
    assert.equal(
      await page.evaluate(() => window.__kubb.game.engine.version),
      "0.8.1",
    );
    assert.deepEqual(page.errors, []);
    await ctx.close();
  },
);

browserTest(
  "SCORE SHEET pressed after WATCH REPLAY, while the engine loads, leaves the replay playing",
  async () => {
    const { page, ctx } = await open(`/p/${CODES.sealed}?${rq()}&nohowto=1`);
    await page.waitForSelector("[data-test=winner]", { timeout: 30000 });
    // both pressed before 0.6 has loaded: the replay starts first, and the sheet must
    // not then set the engine it plays on to the match's last snapshot
    await page.evaluate(() => {
      window.__restores = 0;
      window.__kubb.engines.onLoad((e, mm) => {
        if (mm !== "0.6") return;
        const restore = e.restore.bind(e);
        e.restore = (...a) => (window.__restores++, restore(...a));
      });
      document.querySelector("[data-test=watch-replay]").click();
      document.querySelector("[data-test=winner-sheet]").click();
    });
    await page.waitForSelector("[data-test=replay-bar]");
    await page.waitForSelector("[data-test=sheet-text]");
    const seen = await page.evaluate(() => ({
      mode: window.__kubb.pitch.mode,
      playing: window.__kubb.game.engine.version,
      restores: window.__restores,
    }));
    assert.deepEqual(seen, { mode: "replay", playing: "0.6.9", restores: 0 });
    assert.deepEqual(page.errors, []);
    await ctx.close();
  },
);
