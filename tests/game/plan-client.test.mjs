// The plan's sliders in a real browser (src/game/plan-sliders.js; Jamie,
// 2026-11-19: "I'd like to make arc and tilt less buttons and more a slider
// with continuous movement"): ARC is continuous, TILT and SPIN settle on the
// engine's detents, a drag shows the side view, SIDE VIEW is a toggle, and
// in every layout the sliders keep clear of the meter, the minimap and MENU.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import {
  serve,
  open,
  state,
  waitPhase,
  dialGeometry,
  dragSlider,
  nextFrame,
  VIEWPORTS,
} from "./browser.mjs";
import { sideFraction } from "../../src/game/plan-sliders.js";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/plan-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

// a phone's browser with its toolbars showing
VIEWPORTS.shortPhone = {
  ...VIEWPORTS.portrait,
  viewport: { width: 390, height: 664 },
};

let env;
before(async () => {
  if (available) env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
});

const slider = (page, which) =>
  page.evaluate((which) => {
    const el = document.querySelector(`[data-test=${which}]`);
    return {
      head: el.querySelector(".slider-head").textContent,
      now: Number(el.getAttribute("aria-valuenow")),
      min: Number(el.getAttribute("aria-valuemin")),
      max: Number(el.getAttribute("aria-valuemax")),
      text: el.getAttribute("aria-valuetext"),
      role: el.getAttribute("role"),
      f: Number(el.style.getPropertyValue("--f")),
    };
  }, which);

const sideViewWanted = (page) =>
  page.evaluate(() => window.__kubb.game.planWanted());

