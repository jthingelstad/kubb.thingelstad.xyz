// STAND in a real browser (src/game/stand-pad.js). It replaced WALK, the
// Playdate's held A, a mode switch that made a drag on the pitch walk the
// thrower like a joystick (Jamie, 2026-11-19: "Can you audit the control
// surface from a broader level that would catch these type of odd
// engagements. It is all a hangover from us starting on play date"). A
// drag on STAND puts the thrower where the finger is on its picture of the
// line, held to what the engine allows, and the pitch's own presses (a tap
// aims, a drag moves the circle, the linear meter's stroke) are as before.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import {
  serve,
  open,
  state,
  waitPhase,
  nextFrame,
  openPlate,
  sweep,
  swing,
} from "./browser.mjs";
import { standSpan, groundAt } from "../../src/game/stand-pad.js";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/stand-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

let env;
before(async () => {
  if (available) env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
});

const aimOf = (page) =>
  page.evaluate(() => {
    const a = window.__kubb.game.out.aim;
    return {
      thrower: a.thrower,
      marker: { x: a.marker.x, y: a.marker.y },
      span: {
        projectile: a.projectile,
        lineY: a.lineY,
        forwardY: a.forwardY,
        halfWidth: a.halfWidth,
        backMax: a.backMax,
      },
    };
  });

// STAND's run in CSS px, and a point on it at (fx, fy). Its plate in the tray
// is opened first (the 1.0 design: src/game/tray.js).
const run = async (page) => {
  await openPlate(page, "stand");
  return page.evaluate(() => {
    const r = document
      .querySelector("[data-test=stand] .stand-run")
      .getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
};
const at = (r, fx, fy) => [r.x + r.w * fx, r.y + r.h * fy];

// A drag through the places fs ([fx, fy] on STAND's run, or [x, y, "px"]),
// with the mouse or a finger. keep: leave it held.
async function drag(page, fs, { touch = false, keep = false } = {}) {
  const r = await run(page);
  const pts = fs.map((f) => (f[2] === "px" ? f : at(r, f[0], f[1])));
  if (!touch) {
    await page.mouse.move(...pts[0]);
    await page.mouse.down();
    await nextFrame(page);
    for (const p of pts.slice(1)) {
      await page.mouse.move(...p);
      await nextFrame(page);
    }
    if (keep) return () => page.mouse.up();
    await page.mouse.up();
  } else {
    const cdp = await page.context().newCDPSession(page);
    const tp = ([x, y]) => [{ x, y, id: 3, radiusX: 8, radiusY: 8, force: 1 }];
    const send = (type, p) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: p ? tp(p) : [],
      });
    await send("touchStart", pts[0]);
    await nextFrame(page);
    for (const p of pts.slice(1)) {
      await send("touchMove", p);
      await nextFrame(page);
    }
    const end = async () => {
      await send("touchEnd");
      await cdp.detach();
    };
    if (keep) return end;
    await end();
  }
  await nextFrame(page);
  await nextFrame(page);
  return null;
}

const near = (a, b, tol = 0.02) =>
  Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol;

