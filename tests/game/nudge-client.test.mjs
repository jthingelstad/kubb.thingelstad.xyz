// The throw's nudge in a real browser (src/game/nudge.js, src/render/nudge.js):
// a stuck player is shown a ghost throw on the meter itself. The waits are
// shortened through window.__kubb (test hosts only), so nothing here waits
// out the real 8 or 30 s. With KUBB_NUDGE_SHOTS=<dir> it also saves the
// nudge at three moments for each meter and screen.
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
  dialGeometry,
} from "./browser.mjs";
import { linearGeometry } from "../../src/render/linear.js";
import { tune as nudgeTune } from "../../src/game/nudge.js";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/nudge-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;
const SHOTS = process.env.KUBB_NUDGE_SHOTS || null;

let env;
before(async () => {
  if (available) env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
});

const nudge = (page) => page.evaluate(() => window.__kubb.game.nudgeState());

// Shorten the trigger's waits on this page.
const shorten = (page, t) =>
  page.evaluate((t) => Object.assign(window.__kubb.game.nudge.tune, t), t);

const waitShowing = (page, ms = 5000) =>
  page.waitForFunction(() => window.__kubb.game.nudgeState().showing, null, {
    timeout: ms,
    polling: 50,
  });

// The knob at home on the meter the page shows.
async function knob(page) {
  const L = await page.evaluate(() => {
    const { meter, dial, meterSide } = window.__kubb.game.L;
    return { meter, dial, meterSide };
  });
  if (L.meter === "linear") {
    const g = linearGeometry(L.dial, L.meterSide);
    return [g.cx, g.y0];
  }
  const g = await dialGeometry(page);
  return [g.cx, g.cy + g.r * 0.86];
}

// A press on the knob and a let go, not moved: no throw.
async function fumble(page, touch) {
  const [x, y] = await knob(page);
  if (touch) await page.touchscreen.tap(x, y);
  else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
  }
}

async function throwOnce(page, opts = {}) {
  const p = (await state(page)).plan;
  await swing(
    page,
    sweep({
      back: (p.powerLo + p.powerHi) / 2,
      stop: p.release,
      backDps: 900,
      flickDps: 3600,
    }),
    opts,
  );
}

const T = nudgeTune;
const MOMENTS = {
  pressed: T.press * 0.9,
  back: T.press + T.back + T.hold / 2,
  flick: T.press + T.back + T.hold + T.flick * 0.55,
};

async function shoot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const [moment, t] of Object.entries(MOMENTS)) {
    await page.evaluate((t) => (window.__kubb.game.nudgeFreeze = t), t);
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => r())),
    );
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => r())),
    );
    await page.screenshot({ path: `${SHOTS}/${name}-${moment}.png` });
  }
  await page.evaluate(() => (window.__kubb.game.nudgeFreeze = null));
}

const CASES = [
  ["clock", "portrait", true, "right"],
  ["clock", "desktop", false, "right"],
  ["linear", "portrait", true, "right"],
  ["linear", "desktop", false, "right"],
  ["linear", "portrait", true, "left"],
];

for (const [meter, kind, touch, side] of CASES) {
  const label = `${meter}, ${kind}${side === "left" ? ", Side Left" : ""}`;
  browserTest(
    `a new device is nudged after the wait, and a press on the meter stops it (${label})`,
    async () => {
      const page = await open(env, "/practice/?nohowto=1", kind, {
        prefs: { meter, meterSide: side },
      });
      try {
        await waitPhase(page, "aim", 10000);
        const before = await nudge(page);
        assert.equal(before.showing, false, "not at once");
        assert.equal(before.learned, false);
        await shorten(page, { wait: 0.6 });
        await waitShowing(page);
        const s = await nudge(page);
        const L = await page.evaluate(() => window.__kubb.game.L);
        assert.equal(L.meter, meter);
        const f = s.frame.finger;
        assert.ok(f.x > 0 && f.x < L.W && f.y > 0 && f.y < L.H, "on screen");
        if (meter === "linear") {
          const g = linearGeometry(L.dial, L.meterSide);
          if (!touch) {
            // a mouse grabs the knob: the pointer rides the ghost
            assert.ok(Math.abs(f.x - g.cx) < 1, "on the knob");
          } else {
            // the fingertip strokes in the throw zone, beside the meter on
            // its inner side, never on it
            if (side === "left") assert.ok(f.x > g.right + 20, "inner side");
            else assert.ok(f.x < g.left - 20, "inner side");
            if (s.frame.step === "press")
              assert.ok(f.y >= L.H * 0.6, "starts in the throw zone");
          }
        } else if (L.track) {
          // the fingertip rides the finger track, beside the ring
          const g = await dialGeometry(page);
          const d = Math.hypot(f.x - g.cx, f.y - g.cy) / g.r;
          assert.ok(d > 1.1 && d < 1.55, `on the track (${d.toFixed(2)})`);
        }
        // the real knob stays home and the engine is fed nothing
        const st = await state(page);
        assert.equal(st.dial.phase, "idle");
        assert.equal(st.phase, "aim");
        await shoot(
          page,
          `${meter}-${kind === "portrait" ? "390x844" : "1280x768"}${side === "left" ? "-left" : ""}`,
        );
        // a press on the meter stops it at once
        const [x, y] = await knob(page);
        if (touch) {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x, y, id: 1 }],
          });
          await page.waitForFunction(
            () => !window.__kubb.game.nudge.showing,
            null,
            { timeout: 1000, polling: 16 },
          );
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          await cdp.detach();
        } else {
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.waitForFunction(
            () => !window.__kubb.game.nudge.showing,
            null,
            { timeout: 1000, polling: 16 },
          );
          await page.mouse.up();
        }
        assert.deepEqual(page.errors, []);
      } finally {
        await page.context().close();
      }
    },
  );
}

