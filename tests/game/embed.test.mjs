// The embed, /e/<code> (src/embed/embed.js), in a real browser inside an iframe on
// a page of another origin: a kept replay plays read only, without sound, with the
// score sheet closed, while at least half of it is in view; a match in play, a
// waiting pitch and a pitch with nothing to show are quiet cards. The pages
// function's state block is written in by the preview's stand-in for it.
// Skipped with a notice when Playwright's Chromium is not installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { chromium } from "playwright";
import { serve } from "./browser.mjs";
import { startPitchServer } from "../../tools/pitch-dev.mjs";
import { injectPreview, pitchState } from "../../backend/pages/pitch.mjs";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/embed.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

const REPLAY = fs.readFileSync(
  "tests/fixtures/replay-north-south.json",
  "utf8",
);
const IN_PLAY = fs.readFileSync("tests/fixtures/snap-in-play.json", "utf8");
const CODES = {
  replay: "rrrrrrrr",
  playing: "pppppppp",
  waiting: "wwwwwwww",
  rematch: "mmmmmmmm", // waiting again, the last match's replay still kept
  older: "kkkkkkkk", // finished, but the replay kept is the match before
  over: "vvvvvvvv", // finished, its replay not kept
  none: "nnnnnnnn",
};
// The pitch's records as the pages function reads them (backend/pages/pitch.mjs
// readPitch): the state of its latest match and the kept replay of the last finished one.
const M = 1_763_700_000_000;
const R = JSON.parse(REPLAY);
const KEPT = { v: M + 1000, made: M, n: R.n, snap: R.snap, hash: R.hash };
const state = (fields) => ({ v: 5, made: M, n: 1, seq: 1, ...fields });
// No record says "waiting" any more (the pitch server pushes no lobby), but the embed
// still has its card for a state that says so.
const WAITING = { state: "waiting", v: 5 };
const STATES = {
  [CODES.replay]: pitchState({ kept: KEPT }),
  [CODES.playing]: pitchState({
    state: state({ over: false, snap: IN_PLAY }),
  }),
  [CODES.waiting]: WAITING,
  [CODES.rematch]: WAITING,
  [CODES.older]: pitchState({
    state: state({ over: true, n: R.n + 1, snap: R.snap, hash: R.hash }),
    kept: KEPT,
  }),
  [CODES.over]: pitchState({
    state: state({ over: true, snap: R.snap }),
    kept: null,
  }),
  [CODES.none]: pitchState({}),
};

// requestAnimationFrame stops in a frame out of view, so waits poll on a timer
const POLL = { polling: 100, timeout: 10000 };

let env, rooms, hostServer, embedder, hosted;
before(async () => {
  if (!available) return;
  rooms = await startPitchServer();
  hostServer = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(hosted);
  });
  await new Promise((r) => hostServer.listen(0, "127.0.0.1", r));
  embedder = `http://127.0.0.1:${hostServer.address().port}/`;
  // the kept replay in the api's store as the pitch's pushes leave it: the final
  // snapshot and the kept half (backend/api/memory-store.mjs putFinal, putKept)
  const { snap, ...half } = R;
  const exp = Math.floor(Date.now() / 1000) + 3600;
  for (const code of [CODES.replay, CODES.rematch, CODES.older]) {
    const at = { made: KEPT.made, n: KEPT.n, exp };
    await rooms.api.store.putFinal(code, { ...at, snap });
    await rooms.api.store.putKept(code, {
      ...at,
      v: KEPT.v,
      data: JSON.stringify(half),
      hash: KEPT.hash,
    });
    assert.ok(await rooms.api.store.getReplay(code), code);
  }
  env = await serve({
    build: true,
    page: (html, { uri, query }) => {
      const code = query?.pitch?.value;
      if (uri !== "/embed/index.html" || !STATES[code]) return html;
      return injectPreview(html, {
        code,
        s: STATES[code],
        path: `/e/${code}`,
        embed: true,
      });
    },
  });
});
after(async () => {
  if (env) await env.close();
  if (rooms) await rooms.close();
  if (hostServer) await new Promise((r) => hostServer.close(r));
});

