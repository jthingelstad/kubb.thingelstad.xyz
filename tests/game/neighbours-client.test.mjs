// The Tournament's live neighbours in a real browser (src/game/neighbours.js over the
// worker src/engine/neighbours-worker.js; docs/SCENES.md "Tournament"): a Tournament
// match shows a neighbour's piece moving within about 30 s of match clock (the test
// drives the field's clock rather than waiting); no worker in any other scene or with
// reduced motion; leaving the scene ends the worker; and a worker that never answers
// leaves the match playing and the still pitches drawn.
// Skipped with a notice when Playwright's Chromium is not installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, open } from "./browser.mjs";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/neighbours-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

let env;
before(async () => {
  if (available) env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
});

// Every Worker the page makes, and whether it was ended.
const COUNT_WORKERS = () => {
  const W = window.Worker;
  window.__workers = [];
  window.Worker = class extends W {
    constructor(url, opts) {
      super(url, opts);
      const rec = { url: String(url), type: opts?.type, terminated: false };
      window.__workers.push(rec);
      const end = this.terminate.bind(this);
      this.terminate = () => {
        rec.terminated = true;
        end();
      };
    }
  };
};

// A worker that takes every message and never answers.
const SILENT_WORKER = () => {
  window.__workers = [];
  window.Worker = class {
    constructor(url) {
      this.rec = { url: String(url), posted: 0, terminated: false };
      window.__workers.push(this.rec);
    }
    postMessage() {
      this.rec.posted += 1;
    }
    terminate() {
      this.rec.terminated = true;
    }
  };
};

const watch = (scene, opts = {}) =>
  open(env, "/p/abcdefgh?watch=1&nohowto=1", "desktop", {
    prefs: { solo: { scene }, watchView: "wide" },
    ...opts,
  });

const frames = (page, n = 3) =>
  page.evaluate(
    (n) =>
      new Promise((r) => {
        let k = 0;
        const f = () => (++k >= n ? r() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );

browserTest(
  "a Tournament match: the field opens in a worker and a neighbour's piece moves within 30 s of clock",
  async () => {
    const page = await watch("tournament", { init: COUNT_WORKERS });
    try {
      await page.waitForFunction(() => window.__kubb.game.nb?.isOpen, null, {
        timeout: 30000,
      });
      const w = await page.evaluate(() => window.__workers);
      assert.equal(w.length, 1);
      assert.match(w[0].url, /\/assets\/neighbours-[A-Z0-9]+\.js$/);
      assert.equal(w[0].type, "module");
      // drive the field's clock (no more than 30 s) until a throw starts on a pitch
      let seen = null;
      for (let i = 0; i < 400 && !seen; i++) {
        seen = await page.evaluate(() => {
          const nb = window.__kubb.game.nb;
          const p = nb.fieldData.pitches.find(
            (q) => q.rec && nb.clock - q.recAt < 0.3,
          );
          if (p)
            return {
              id: p.id,
              proj: p.rec.projectile.id,
              at: p.recAt,
              clock: nb.clock,
            };
          if (nb.clock < 30 && !nb.fieldData.pitches.some((q) => q.rec))
            nb.clock += 0.25;
          return null;
        });
        if (!seen) await frames(page, 2);
      }
      assert.ok(seen, "a neighbour threw");
      assert.ok(seen.at <= 30, `its first throw at ${seen.at} s of clock`);
      // the drawn field: the thrown piece in two frames, somewhere else
      // (by its id in the pitch's pieces as drawn: still in the air, or come to rest
      // if a slow machine's frames outlast its flight)
      const where = () =>
        page.evaluate(({ id, proj }) => {
          const g = window.__kubb.game;
          const nbp = g.nb.fieldData.byId.get(id);
          const pitch = g.nbDrawn?.field.find((p) => p.id === id);
          if (!nbp || !pitch) return null;
          const i = g.nb.fieldData
            .itemsAt(nbp, g.nb.clock)
            .findIndex((it) => it.id === proj);
          const q = pitch.pieces[i];
          return q ? [q.x, q.y, q.z] : null;
        }, seen);
      await frames(page, 1);
      const a = await where();
      await page.waitForTimeout(150);
      await frames(page, 1);
      const b = await where();
      assert.ok(a && b, "the piece is in the drawn field");
      assert.ok(
        Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 0.05,
        `moved: ${a} -> ${b}`,
      );
      assert.equal(
        await page.evaluate(() => window.__kubb.game.nb.failed),
        false,
      );
      // leaving the scene closes the field and ends the worker
      await page.evaluate(() => window.__kubb.game.showScene("day"));
      await page.waitForFunction(() => window.__workers[0].terminated, null, {
        timeout: 5000,
      });
      assert.equal(await page.evaluate(() => window.__kubb.game.nb), null);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

browserTest("no worker in another scene, or with reduced motion", async () => {
  for (const [scene, context] of [
    ["day", {}],
    ["neon", {}],
    ["tournament", { reducedMotion: "reduce" }],
  ]) {
    const page = await watch(scene, { init: COUNT_WORKERS, context });
    try {
      await page.waitForFunction(
        () => window.__kubb.game.phase === "aim",
        null,
        {
          timeout: 20000,
        },
      );
      await page.waitForTimeout(1500);
      const s = await page.evaluate(() => ({
        workers: window.__workers.length,
        nb: window.__kubb.game.nb,
        stage: window.__kubb.game.stage.id,
      }));
      assert.equal(s.workers, 0, `${scene} ${JSON.stringify(context)}`);
      assert.equal(s.nb, null);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  }
});

browserTest(
  "a worker that never answers: the match plays on over the still pitches",
  async () => {
    const page = await watch("tournament", { init: SILENT_WORKER });
    try {
      // the computer throws: a playback starts and ends while the worker is silent
      await page.waitForFunction(
        () => window.__kubb.game.phase === "play",
        null,
        {
          timeout: 30000,
        },
      );
      await page.waitForFunction(
        () => window.__kubb.game.phase !== "play",
        null,
        {
          timeout: 30000,
        },
      );
      const s = await page.evaluate(() => {
        const g = window.__kubb.game;
        return {
          open: g.nb?.isOpen ?? false,
          posted: window.__workers.map((w) => w.posted),
          stage: g.stage.id,
          drawnLive: !!g.nbDrawn,
        };
      });
      assert.equal(s.open, false);
      assert.deepEqual(s.posted, [1], "the open, and nothing queued behind it");
      assert.equal(s.stage, "tournament");
      assert.equal(s.drawnLive, false, "the still pitches are drawn");
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);