browserTest(
  "after 3 throws the idle wait brings no nudge; two fumbles do",
  async () => {
    const page = await open(env, "/practice/?nohowto=1");
    try {
      await waitPhase(page, "aim", 10000);
      await shorten(page, { wait: 0.4, idle: 600 });
      for (let i = 0; i < 3; i++) {
        await waitPhase(page, "aim", 10000);
        await throwOnce(page);
        await waitPhase(page, "play", 5000);
        await page.evaluate(() => window.__kubb.game.skip());
      }
      await waitPhase(page, "aim", 10000);
      const s = await nudge(page);
      assert.equal(s.throws, 3);
      assert.equal(s.learned, true);
      assert.equal(
        await page.evaluate(() => localStorage.getItem("kubb:throwsMade")),
        "3",
        "kept on the device",
      );
      await page.waitForTimeout(1500);
      assert.equal(
        (await nudge(page)).showing,
        false,
        "the wait is not enough",
      );
      await fumble(page, false);
      await page.waitForTimeout(300);
      assert.equal((await nudge(page)).fumbles, 1);
      assert.equal((await nudge(page)).showing, false, "one is not enough");
      await fumble(page, false);
      await waitShowing(page, 3000);
      assert.equal((await nudge(page)).fumbles, 2);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

browserTest("a learned device, reloaded, stays learned", async () => {
  const page = await open(env, "/practice/?nohowto=1", "portrait", {
    prefs: { throwsMade: 3, meter: "linear" },
  });
  try {
    await waitPhase(page, "aim", 10000);
    await shorten(page, { wait: 0.3 });
    await page.waitForTimeout(1200);
    const s = await nudge(page);
    assert.equal(s.learned, true);
    assert.equal(s.showing, false);
    await fumble(page, true);
    await fumble(page, true);
    await waitShowing(page, 3000);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

browserTest("never while watching the computer", async () => {
  const page = await open(env, "/p/abcdefgh?watch=1&nohowto=1");
  try {
    await shorten(page, { wait: 0.05, idle: 0.05, fumbles: 0 });
    let seen = false;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(100);
      if ((await nudge(page)).showing) seen = true;
    }
    assert.equal(seen, false);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

browserTest("never under a card: the menu holds it off", async () => {
  const page = await open(env, "/practice/?nohowto=1");
  try {
    await waitPhase(page, "aim", 10000);
    await page.click("[data-test=menu]");
    await shorten(page, { wait: 0.2 });
    await page.waitForTimeout(800);
    assert.equal((await nudge(page)).showing, false);
    await page.keyboard.press("Escape");
    await waitShowing(page, 3000);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

browserTest("reduced motion shows a still picture", async () => {
  for (const meter of ["clock", "linear"]) {
    const page = await open(env, "/practice/?nohowto=1", "portrait", {
      prefs: { meter },
    });
    try {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await waitPhase(page, "aim", 10000);
      await shorten(page, { wait: 0.3 });
      await waitShowing(page);
      const a = await nudge(page);
      await page.waitForTimeout(400);
      const b = await nudge(page);
      assert.equal(a.frame.step, "still");
      assert.deepEqual(a.frame, b.frame, "it does not move");
      assert.ok(a.frame.arm < -90, "the ghost is at the back");
      if (SHOTS)
        await page.screenshot({
          path: `${SHOTS}/${meter}-390x844-reduced.png`,
        });
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  }
});
