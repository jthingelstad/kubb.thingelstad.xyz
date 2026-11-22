// Two players and an observer on one pitch, in three real browsers, against the pitch
// server run on this machine (docs/MULTIPLAYER.md): they complete a turn in step, and
// the observer's picture of the thrower's dial moves between the aim samples the pitch
// relays (src/net/aim.js), not only on them.
//
// The pitch server is tools/pitch-dev.mjs (the pitch core in Node) unless
// KUBB_E2E_PITCH and KUBB_E2E_API name another, such as `wrangler dev` from
// backend/pitch-server/ with tools/pitch-dev.mjs --api-only beside it (tools/dev.mjs
// starts exactly that pair). Skipped with a notice when Playwright's Chromium is missing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, sweep, swing, VIEWPORTS } from "./browser.mjs";
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
    "# tests/game/pitch-e2e.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

let env, local, pitchUrl, apiUrl;
before(async () => {
  if (!available) return;
  if (process.env.KUBB_E2E_PITCH && process.env.KUBB_E2E_API) {
    pitchUrl = process.env.KUBB_E2E_PITCH;
    apiUrl = process.env.KUBB_E2E_API;
  } else {
    local = await startPitchServer();
    pitchUrl = local.url;
    apiUrl = local.apiUrl;
  }
  env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
  if (local) await local.close();
});

async function open(code, name, { lobby = true, query = "" } = {}) {
  const ctx = await env.browser.newContext(VIEWPORTS.desktop);
  if (!lobby)
    await ctx.addInitScript(
      (n) => localStorage.setItem("kubb:name", JSON.stringify(n)),
      name,
    );
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") page.errors.push(m.text());
  });
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(
    `${env.base}/p/${code}?nohowto=1&pitchserver=${encodeURIComponent(pitchUrl)}&api=${encodeURIComponent(apiUrl)}${query}`,
  );
  await page.waitForSelector("body[data-ready='1']", { timeout: 30000 });
  if (lobby) {
    await page.waitForSelector("[data-test=lobby]");
    // the name a player picks in the lobby's name row
    await page.evaluate((n) => window.__kubb.game.setPlayerName(n), name);
  }
  await page.waitForFunction(
    () => window.__kubb.pitch?.state().status === "open",
    null,
    { timeout: 15000 },
  );
  return page;
}

const pst = (page) => page.evaluate(() => window.__kubb.pitch.state());

async function waitFor(page, fn, arg, ms = 20000) {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
  } catch (err) {
    const st = await page
      .evaluate(() => JSON.stringify(window.__kubb.pitch?.state()))
      .catch(() => "?");
    throw new Error(`waiting for ${String(fn).slice(0, 160)}\n${st}`, {
      cause: err,
    });
  }
}

async function inStep(pages, ms = 20000) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    last = await Promise.all(pages.map(pst));
    const h = last[0].docHash;
    if (
      h &&
      last.every(
        (s) =>
          s.hash === h &&
          s.docHash === h &&
          s.local.seq === s.docSeq &&
          !s.pending &&
          !s.queued,
      )
    )
      return last;
    await pages[0].waitForTimeout(100);
  }
  throw new Error(`not in step: ${JSON.stringify(last)}`);
}

async function myThrow(page, ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const ok = await page.evaluate(() => {
      const g = window.__kubb.game;
      const go = document.querySelector(
        "[data-test=handoff-go], [data-test=pass] .btn",
      );
      if (go && g.mayAct()) go.click();
      return (
        g.phase === "aim" && g.need?.kind === "throw" && g.mayAct() && !g.modal
      );
    });
    if (ok) return;
    await page.waitForTimeout(80);
  }
  throw new Error("never this browser's throw");
}

// A slow swing, so the watcher gets many aim samples to draw between.
async function slowThrow(page) {
  const p = await page.evaluate(() => window.__kubb.game.out.aim.plan);
  assert.ok(p, "an aim plan");
  await swing(
    page,
    sweep({
      back: (p.powerLo + p.powerHi) / 2,
      stop: p.release,
      backDps: 240,
      flickDps: 3600,
      hold: 20,
    }),
  );
}

async function settle(page) {
  await page.evaluate(() => {
    const g = window.__kubb.game;
    if (g.phase === "play") g.skip();
    if (g.phase === "raise" && g.mayAct())
      document.querySelector("[data-test=raise-auto]")?.click();
    if (g.phase === "punish" && g.mayAct()) g.punish();
    const go = document.querySelector(
      "[data-test=pass] .btn, [data-test=settle] .btn",
    );
    if (go && g.need?.cpu) go.click();
  });
}