browserTest("there is no WALK button; STAND is in the plan", async () => {
  const page = await open(env, "/practice/?nohowto=1", "desktop");
  try {
    await waitPhase(page, "aim", 10000);
    assert.equal(await page.locator("[data-test=walk]").count(), 0);
    assert.equal(
      await page.locator("[data-test=plans] [data-test=stand]").count(),
      1,
    );
    assert.equal(
      await page.textContent("[data-test=stand] .slider-head"),
      "STAND",
    );
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

for (const [kind, touch] of [
  ["desktop", false],
  ["portrait", true],
]) {
  browserTest(
    `a drag on STAND puts the thrower where the finger is, held to the line (${kind})`,
    async () => {
      const page = await open(env, "/practice/?nohowto=1", kind);
      try {
        await waitPhase(page, "aim", 10000);
        const a0 = await aimOf(page);
        assert.equal(a0.thrower.set, false, "the stance follows the target");
        const span = standSpan(a0.span);
        // on the way, held: the caption says where and what
        const release = await drag(
          page,
          [
            [0.5, 0.5],
            [0.6, 0.6],
            [0.7, 0.7],
          ],
          { touch, keep: true },
        );
        await nextFrame(page);
        let a = await aimOf(page);
        const want = groundAt(span, 0.7, 0.7);
        assert.ok(near(a.thrower, want, 0.05), JSON.stringify(a.thrower));
        assert.equal(a.thrower.set, true);
        const cap = await page.evaluate(() => {
          const el = document.querySelector("[data-test=plan-caption]");
          return { shown: !el.hidden, text: el.textContent };
        });
        assert.equal(cap.shown, true);
        assert.match(cap.text, /RIGHT, .* BACK/i);
        assert.match(cap.text, /on your line or behind it/i);
        await release();
        await nextFrame(page);
        // past the plate's corner: the line's right end, backMax behind it
        await drag(
          page,
          [
            [0.5, 0.5],
            [0.9, 0.9],
            [1.6, 1.8],
          ],
          { touch },
        );
        a = await aimOf(page);
        assert.ok(
          near(a.thrower, { x: 2.5, y: -3 }),
          JSON.stringify(a.thrower),
        );
        // and past the top-left: the left end, on the line (no advantage
        // line: the engine holds it to the line)
        await drag(
          page,
          [
            [0.5, 0.5],
            [0.1, 0.1],
            [-0.5, -0.6],
          ],
          { touch },
        );
        a = await aimOf(page);
        assert.ok(
          near(a.thrower, { x: -2.5, y: 0 }),
          JSON.stringify(a.thrower),
        );
        assert.ok(
          near(a.marker, a0.marker, 0.3),
          "the circle stays on its target",
        );
        assert.equal((await state(page)).phase, "aim", "nothing was thrown");
        assert.deepEqual(page.errors, []);
      } finally {
        await page.context().close();
      }
    },
  );
}

browserTest(
  "the pitch's presses are unchanged: a tap aims, a drag moves the circle, and neither walks",
  async () => {
    const page = await open(env, "/practice/?nohowto=1", "portrait");
    try {
      await waitPhase(page, "aim", 10000);
      await drag(page, [
        [0.5, 0.5],
        [0.3, 0.6],
      ]);
      const a0 = await aimOf(page);
      // a tap on the far half of the pitch puts the circle there
      await page.touchscreen.tap(390 * 0.3, 844 * 0.33);
      await page.waitForFunction(
        (x) => window.__kubb.game.out?.aim?.marker?.x !== x,
        a0.marker.x,
        { timeout: 3000, polling: 50 },
      );
      let a = await aimOf(page);
      assert.ok(a.marker.x < a0.marker.x, "the tap aimed");
      assert.ok(near(a.thrower, a0.thrower, 1e-6), "the tap did not walk");
      // a finger's drag elsewhere on the pitch moves the circle
      const m1 = a.marker;
      const cdp = await page.context().newCDPSession(page);
      const tp = (x, y) => [{ x, y, id: 4, radiusX: 8, radiusY: 8, force: 1 }];
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: tp(200, 300),
      });
      for (let i = 1; i <= 8; i++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: tp(200 + i * 10, 300),
        });
        await nextFrame(page);
      }
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await cdp.detach();
      await nextFrame(page);
      a = await aimOf(page);
      assert.ok(a.marker.x > m1.x, "the drag moved the circle");
      assert.ok(near(a.thrower, a0.thrower, 1e-6), "the drag did not walk");
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

browserTest(
  "after STAND, the linear meter's stroke still throws, from where STAND put the thrower",
  async () => {
    const page = await open(env, "/practice/?nohowto=1", "desktop", {
      prefs: { meter: "linear" },
    });
    try {
      await waitPhase(page, "aim", 10000);
      await drag(page, [
        [0.5, 0.5],
        [0.25, 0.75],
      ]);
      const a = await aimOf(page);
      assert.ok(a.thrower.x < -0.5 && a.thrower.y < -0.5);
      const p = (await state(page)).plan;
      const { W, H } = await page.evaluate(() => ({
        W: window.__kubb.game.W,
        H: window.__kubb.game.H,
      }));
      await swing(
        page,
        sweep({
          back: (p.powerLo + p.powerHi) / 2,
          stop: p.release,
          backDps: 900,
          flickDps: 3600,
        }),
        { from: [W * 0.3, H * 0.7] },
      );
      await waitPhase(page, "play", 5000);
      const thrown = await page.evaluate(() => {
        const ops = window.__kubb.game.trail.ops;
        return ops[ops.length - 1];
      });
      assert.equal(thrown.type, "throw");
      assert.ok(
        near(thrown.stance, a.thrower, 1e-4),
        `the throw left from STAND's place: ${JSON.stringify(thrown.stance)}`,
      );
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

browserTest(
  "STAND's arrow keys step the thrower; A/D/W/S still walk",
  async () => {
    const page = await open(env, "/practice/?nohowto=1", "desktop");
    try {
      await waitPhase(page, "aim", 10000);
      const a0 = await aimOf(page);
      await openPlate(page, "stand");
      await page.focus("[data-test=stand]");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowDown");
      await nextFrame(page);
      const a1 = await aimOf(page);
      assert.ok(
        near(a1.thrower, { x: a0.thrower.x + 0.25, y: a0.thrower.y - 0.25 }),
        JSON.stringify(a1.thrower),
      );
      assert.ok(near(a1.marker, a0.marker, 0.3), "the arrows did not aim");
      await page
        .locator("#pitch")
        .focus()
        .catch(() => {});
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.down("KeyA");
      await page.waitForTimeout(400);
      await page.keyboard.up("KeyA");
      await nextFrame(page);
      const a2 = await aimOf(page);
      assert.ok(a2.thrower.x < a1.thrower.x - 0.1, "A walked left");
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);
