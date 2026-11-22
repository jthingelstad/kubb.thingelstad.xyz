// The owner's play of 2026-11-22, in a real browser (web 0.17.0): the verdict never
// stops an aim (no presses, gone at the first aim input, never over the target ring,
// the tray, the minimap or the meter in any layout); the raise view shows twice as much
// and its kubb is still easy to hit; an automatic raise is watched, sends the same
// actions in the same order and can be skipped; the engine's own raises are watched.
// Skipped with a notice when Playwright's Chromium is not installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, open, waitPhase, nextFrame } from "./browser.mjs";
import { tune as gameTune } from "../../src/game/game.js";
import { tune as liftTune } from "../../src/game/lift.js";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/feedback-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

let env;
before(async () => {
  if (available) env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
});

const RAISE = fs.readFileSync("tests/fixtures/snap-raise.json", "utf8");
const LAST_KUBB = fs.readFileSync("tests/fixtures/snap-last-kubb.json", "utf8");

// The owner's iPhone in Safari with the app banner: a short upright window.
const SAFARI = {
  viewport: { width: 402, height: 665 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};

const SOLO = (scene = "tournament", computer = "beginner") => ({
  solo: { scene, computer, opening: "246", raising: "hand", wind: "none" },
  throwsMade: 5,
});

// A solo match on its first aim, the hand-off card gone.
async function soloAim(kind, prefs = {}, context = {}) {
  const page = await open(env, "/p/abcdefgh?solo=1&play=1&nohowto=1", kind, {
    prefs: { ...SOLO(), ...prefs },
    context,
  });
  const start = page.getByRole("button", { name: "START", exact: true });
  if (await start.count()) await start.first().click();
  await page.waitForFunction(
    () => window.__kubb.game.mode === "match" && window.__kubb.game.need,
  );
  const go = page.getByRole("button", { name: "THROW", exact: true });
  await go.first().click({ timeout: 10000 });
  await waitPhase(page, "aim");
  return page;
}

const meets = (a, b, pad = 0) =>
  !!a &&
  !!b &&
  a[0] < b[2] + pad &&
  b[0] < a[2] + pad &&
  a[1] < b[3] + pad &&
  b[1] < a[3] + pad;

// The verdict's box and what it must keep clear of, CSS px [left, top, right, bottom].
const verdictLayout = (page) =>
  page.evaluate(() => {
    const g = window.__kubb.game;
    const r = (el) => {
      if (!el || el.hidden) return null;
      const b = el.getBoundingClientRect();
      return b.width ? [b.left, b.top, b.right, b.bottom] : null;
    };
    const box = (q) => q && [q.x, q.y, q.x + q.width, q.y + q.height];
    const m = g.out.aim.marker;
    const ring = [
      g.screenOf({ x: m.x - m.r, y: m.y }),
      g.screenOf({ x: m.x + m.r, y: m.y }),
      g.screenOf({ x: m.x, y: m.y - m.r }),
      g.screenOf({ x: m.x, y: m.y + m.r }),
    ];
    const flag = document.querySelector("[data-test=flag]");
    const chips = document.querySelector("[data-test=verdicts]");
    return {
      flag: r(flag),
      chips: r(chips),
      events: [flag, chips, ...chips.children].map(
        (el) => getComputedStyle(el).pointerEvents,
      ),
      ring: [
        Math.min(...ring.map((q) => q.x)),
        Math.min(...ring.map((q) => q.y)),
        Math.max(...ring.map((q) => q.x)),
        Math.max(...ring.map((q) => q.y)),
      ],
      centre: g.screenOf(m),
      plates: [...document.querySelectorAll("[data-test$=-plate]")]
        .map(r)
        .filter(Boolean),
      minimap: box(g.L.minimap),
      meter: box(g.L.dial),
      header: box(g.L.header),
      H: g.H,
      far: g.screenOf({ x: 0, y: 8 }).y,
      tall: g.L.tall,
    };
  });

const showVerdict = (page) =>
  page.evaluate(() => {
    // the tallest verdict: three off words and the flag
    window.__kubb.game.result = {
      flag: "1 DOWN",
      verdicts: {
        power: "LONG",
        release: "ON",
        steady: "SHAKY",
        side: "PULLED LEFT",
      },
      age: 0.9,
    };
  });

const LAYOUTS = [
  ["the owner's Safari window, 402 x 665", null, {}, SAFARI],
  ["390 x 844, the clock", "portrait", {}],
  ["390 x 844, linear right", "portrait", { meter: "linear" }],
  [
    "390 x 844, linear left",
    "portrait",
    { meter: "linear", meterSide: "left" },
  ],
  ["844 x 390, the clock", "landscape", {}],
  ["844 x 390, linear right", "landscape", { meter: "linear" }],
  [
    "844 x 390, linear left",
    "landscape",
    { meter: "linear", meterSide: "left" },
  ],
  [
    "1280 x 800",
    "desktop",
    {},
    { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  ],
  [
    "1280 x 800, linear left",
    "desktop",
    { meter: "linear", meterSide: "left" },
    { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  ],
];

browserTest(
  "the verdict takes no presses and never covers the target ring, the tray, the minimap, the meter or the header",
  async () => {
    for (const [what, kind, prefs, context] of LAYOUTS) {
      const page = await soloAim(kind || "portrait", prefs, context || {});
      await showVerdict(page);
      await nextFrame(page);
      await nextFrame(page);
      const L = await verdictLayout(page);
      assert.ok(L.flag && L.chips, `${what}: shown`);
      assert.deepEqual([...new Set(L.events)], ["none"], `${what}: no presses`);
      for (const v of [L.flag, L.chips]) {
        assert.ok(!meets(v, L.ring, 4), `${what}: the ring ${L.ring} ${v}`);
        assert.ok(!meets(v, L.minimap), `${what}: the minimap`);
        assert.ok(!meets(v, L.meter), `${what}: the meter`);
        assert.ok(!meets(v, L.header), `${what}: the header`);
        for (const p of L.plates)
          assert.ok(!meets(v, p), `${what}: a tray plate ${p} ${v}`);
      }
      // upright the far baseline stands at 41% of the height
      if (L.tall)
        assert.ok(
          Math.abs(L.far / L.H - 0.41) < 0.01,
          `${what}: far ${L.far / L.H}`,
        );
      await page.context().close();
    }
  },
);

browserTest(
  "a press where the verdict is drawn aims, and the first aim input takes the verdict away",
  async () => {
    // a finger: a tap on the ring under the verdict's band
    const phone = await soloAim("portrait", {}, SAFARI);
    await showVerdict(phone);
    await nextFrame(phone);
    const L = await verdictLayout(phone);
    // press on the pitch inside the flag's box: it reaches the canvas
    const at = {
      x: (L.flag[0] + L.flag[2]) / 2,
      y: (L.flag[1] + L.flag[3]) / 2,
    };
    const hit = await phone.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.tagName,
      at,
    );
    assert.equal(hit, "CANVAS", "the canvas is under the verdict");
    await phone.touchscreen.tap(L.centre.x, L.centre.y);
    await nextFrame(phone);
    await nextFrame(phone);
    assert.ok(
      (await phone.evaluate(() => window.__kubb.game.result.age)) >=
        gameTune.flagFor,
    );
    assert.equal(await phone.isHidden("[data-test=flag]"), true);
    await phone.context().close();

    // a key, and a tray plate
    const desk = await soloAim("desktop");
    await showVerdict(desk);
    await nextFrame(desk);
    assert.equal(await desk.isVisible("[data-test=flag]"), true);
    await desk.keyboard.press("KeyR");
    await nextFrame(desk);
    await nextFrame(desk);
    assert.equal(await desk.isHidden("[data-test=flag]"), true, "a key");
    await showVerdict(desk);
    await nextFrame(desk);
    await desk.click("[data-test=arc-plate]");
    await nextFrame(desk);
    await nextFrame(desk);
    assert.equal(await desk.isHidden("[data-test=flag]"), true, "a plate");
    // untouched it stays only flagFor from the throw's rest
    await desk.keyboard.press("Escape");
    await desk.evaluate((t) => {
      window.__kubb.game.result = { flag: "MISS", verdicts: null, age: t };
    }, gameTune.flagFor - 0.2);
    await desk.waitForSelector("[data-test=flag]", { state: "hidden" });
    await desk.context().close();
  },
);

// A raise by hand of four kubbs (the fixture: the computer threw them into this
// browser's half), adopted into a solo match, the sent actions recorded.
async function raisePage(kind) {
  const page = await soloAim(kind, { solo: { ...SOLO("day").solo } });
  await page.evaluate((snap) => {
    const g = window.__kubb.game;
    g.adopt(snap);
    window.__sent = [];
    window.__phases = [];
    const on = g.onAction;
    g.onAction = (a, ...rest) => {
      window.__sent.push(a);
      return on?.(a, ...rest);
    };
    const watch = () => {
      // the phase and the raise need's kubb (a watched raise keeps its need)
      const k = `${g.phase}:${g.need?.kind === "raise" ? g.need.n : ""}`;
      if (window.__phases.at(-1)?.[0] !== k)
        window.__phases.push([k, performance.now()]);
      requestAnimationFrame(watch);
    };
    watch();
  }, RAISE);
  await waitPhase(page, "raise");
  return page;
}

browserTest(
  "the raise view shows twice the ground; the kubb's touch target stays 44 px or more and the numbers sit clear of it",
  async () => {
    for (const kind of ["portrait", "landscape", "desktop"]) {
      const page = await raisePage(kind);
      await nextFrame(page);
      const r = await page.evaluate(() => {
        const g = window.__kubb.game;
        const s = g.raiseShape();
        const xs = s.outline.map((p) => p[0]),
          ys = s.outline.map((p) => p[1]);
        const panel = document
          .querySelector("[data-test=raise]")
          ?.getBoundingClientRect();
        return {
          w: Math.max(...xs) - Math.min(...xs),
          h: Math.max(...ys) - Math.min(...ys),
          bottom: Math.max(...ys),
          ends: g.endPoints(),
          panelTop: panel?.top ?? g.H,
          H: g.H,
          W: g.W,
        };
      });
      const slop = 24;
      assert.ok(
        r.w + 2 * slop >= 44 && r.h + 2 * slop >= 44,
        `${kind}: target`,
      );
      assert.ok(r.w < 100, `${kind}: drawn smaller than before (${r.w} px)`);
      for (const e of r.ends) {
        assert.ok(e.lx > 17 && e.lx < r.W - 17, `${kind}: a number on screen`);
        // the number's circle (17 px) is clear of its footprint's middle
        assert.ok(Math.hypot(e.lx - e.x, e.ly - e.y) >= 17, `${kind}: clear`);
        assert.ok(e.ly + 17 <= r.panelTop, `${kind}: above the panel`);
      }
      assert.ok(r.bottom <= r.panelTop, `${kind}: the kubb above the panel`);
      await page.context().close();
    }
  },
);

browserTest(
  "AUTO ALL is watched kubb by kubb, sends the same raise actions in order, and a tap skips it",
  async () => {
    const page = await raisePage("portrait");
    const of = await page.evaluate(() => window.__kubb.game.need.of);
    assert.equal(of, 4);
    await page.click("[data-test=raise-auto-all]");
    await page.waitForFunction(() => window.__kubb.game.phase === "aim", null, {
      timeout: 10000,
    });
    const sent = await page.evaluate(() => window.__sent);
    assert.deepEqual(sent, Array(4).fill({ type: "raise" }));
    const phases = await page.evaluate(() => window.__phases);
    const lifts = phases.filter(([k]) => k.startsWith("lift:"));
    assert.ok(lifts.length >= 4, `each kubb watched: ${JSON.stringify(lifts)}`);
    const t0 = phases.find(([k]) => k.startsWith("raise"))[1];
    const t1 = phases.find(([k]) => k.startsWith("aim"))[1];
    assert.ok(
      (t1 - t0) / 1000 <= liftTune.total + 1.2,
      `the whole raise: ${((t1 - t0) / 1000).toFixed(2)} s`,
    );
    assert.ok((t1 - t0) / 1000 >= 4 * 0.4, "not at once");
    await page.context().close();

    // skipped: a tap during the first kubb stands the rest at once
    const skip = await raisePage("portrait");
    await skip.click("[data-test=raise-auto-all]");
    await skip.waitForFunction(() => window.__kubb.game.phase === "lift");
    const tap = Date.now();
    await skip.touchscreen.tap(200, 400);
    await skip.waitForFunction(() => window.__kubb.game.phase === "aim", null, {
      timeout: 3000,
    });
    assert.ok(Date.now() - tap < 1500, "skipped to the end");
    assert.deepEqual(
      await skip.evaluate(() => window.__sent),
      Array(4).fill({ type: "raise" }),
      "the same actions",
    );
    await skip.context().close();
  },
);

browserTest(
  "with reduced motion the kubbs still stand one at a time; the engine's own raises stand at once until the engine hands them out",
  async () => {
    const page = await soloAim(
      "portrait",
      { solo: { ...SOLO("day").solo } },
      {
        reducedMotion: "reduce",
      },
    );
    await page.evaluate((snap) => window.__kubb.game.adopt(snap), RAISE);
    await waitPhase(page, "raise");
    await page.click("[data-test=raise-auto]");
    assert.equal(await page.evaluate(() => window.__kubb.game.phase), "lift");
    await page.context().close();

    // the computer against itself raising automatically: its last kubb thrown in, then
    // the engine stands them itself. Those raises have no need and no action, and wait
    // for the engine to hand them out (engine 0.16.0's setup.settled; lift.js
    // settledClips): today they stand at once, as before web 0.17.0, never watched
    const watch = await soloAim("portrait", { solo: { ...SOLO("day").solo } });
    await watch.evaluate((snap) => {
      const g = window.__kubb.game;
      window.__lifted = false;
      const look = () => {
        if (g.phase === "lift") window.__lifted = true;
        requestAnimationFrame(look);
      };
      look();
      g.adopt(snap);
    }, LAST_KUBB);
    await watch.waitForFunction(
      () => window.__kubb.game.need?.setup?.kind === "baton",
      null,
      { timeout: 60000 },
    );
    assert.equal(await watch.evaluate(() => window.__lifted), false);
    assert.equal(
      await watch.evaluate(() => window.__kubb.game.need.setup.kind),
      "baton",
    );
    await watch.context().close();
  },
);