// A page of another origin (a second server on 127.0.0.1: `*` in frame-ancestors
// matches network schemes only, so about:blank is refused, and Chrome keeps a
// public origin from framing loopback) with the embed's snippet in it, below a
// spacer when `below`, so the frame starts out of view.
async function host(code, { below = false } = {}) {
  const ctx = await env.browser.newContext({
    viewport: { width: 1000, height: 700 },
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  const src = `${env.base}/e/${code}?pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`;
  hosted = `<!doctype html><body style="margin:0">
${below ? '<div style="height:2000px">above</div>' : ""}
<iframe id="kubb" src="${src}" title="A match of Kubb: Throwing Wood" width="100%" style="aspect-ratio: 16 / 10; border: 0;" loading="lazy" allow=""></iframe>
<div style="height:2000px">below</div></body>`;
  await page.goto(embedder);
  if (below) await page.evaluate(() => window.scrollTo(0, 1500));
  const frame = await (await page.waitForSelector("#kubb")).contentFrame();
  await frame.waitForSelector("body[data-ready='1']", { timeout: 30000 });
  return { page, frame, ctx };
}

browserTest(
  "a kept replay plays in the frame, read only and silent",
  async () => {
    const { page, frame, ctx } = await host(CODES.replay);
    assert.equal(await frame.getAttribute("body", "data-embed"), "replay");
    await frame.waitForSelector("[data-test=replay-bar]");
    // the observer says whether it is in view on its first callback, a frame or so on
    await frame.waitForFunction(
      () => window.__kubb.embed.player.playing,
      null,
      POLL,
    );
    const seen = await frame.evaluate(() => {
      const { game, player } = window.__kubb.embed;
      return {
        sound: game.sound,
        mayAct: game.seat.mayAct("A") || game.seat.mayAct("B"),
        sides: game.seat.sides.length,
        playing: player.playing,
        wide: game.wide,
        sheetHidden: document.querySelector(".replay-sheet").hidden,
        menu: !!document.querySelector("[data-test=menu]"),
        embedButton: !!document.querySelector("[data-test=replay-embed]"),
        link: (() => {
          const a = document.querySelector("[data-test=embed-link]");
          return [a.getAttribute("href"), a.target, a.rel, a.textContent];
        })(),
      };
    });
    assert.equal(seen.sound, null);
    assert.equal(seen.mayAct, false);
    assert.equal(seen.sides, 0);
    assert.equal(seen.playing, true, "plays when in view");
    assert.equal(seen.sheetHidden, true, "the score sheet starts closed");
    assert.equal(seen.menu, false);
    assert.equal(seen.embedButton, false);
    assert.deepEqual(seen.link, [
      `/p/${CODES.replay}`,
      "_blank",
      "noopener",
      "Kubb: Throwing Wood ↗",
    ]);
    // the sheet opens on asking
    await frame.click("[data-test=replay-sheet-toggle]");
    assert.equal(
      await frame.evaluate(
        () => document.querySelector(".replay-sheet").hidden,
      ),
      false,
    );
    // the throws move on
    await frame.waitForFunction(
      () => window.__kubb.embed.game.engine.replayInfo().i > 0,
      null,
      { timeout: 20000 },
    );
    // nothing joined the pitch: an embed only reads the kept replay
    assert.equal(rooms.pitch(CODES.replay), null);
    assert.deepEqual(page.errors, []);
    await ctx.close();
  },
);

browserTest(
  "it holds when scrolled away and plays when half in view",
  async () => {
    const { page, frame, ctx } = await host(CODES.replay, { below: true });
    await frame.waitForSelector("[data-test=replay-bar]");
    const playing = () =>
      frame.evaluate(() => window.__kubb.embed.player.playing);
    await page.evaluate(() => window.scrollTo(0, 2000));
    await frame.waitForFunction(
      () => window.__kubb.embed.player.playing,
      null,
      POLL,
    );
    // away: held
    await page.evaluate(() => window.scrollTo(0, 0));
    await frame.waitForFunction(
      () => !window.__kubb.embed.player.playing,
      null,
      POLL,
    );
    // a quarter in view is not half
    const h = await page.evaluate(
      () => document.getElementById("kubb").getBoundingClientRect().height,
    );
    await page.evaluate((y) => window.scrollTo(0, y), 2000 - 700 + h * 0.25);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await playing(), false);
    await page.evaluate((y) => window.scrollTo(0, y), 2000 - 700 + h * 0.75);
    await frame.waitForFunction(
      () => window.__kubb.embed.player.playing,
      null,
      POLL,
    );
    // a pause the viewer chose stays a pause when scrolled away and back
    await page.evaluate(() => window.scrollTo(0, 2000));
    await frame.click("[data-test=replay-play]", { timeout: 10000 });
    assert.equal(await playing(), false);
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 300));
    await page.evaluate(() => window.scrollTo(0, 2000));
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await playing(), false);
    await ctx.close();
  },
);

browserTest(
  "a match in play, a waiting pitch and nothing to show are quiet cards",
  async () => {
    for (const [code, state, title] of [
      [CODES.playing, "playing", "Match in progress"],
      [CODES.waiting, "waiting", "Waiting for players"],
      [CODES.rematch, "waiting", "Waiting for players"],
      [CODES.over, "over", "Final: Lucky Larch 1, Mighty Maple 0"],
      [CODES.older, "over", "Final: Lucky Larch 1, Mighty Maple 0"],
      [CODES.none, "none", "No match here"],
    ]) {
      const { frame, ctx } = await host(code);
      const card = await frame.waitForSelector("[data-test=embed-card]");
      assert.equal(await card.getAttribute("data-state"), state, code);
      const h2 = await frame.textContent("[data-test=embed-card] h2");
      if (state === "over") assert.match(h2, /^Final: [\w ]+ 1, [\w ]+ 0$/);
      else assert.equal(h2, title, code);
      const go = await frame.getAttribute("[data-test=embed-card] a", "href");
      assert.equal(go, `/p/${code}`);
      // no engine, no Game: a card needs neither
      assert.equal(
        await frame.evaluate(() => !!window.__kubb.embed.game),
        false,
      );
      await ctx.close();
    }
  },
);

browserTest("only /e/ may be framed", async () => {
  const embed = await fetch(`${env.base}/e/${CODES.replay}`);
  assert.equal(embed.headers.get("x-frame-options"), null);
  assert.match(
    embed.headers.get("content-security-policy"),
    /frame-ancestors \*$/,
  );
  const pitch = await fetch(`${env.base}/p/${CODES.replay}`);
  assert.equal(pitch.headers.get("x-frame-options"), "DENY");
  assert.match(
    pitch.headers.get("content-security-policy"),
    /frame-ancestors 'none'$/,
  );
});