browserTest("dragging ARC sets a release between the old steps", async () => {
  const page = await open(env, "/practice/?nohowto=1", "desktop");
  try {
    await waitPhase(page, "aim", 10000);
    const before = await slider(page, "arc");
    assert.equal(before.role, "slider");
    assert.equal(before.min, 15);
    assert.equal(before.max, 165);
    await page.evaluate(() => (window.__kubb.game.nudge.inputAt = -100));
    await dragSlider(page, "arc", [0.5, 0.6, 0.7, 0.73]);
    await nextFrame(page);
    const p = (await state(page)).plan;
    assert.ok(Math.abs(p.release - (15 + 0.73 * 150)) < 1.5, `${p.release}`);
    assert.ok(Math.abs(p.release / 15 - Math.round(p.release / 15)) > 0.05);
    assert.equal(p.arcSet, true);
    const s = await slider(page, "arc");
    assert.equal(s.head, `ARC ${Math.round(p.loft)}°`);
    assert.notEqual(s.head, before.head, "the label follows");
    assert.equal(s.now, Math.round(p.release));
    assert.ok(
      await page.evaluate(() => window.__kubb.game.nudge.inputAt > -100),
      "a slider press is input for the nudge",
    );
    // a press anywhere on the track jumps there
    await dragSlider(page, "arc", [0.1]);
    await nextFrame(page);
    const low = (await state(page)).plan;
    assert.ok(low.release < 35 && low.loft < p.loft, "lower");
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

browserTest(
  "the tilt slider settles on steps of 5, to 20 either way",
  async () => {
    const page = await open(env, "/practice/?nohowto=1", "portrait");
    try {
      await waitPhase(page, "aim", 10000);
      assert.equal((await slider(page, "side")).head, "TILT 0");
      await dragSlider(page, "side", [0.5, 0.7, 0.9, 1], { touch: true });
      await nextFrame(page);
      assert.equal((await state(page)).plan.tilt, 20);
      assert.equal((await slider(page, "side")).head, "TILT 20R");
      await dragSlider(page, "side", [1, 0.6, 0.2, 0], { touch: true });
      await nextFrame(page);
      assert.equal((await state(page)).plan.tilt, -20);
      const s = await slider(page, "side");
      assert.equal(s.head, "TILT 20L");
      assert.equal(s.min, -20);
      assert.equal(s.max, 20);
      assert.equal(s.now, -20);
      // let go between detents: the nearest, and the knob settles there
      await dragSlider(page, "side", [0.5, 0.6, 0.64], { touch: true });
      await nextFrame(page);
      const tilt = (await state(page)).plan.tilt;
      assert.equal(tilt % 5, 0);
      assert.equal(tilt, 5);
      assert.equal((await slider(page, "side")).f, sideFraction(1, false));
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

browserTest("in DRILL the slider is SPIN, to 3 either way", async () => {
  const page = await open(env, "/practice/?nohowto=1", "desktop");
  try {
    await waitPhase(page, "aim", 10000);
    await page.locator("[data-test=drill]").click();
    await page.waitForFunction(
      () => window.__kubb.game.out?.aim?.projectile === "kubb",
      null,
      { timeout: 5000, polling: 50 },
    );
    await nextFrame(page);
    assert.equal((await slider(page, "side")).head, "SPIN 0");
    await dragSlider(page, "side", [0.5, 0.8, 1]);
    await nextFrame(page);
    assert.equal((await state(page)).plan.spin, 3);
    assert.equal((await slider(page, "side")).head, "SPIN 3R");
    await dragSlider(page, "side", [0.5, 0.2, 0]);
    await nextFrame(page);
    assert.equal((await state(page)).plan.spin, -3);
    const s = await slider(page, "side");
    assert.equal(s.head, "SPIN 3L");
    assert.equal(s.max, 3);
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

browserTest("a drag shows the side view, and it goes soon after", async () => {
  const page = await open(env, "/practice/?nohowto=1", "desktop");
  try {
    await waitPhase(page, "aim", 10000);
    assert.equal(await sideViewWanted(page), false);
    const release = await dragSlider(page, "arc", [0.5, 0.7], { keep: true });
    await page.waitForTimeout(400);
    assert.equal(await sideViewWanted(page), true, "on while held");
    const mix = await page.evaluate(() => window.__kubb.game.out.aim.mix);
    assert.ok(mix > 0, `the camera swings out: ${mix}`);
    await release();
    await nextFrame(page);
    assert.equal(await sideViewWanted(page), true, "still out just after");
    await page.waitForTimeout(800);
    assert.equal(await sideViewWanted(page), false, "back after the peek");
    assert.equal(
      await page.getAttribute("[data-test=side-view]", "aria-pressed"),
      "false",
      "the button did not light",
    );
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

browserTest("SIDE VIEW is a toggle with a mouse", async () => {
  const page = await open(env, "/practice/?nohowto=1", "desktop");
  try {
    await waitPhase(page, "aim", 10000);
    const btn = page.locator("[data-test=side-view]");
    assert.equal(await btn.textContent(), "SIDE VIEW");
    await btn.click();
    await page.waitForTimeout(300);
    assert.equal(await sideViewWanted(page), true, "on after the click");
    assert.equal(await btn.getAttribute("aria-pressed"), "true");
    await btn.click();
    await page.waitForTimeout(300);
    assert.equal(await sideViewWanted(page), false, "off after another");
    assert.equal(await btn.getAttribute("aria-pressed"), "false");
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

const overlaps = (a, b) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

for (const [kind, prefs, name] of [
  ["desktop", {}, "a wide screen, the clock on the right"],
  ["desktop", { meterSide: "left" }, "a wide screen, the clock on the left"],
  ["portrait", {}, "a tall phone with the clock"],
  ["portrait", { meter: "linear" }, "a tall phone, linear on the right"],
  [
    "portrait",
    { meter: "linear", meterSide: "left" },
    "a tall phone, linear on the left",
  ],
  ["landscape", {}, "a phone on its side"],
  ["shortPhone", {}, "a short tall window"],
]) {
  browserTest(`the plan keeps clear: ${name}`, async () => {
    const page = await open(env, "/practice/?nohowto=1", kind, { prefs });
    try {
      await waitPhase(page, "aim", 10000);
      await nextFrame(page);
      const L = await page.evaluate(() => window.__kubb.game.L);
      let meter;
      if (L.meter === "linear") meter = L.dial;
      else {
        const g = await dialGeometry(page);
        // the face and the prompt plate over it
        meter = {
          x: g.cx - g.r,
          y: g.cy - g.r * 1.45,
          width: 2 * g.r,
          height: g.r * 2.45,
        };
      }
      const boxes = await page.evaluate(() => {
        const box = (el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        };
        const plans = [
          ...document.querySelectorAll("[data-test=plans] > *"),
        ].map((el) => ({ name: el.dataset.test, ...box(el) }));
        const menu = box(document.querySelector("[data-test=menu]"));
        return { plans, menu, W: innerWidth, H: innerHeight };
      });
      assert.equal(boxes.plans.length, 4);
      const map = L.minimap;
      for (const b of boxes.plans) {
        assert.ok(b.width > 0 && b.height > 0, `${b.name} shows`);
        assert.ok(!overlaps(b, meter), `${b.name} is clear of the meter`);
        assert.ok(!overlaps(b, map), `${b.name} is clear of the minimap`);
        assert.ok(!overlaps(b, boxes.menu), `${b.name} is clear of MENU`);
        assert.ok(
          b.x >= 0 && b.y >= 0 && b.x + b.width <= boxes.W,
          `${b.name} is on the screen`,
        );
        assert.ok(b.y + b.height <= boxes.H, `${b.name} is above the bottom`);
      }
      // a slider's hit area is at least 44 px across its drag direction
      const bodies = await page.evaluate(() =>
        [...document.querySelectorAll("[data-test=plans] .slider-body")].map(
          (el) => {
            const r = el.getBoundingClientRect();
            return { width: r.width, height: r.height };
          },
        ),
      );
      assert.equal(bodies.length, 2);
      assert.ok(bodies[0].width >= 44, `ARC ${bodies[0].width} wide`);
      assert.ok(bodies[1].height >= 44, `TILT ${bodies[1].height} tall`);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  });
}
