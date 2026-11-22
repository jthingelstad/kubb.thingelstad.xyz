// The plan's sliders in a real browser (src/game/plan-sliders.js; Jamie,
// 2026-11-19: "I'd like to make arc and tilt less buttons and more a slider
// with continuous movement"): ARC, TILT and SPIN take any value in the engine's
// range (engine 0.9's aim.controls; on 0.8 and 0.7 TILT and SPIN settled on
// steps), and the tray (the 1.0 design: src/game/tray.js): three plates of
// one size, each opened by a tap into its control, one at a time, ARC open the
// side view, closed by Escape, a tap outside or its band; in every layout the
// plates, closed and open, keep clear of the meter, the minimap and the header.
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
  openPlate,
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

browserTest(
  "ARC open is the side view until it closes; a TILT drag peeks, and the peek goes soon after",
  async () => {
    const page = await open(env, "/practice/?nohowto=1", "desktop");
    try {
      await waitPhase(page, "aim", 10000);
      assert.equal(await sideViewWanted(page), false);
      await openPlate(page, "arc");
      await page.waitForTimeout(400);
      assert.equal(await sideViewWanted(page), true, "on while ARC is open");
      const mix = await page.evaluate(() => window.__kubb.game.out.aim.mix);
      assert.ok(mix > 0, `the camera swings out: ${mix}`);
      await page.keyboard.press("Escape");
      await nextFrame(page);
      assert.equal(await sideViewWanted(page), false, "off when it closes");
      // TILT open is no side view; its drag is, and half a second after
      await openPlate(page, "side");
      assert.equal(
        await sideViewWanted(page),
        false,
        "TILT open: no side view",
      );
      const release = await dragSlider(page, "side", [0.5, 0.7], {
        keep: true,
      });
      assert.equal(await sideViewWanted(page), true, "on while held");
      await release();
      await nextFrame(page);
      assert.equal(await sideViewWanted(page), true, "still out just after");
      await page.waitForTimeout(800);
      assert.equal(await sideViewWanted(page), false, "back after the peek");
      assert.equal(await page.locator("[data-test=side-view]").count(), 0);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

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

// The tray (the 1.0 design): a tap opens a plate, one at a time; Escape, a tap
// outside the tray and the open plate's band close it. The keyboard reaches
// each plate with Tab (its value spoken), Enter opens it with the control
// focused, the arrows step it, and Escape gives the focus back to the plate.
const plates = (page) =>
  page.evaluate(() =>
    ["arc", "side", "stand"].map((k) => {
      const el = document.querySelector(`[data-test=plate-${k}]`);
      const t = el.querySelector(".plate-toggle");
      return {
        open: el.hasAttribute("data-open"),
        expanded: t.getAttribute("aria-expanded"),
        label: t.getAttribute("aria-label"),
        head: t.querySelector(".plate-head").textContent,
      };
    }),
  );

browserTest(
  "the plates open one at a time; Escape, a tap outside and the band close them",
  async () => {
    const page = await open(env, "/practice/?nohowto=1", "portrait");
    try {
      await waitPhase(page, "aim", 10000);
      let p = await plates(page);
      assert.deepEqual(
        p.map((x) => x.head),
        ["ARC 22°", "TILT 0", "STAND"],
      );
      assert.deepEqual(
        p.map((x) => x.label),
        ["Arc, 22 degrees", "Tilt, none", "Stand, middle, on the line"],
      );
      assert.ok(p.every((x) => !x.open && x.expanded === "false"));
      assert.equal(
        await page.getAttribute("[data-test=plans]", "aria-label"),
        "Throw set-up",
      );
      // one at a time
      await page.click("[data-test=arc-plate]");
      p = await plates(page);
      assert.deepEqual(
        p.map((x) => x.open),
        [true, false, false],
      );
      assert.equal(p[0].expanded, "true");
      await page.click("[data-test=side-plate]");
      p = await plates(page);
      assert.deepEqual(
        p.map((x) => x.open),
        [false, true, false],
      );
      assert.equal(await sideViewWanted(page), false, "ARC closed with it");
      // Escape
      await page.keyboard.press("Escape");
      assert.ok(
        (await plates(page)).every((x) => !x.open),
        "Escape closes",
      );
      // a tap outside the tray (on the pitch: it still aims)
      await page.click("[data-test=stand-plate]");
      assert.equal((await plates(page))[2].open, true);
      const before = (await state(page)).marker;
      await page.touchscreen.tap(250, 300);
      await nextFrame(page);
      assert.ok(
        (await plates(page)).every((x) => !x.open),
        "a tap outside",
      );
      const after = (await state(page)).marker;
      assert.notDeepEqual(after, before, "and the tap still aims");
      // the open plate's band
      await page.click("[data-test=arc-plate]");
      await page.click("[data-test=arc-plate]");
      assert.ok(
        (await plates(page)).every((x) => !x.open),
        "the band",
      );
      assert.equal(await sideViewWanted(page), false);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

browserTest(
  "the keyboard: Tab to a plate, Enter opens it, the arrows step it, Escape back",
  async () => {
    const page = await open(env, "/practice/?nohowto=1", "desktop");
    try {
      await waitPhase(page, "aim", 10000);
      await page.focus("[data-test=arc-plate]");
      await page.keyboard.press("Enter");
      await nextFrame(page);
      await nextFrame(page);
      assert.equal(
        await page.evaluate(() => document.activeElement.dataset.test),
        "arc",
        "the slider has the focus",
      );
      assert.equal(await sideViewWanted(page), true, "ARC open: the side view");
      const r0 = (await state(page)).plan.release;
      await page.keyboard.press("ArrowUp");
      await nextFrame(page);
      assert.ok((await state(page)).plan.release > r0, "an arrow steps it");
      await page.keyboard.press("Escape");
      await nextFrame(page);
      assert.equal(
        await page.evaluate(() => document.activeElement.dataset.test),
        "arc-plate",
        "the focus is back on the plate",
      );
      assert.equal((await plates(page))[0].open, false);
      assert.equal(await sideViewWanted(page), false);
      // the tray's order after the header: ARC, TILT, STAND, then the minimap
      const order = await page.evaluate(() =>
        [...document.querySelectorAll("#ui [tabindex='0'], #ui button")]
          .filter(
            (el) => el.offsetParent !== null || el.getClientRects().length,
          )
          .map((el) => el.dataset.test)
          .filter(Boolean),
      );
      const at = (k) => order.indexOf(k);
      assert.ok(at("menu") < at("prompt-proxy"), order.join(" "));
      assert.ok(at("prompt-proxy") < at("meter-proxy"), order.join(" "));
      assert.ok(at("meter-proxy") < at("arc-plate"), order.join(" "));
      assert.ok(at("arc-plate") < at("side-plate"), order.join(" "));
      assert.ok(at("side-plate") < at("stand-plate"), order.join(" "));
      assert.ok(at("stand-plate") < at("map-proxy"), order.join(" "));
      // R/F still set the arc without opening anything
      const r1 = (await state(page)).plan.release;
      await page
        .locator("#pitch")
        .focus()
        .catch(() => {});
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press("KeyR");
      await nextFrame(page);
      assert.ok((await state(page)).plan.release > r1, "R raises the arc");
      assert.ok((await plates(page)).every((x) => !x.open));
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

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
      const box = (sel) =>
        page.evaluate((sel) => {
          return [...document.querySelectorAll(sel)].map((el) => {
            const r = el.getBoundingClientRect();
            return {
              name: el.dataset.test,
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
            };
          });
        }, sel);
      const W = await page.evaluate(() => innerWidth);
      const H = await page.evaluate(() => innerHeight);
      const header = (await box("[data-test=rail]"))[0];
      const closed = await box("[data-test=plans] > .plate");
      assert.equal(closed.length, 3);
      // the column is where layout.js puts it, its plates the size it plans
      const t = L.tray;
      const col = (await box("[data-test=plans]"))[0];
      assert.ok(Math.abs(col.x - t.x) < 1, "the column's x");
      assert.ok(Math.abs(col.y + col.height - t.foot) < 1, "the column's foot");
      for (const b of closed) {
        assert.ok(Math.abs(b.width - t.plateW) < 0.6, `${b.name} wide`);
        assert.ok(Math.abs(b.height - t.plateH) < 0.6, `${b.name} tall`);
      }
      assert.equal(
        L.planEdge,
        prefs.meterSide === "left" ? "right" : "left",
        "the column at the edge away from the meter",
      );
      const map = L.minimap;
      const clear = (b, what) => {
        assert.ok(b.width > 0 && b.height > 0, `${what} shows`);
        assert.ok(!overlaps(b, meter), `${what} is clear of the meter`);
        assert.ok(!overlaps(b, map), `${what} is clear of the minimap`);
        assert.ok(!overlaps(b, header), `${what} is clear of the header`);
        assert.ok(
          b.x >= 0 && b.y >= 0 && b.x + b.width <= W,
          `${what} on screen`,
        );
        assert.ok(b.y + b.height <= H, `${what} is above the bottom`);
      };
      for (const b of closed) clear(b, `${b.name} closed`);
      // each open in turn: clear of the same, its control at least 44 px across
      // its drag, the minimap where it was
      for (const k of ["arc", "side", "stand"]) {
        await openPlate(page, k);
        const [b] = await box(`[data-test=plate-${k}]`);
        clear(b, `${k} open`);
        const [body] = await box(`[data-test=plate-${k}] .slider-body`);
        if (k === "arc") assert.ok(body.width >= 44, `ARC ${body.width} wide`);
        if (k === "side")
          assert.ok(body.height >= 44, `TILT ${body.height} tall`);
        if (k === "stand")
          assert.ok(
            body.width >= 44 && body.height >= 44,
            `STAND ${body.width} x ${body.height}`,
          );
        const L2 = await page.evaluate(() => window.__kubb.game.L);
        assert.deepEqual(L2.minimap, map, "the minimap does not move");
        await page.keyboard.press("Escape");
      }
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  });
}