// Note in the watcher every aim sample that arrives and every aim the game draws.
function watchAim(page) {
  return page.evaluate(() => {
    const p = window.__kubb.pitch;
    window.__aim = { samples: [], drawn: [] };
    const push = p.aimIn.push.bind(p.aimIn);
    p.aimIn.push = (e, at) => {
      const ok = push(e, at);
      if (ok) window.__aim.samples.push(e.d.s.arm);
      return ok;
    };
    const feed = window.__kubb.game.remoteFeed;
    window.__kubb.game.remoteFeed = () => {
      const s = feed();
      if (s && typeof s.arm === "number")
        window.__aim.drawn.push({ arm: s.arm, n: window.__aim.samples.length });
      return s;
    };
  });
}

browserTest(
  "two players and an observer complete a turn; the observer's dial moves between samples",
  async (t) => {
    const code = makePitchCode();
    const host = await open(code, "Happy Hazel");
    const guest = await open(code, "Gentle Ginkgo");
    await host.click("[data-test=join-A]");
    await guest.click("[data-test=join-B]");
    await waitFor(host, () =>
      document
        .querySelector("[data-test=team-B]")
        ?.textContent.includes("Gentle Ginkgo"),
    );
    const watcher = await open(code, "Calm Cedar", {
      lobby: false,
      query: "&observe=1",
    });
    await host.click("[data-test=lobby-start]");
    for (const p of [guest, watcher])
      await waitFor(p, () => window.__kubb.pitch.state().mode === "match");
    let [h, g, o] = await inStep([host, guest, watcher]);
    assert.equal(h.playing, "A");
    assert.equal(g.playing, "B");
    assert.equal(o.playing, null);
    assert.equal(o.mayAct, false);

    // the host's first baton, swung slowly, watched
    await myThrow(host);
    await watchAim(watcher);
    await slowThrow(host);
    [h, g, o] = await inStep([host, guest, watcher]);
    assert.equal(h.local.seq, 1);
    assert.ok(h.aimSent >= 5, `the host sent ${h.aimSent} aim samples`);
    const aim = await watcher.evaluate(() => window.__aim);
    const heard = new Set(aim.samples);
    assert.ok(aim.samples.length >= 5, `${aim.samples.length} samples heard`);
    const between = aim.drawn.filter((d) => !heard.has(d.arm));
    assert.ok(
      between.length >= 3,
      `the dial was drawn between samples ${between.length} times of ${aim.drawn.length}`,
    );
    // and it moved while no new sample came: two frames, one sample count, two arms
    const moved = aim.drawn.some(
      (d, i) =>
        i > 0 && d.n === aim.drawn[i - 1].n && d.arm !== aim.drawn[i - 1].arm,
    );
    assert.ok(moved, "the dial moved between two samples");
    t.diagnostic(
      `aim: ${h.aimSent} sent, ${aim.samples.length} heard, ${aim.drawn.length} drawn, ${between.length} between samples`,
    );

    // the rest of the host's turn, then the turn passes to the guest
    await host.evaluate(
      () => window.__kubb.game.phase === "play" && window.__kubb.game.skip(),
    );
    const deadline = Date.now() + 90000;
    let guestUp = false;
    while (Date.now() < deadline) {
      await settle(host);
      await settle(guest);
      const s = await pst(host);
      if (s.mayAct && s.phase === "aim" && s.playing === "A") {
        const need = await host.evaluate(() => window.__kubb.game.need?.kind);
        if (need === "throw") {
          await myThrow(host);
          await slowThrow(host);
          continue;
        }
      }
      const gs = await pst(guest);
      if (gs.mayAct && gs.phase === "aim") {
        guestUp = true;
        break;
      }
      await host.waitForTimeout(100);
    }
    assert.ok(guestUp, "the turn passed to the guest");
    [h, g, o] = await inStep([host, guest, watcher]);
    assert.equal(o.hash, h.hash, "the observer is on the same hash");
    assert.ok(h.local.seq >= 2);
    for (const p of [host, guest, watcher]) assert.deepEqual(p.errors, []);
    for (const p of [host, guest, watcher]) await p.context().close();
  },
);
