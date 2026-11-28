// The other side's throw seen from the player's end (engine 1.4.1: a person's eyes on the
// baseline that turn with the throw, `camera.endFollow`), in a real browser: with motion
// the camera drawn moves frame by frame, toward the baton; with prefers-reduced-motion it
// is the recording's first frame's (`showAt { t = 0 }`, fitted to the whole throw) for the
// whole of it (src/game/held-end.js; the iPhone app's Playback.heldEnd). The pieces still
// move either way.
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
    "# tests/game/held-end-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
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

// Our two batons thrown, then the computer's first throw as it plays: the camera and a
// piece drawn each animation frame, and the recording's first frame's camera.
async function watchComputersThrow(page) {
  await page.click("[data-test=start]");
  await page.click("[data-test=handoff-go]");
  for (let i = 0; i < 2; i++) {
    await waitPhase(page, "aim", 10000);
    await throwOnce(page);
    await waitPhase(page, "play", 5000);
    await page.evaluate(() => window.__kubb.game.skip());
  }
  await page.waitForFunction(
    () => {
      const g = window.__kubb.game;
      return g.phase === "play" && !!g.play?.cpu;
    },
    null,
    { timeout: 30000, polling: 10 },
  );
  return page.evaluate(
    () =>
      new Promise((done) => {
        const g = window.__kubb.game;
        const p = g.play;
        const first = JSON.stringify(g.engine.showAt(0).camera);
        const pid = p.rec.projectile?.id;
        const frames = [];
        const step = () => {
          if (g.play !== p || p.done) return done({ first, frames });
          const s = p.last;
          if (s)
            frames.push({
              t: s.t,
              cam: JSON.stringify(s.camera),
              kind: s.camera?.kind,
              at: JSON.stringify(s.items.find((it) => it.id === pid) ?? null),
            });
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
  );
}

for (const reduced of [false, true])
  browserTest(
    `the computer's throw from our end, ${reduced ? "reduced motion: one camera held" : "with motion: the camera turns with it"}`,
    async () => {
      const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1", "desktop", {
        context: { reducedMotion: reduced ? "reduce" : "no-preference" },
      });
      try {
        const { first, frames } = await watchComputersThrow(page);
        assert.ok(frames.length > 10, `${frames.length} frames drawn`);
        assert.ok(
          frames.every((f) => f.kind === "end"),
          "seen from our end (engine 1.4 setView)",
        );
        const cams = new Set(frames.map((f) => f.cam));
        assert.ok(
          new Set(frames.map((f) => f.at)).size > 5,
          "the baton flies either way",
        );
        if (reduced) {
          assert.equal(cams.size, 1, "one camera for the whole throw");
          assert.equal([...cams][0], first, "the first frame's (showAt t = 0)");
        } else assert.ok(cams.size > 5, `${cams.size} cameras: it turns`);
        assert.deepEqual(page.errors, []);
      } finally {
        await page.context().close();
      }
    },
  );
