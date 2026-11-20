// The plan's sliders in a real browser (src/game/plan-sliders.js; Jamie,
// 2026-11-19: "I'd like to make arc and tilt less buttons and more a slider
// with continuous movement"): ARC, TILT and SPIN take any value in the engine's
// range (engine 0.9's aim.controls; on 0.8 and 0.7 TILT and SPIN settled on
// steps), a drag shows the side view, SIDE VIEW is a toggle, and
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
  sweep,
  swing,
  VIEWPORTS,
} from "./browser.mjs";

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

// Engine 0.9: the sliders take any value in the engine's range (aim.controls); the
// ticks are marks, not stops (Jamie, 2026-11-20: "sliders, not step buttons").
browserTest(
  "the tilt slider takes any value to 20 either way, between the ticks too",
  async () => {
    const page = await open(env, "/practice/?nohowto=1", "portrait");
    try {
      await waitPhase(page, "aim", 10000);
      const c = await page.evaluate(
        () => window.__kubb.game.out.aim.controls.tilt,
      );
      assert.deepEqual([c.min, c.max, c.tick], [-20, 20, 1]);
      assert.equal((await slider(page, "side")).head, "TILT 0");
      const ticks = await page.evaluate(
        () => document.querySelectorAll("[data-test=side] .slider-tick").length,
      );
      assert.equal(ticks, 41, "a mark at every degree");
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
      // let go between the old steps of 5, and off a tick: the value stays there
      await dragSlider(page, "side", [0.5, 0.6, 0.641], { touch: true });
      await nextFrame(page);
      const tilt = (await state(page)).plan.tilt;
      assert.ok(tilt > 3 && tilt < 8, `${tilt}`);
      assert.ok(
        Math.abs(tilt - Math.round(tilt)) > 0.01,
        `off a tick: ${tilt}`,
      );
      const after = await slider(page, "side");
      assert.equal(after.head, `TILT ${Math.round(tilt)}R`);
      assert.ok(Math.abs(after.f - (tilt + 20) / 40) < 1e-6, "the knob stays");
      // an arrow key moves one tick, from where it is
      await page.focus("[data-test=side]");
      await page.keyboard.press("ArrowRight");
      await nextFrame(page);
      const t2 = (await state(page)).plan.tilt;
      assert.ok(Math.abs(t2 - (tilt + 1)) < 1e-6, `${tilt} -> ${t2}`);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

// Engine 0.9: a kubb's spin is kept for the turn (in practice, throw to throw): the
// slider shows the kept value when the next kubb comes up, and nothing resets it.
browserTest("the spin a kubb was thrown with is the next kubb's", async () => {
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
    await dragSlider(page, "side", [0.5, 0.6, 0.7, 0.71]);
    await nextFrame(page);
    const spin = (await state(page)).plan.spin;
    assert.ok(spin > 0.8 && spin < 1.8, `${spin}`);
    assert.ok(
      Math.abs(spin * 4 - Math.round(spin * 4)) > 0.01,
      `off a tick: ${spin}`,
    );
    await page.waitForTimeout(900); // the side view's peek goes
    const p = (await state(page)).plan;
    await swing(
      page,
      sweep({
        back: (p.powerLo + p.powerHi) / 2,
        stop: p.release,
        backDps: 900,
        flickDps: 3600,
      }),
    );
    await waitPhase(page, "play", 3000);
    await waitPhase(page, "aim", 20000);
    await page.waitForFunction(
      () => window.__kubb.game.out?.aim?.projectile === "kubb",
      null,
      { timeout: 5000, polling: 50 },
    );
    await nextFrame(page);
    const next = await page.evaluate(() => ({
      plan: window.__kubb.game.out.aim.plan.spin,
      control: window.__kubb.game.out.aim.controls.spin.value,
    }));
    assert.ok(Math.abs(next.plan - spin) < 1e-9, `${spin} -> ${next.plan}`);
    assert.ok(Math.abs(next.control - spin) < 1e-9);
    const s = await slider(page, "side");
    assert.equal(s.head, `SPIN ${Math.round(spin * 10) / 10}R`);
    assert.ok(Math.abs(s.f - (spin + 3) / 6) < 1e-6, "the knob where it was");
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

browserTest("throwing KUBBS the slider is SPIN, to 3 either way", async () => {
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

// The engine takes no swing while the plan view is wanted, so the half
// second of side view after a slider must end the moment a throw begins.
browserTest(
  "a throw started right after a slider is let go is a whole throw",
  async () => {
    const page = await open(env, "/practice/?nohowto=1", "desktop");
    try {
      await waitPhase(page, "aim", 10000);
      await dragSlider(page, "arc", [0.5, 0.6]);
      assert.equal(await sideViewWanted(page), true, "the peek is on");
      const p = (await state(page)).plan;
      const arms = sweep({
        back: (p.powerLo + p.powerHi) / 2,
        stop: p.release,
        backDps: 900,
        flickDps: 3600,
      });
      await swing(page, arms);
      await waitPhase(page, "play", 3000);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

// MENU opened by another finger hides the sliders under the one holding
// one: the hold ends for the game too, so the side view (and with it the
// engine's refusal to take a swing) does not outlast the menu.
browserTest(
  "a slider hidden while it is held lets the side view go",
  async () => {
    const page = await open(env, "/practice/?nohowto=1", "portrait");
    try {
      await waitPhase(page, "aim", 10000);
      const release = await dragSlider(page, "arc", [0.5, 0.6], {
        touch: true,
        keep: true,
      });
      assert.equal(await sideViewWanted(page), true, "held: the side view");
      const menu = () =>
        page.evaluate(() => document.querySelector("[data-test=menu]").click());
      await menu();
      await nextFrame(page);
      await nextFrame(page);
      await release();
      await menu();
      await nextFrame(page);
      assert.equal(
        await page.evaluate(() => window.__kubb.game.slide),
        null,
        "the game holds no slider",
      );
      assert.equal(await sideViewWanted(page), false, "the side view is off");
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

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

// What a held slider does, shown on the control while it is used (a
// tester, 2026-11-19: "I can't tell what tilt does at all"; Jamie: "Have the
// UI show it not a separate how to page").
const caption = (page) =>
  page.evaluate(() => {
    const el = document.querySelector("[data-test=plan-caption]");
    const r = el.getBoundingClientRect();
    const wood = el.querySelector(".cap-wood");
    return {
      shown: !el.hidden,
      text: el.querySelector(".cap-text").textContent,
      what: el.dataset.what,
      baton: !el.querySelector(".cap-baton").hidden,
      lean: wood.style.transform,
      box: { x: r.x, y: r.y, width: r.width, height: r.height },
      plans: document.querySelector("[data-test=plans]").getBoundingClientRect()
        .top,
    };
  });

browserTest(
  "a held slider says what it does, TILT with a leaning baton",
  async () => {
    const page = await open(env, "/practice/?nohowto=1", "portrait", {
      prefs: { meter: "linear" },
    });
    try {
      await waitPhase(page, "aim", 10000);
      assert.equal((await caption(page)).shown, false, "hidden at rest");
      const release = await dragSlider(page, "arc", [0.5, 0.6], {
        touch: true,
        keep: true,
      });
      let c = await caption(page);
      assert.equal(c.shown, true);
      assert.equal(c.what, "arc");
      assert.equal(
        c.text,
        "A higher arc drops in steeper. A lower one skids in.",
      );
      assert.equal(c.baton, false);
      assert.ok(
        c.box.y + c.box.height <= c.plans,
        "above the plan, clear of the finger",
      );
      const L = await page.evaluate(() => window.__kubb.game.L);
      assert.ok(!overlaps(c.box, L.dial), "clear of the meter");
      await release();
      await page.waitForTimeout(800);
      assert.equal((await caption(page)).shown, false, "gone after the peek");
      const r2 = await dragSlider(page, "side", [0.5, 0.75], {
        touch: true,
        keep: true,
      });
      c = await caption(page);
      assert.equal(c.what, "tilt");
      assert.equal(c.text, "Tilt leans the baton to steer it through a group.");
      assert.equal(c.baton, true);
      assert.equal(c.lean, `rotate(${(await state(page)).plan.tilt}deg)`);
      assert.notEqual(c.lean, "rotate(0deg)");
      await r2();
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

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
  [
    "landscape",
    { meterSide: "left" },
    "a phone on its side, meter on the left",
  ],
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
        const block = box(document.querySelector("[data-test=plans]"));
        return { plans, menu, block, W: innerWidth, H: innerHeight };
      });
      assert.equal(boxes.plans.length, 4);
      // a wide screen's block is the size layout.js plans for (tune.planW,
      // planH), and on a touchscreen at the edge away from the meter
      if (L.plan) {
        const b = boxes.block;
        for (const k of ["x", "y", "width", "height"])
          assert.ok(Math.abs(b[k] - L.plan[k]) < 1, `the block's ${k}`);
      }
      if (kind === "landscape")
        assert.equal(
          L.planEdge,
          prefs.meterSide === "left" ? "right" : "left",
          "the block at the far edge",
        );
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
      assert.equal(bodies.length, 3);
      assert.ok(bodies[0].width >= 44, `ARC ${bodies[0].width} wide`);
      assert.ok(bodies[1].height >= 44, `TILT ${bodies[1].height} tall`);
      // STAND is dragged both ways
      assert.ok(
        bodies[2].width >= 44 && bodies[2].height >= 44,
        `STAND ${bodies[2].width} x ${bodies[2].height}`,
      );
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  });
}
