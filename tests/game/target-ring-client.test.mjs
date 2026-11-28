// A press on the target's ring always aims (the owner, 2026-11-27, of the iPhone app on
// an iPad: "On iPad I'm trying to move the drill target and when I tap it is activating
// the throw instead."), in a real browser: the web's advantage position (a kubb at the
// advantage line, its ring low on an upright screen, in the linear meter's throw zone).
// A finger on the ring, or near its rim, is the aim's, a tap or a drag; the knob still
// strokes; low on the other half of the screen aims and low on the meter's half strokes.
// src/game/target-ring.js, Game.down; the iPhone app's TargetRingTests.
// Skipped with a notice when Playwright's Chromium is not installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, open } from "./browser.mjs";
import { tune as linearTune } from "../../src/render/linear.js";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/target-ring-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

const ADVANTAGE = fs.readFileSync("tests/fixtures/snap-advantage.json", "utf8");

let env;
before(async () => {
  if (!available) return;
  env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
});

// A touch press at (x, y) on the canvas, moved by `path` (dx, dy steps), then lifted:
// what the press started as (Game.ptr.kind) and what came of it.
const press = (page, x, y, path = []) =>
  page.evaluate(
    async ({ x, y, path }) => {
      const g = window.__kubb.game;
      const c = document.getElementById("pitch");
      const ev = (name, px, py) =>
        c.dispatchEvent(
          new PointerEvent(name, {
            clientX: px,
            clientY: py,
            pointerId: 9,
            pointerType: "touch",
            isPrimary: true,
            bubbles: true,
            cancelable: true,
            buttons: name === "pointerup" ? 0 : 1,
          }),
        );
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      const m0 = { ...g.out.aim.marker };
      ev("pointerdown", x, y);
      const kind = g.ptr?.kind ?? null;
      let px = x,
        py = y;
      for (const [dx, dy] of path) {
        px += dx;
        py += dy;
        ev("pointermove", px, py);
        await frame();
      }
      ev("pointerup", px, py);
      await frame();
      await frame();
      const m1 = g.out?.aim?.marker;
      return {
        kind,
        phase: g.phase,
        playing: !!g.play,
        moved: !!m1 && (m1.x !== m0.x || m1.y !== m0.y),
      };
    },
    { x, y, path },
  );

for (const side of ["right", "left"])
  browserTest(
    `upright, the linear meter at the ${side}: a press on the ring aims, the zone narrows to the meter's half`,
    async () => {
      const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1", "portrait", {
        prefs: { meter: "linear", meterSide: side, throwsMade: 9 },
      });
      try {
        await page.click("[data-test=start]");
        await page.evaluate((snap) => {
          const g = window.__kubb.game;
          g.adopt(snap);
        }, ADVANTAGE);
        const go = page.locator("[data-test=handoff-go]");
        if (await go.count()) await go.click();
        await page.waitForFunction(() => {
          const g = window.__kubb.game;
          return g.phase === "aim" && !g.modal && g.mayAct();
        });
        const at = await page.evaluate(() => {
          const g = window.__kubb.game;
          const r = g.targetRing();
          const xs = r.outline.map((p) => p.x);
          const ys = r.outline.map((p) => p.y);
          return {
            W: g.L.W,
            H: g.L.H,
            meter: g.L.meter,
            c: r.center,
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            maxY: Math.max(...ys),
            knob: { x: g.linearG().cx, y: g.linearG().y0 },
          };
        });
        assert.equal(at.meter, "linear");
        assert.ok(
          at.c.y >= at.H * 0.6,
          `the ring in the zone: ${at.c.y / at.H}`,
        );
        // on the ring: its centre, inside its rim at either end, 8 px outside it, under it
        for (const [x, y] of [
          [at.c.x, at.c.y],
          [at.minX + 1, at.c.y],
          [at.maxX - 1, at.c.y],
          [at.minX - 8, at.c.y],
          [at.maxX + 8, at.c.y],
          [at.c.x, at.maxY + 8],
        ]) {
          const r = await press(page, x, y);
          assert.equal(r.kind, "target", `${side}: (${x}, ${y}) on the ring`);
          assert.equal(r.playing, false, "never a throw");
          assert.equal(r.phase, "aim");
        }
        // a drag from the ring moves the circle and never strokes the meter
        const drag = await press(page, at.c.x, at.c.y, [
          [0, -12],
          [0, -12],
          [0, -12],
          [0, -12],
        ]);
        assert.equal(drag.kind, "target");
        assert.equal(drag.moved, true, "the circle moved");
        assert.equal(drag.playing, false);
        // the zone is the meter's half while the ring is in it: low on the other half
        // is a press on the pitch (a tap aims, a drag moves the aim), low on the
        // meter's half (off the ring) strokes
        const low = at.H - 6;
        const far = side === "right" ? at.W * 0.1 : at.W * 0.9;
        const near = side === "right" ? at.W * 0.5 + 4 : at.W * 0.5 - 4;
        assert.equal(
          (await press(page, far, low)).kind,
          "tap",
          "the other half",
        );
        assert.equal(
          (await press(page, near, low)).kind,
          "zone",
          "the meter's half",
        );
        // the knob, at home, still strokes wherever the ring is
        const k = await page.evaluate(() => {
          const g = window.__kubb.game;
          const c = document.getElementById("pitch");
          const gl = g.linearG();
          c.dispatchEvent(
            new PointerEvent("pointerdown", {
              clientX: gl.cx,
              clientY: gl.y0,
              pointerId: 9,
              pointerType: "touch",
              isPrimary: true,
              bubbles: true,
              cancelable: true,
              buttons: 1,
            }),
          );
          const kind = g.ptr?.kind;
          g.releaseAll();
          return kind;
        });
        assert.equal(k, "dial", "the knob");
        assert.ok(linearTune.grabTouch > 0);
        assert.deepEqual(page.errors, []);
      } finally {
        await page.context().close();
      }
    },
  );
