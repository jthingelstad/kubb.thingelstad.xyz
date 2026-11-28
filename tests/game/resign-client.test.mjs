// RESIGN against the computer ends the match at once (the owner, 2026-11-27, with the
// iPhone app's PitchSession.endResignation: "they should not have to watch the computer
// play out its turn"). In a real browser: resigned while the computer's throw plays, and
// while it aims, the winner card is up at once with no throw playing; the actions made in
// between (the computer's throws by cpuPlay, the person's raises and punishment kubbs by
// the engine's choice) are in the trail each with the hash after it, and they are exactly
// the ones the same resignation played out frame by frame makes, ending on the same hash.
// The throw to go still waits, as on the app. (A pitch, the other place it waits, never
// sets the solo flag the rule reads: Game.resignationWaits.)
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
    "# tests/game/resign-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

let env;
before(async () => {
  if (!available) return;
  env = await serve({ build: true });
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

// (the record's POST has no api in this test server: its 404 is not the page's)
const pageErrors = (page) =>
  page.errors.filter((e) => !/Failed to load resource/.test(e));

// A solo match up to the computer's first turn: our two batons thrown and skipped.
async function toComputersTurn(page) {
  await page.click("[data-test=start]");
  await page.click("[data-test=handoff-go]");
  for (let i = 0; i < 2; i++) {
    await waitPhase(page, "aim", 10000);
    await throwOnce(page);
    await waitPhase(page, "play", 5000);
    await page.evaluate(() => window.__kubb.game.skip());
  }
  await page.waitForFunction(() => !!window.__kubb.game.need?.cpu, null, {
    timeout: 20000,
  });
}

// Every action of the trail played again from its start through the engine: each must
// end on the hash the trail kept after it.
const trailHolds = (page) =>
  page.evaluate(() => {
    const g = window.__kubb.game;
    const t = g.trail;
    const e = g.engine;
    const now = e.snapshot();
    e.restore(t.start);
    const bad = [];
    t.actions.forEach((a, i) => {
      const r = e.apply(a);
      if (r?.ok === false) bad.push(`${i} refused`);
      else if (e.hash().hash !== t.hashes[i]) bad.push(`${i} ${a.type}`);
    });
    e.restore(now);
    return { n: t.actions.length, bad };
  });

browserTest(
  "RESIGN while the computer's throw plays: the winner card at once, the trail as a played-out resignation's",
  async () => {
    const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1");
    try {
      await toComputersTurn(page);
      await page.waitForFunction(
        () => {
          const g = window.__kubb.game;
          return g.phase === "play" && !!g.play?.cpu;
        },
        null,
        { timeout: 20000, polling: 20 },
      );
      // no clock on the actions, so the two runs below make the same ones
      const before = await page.evaluate(() => {
        const g = window.__kubb.game;
        g.stamp = () => undefined;
        return { snap: g.engine.snapshot(), n: g.trail.actions.length };
      });
      await page.click("[data-test=menu]");
      await page.click("[data-test=menu-resign]");
      const at = await page.evaluate(() => {
        const g = window.__kubb.game;
        return {
          kind: g.need?.kind,
          winner: g.need?.winner?.winner,
          phase: g.phase,
          playing: !!g.play,
          lifting: !!g.liftState,
          actions: g.trail.actions.slice(),
          hashes: g.trail.hashes.slice(),
          hash: g.engine.hash().hash,
        };
      });
      assert.equal(at.kind, "over", "over at once");
      assert.equal(at.phase, "over");
      assert.equal(at.winner, "B", "the computer wins");
      assert.equal(at.playing, false, "the throw playing was cut");
      assert.equal(at.lifting, false);
      await page.waitForSelector("[data-test=winner]", { timeout: 5000 });
      const made = at.actions.slice(before.n);
      assert.equal(made[0].type, "resign", "the resign first");
      assert.ok(made.length > 1, "the computer's turn made in between");
      assert.equal(at.hashes.length, at.actions.length, "a hash each");
      const held = await trailHolds(page);
      assert.deepEqual(held.bad, [], "every action ends on its own hash");

      // the same resignation, played out frame by frame (as on a pitch, or before):
      // the same actions and the same hash after each
      await page.evaluate((snap) => {
        const g = window.__kubb.game;
        g.fastCpu = false;
        g.adopt(snap);
      }, before.snap);
      await page.evaluate(() =>
        window.__kubb.game.resign(window.__kubb.game.localSide || "A"),
      );
      assert.notEqual(
        await page.evaluate(() => window.__kubb.game.need?.kind),
        "over",
        "without the rule it waits",
      );
      await page.waitForFunction(
        () => {
          const g = window.__kubb.game;
          if (g.phase === "play") g.skip();
          if (g.phase === "lift") g.skipLifts();
          if (g.phase === "raise" && g.mayAct(g.need)) g.raiseAuto();
          if (g.phase === "punish" && g.mayAct(g.need)) g.punish();
          const go = document.querySelector(
            "[data-test=handoff-go], [data-test=pass] .btn, [data-test=settle] .btn",
          );
          if (go) go.click();
          return g.need?.kind === "over";
        },
        null,
        { timeout: 60000, polling: 50 },
      );
      const out = await page.evaluate(() => ({
        actions: window.__kubb.game.trail.actions.slice(),
        hashes: window.__kubb.game.trail.hashes.slice(),
        hash: window.__kubb.game.engine.hash().hash,
      }));
      assert.deepEqual(out.actions, made, "the same actions");
      assert.deepEqual(
        out.hashes,
        at.hashes.slice(before.n),
        "the same hashes",
      );
      assert.equal(out.hash, at.hash, "the same end");
      assert.deepEqual(pageErrors(page), []);
    } finally {
      await page.context().close();
    }
  },
);

browserTest(
  "RESIGN while the computer aims: over at once; the throw to go still waits",
  async () => {
    const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1");
    try {
      await toComputersTurn(page);
      await waitPhase(page, "aim", 10000);
      assert.equal(
        await page.evaluate(() => !!window.__kubb.game.need?.cpu),
        true,
      );
      const n = await page.evaluate(
        () => window.__kubb.game.trail.actions.length,
      );
      await page.click("[data-test=menu]");
      await page.click("[data-test=menu-resign]");
      const at = await page.evaluate(() => ({
        kind: window.__kubb.game.need?.kind,
        phase: window.__kubb.game.phase,
        n: window.__kubb.game.trail.actions.length,
      }));
      assert.equal(at.kind, "over");
      assert.equal(at.phase, "over");
      assert.ok(at.n > n + 1, "the resign and the computer's turn");
      await page.waitForSelector("[data-test=winner]", { timeout: 5000 });
      assert.deepEqual((await trailHolds(page)).bad, []);
      assert.deepEqual(pageErrors(page), []);
    } finally {
      await page.context().close();
    }
    // the throw to go: only a person throws their own baton, so it waits
    const togo = await open(env, "/p/abcdefgh?solo=1&nohowto=1", "desktop", {
      prefs: { testTogo: "on", throwsMade: 5 },
    });
    try {
      await togo.click("[data-test=start]");
      await togo.waitForFunction(
        () => window.__kubb.game.need?.kind === "togo",
        null,
        { timeout: 15000 },
      );
      await togo.evaluate(() => window.__kubb.game.resign("A"));
      const st = await togo.evaluate(() => ({
        kind: window.__kubb.game.need?.kind,
        pending: window.__kubb.game.engine.need()?.resignPending,
      }));
      assert.equal(st.kind, "togo", "the baton to go is still ours to throw");
      assert.equal(st.pending, "A");
      assert.deepEqual(togo.errors, []);
    } finally {
      await togo.context().close();
    }
  },
);
