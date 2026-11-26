// The game client in a real browser: Playwright's Chromium against the
// `npm run build` output, served by tools/preview.mjs on a free 127.0.0.1
// port (tests/game/browser.mjs). Skipped with a notice when Chromium is not
// installed (npx playwright install chromium).
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
  watchThrows,
  dialGeometry,
  nextFrame,
  VIEWPORTS,
} from "./browser.mjs";
import { linearGeometry } from "../../src/render/linear.js";
import { tune as layoutTune } from "../../src/game/layout.js";
import { startPitchServer } from "../../tools/pitch-dev.mjs";
import { Engine } from "../../src/engine/index.js";
import { bundleLua } from "../../tools/lua-bundle.mjs";
import { replayReport } from "../../tools/reports.mjs";
import { paintProblem } from "../../src/net/paint.js";
import { browserMatch, replayBrowser } from "../../tools/games.mjs";

// The local api's kept records under `prefix` ("reports/", "games/browser/"), oldest
// first and read afresh on every look: [{ key, text }] (backend/api/records.mjs keys).
const keptUnder = (server, prefix) => ({
  get kept() {
    return [...server.api.records.kept]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, text]) => ({ key, text: String(text) }));
  },
});

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

let env;
before(async () => {
  if (available) env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
});

// A swing at the middle of the power band, released on the plan's release
// mark. The Playwright mouse and CDP touch need two animation frames a step
// (a round trip each), so the flick is given twice the per-frame speed a
// hand gives (docs/CLIENT.md "Swing feel").
async function throwOnce(page, opts = {}) {
  const p = (await state(page)).plan;
  assert.ok(p, "an aim plan");
  const arms = sweep({
    back: (p.powerLo + p.powerHi) / 2,
    stop: p.release,
    backDps: 900,
    flickDps: 3600,
  });
  await swing(page, arms, opts);
}

browserTest("practice loads with no console errors", async () => {
  const page = await open(env, "/practice/?nohowto=1");
  await waitPhase(page, "aim", 10000);
  const s = await state(page);
  assert.equal(s.phase, "aim");
  assert.ok(s.dial, "the dial is drawn");
  assert.equal(
    await page.locator("[data-test=loading]").count(),
    0,
    "the loading card is gone",
  );
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

browserTest(
  "a mouse swing on the dial throws and returns to aiming",
  async () => {
    const page = await open(env, "/practice/?nohowto=1");
    await waitPhase(page, "aim", 10000);
    await watchThrows(page);
    await throwOnce(page);
    await waitPhase(page, "play", 5000);
    await waitPhase(page, "aim", 20000);
    const throws = await page.evaluate(() => window.__throws);
    assert.equal(throws.length, 1);
    assert.equal(throws[0].local, true);
    assert.ok(throws[0].result, "the throw has a result");
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },
);

// Tyler's report, 2026-11-16: three throws he took for perfect had been
// judged long. A swing well past the power band with a hard flick is long;
// its LONG chip is the off-target style, ahead of the on-target ones.
browserTest("a long throw shows its LONG chip first, inverted", async () => {
  const page = await open(env, "/practice/?nohowto=1");
  await waitPhase(page, "aim", 10000);
  await watchThrows(page);
  const p = (await state(page)).plan;
  await swing(
    page,
    sweep({
      back: p.powerHi + 30,
      stop: p.release,
      backDps: 900,
      flickDps: 3600,
    }),
  );
  await waitPhase(page, "play", 5000);
  await page.waitForSelector(".verdicts .chip", { timeout: 20000 });
  const throws = await page.evaluate(() => window.__throws);
  assert.equal(throws[0].result.verdicts.power, "LONG", "the throw is long");
  const chips = await page.$$eval(".verdicts .chip", (els) =>
    els.map((e) => {
      const cs = getComputedStyle(e);
      return {
        text: e.textContent,
        off: e.classList.contains("off"),
        bg: cs.backgroundColor,
        size: parseFloat(cs.fontSize),
        icon: e.dataset.icon || null,
        svg: !!e.querySelector("svg.verdict-icon"),
      };
    }),
  );
  // the 1.0 design: the off word at 18 px with its arrow (up for LONG)
  assert.equal(chips[0].size, 18);
  assert.equal(chips[0].icon, "up");
  assert.ok(chips[0].svg, "the arrow is drawn");
  assert.ok(
    chips.slice(1).every((c) => c.off || !c.svg),
    "on chips: no arrow",
  );
  // said once to a screen reader, the off word first
  const said = await page.textContent("[data-test=verdict-said]");
  assert.match(said, /^Long\. /);
  assert.deepEqual(
    { text: chips[0].text, off: chips[0].off },
    { text: "LONG", off: true },
  );
  assert.ok(!chips.some((c) => c.text.startsWith("POWER")), "no POWER chip");
  const firstOn = chips.findIndex((c) => !c.off);
  assert.ok(
    chips.slice(firstOn).every((c) => !c.off),
    "the off chips come first",
  );
  const ink = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--ink"),
  );
  assert.equal(chips[0].bg, "rgb(22, 19, 15)", `ink background (${ink})`);
  if (firstOn > 0)
    assert.ok(chips[0].size > chips[firstOn].size, "the off chip is larger");
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

browserTest(
  "dragging the target circle moves the engine's target",
  async () => {
    const page = await open(env, "/practice/?nohowto=1");
    await waitPhase(page, "aim", 10000);
    const before = await page.evaluate(() => window.__kubb.engine.aimState());
    const at = await page.evaluate(() => {
      const g = window.__kubb.game;
      return g.screenOf(g.out.aim.marker);
    });
    assert.ok(at, "the circle is on the screen");
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++)
      await page.mouse.move(at.x - i * 12, at.y + i * 4);
    await page.mouse.up();
    const after = await page.evaluate(() => window.__kubb.engine.aimState());
    assert.notDeepEqual(after, before, "the aim state changed");
    const s = await state(page);
    assert.equal(s.phase, "aim", "a drag on the circle does not throw");
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },
);

// A finger aims as on the iPhone (a tester, 2026-11-19: aiming is "very
// touchy and hard to place"): a drag from the circle, or from anywhere on
// the pitch, moves it half the finger's travel and never jumps it under the
// finger; a tap still places it. The aim camera follows the circle, so this
// is measured on the ground, under the camera of the press.
async function touchDrag(page, from, dx, dy, steps = 8) {
  // the ground under the press's camera: the circle, the finger's full and
  // half travel
  const want = await page.evaluate(
    ([x0, y0, dx, dy]) => {
      const g = window.__kubb.game;
      const cam = g.out.camera;
      const m = g.out.aim.marker;
      const at = g.screenOf(m);
      return {
        m: { x: m.x, y: m.y },
        full: g.ground(at.x + dx, at.y + dy, cam),
        half: g.ground(at.x + dx / 2, at.y + dy / 2, cam),
        finger: g.ground(x0 + dx, y0 + dy, cam),
      };
    },
    [...from, dx, dy],
  );
  const cdp = await page.context().newCDPSession(page);
  const tp = (x, y) => [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }];
  const send = (type, pts) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
  await send("touchStart", tp(...from));
  for (let i = 1; i <= steps; i++) {
    await send(
      "touchMove",
      tp(from[0] + (dx * i) / steps, from[1] + (dy * i) / steps),
    );
    await nextFrame(page);
  }
  await send("touchEnd", []);
  await cdp.detach();
  await nextFrame(page);
  const got = (await state(page)).marker;
  return { ...want, got: { x: got.x, y: got.y } };
}

browserTest(
  "a finger moves the circle at half its travel, from the circle or anywhere on the pitch",
  async () => {
    const page = await open(env, "/practice/?nohowto=1", "portrait");
    try {
      await waitPhase(page, "aim", 10000);
      await watchThrows(page);
      const near = (a, b, eps) => Math.hypot(a.x - b.x, a.y - b.y) <= eps;
      // from the circle: 80 px right puts it where 40 px is
      const at = await page.evaluate(() => {
        const g = window.__kubb.game;
        return g.screenOf(g.out.aim.marker);
      });
      let r = await touchDrag(page, [at.x, at.y], 80, 0);
      const half = Math.abs(r.half.x - r.m.x);
      assert.ok(half > 0.05, "the drag is long enough to measure");
      assert.ok(near(r.got, r.half, half * 0.2), JSON.stringify(r));
      assert.ok(!near(r.got, r.full, half * 0.5), "not under the finger");
      for (let i = 0; i < 20; i++) await nextFrame(page);
      // from the far half of the pitch, away from the circle: 40 px right
      // (not back onto the kubb, where letting go snaps to it)
      const at2 = await page.evaluate(() => {
        const g = window.__kubb.game;
        return g.screenOf(g.out.aim.marker);
      });
      const from = [390 * 0.25, 844 * 0.42];
      assert.ok(Math.hypot(from[0] - at2.x, from[1] - at2.y) > 80, "away");
      r = await touchDrag(page, from, 40, 0);
      const h2 = Math.abs(r.half.x - r.m.x);
      assert.ok(near(r.got, r.half, h2 * 0.2), JSON.stringify(r));
      assert.ok(!near(r.got, r.finger, 0.3), "never jumps under the finger");
      assert.equal((await state(page)).phase, "aim");
      assert.deepEqual(await page.evaluate(() => window.__throws), []);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

browserTest(
  "a first visit's HOW TO THROW stands over the first hand-off, which waits for it",
  async () => {
    // PLAY NOW on a device that has never played: the match starts at once and
    // the guide opens with it. The guide is the top card; the hand-off's card is
    // not shown under it, and takes its place when the guide is closed.
    const page = await open(env, "/p/abcdefgh?solo=1&play=1");
    await page.waitForSelector("[data-test=howto]");
    await page.waitForSelector("[data-test=handoff]", { state: "attached" });
    const under = await page.evaluate(() => {
      const how = document.querySelector("[data-test=howto]");
      const r = how.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + 12);
      const hand = document.querySelector("[data-test=handoff]");
      const go = document.querySelector("[data-test=handoff-go]");
      const gr = go.getBoundingClientRect();
      return {
        guideOnTop: how.contains(top),
        handoff: getComputedStyle(hand).visibility,
        goReachable: go.contains(
          document.elementFromPoint(gr.x + gr.width / 2, gr.y + gr.height / 2),
        ),
      };
    });
    assert.equal(under.guideOnTop, true);
    assert.equal(under.handoff, "hidden");
    assert.equal(under.goReachable, false);
    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-test=handoff]", { state: "visible" });
    // the keyboard is on the hand-off's THROW, not left on the page
    await page.waitForFunction(
      () => document.activeElement?.dataset.test === "handoff-go",
      null,
      { timeout: 2000 },
    );
    await page.keyboard.press("Enter");
    await waitPhase(page, "aim", 10000);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },
);

browserTest(
  "a solo match plays your throw, the computer's WATCH and a hand-off",
  async () => {
    const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1");
    await page.click("[data-test=start]");
    await page.waitForSelector("[data-test=handoff]");
    // the 1.0 hand-off: a short card at the foot, the title, one line, one go
    const card = await page.evaluate(() => {
      const el = document.querySelector("[data-test=handoff]");
      const r = el.getBoundingClientRect();
      return {
        title: el.querySelector("[data-test=handoff-title]").textContent,
        line: el.querySelector("[data-test=handoff-line]").textContent,
        buttons: [...el.querySelectorAll("button")].map((b) => b.textContent),
        map: !!el.querySelector("canvas"),
        kicker: !!el.querySelector(".kicker"),
        foot: innerHeight - r.bottom,
        header: getComputedStyle(document.querySelector("[data-test=rail]"))
          .visibility,
      };
    });
    assert.equal(card.title, "Your turn");
    assert.equal(card.line, "Two batons. Aim for the base kubbs.");
    assert.deepEqual(card.buttons, ["THROW"]);
    assert.equal(card.map, false, "no map");
    assert.equal(card.kicker, false, "no turn number");
    assert.ok(card.foot < 40, `at the foot: ${card.foot}`);
    assert.equal(card.header, "visible", "the header shows over the dim");
    await page.click("[data-test=handoff-go]");
    await watchThrows(page);
    // our two batons
    for (let i = 0; i < 2; i++) {
      await waitPhase(page, "aim", 10000);
      await throwOnce(page);
      await waitPhase(page, "play", 5000);
      await page.evaluate(() => window.__kubb.game.skip());
    }
    // the computer's turn: WATCH
    await page.waitForFunction(() => window.__kubb.game.need?.cpu, null, {
      timeout: 20000,
    });
    // no card: the header, WATCH on the computer's colour, the faded meter
    await page.waitForFunction(
      () => window.__kubb.game.meterShown?.prompt === "WATCH",
      null,
      { timeout: 5000 },
    );
    const cpu = await page.evaluate(() => ({
      meter: window.__kubb.game.meterShown,
      card: !!document.querySelector("[data-test=handoff]"),
      status: document.querySelector("[data-test=status]").textContent,
      side: window.__kubb.game.need.side,
    }));
    assert.equal(cpu.card, false, "no card for the computer's turn");
    assert.equal(cpu.meter.faded, true, "the meter faded");
    assert.equal(
      cpu.meter.promptFill,
      cpu.side === "B" ? "#8e44ad" : "#f2b705",
    );
    assert.equal(cpu.meter.distance, null, "no distance on a watched turn");
    assert.equal(cpu.status, "", "no WATCH pill as well");
    // play on (skipping playback, raising automatically) until a hand-off
    // card gives the pitch back to us
    const deadline = Date.now() + 90000;
    let handed = false;
    while (Date.now() < deadline && !handed) {
      handed = await page.evaluate(() => {
        const g = window.__kubb.game;
        const card = document.querySelector("[data-test=handoff]");
        if (card && g.need && !g.need.cpu) return true;
        if (g.phase === "play") g.skip();
        const go = document.querySelector(
          "[data-test=handoff-go], [data-test=pass] .btn, [data-test=settle] .btn",
        );
        if (go && g.need?.cpu) go.click();
        if (g.phase === "raise" && g.mayAct(g.need))
          document.querySelector("[data-test=raise-auto]")?.click();
        if (g.phase === "punish" && g.mayAct(g.need)) g.punish();
        return false;
      });
      if (!handed) await page.waitForTimeout(100);
    }
    assert.ok(handed, "a hand-off card back to us");
    const throws = await page.evaluate(() => window.__throws);
    assert.ok(throws.filter((t) => t.local).length >= 2, "our throws");
    assert.ok(
      throws.some((t) => !t.local),
      "the computer's throws",
    );
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },
);

// Raising (src/game/auto-raise.js): the panel, MENU's row and the game's
// frame together. A raise is stood in for the engine's (a match takes a
// minute to reach one): `need` as the engine gives it, and game.raise
// recording what it was asked. The timing itself is auto-raise.test.mjs's, and the
// watched raise's feedback-client.test.mjs's.
browserTest(
  "raising: AUTO ALL for the turn, MENU's Raising and REST OF GAME for the match, BY HAND back",
  async () => {
    const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1");
    await page.click("[data-test=start]");
    await page.click("[data-test=handoff-go]");
    await waitPhase(page, "aim", 10000);
    await page.evaluate(() => {
      const g = window.__kubb.game;
      window.__raised = [];
      // the raise scene needs the engine's kubb; the panel is what is tested
      g.drawStill = () => g.cards.tick(g);
      window.__stage = (turn, of) => {
        const need = (n) => ({
          kind: "raise",
          team: "YOU",
          turn,
          kubb: `k${turn}-${n}`,
          n,
          of,
          ends: [{}, {}],
        });
        g.raise = (i) => {
          window.__raised.push(i);
          if (g.need.n < of) g.need = need(g.need.n + 1);
          else {
            g.need = { kind: "throw" };
            g.phase = "wait";
          }
          return { ok: true };
        };
        g.need = need(1);
        g.phase = "raise";
      };
      window.__stage(4, 3);
    });
    const has = (name) =>
      page.locator(`[data-test=${name}]`).count().then(Boolean);
    const raised = () => page.evaluate(() => window.__raised.length);
    const auto = () => page.evaluate(() => window.__kubb.game.autoRaise);
    await page.waitForSelector("[data-test=raise-auto]");
    assert.ok(await has("raise-auto-all"), "AUTO ALL with more to raise");

    // AUTO ALL: the rest of this turn's, each on the engine's choice
    const t0 = Date.now();
    await page.click("[data-test=raise-auto-all]");
    assert.match(
      await page.locator("[data-test=raise-note]").textContent(),
      /the rest automatically/,
    );
    assert.ok(await has("raise-hand"));
    assert.ok(await has("raise-auto-game"));
    await page.waitForFunction(() => window.__raised.length === 3);
    // the first lies its wait; the rest follow at once here, where the stand-in raise
    // has no clip to watch (the real pace is feedback-client.test.mjs's)
    assert.ok(Date.now() - t0 >= 350, "the first after its wait");
    assert.deepEqual(await page.evaluate(() => window.__raised), [
      null,
      null,
      null,
    ]);
    await nextFrame(page);
    assert.equal((await auto()).turn, false, "it ends with the turn");

    // the next turn is by hand again; REST OF GAME on the panel makes it the
    // match's, and MENU's Raising row (the 1.0 design) offers the same choice
    await page.evaluate(() => window.__stage(6, 2));
    await page.waitForSelector("[data-test=raise-auto]");
    assert.ok(await has("raise-auto-game"), "REST OF GAME offered by hand");
    await page.click("[data-test=menu]");
    assert.ok(await has("menu-raising"), "and MENU's Raising");
    await page.keyboard.press("Escape");
    await page.click("[data-test=raise-auto-game]");
    assert.match(
      await page.locator("[data-test=raise-note]").textContent(),
      /rest of the game/,
    );
    assert.equal(await has("raise-auto-game"), false);
    await page.waitForFunction(() => window.__raised.length === 5);

    // and it is still on a turn later, until BY HAND
    await page.evaluate(() => window.__stage(8, 2));
    await page.click("[data-test=raise-hand]");
    await page.waitForSelector("[data-test=raise-auto]");
    assert.equal((await auto()).game, false);
    await page.waitForTimeout(1000);
    assert.equal(await raised(), 5, "nothing is raised by hand's panel");

    // REST OF GAME, offered while AUTO ALL is running too
    await page.click("[data-test=raise-auto-all]");
    await page.click("[data-test=raise-auto-game]");
    assert.equal((await auto()).game, true);
    await page.waitForFunction(() => window.__raised.length === 7);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },
);

// Touch the kubb to raise it (src/game/raise-touch.js): a raise need staged with
// the engine's shape (session.lua raiseInfo: two ends 11 cm out along the kubb,
// end 1 first, as core/raising.lua footprints; compared with the engine's own in
// the test after this one), drawn with the real raise camera and projection, and
// game.raise recording the end it was asked for. `refuse` makes end 1 one the
// rules refuse.
async function stageRaise(page, { refuse = false } = {}) {
  await page.evaluate((refuse) => {
    const g = window.__kubb.game;
    window.__raised = [];
    const pose = { x: 0.7, y: 2.3, angle: 0.35, standing: false };
    const c = Math.cos(pose.angle),
      s = Math.sin(pose.angle);
    const end = (k) => ({
      which: k,
      inBounds: true,
      ok: !(refuse && k === 1),
      why: refuse && k === 1 ? "THAT END IS BLOCKED" : undefined,
      pose: {
        x: pose.x + (k === 1 ? 1 : -1) * c * 0.11,
        y: pose.y + (k === 1 ? 1 : -1) * s * 0.11,
        standing: true,
        angle: pose.angle,
      },
    });
    g.need = {
      kind: "raise",
      side: "A",
      team: "YOU",
      turn: 3,
      kubb: "a3",
      n: 1,
      of: 1,
      pose,
      mode: "choice",
      ends: [end(1), end(2)],
      choices: (refuse ? [2] : [1, 2]).map((k) => ({
        which: k,
        pose: end(k).pose,
        displaced: false,
        crowded: false,
      })),
      default: 1,
      others: [],
      king: { x: 0, y: 4, standing: true, angle: 0 },
    };
    g.raiseDrag = g.raiseHint = g.raiseSel = null;
    g.raise = (i) => {
      window.__raised.push(i);
      return { ok: true };
    };
    g.phase = "raise";
  }, refuse);
  await page.waitForSelector("[data-test=raise-text]");
  await nextFrame(page);
}

// One pointer gesture in the page: down at the first point, a move a frame
// through the rest, up at the last (or cancelled).
async function gesture(page, pts, { type = "mouse", cancel = false } = {}) {
  await page.evaluate(
    ({ pts, type, cancel }) =>
      new Promise((done) => {
        const c = document.getElementById("pitch");
        const r = c.getBoundingClientRect();
        const ev = (name, [x, y]) =>
          c.dispatchEvent(
            new PointerEvent(name, {
              clientX: x + r.left,
              clientY: y + r.top,
              pointerId: 9,
              pointerType: type,
              isPrimary: true,
              bubbles: true,
              cancelable: true,
              buttons: name === "pointerup" ? 0 : 1,
            }),
          );
        ev("pointerdown", pts[0]);
        let i = 1;
        const step = () => {
          if (i < pts.length) {
            ev("pointermove", pts[i++]);
            requestAnimationFrame(step);
          } else {
            ev(cancel ? "pointercancel" : "pointerup", pts[pts.length - 1]);
            done();
          }
        };
        requestAnimationFrame(step);
      }),
    { pts, type, cancel },
  );
}

browserTest(
  "raising by touch: a tap anywhere on the kubb, a label, a drag either way, a short drag, a refused end",
  async () => {
    for (const kind of ["desktop", "portrait"]) {
      const type = kind === "portrait" ? "touch" : "mouse";
      const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1", kind);
      await page.click("[data-test=start]");
      await page.click("[data-test=handoff-go]");
      await waitPhase(page, "aim", 10000);
      await stageRaise(page);
      const raised = () => page.evaluate(() => window.__raised);
      const shape = () => page.evaluate(() => window.__kubb.game.raiseShape());
      const g = await shape();
      assert.ok(g, `${kind}: the kubb is on the screen`);
      const [a, b] = g.caps;
      const lerp = (t) => [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t];

      // the panel: the kubb is the control; END 1 and END 2 only for the keyboard
      const text = await page.textContent("[data-test=raise-text]");
      assert.match(
        text,
        kind === "portrait" ? /^Touch the kubb or drag it/ : /^Click the kubb/,
      );
      const lines = await page.evaluate(() => {
        const el = document.querySelector("[data-test=raise-text]");
        return Math.round(
          el.getBoundingClientRect().height /
            parseFloat(getComputedStyle(el).fontSize) /
            1.2,
        );
      });
      assert.ok(lines <= 2, `${kind}: the panel's line runs ${lines} lines`);
      const endBox = await page
        .locator("[data-test=end-1]")
        .evaluate((el) => el.getBoundingClientRect().width);
      assert.ok(endBox <= 1, "END 1 is out of sight");
      await page.focus("[data-test=end-1]");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      assert.ok(
        (await page
          .locator("[data-test=end-1]")
          .evaluate((el) => el.getBoundingClientRect().width)) > 20,
        "and shown when the keyboard reaches it",
      );
      await page.keyboard.press("Enter");
      assert.deepEqual(await raised(), [0], "END 1 by the keyboard");
      assert.match(
        await page.getAttribute("#pitch", "aria-label"),
        /end 1 on the (left|right), end 2 on the (left|right)/,
      );

      // every point of the drawn kubb, and a finger's width round it, picks
      // the end nearer it
      const picks = await page.evaluate(
        ({ a, b, outline }) => {
          const g = window.__kubb.game;
          const out = [];
          const xs = outline.map((p) => p[0]),
            ys = outline.map((p) => p[1]);
          const x0 = Math.min(...xs) - 22,
            x1 = Math.max(...xs) + 22,
            y0 = Math.min(...ys) - 22,
            y1 = Math.max(...ys) + 22;
          // inside the outline, or within 22 px of an edge
          const near = (x, y) => {
            let inside = true,
              best = Infinity;
            for (let k = 0; k < outline.length; k++) {
              const [ax, ay] = outline[k],
                [bx, by] = outline[(k + 1) % outline.length];
              const ex = bx - ax,
                ey = by - ay;
              if (ex * (y - ay) - ey * (x - ax) < 0) inside = false;
              const t = Math.max(
                0,
                Math.min(
                  1,
                  ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey),
                ),
              );
              best = Math.min(
                best,
                Math.hypot(x - ax - t * ex, y - ay - t * ey),
              );
            }
            return inside || best <= 22;
          };
          for (let x = x0; x <= x1; x += 4)
            for (let y = y0; y <= y1; y += 4) {
              if (!near(x, y)) continue;
              const t =
                ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) /
                ((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
              if (Math.abs(t - 0.5) < 0.03) continue; // the very middle
              out.push([g.raisePick(x, y), t < 0.5 ? 0 : 1]);
            }
          return out;
        },
        { a, b, outline: g.outline },
      );
      assert.ok(picks.length > 100, `${picks.length} points tried`);
      const wrong = picks.filter(([got, want]) => got !== want);
      assert.equal(wrong.length, 0, `${kind}: ${wrong.length} points missed`);

      // real taps: the middle of each half, and a label
      await gesture(page, [lerp(0.25)], { type });
      await gesture(page, [lerp(0.75)], { type });
      const labels = await page.evaluate(() => window.__kubb.game.endPoints());
      await gesture(page, [[labels[1].lx + 10, labels[1].ly - 8]], { type });
      assert.deepEqual(await raised(), [0, 0, 1, 1]);

      // drags: toward end 1 stands it on end 1, toward end 2 on end 2; drawn
      // tipped part way and the footprint lit past half way
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const travel = Math.max(90, L * 1.1);
      const dragTo = (from, dir, f) => {
        const [x0, y0] = lerp(from);
        const o = dir === a ? b : a;
        const ux = (dir.x - o.x) / L,
          uy = (dir.y - o.y) / L;
        const pts = [];
        for (let k = 0; k <= 6; k++)
          pts.push([
            x0 + (ux * travel * f * k) / 6,
            y0 + (uy * travel * f * k) / 6,
          ]);
        return pts;
      };
      await page.evaluate(() => (window.__raised = []));
      // grab near end 2 and move toward end 1
      const toEnd1 = dragTo(0.8, a, 0.7);
      await gesture(page, toEnd1.slice(0, -1), { type, cancel: true });
      // the same drag held part way: tipped toward end 1, its footprint lit
      await page.evaluate(
        ({ pts, type }) => {
          const c = document.getElementById("pitch");
          const r = c.getBoundingClientRect();
          for (const [n, [x, y]] of [
            ["pointerdown", pts[0]],
            ["pointermove", pts.at(-1)],
          ])
            c.dispatchEvent(
              new PointerEvent(n, {
                clientX: x + r.left,
                clientY: y + r.top,
                pointerId: 9,
                pointerType: type,
                isPrimary: true,
                bubbles: true,
                buttons: 1,
              }),
            );
        },
        { pts: toEnd1, type },
      );
      const mid = await page.evaluate(() => ({
        drag: window.__kubb.game.raiseDrag,
        sel: window.__kubb.game.raiseSel,
      }));
      assert.equal(mid.drag.i, 0);
      assert.ok(mid.drag.t > 0.6 && mid.drag.t < 0.8, `t ${mid.drag.t}`);
      assert.equal(mid.sel, 0, "the footprint it will stand on is lit");
      await gesture(page, [toEnd1.at(-1)], { type, cancel: true });
      assert.deepEqual(await raised(), [], "a cancelled drag sends nothing");
      await gesture(page, toEnd1, { type });
      await gesture(page, dragTo(0.2, b, 0.7), { type });
      assert.deepEqual(await raised(), [0, 1]);
      // short of half way it lies back down and nothing is sent
      await gesture(page, dragTo(0.8, a, 0.35), { type });
      await gesture(page, dragTo(0.2, b, 0.35), { type });
      assert.deepEqual(await raised(), [0, 1]);
      assert.equal(
        await page.evaluate(() => window.__kubb.game.raiseDrag),
        null,
      );

      // end 1 refused: a tap nearer it, or a drag toward it, sends nothing
      // and lights end 2
      await stageRaise(page, { refuse: true });
      await gesture(page, [lerp(0.2)], { type });
      assert.deepEqual(await raised(), []);
      assert.equal(
        await page.evaluate(() => window.__kubb.game.raiseHint?.i),
        1,
      );
      await gesture(page, dragTo(0.8, a, 0.8), { type });
      assert.deepEqual(await raised(), []);
      await gesture(page, [lerp(0.8)], { type });
      assert.deepEqual(await raised(), [1], "the allowed end still stands");
      assert.deepEqual(page.errors, []);
      await page.context().close();
    }
  },
);

// The engine's own raises, not a staged one: the computer's throws of a seeded
// match (both sides, played here in Node) are applied in the page to a pass and
// play match that raises by hand, up to its nth raise, which the page then
// draws. On engine 0.13 with seed 115 the 1st raise is South's (Team B's turned
// frame), the 2nd North's, and the 3rd South's with end 1 refused by the rules, each
// after a throw, so each has its settle card (on 0.9 it was seed 116, on 0.8 seed 5
// and the 5th).
const REAL_RAISE_SEED = 115;
function realRaiseOptions(cpu, raising) {
  return {
    seed: REAL_RAISE_SEED,
    cpu,
    raising,
    first: "A",
    start: { year: 2026, month: 11, day: 19, hour: 9, min: 0 },
    teams: {
      A: { name: "North", players: [{ name: "North" }] },
      B: { name: "South", players: [{ name: "South" }] },
    },
  };
}
async function realRaiseThrows(count = 40) {
  const engine = await Engine.create({ sources: await bundleLua() });
  engine.newMatch(realRaiseOptions("both", "auto"));
  const acts = [];
  for (let f = 0; acts.length < count && f < 200000; f++) {
    const out = engine.frame({ dt: 1 / 20 });
    if (out.action) acts.push(out.action);
  }
  return acts;
}
async function toRealRaise(page, acts, nth) {
  const r = await page.evaluate(
    ({ acts, o, nth }) => {
      const g = window.__kubb.game;
      g.seat = { sides: ["A", "B"], cpu: false };
      g.localSide = null;
      g.newMatch(o);
      const e = g.engine;
      let k = 0,
        seen = 0;
      for (let step = 0; step < 500; step++) {
        const n = e.view().need;
        if (n.kind === "throw") {
          if (k >= acts.length) return { error: "out of throws" };
          e.apply(acts[k++]);
        } else if (n.kind === "raise") {
          // a turn's raising opens with its settle card (n 1): count those (engine
          // 1.4 keeps one need for the turn's lying kubbs, picked in any order)
          if (n.n === 1 && seen++ === nth) break;
          e.apply({ type: "raise" });
        } else if (n.kind === "punish")
          e.apply({ type: "punish", x: n.cursor.x, y: n.cursor.y });
        else return { error: n.kind };
      }
      g.enter(e.view());
      // what the game sends the engine from here on
      window.__sent = [];
      if (!e.__wrapped) {
        const apply = e.apply.bind(e);
        e.apply = (a) => {
          window.__sent.push(a);
          return apply(a);
        };
        e.__wrapped = true;
      }
      return { need: g.need };
    },
    { acts, o: realRaiseOptions([], "hand"), nth },
  );
  assert.ok(!r.error, `reaching raise ${nth}: ${r.error}`);
  await page.click("[data-test=settle] .btn");
  await waitPhase(page, "raise", 10000);
  await nextFrame(page);
  return r.need;
}

browserTest(
  "raising by touch on the engine's own raises: both teams' frames, a tap on each half, a drag, a refused end",
  async () => {
    const acts = await realRaiseThrows();
    const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1", "portrait");
    await page.click("[data-test=start]");
    await page.click("[data-test=handoff-go]");
    await waitPhase(page, "aim", 10000);
    // where the game draws it: the kubb's end caps, and the two footprints
    const drawn = () =>
      page.evaluate(() => {
        const g = window.__kubb.game;
        return { shape: g.raiseShape(), feet: g.endPoints() };
      });
    const lerp = ([a, b], t) => [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t];
    // the end the engine stood it on, from the action the game sent
    const sentEnd = async (need) => {
      const sent = await page.evaluate(() => window.__sent);
      assert.equal(sent.length, 1, JSON.stringify(sent));
      assert.equal(sent[0].type, "raise");
      // engine 1.4: the kubb and its end by name (raise in any order)
      assert.equal(sent[0].kubb, need.kubb, "the kubb named");
      const which = sent[0].which ?? need.choices[sent[0].choice - 1].which;
      return need.ends.findIndex((e) => e.which === which);
    };
    // and where the kubb stands now: on that end's footprint (the next view
    // may be in the other team's frame: the mirror x, 8 - y)
    const standsOn = async (need, i) => {
      const piece = await page.evaluate((id) => {
        const v = window.__kubb.game.engine.view();
        const all = JSON.stringify(v).match(
          new RegExp(`\\{[^{}]*"id":"${id}"[^{}]*"z":[^{}]*\\}`),
        );
        return all && JSON.parse(all[0]);
      }, need.kubb);
      assert.ok(piece && !piece.toppled, "the kubb stands");
      const f = need.ends[i].pose;
      const d = Math.min(
        Math.hypot(piece.x - f.x, piece.y - f.y),
        Math.hypot(piece.x + f.x, piece.y - (8 - f.y)),
      );
      assert.ok(
        d < 0.005,
        `stands ${d.toFixed(3)} m from end ${i + 1}'s footprint`,
      );
    };
    const nearestFoot = (feet, [x, y]) =>
      Math.hypot(feet[0].x - x, feet[0].y - y) <
      Math.hypot(feet[1].x - x, feet[1].y - y)
        ? 0
        : 1;

    // a tap at each end, Team B's raise then Team A's (engine 1.4 draws the raise
    // through the whole group's camera, where a kubb lying toward the camera is a few
    // pixels long: the tap goes on the end's footprint, not a fraction along it)
    const picked = { A: [], B: [] };
    for (const [nth, side, i] of [
      [0, "B", 0],
      [0, "B", 1],
      [1, "A", 0],
      [1, "A", 1],
    ]) {
      const need = await toRealRaise(page, acts, nth);
      assert.equal(need.side, side);
      assert.deepEqual(
        need.ends.map((e) => e.ok),
        [true, true],
      );
      const { feet } = await drawn();
      const at = [feet[i].x, feet[i].y];
      const want = nearestFoot(feet, at);
      await gesture(page, [at], { type: "touch" });
      assert.equal(await sentEnd(need), want, `${side} tap at end ${i + 1}`);
      await standsOn(need, want);
      picked[side].push(want);
    }
    assert.deepEqual(
      [picked.A.sort(), picked.B.sort()],
      [
        [0, 1],
        [0, 1],
      ],
      "each end is its own",
    );

    // a drag toward the end drawn farther from where it starts
    {
      const need = await toRealRaise(page, acts, 0);
      const { shape, feet } = await drawn();
      const [a, b] = shape.caps;
      const from = lerp(shape.caps, 0.2);
      const want = nearestFoot(feet, [b.x, b.y]);
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const go = Math.max(90, L * 1.1) * 0.8;
      const pts = [];
      for (let k = 0; k <= 6; k++)
        pts.push([
          from[0] + ((b.x - a.x) / L) * go * (k / 6),
          from[1] + ((b.y - a.y) / L) * go * (k / 6),
        ]);
      await gesture(page, pts, { type: "touch" });
      assert.equal(await sentEnd(need), want, "the drag's end");
      await standsOn(need, want);
    }

    // the rules refuse end 1: a tap nearer it sends nothing, the other stands
    {
      const need = await toRealRaise(page, acts, 2);
      const oks = need.ends.map((e) => e.ok);
      assert.equal(oks.filter((x) => !x).length, 1, `one end refused: ${oks}`);
      const bad = oks.indexOf(false);
      const good = 1 - bad;
      const { shape, feet } = await drawn();
      const nearBad = [0.2, 0.8].find(
        (t) => nearestFoot(feet, lerp(shape.caps, t)) === bad,
      );
      await gesture(page, [lerp(shape.caps, nearBad)], { type: "touch" });
      assert.deepEqual(await page.evaluate(() => window.__sent), []);
      assert.equal(
        await page.evaluate(() => window.__kubb.game.raiseHint?.i),
        good,
      );
      await gesture(page, [lerp(shape.caps, 1 - nearBad)], { type: "touch" });
      assert.equal(await sentEnd(need), good);
      await standsOn(need, good);
    }
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },
);

browserTest(
  "watching the computer: both sides throw, in a hidden tab too, and the next match starts by itself",
  async () => {
    const rooms = await startPitchServer();
    const recordGame = keptUnder(rooms, "games/browser/");
    try {
      await watchMatches(recordGame, rooms);
    } finally {
      await rooms.close();
    }
  },
);

browserTest(
  "watching in the wide view: the default, switched by the button and V, remembered, and played to a winner",
  async () => {
    // the finished match is sent to the api, as every watched one is
    const rooms = await startPitchServer();
    try {
      await watchWide(rooms);
    } finally {
      await rooms.close();
    }
  },
);

async function watchWide(rooms) {
  {
    const page = await open(
      env,
      `/p/abcdefgh?watch=1&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`,
    );
    await page.evaluate(() => (window.__kubb.game.zen = null));
    await page.waitForFunction(() => window.__kubb.game.need?.kind === "throw");
    const view = () =>
      page.evaluate(() => {
        const g = window.__kubb.game;
        return {
          name: g.viewName,
          kind: g.wide?.kind ?? null,
          camera: JSON.stringify(g.out?.camera ?? null),
          label: document.querySelector("[data-test=view]")?.textContent,
          pref: localStorage.getItem("kubb:watchView"),
        };
      });
    const v0 = await view();
    assert.equal(v0.name, "wide", "the wide view is the default");
    assert.equal(v0.kind, "side", "a landscape window: the sideline view");
    assert.equal(v0.label, "THROWER'S VIEW", "the button names the other view");
    // the button: the thrower's view, remembered
    await page.click("[data-test=view]");
    const v1 = await view();
    assert.equal(v1.name, "thrower");
    assert.equal(v1.label, "WIDE VIEW");
    assert.equal(v1.pref, '"thrower"');
    assert.notEqual(v1.camera, v0.camera, "another camera");
    // the V key: back to the wide view
    await page.keyboard.press("KeyV");
    const v2 = await view();
    assert.equal(v2.name, "wide");
    assert.equal(v2.pref, '"wide"');
    // the wide camera stays put through both teams' throws
    const cams = new Set();
    const sides = new Set();
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline && sides.size < 2) {
      const s = await page.evaluate(() => {
        const g = window.__kubb.game;
        const cam = JSON.stringify(g.play?.last?.camera ?? g.out?.camera);
        if (g.phase === "play") g.skip();
        return { side: g.need?.side, cam };
      });
      if (s.side) sides.add(s.side);
      cams.add(s.cam);
      await page.waitForTimeout(100);
    }
    assert.equal(sides.size, 2, "both teams throw");
    assert.equal(cams.size, 1, "one camera for both teams");
    // and the match still plays to a winner
    await resignAndSkip(page, "A");
    await page.waitForSelector("[data-test=winner]");
    assert.ok(await page.evaluate(() => window.__kubb.game.need.winner));
    // a reload keeps the choice: the thrower's view
    await page.evaluate(() =>
      localStorage.setItem("kubb:watchView", '"thrower"'),
    );
    await page.reload();
    await page.waitForSelector("body[data-ready='1']");
    await page.waitForFunction(() => window.__kubb.game.need?.kind === "throw");
    assert.equal((await view()).name, "thrower");
    assert.deepEqual(page.errors, []);
    await page.context().close();

    // a played match keeps the thrower's view, with no switch
    const solo = await open(env, "/p/abcdefgh?solo=1&nohowto=1");
    await solo.click("[data-test=start]");
    await solo.waitForFunction(() => window.__kubb.game.need?.kind === "throw");
    assert.equal(
      await solo.evaluate(() => window.__kubb.game.viewName),
      "thrower",
    );
    assert.equal(await solo.locator("[data-test=view]").count(), 0);
    await solo.context().close();
  }
}

const resignAndSkip = async (page, side) => {
  await page.evaluate((s) => window.__kubb.game.resign(s), side);
  // playback skipped until the match is over
  await page.waitForFunction(
    () => {
      const g = window.__kubb.game;
      if (g.phase === "play") g.skip();
      return g.need?.kind === "over";
    },
    null,
    { timeout: 30000, polling: 100 },
  );
};

async function watchMatches(recordGame, rooms) {
  {
    const page = await open(
      env,
      `/p/abcdefgh?watch=1&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`,
    );
    assert.equal(await page.locator("[data-test=options]").count(), 0);
    // the calm pace: the computer stands a while before its first throw
    const pace = await page.evaluate(() => {
      const g = window.__kubb.game;
      return { zen: !!g.zen, pause: g.zenPause, hold: g.zen?.holdAfter };
    });
    // while it stands, the computer's arm does not move: no throw leaves
    await page.evaluate(() => {
      const g = window.__kubb.game;
      g.zenPause = 3;
      g.__mode0 = g.out?.dial?.phase;
    });
    await page.waitForTimeout(1800);
    const held = await page.evaluate(() => {
      const g = window.__kubb.game;
      const r = {
        phase: g.phase,
        same: g.out?.dial?.phase === g.__mode0,
        left: g.zenPause,
        throws: window.__throws?.length ?? 0,
      };
      g.zen = null; // the rest of this test at the match's pace
      return r;
    });
    assert.equal(held.phase, "aim");
    assert.equal(held.same, true, "the dial holds through the pause");
    assert.ok(held.left > 0 && held.left < 3);
    assert.equal(held.throws, 0, "nothing is thrown during the pause");
    assert.equal(pace.zen, true);
    assert.ok(pace.pause > 1, "a pause before the throw");
    assert.ok(pace.hold > 1);
    await watchThrows(page);
    await page.waitForFunction(() => window.__kubb.game.need?.cpu, null, {
      timeout: 10000,
    });
    // a throw from each side with nobody touching anything (playback skipped)
    const sides = new Set();
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline && sides.size < 2) {
      const s = await page.evaluate(() => {
        const g = window.__kubb.game;
        if (g.phase === "play") g.skip();
        return { side: g.need?.side, card: !!document.querySelector(".card") };
      });
      assert.equal(s.card, false, "no card waits for anyone");
      if (s.side) sides.add(s.side);
      await page.waitForTimeout(100);
    }
    assert.equal(sides.size, 2, "both teams throw");
    assert.ok((await page.evaluate(() => window.__throws.length)) >= 2);

    // hidden: the timer steps it, drawing nothing
    const before = await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      return window.__throws.length;
    });
    assert.ok(await page.evaluate(() => !!window.__kubb.game.hiddenTimer));
    await page.waitForFunction((n) => window.__throws.length >= n + 2, before, {
      timeout: 30000,
    });
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(
      await page.evaluate(() => window.__kubb.game.hiddenTimer),
      null,
    );

    // the end: resign one side, the winner card, then the next match by itself
    await page.evaluate(() => {
      window.__kubb.watchTune.nextMs = 1500;
      window.__kubb.game.resign("A");
    });
    while (!(await page.locator("[data-test=winner]").count())) {
      await page.evaluate(() => {
        const g = window.__kubb.game;
        if (g.phase === "play") g.skip();
      });
      await page.waitForTimeout(100);
    }
    const over = await page.evaluate(() => window.__kubb.game.need);
    assert.equal(over.kind, "over");
    assert.ok(over.file?.text, "the game file");
    assert.equal(await page.locator("[data-test=winner-note]").count(), 1);
    await page.waitForSelector("[data-test=winner]", {
      state: "detached",
      timeout: 5000,
    });
    const next = await page.evaluate(() => window.__kubb.game.need);
    assert.equal(next.kind, "throw");
    assert.equal(next.turn, 1, "a new match");

    // the finished match was sent once and kept, enough to replay it
    await page.waitForFunction(() => window.__kubb.recorded.length === 1);
    assert.equal(
      await page.evaluate(() => window.__kubb.recorded[0]),
      true,
      "the server kept it",
    );
    assert.equal(recordGame.kept.length, 1);
    assert.match(
      recordGame.kept[0].key,
      /^games\/browser\/\d{4}-\d{2}-\d{2}\//,
    );
    const kept = JSON.parse(recordGame.kept[0].text);
    assert.equal(kept.game.mode, "watch");
    assert.deepEqual(
      [kept.game.options.teams.A.name, kept.game.options.teams.B.name],
      ["North", "South"],
    );
    assert.equal(kept.game.end.over, true);
    assert.match(kept.game.file, /\[Team A "North"\]/);
    assert.ok(!recordGame.kept[0].text.includes("HeadlessChrome"));
    const match = browserMatch(kept);
    const r = replayBrowser(
      await Engine.create({ sources: await bundleLua() }),
      match,
    );
    assert.equal(r.same, match.actions.length, "replays here as it was played");
    assert.equal(r.end, "same");

    // the next one ends in a hidden tab: it is sent there too, once
    await page.evaluate(() => {
      window.__kubb.watchTune.nextMs = 60000;
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await resignAndSkip(page, "B");
    await page.waitForFunction(
      () => window.__kubb.recorded.length === 2,
      null,
      {
        timeout: 15000,
      },
    );
    await page.waitForTimeout(300);
    assert.equal(recordGame.kept.length, 2);
    assert.equal(JSON.parse(recordGame.kept[1].text).game.end.over, true);
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // the score sheet from the winner card: the whole match
    await page.click("[data-test=winner-sheet]");
    await page.waitForSelector("[data-test=sheet-card]");
    assert.match(
      await page.textContent("[data-test=sheet-card]"),
      /The whole match\./,
    );
    await page.click("[data-test=sheet-back]");
    assert.equal(await page.locator("[data-test=sheet-card]").count(), 0);
    assert.equal(recordGame.kept.length, 2, "not sent again");
    assert.deepEqual(page.errors, []);
    await page.context().close();
  }
}

browserTest(
  "a match that cannot be kept goes on as if nothing happened",
  async () => {
    // an api that keeps no matches answers `unavailable` (503)
    const rooms = await startPitchServer();
    try {
      const page = await open(
        env,
        `/p/abcdefgh?watch=1&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`,
      );
      await page.route(`${rooms.apiUrl}/game`, (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: "unavailable",
            message: "Matches are not kept here.",
          }),
        }),
      );
      await page.waitForFunction(() => window.__kubb.game.need?.cpu, null, {
        timeout: 10000,
      });
      await page.evaluate(() => (window.__kubb.watchTune.nextMs = 1500));
      await resignAndSkip(page, "A");
      await page.waitForFunction(() => window.__kubb.recorded.length === 1);
      assert.equal(
        await page.evaluate(() => window.__kubb.recorded[0]),
        false,
        "not kept, and nothing else happened",
      );
      assert.equal(keptUnder(rooms, "games/").kept.length, 0);
      await page.waitForSelector("[data-test=winner]", {
        state: "detached",
        timeout: 5000,
      });
      assert.equal(
        (await page.evaluate(() => window.__kubb.game.need)).turn,
        1,
        "the next match started",
      );
      // the browser's own line for the 503 is all: nothing from the page
      assert.deepEqual(
        page.errors.filter((e) => !/^Failed to load resource/.test(e)),
        [],
      );
      await page.context().close();
    } finally {
      await rooms.close();
    }
  },
);

browserTest(
  "the score sheet on a phone: the match so far, positions on request, copy and download",
  async () => {
    const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1", "portrait");
    await page.click("[data-test=start]");
    await page.waitForSelector("[data-test=handoff]");
    await page.click("[data-test=handoff-go]");
    await waitPhase(page, "aim", 10000);
    await throwOnce(page, { touch: true });
    await waitPhase(page, "play", 5000);
    await page.evaluate(() => window.__kubb.game.skip());
    await page.waitForFunction(
      () => window.__kubb.game.trail?.actions.length >= 1,
    );

    await page.click("[data-test=menu]");
    await page.click("[data-test=menu-sheet]");
    await page.waitForSelector("[data-test=sheet-card]");
    assert.equal(await page.evaluate(() => window.__kubb.game.modal > 0), true);
    const card = await page.textContent("[data-test=sheet-card]");
    assert.match(card, /Score sheet/);
    assert.match(card, /The match so far\./);
    const shown = await page.textContent("[data-test=sheet-text]");
    assert.match(shown, /\[Team A "/);
    assert.match(shown, /\[Team B "Computer"\]/);
    const file = await page.evaluate(() => window.__kubb.engine.sheet().text);
    // on screen without the position lines (Planet Kubb Notation 2's "@a ..." pitch
    // and "*a ..." felled lines, engine 0.13.1 on); the file keeps them
    const positionLine = (l) => /^[@*][ab]\b/.test(l);
    assert.equal(
      shown,
      file
        .replace(/\n$/, "")
        .split("\n")
        .filter((l) => !positionLine(l))
        .join("\n"),
    );
    assert.ok(!shown.split("\n").some(positionLine), "positions hidden");
    await page.click("[data-test=sheet-positions]");
    assert.equal(
      await page.textContent("[data-test=sheet-text]"),
      file.replace(/\n$/, ""),
    );
    assert.equal(
      await page.getAttribute("[data-test=sheet-positions]", "aria-pressed"),
      "true",
    );
    // readable at phone width: nothing wider than the screen
    const fit = await page.evaluate(() => {
      const c = document.querySelector("[data-test=sheet-card]");
      const t = document.querySelector("[data-test=sheet-text]");
      return {
        card: c.getBoundingClientRect().right,
        width: window.innerWidth,
        overflow: t.scrollWidth - t.clientWidth,
      };
    });
    assert.ok(fit.card <= fit.width, "the card fits the screen");
    assert.ok(fit.overflow <= 1, "lines wrap");
    const link = await page.getAttribute(".sheet-note a", "href");
    assert.equal(
      link,
      "https://thingelstad.xyz/things/planet-kubb-score/?ref=kubb-sheet",
    );

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click("[data-test=sheet-download]"),
    ]);
    assert.match(
      download.suggestedFilename(),
      /^\d{4}-\d{2}-\d{2}-\d{4}-.+-v-computer\.txt$/,
    );
    const saved = await download.path();
    assert.equal(
      fs.readFileSync(saved, "utf8"),
      file,
      "the whole file, positions too",
    );

    await page.click("[data-test=sheet-copy]");
    await page.waitForFunction(
      () =>
        document.querySelector("[data-test=sheet-status]").textContent !== "" &&
        !/^Saved/.test(
          document.querySelector("[data-test=sheet-status]").textContent,
        ),
    );
    assert.match(
      await page.textContent("[data-test=sheet-status]"),
      /^(Copied the game file\.|Could not copy\. The file is selected to copy\.)$/,
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("[data-test=sheet-card]").count(), 0);
    assert.equal(await page.evaluate(() => window.__kubb.game.modal), 0);
    // a solo match in progress is not sent; practice has no SCORE SHEET
    assert.equal(await page.evaluate(() => window.__kubb.recorded.length), 0);
    assert.deepEqual(page.errors, []);
    await page.context().close();

    const practice = await open(env, "/practice/?nohowto=1");
    await waitPhase(practice, "aim", 10000);
    await practice.click("[data-test=menu]");
    assert.equal(await practice.locator("[data-test=menu-sheet]").count(), 0);
    await practice.context().close();
  },
);

// Send hardware-style contacts through Chromium, with a physical sample clock
// independent of the machine running the test.
async function pendulum(page, returnSeconds, { x = 85, y = 580 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const clock = Date.now() / 1000;
  const send = (type, offset, t) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: offset == null ? [] : [{ x, y: y + offset, id: 1 }],
      timestamp: clock + t,
    });
  try {
    await send("touchStart", 0, 0);
    await send("touchMove", 32, 0.12);
    await send("touchMove", 100, 0.38);
    await page.waitForFunction(
      () => window.__kubb.game.out.dial.phase === "winding",
    );
    for (let i = 1; i <= 8; i++)
      await send("touchMove", 100 - 22 * i, 0.38 + (returnSeconds * i) / 8);
    await send("touchEnd", null, 0.39 + returnSeconds);
  } finally {
    await cdp.detach();
  }
}

browserTest(
  "touch pendulum lets down slowly and throws on lift after tab navigation",
  async () => {
    const page = await open(env, "/practice/?throw=swipe&nohowto=1", "swipe");
    try {
      await page.goto(env.base + "/practice/?nohowto=1");
      await page.waitForSelector("body[data-ready='1']");
      await waitPhase(page, "aim");
      await pendulum(page, 1);
      await page.waitForFunction(
        () => window.__kubb.game.out.dial.phase === "idle",
      );
      assert.equal(
        await page.evaluate(() => window.__kubb.game.trail.ops.length),
        0,
      );
      await pendulum(page, 1 / 6);
      await waitPhase(page, "play");
      assert.equal(
        await page.evaluate(() => window.__kubb.game.play.rec.input),
        "touch",
      );
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

browserTest(
  "the visible knob has room to wind and release a touch throw",
  async () => {
    const page = await open(env, "/practice/?throw=swipe", "swipe");
    try {
      // Mobile WebKit can advertise a coarse pointer with zero maxTouchPoints.
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "maxTouchPoints", { value: 0 }),
      );
      await page.reload();
      await page
        .getByRole("heading", { name: "Start on the clock or the grass" })
        .waitFor();
      await page.locator("[data-test=howto-close]").tap();
      const { cx, cy, r } = await dialGeometry(page);
      const knob = { x: cx, y: cy + r * 0.86 };
      assert.ok(
        knob.y + 100 < page.viewportSize().height,
        "the downstroke stays on screen",
      );
      await pendulum(page, 1 / 6, knob);
      await waitPhase(page, "play");
      const rec = await page.evaluate(() => window.__kubb.game.play.rec);
      assert.equal(rec.input, "touch");
      assert.ok(rec.result.back >= 105, "wound the arm on the visible dial");
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

browserTest(
  "a fresh touch tab keeps the dial, and a mouse keeps it with swipe enabled",
  async () => {
    for (const [query, touch] of [
      ["", true],
      ["&throw=swipe", false],
    ]) {
      const page = await open(env, "/practice/?nohowto=1" + query, "swipe");
      try {
        await waitPhase(page, "aim");
        await throwOnce(page, { touch });
        await waitPhase(page, "play");
        assert.equal(
          await page.evaluate(() => window.__kubb.game.play.rec.input),
          "pointer",
        );
        assert.deepEqual(page.errors, []);
      } finally {
        await page.context().close();
      }
    }
  },
);

browserTest("a portrait phone throws by touch", async () => {
  const page = await open(env, "/practice/?nohowto=1", "portrait");
  await waitPhase(page, "aim", 10000);
  const g = await dialGeometry(page);
  assert.ok(g.cy < 844 && g.cx > 100 && g.cx < 290, "the dial is lower centre");
  await watchThrows(page);
  await throwOnce(page, { touch: true });
  await waitPhase(page, "play", 5000);
  await waitPhase(page, "aim", 20000);
  const throws = await page.evaluate(() => window.__throws);
  assert.equal(throws.length, 1);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// The linear meter (MENU, Meter): the same arm to the engine as the clock's,
// so the same swing registers the same back and stop and is judged the same.
for (const [kind, touch] of [
  ["desktop", false],
  ["portrait", true],
]) {
  browserTest(
    `the linear meter throws as the clock does (${kind})`,
    async () => {
      const page = await open(env, "/practice/?nohowto=1", kind, {
        prefs: { meter: "linear" },
      });
      await waitPhase(page, "aim", 10000);
      const L = await page.evaluate(() => window.__kubb.game.L);
      assert.equal(L.meter, "linear");
      assert.ok(L.dial.height > L.dial.width * 4, "a long strip");
      const plan = (await state(page)).plan;
      await watchThrows(page);
      await throwOnce(page, { touch });
      await waitPhase(page, "play", 5000);
      await waitPhase(page, "aim", 20000);
      const throws = await page.evaluate(() => window.__throws);
      assert.equal(throws.length, 1);
      const r = throws[0].result;
      assert.ok(Math.abs(r.back - (plan.powerLo + plan.powerHi) / 2) < 1.5);
      assert.ok(Math.abs(r.stop - plan.release) < 1.5);
      assert.equal(r.verdicts.power, "ON");
      assert.equal(r.verdicts.release, "ON");
      assert.deepEqual(page.errors, []);
      await page.context().close();
    },
  );
}

browserTest(
  "the menu's Meter switches the clock and the linear meter and remembers",
  async () => {
    const page = await open(env, "/practice/?nohowto=1");
    await waitPhase(page, "aim", 10000);
    const meter = () => page.evaluate(() => window.__kubb.game.L.meter);
    assert.equal(await meter(), "clock", "the clock is the default");
    await page.click("[data-test=menu]");
    await page.click("[data-test=menu-settings]");
    await page.click("[data-test=menu-meter] >> text=Linear");
    assert.equal(await meter(), "linear");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("kubb:meter")),
      '"linear"',
    );
    await page.reload();
    await page.waitForSelector("body[data-ready='1']");
    await waitPhase(page, "aim", 10000);
    assert.equal(await meter(), "linear", "kept over a reload");
    // a press on the meter away from its knob neither throws nor moves the aim
    const before = (await state(page)).marker;
    const d = await page.evaluate(() => window.__kubb.game.L.dial);
    await page.mouse.click(d.x + d.width / 2, d.y + d.height - 30);
    const s = await state(page);
    assert.equal(s.phase, "aim");
    assert.deepEqual(s.marker, before);
    await page.click("[data-test=menu]");
    await page.click("[data-test=menu-settings]");
    await page.click("[data-test=menu-meter] >> text=Clock");
    assert.equal(await meter(), "clock");
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },
);

// The player's choice of meter holds when the phone turns (Jamie,
// 2026-11-19: "Bug: On iPhone if I turn on linear and then rotate it goes
// back to the circular swing."): the linear meter stands at its edge with
// the whole height, MENU or the rail moves in beside it, a stroke in the
// meter's half throws, and a tap on its body away from the knob's channel
// is a tap (layout.js linearFirst, inLinearZone).
for (const side of ["right", "left"]) {
  browserTest(
    `a phone on its side keeps the linear meter (${side})`,
    async () => {
      const page = await open(env, "/practice/?nohowto=1", "landscape", {
        prefs: { meter: "linear", meterSide: side },
      });
      try {
        await waitPhase(page, "aim", 10000);
        const L = await page.evaluate(() => window.__kubb.game.L);
        assert.equal(L.meter, "linear");
        assert.equal(L.meterSide, side);
        const g = linearGeometry(L.dial, side);
        assert.ok(g.travel >= 260, `travel ${g.travel}`);
        // the plate at the meter's top corner stands 10 px off its body
        // (MENU is in the header since the 1.0 design: at the right, practice's tray)
        const sel = side === "right" ? "[data-test=tray]" : "[data-test=rail]";
        const r = await page.locator(sel).boundingBox();
        if (side === "right")
          assert.ok(r.x + r.width <= g.left - 9, "the tray");
        else assert.ok(r.x >= g.right + g.sh + 9, "the rail");
        // a tap on the lane beside the knob is a tap: nothing thrown
        await page.touchscreen.tap(g.laneLeft + g.laneW / 2, g.y0 - 20);
        await nextFrame(page);
        await nextFrame(page);
        assert.equal((await state(page)).phase, "aim");
        assert.equal(
          await page.evaluate(() => window.__kubb.game.ptr),
          null,
          "the press is over",
        );
        // a stroke high in the meter's half, off the meter, throws
        const x = side === "right" ? L.W * 0.62 : L.W * 0.38;
        await judgedThrow(page, { touch: true, from: [x, L.H * 0.4] });
        assert.deepEqual(page.errors, []);
      } finally {
        await page.context().close();
      }
    },
  );
}

// Codex on web PR #71: the plates the linear meter moves in are no wider
// than layout.js reserves for them (headerPlates), so where the layout keeps
// the meter they stay apart, and where they would not (practice's tray at
// 480 x 350) the clock is drawn and nothing moves.
browserTest(
  "the header row's plates fit the room the linear meter leaves them",
  async () => {
    const box = (page, sel) => page.locator(sel).boundingBox();
    const apart = (a, b) => a.x + a.width <= b.x || b.x + b.width <= a.x;
    const page = await open(env, "/practice/?nohowto=1", "landscape", {
      prefs: { meter: "linear", meterSide: "right" },
    });
    try {
      await waitPhase(page, "aim", 10000);
      let L = await page.evaluate(() => window.__kubb.game.L);
      assert.equal(L.meter, "linear");
      assert.ok(L.meterRoom.right > 0, "the tray moved in");
      const t = layoutTune;
      const tray = await box(page, "[data-test=tray]");
      const menu = await box(page, "[data-test=menu]");
      const rail = await box(page, "[data-test=rail]");
      assert.ok(tray.width <= t.trayW.practice, `tray ${tray.width}`);
      assert.ok(menu.width <= t.menuW, `MENU ${menu.width}`);
      // the header's fixed width (layout.js headerBox): practice's is a match's
      // where its corner's row leaves the room, never under 218
      assert.ok(
        Math.abs(rail.width - L.header.width) < 0.6,
        `rail ${rail.width}`,
      );
      assert.ok(rail.width >= t.railPracticeW && rail.width <= t.headerMaxW);
      // MENU is a word inside the header's plate
      assert.ok(
        menu.x >= rail.x && menu.x + menu.width <= rail.x + rail.width,
        "MENU in the header",
      );
      assert.ok(apart(tray, rail), "844 x 390");
      assert.ok(
        await page.evaluate(() =>
          document.documentElement.classList.contains("meter-room"),
        ),
      );
      // a narrow window: the tray would cover the rail, so the clock
      await page.setViewportSize({ width: 480, height: 350 });
      await page.waitForFunction(() => window.__kubb.game.L.W === 480);
      await nextFrame(page);
      L = await page.evaluate(() => window.__kubb.game.L);
      assert.equal(L.meter, "clock");
      assert.deepEqual(L.meterRoom, { left: 0, right: 0 });
      const tray2 = await box(page, "[data-test=tray]");
      assert.ok(apart(tray2, await box(page, "[data-test=rail]")), "480 x 350");
      assert.equal(
        await page.evaluate(() =>
          document.documentElement.classList.contains("meter-room"),
        ),
        false,
      );
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
    // watching in the thrower's view: the view tray
    const w = await open(env, "/p/abcdefgh?watch=1&nohowto=1", "landscape", {
      prefs: { meter: "linear", watchView: "thrower" },
    });
    try {
      await w.waitForFunction(() => window.__kubb?.game?.L?.meter === "linear");
      const v = await box(w, "[data-test=view]");
      assert.ok(v.width <= layoutTune.trayW.watch, `view ${v.width}`);
      const rail = await box(w, "[data-test=rail]");
      const LW = await w.evaluate(() => window.__kubb.game.L);
      assert.ok(
        Math.abs(rail.width - LW.header.width) < 0.6,
        `rail ${rail.width}`,
      );
    } finally {
      await w.context().close();
    }
  },
);

// One practice throw, watched: the result the engine judged.
async function judgedThrow(page, opts) {
  const plan = (await state(page)).plan;
  await watchThrows(page);
  await throwOnce(page, opts);
  await waitPhase(page, "play", 5000);
  await waitPhase(page, "aim", 20000);
  const throws = await page.evaluate(() => window.__throws);
  assert.equal(throws.length, 1);
  const r = throws[0].result;
  assert.ok(Math.abs(r.back - (plan.powerLo + plan.powerHi) / 2) < 1.5);
  assert.ok(Math.abs(r.stop - plan.release) < 1.5);
  assert.equal(r.verdicts.power, "ON");
  assert.equal(r.verdicts.release, "ON");
  return r;
}

// Stroke anywhere (Jamie, 2026-11-19): with the linear meter on the screen a
// drag in the throw zone (the lower part of the canvas) drives the knob as
// a grab of it does, so the finger works away from the meter it watches.
for (const [kind, touch] of [
  ["portrait", true],
  ["desktop", false],
]) {
  browserTest(
    `a stroke in the throw zone throws on the linear meter (${kind})`,
    async () => {
      const page = await open(env, "/practice/?nohowto=1", kind, {
        prefs: { meter: "linear" },
      });
      try {
        await waitPhase(page, "aim", 10000);
        const { W, H, meter, dial } = await page.evaluate(() => {
          const g = window.__kubb.game;
          return { W: g.W, H: g.H, meter: g.L.meter, dial: g.L.dial };
        });
        assert.equal(meter, "linear");
        // well away from the meter, between the plan buttons
        const from = [W * 0.4, H * 0.65];
        assert.ok(from[0] < dial.x - 60, "the stroke is not on the meter");
        await judgedThrow(page, { touch, from });
        assert.deepEqual(page.errors, []);
      } finally {
        await page.context().close();
      }
    },
  );
}

browserTest(
  "a tap in the throw zone still puts the target circle there",
  async () => {
    const page = await open(env, "/practice/?nohowto=1", "portrait", {
      prefs: { meter: "linear" },
    });
    try {
      await waitPhase(page, "aim", 10000);
      const before = (await state(page)).marker;
      await watchThrows(page);
      await page.touchscreen.tap(390 * 0.3, 844 * 0.66);
      await page.waitForFunction(
        (x) => window.__kubb.game.out?.aim?.marker?.x !== x,
        before.x,
        { timeout: 3000, polling: 50 },
      );
      const s = await state(page);
      assert.equal(s.phase, "aim");
      assert.ok(s.marker.x < before.x, "moved toward the tap");
      assert.deepEqual(await page.evaluate(() => window.__throws), []);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

// Touch beside the ring (Jamie, 2026-11-19): a finger may go round outside
// the clock's rim, where it hides nothing; a phone held upright leaves the
// room for it all the way round.
browserTest(
  "a touch outside the clock's ring throws on a portrait phone",
  async () => {
    const page = await open(env, "/practice/?nohowto=1", "portrait");
    try {
      await waitPhase(page, "aim", 10000);
      const L = await page.evaluate(() => window.__kubb.game.L);
      assert.equal(L.meter, "clock");
      assert.equal(L.track, true, "the finger track is drawn");
      const g = await dialGeometry(page);
      assert.ok(g.cy + g.r * 1.55 <= 844, "6 o'clock outside the rim fits");
      await judgedThrow(page, { touch: true, radius: 1.35 });
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

// The track lies over ground a tap can aim at, so only a drag there turns
// the arm: a tap still puts the circle where it lands.
browserTest(
  "a tap beside the clock's ring still puts the target circle there",
  async () => {
    const page = await open(env, "/practice/?nohowto=1", "portrait");
    try {
      await waitPhase(page, "aim", 10000);
      const g = await dialGeometry(page);
      // up and to the left of the ring, inside the touch's reach, clear of
      // the plan buttons
      const at = [g.cx - g.r * 0.9, g.cy - g.r * 1.3];
      const aimable = await page.evaluate(
        ([x, y]) => window.__kubb.game.aimable(x, y),
        at,
      );
      assert.equal(aimable, true, "a tap here can aim");
      const before = (await state(page)).marker;
      await watchThrows(page);
      await page.touchscreen.tap(at[0], at[1]);
      await page.waitForFunction(
        (x) => window.__kubb.game.out?.aim?.marker?.x !== x,
        before.x,
        { timeout: 3000, polling: 50 },
      );
      const s = await state(page);
      assert.equal(s.phase, "aim");
      assert.ok(s.marker.x < before.x, "moved toward the tap");
      assert.deepEqual(await page.evaluate(() => window.__throws), []);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

// Left or right (Jamie, 2026-11-19: "Left and right handed folks may want it
// on one side or the other"): MENU, Side mirrors where the meter sits.
async function clearOfMeter(page) {
  const L = await page.evaluate(() => window.__kubb.game.L);
  let m;
  if (L.meter === "linear") m = L.dial;
  else {
    const g = await dialGeometry(page);
    // the face and the prompt plate over it
    m = {
      x: g.cx - g.r,
      y: g.cy - g.r * 1.45,
      width: 2 * g.r,
      height: g.r * 2.45,
    };
  }
  const boxes = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        "[data-test=plans] .plate, [data-test=rail], [data-test=menu], [data-test=tray] .btn",
      ),
    ]
      .filter((el) => !el.closest("[hidden]") && el.offsetParent)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          name: el.textContent,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
        };
      }),
  );
  assert.ok(boxes.length >= 8, `the HUD is up: ${boxes.length}`);
  for (const b of boxes) {
    const hit =
      b.x < m.x + m.width &&
      m.x < b.x + b.width &&
      b.y < m.y + m.height &&
      m.y < b.y + b.height;
    assert.ok(!hit, `${b.name} is clear of the meter`);
  }
  return L;
}

for (const [kind, meter, touch] of [
  ["portrait", "linear", true],
  ["desktop", "linear", false],
  ["desktop", "clock", false],
]) {
  browserTest(
    `the meter on the left: ${meter} (${kind}) lays out clear and throws`,
    async () => {
      const page = await open(env, "/practice/?nohowto=1", kind, {
        prefs: { meter, meterSide: "left" },
      });
      try {
        await waitPhase(page, "aim", 10000);
        const L = await clearOfMeter(page);
        assert.equal(L.meter, meter);
        assert.equal(L.meterSide, "left");
        assert.ok(L.dial.x + L.dial.width < L.W / 2, "on the left");
        // the tray at the other edge; the minimap keeps its place under the
        // header's right end
        assert.equal(L.planEdge, "right", "the tray at the right edge");
        await judgedThrow(page, { touch });
        assert.deepEqual(page.errors, []);
      } finally {
        await page.context().close();
      }
    },
  );
}

browserTest("the menu's Side moves the meter and remembers", async () => {
  const page = await open(env, "/practice/?nohowto=1", "desktop", {
    prefs: { meter: "linear" },
  });
  try {
    await waitPhase(page, "aim", 10000);
    const side = () => page.evaluate(() => window.__kubb.game.L.meterSide);
    assert.equal(await side(), "right", "the right is the default");
    await clearOfMeter(page);
    await page.click("[data-test=menu]");
    await page.click("[data-test=menu-settings]");
    await page.click("[data-test=menu-side] >> text=Left");
    assert.equal(await side(), "left");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("kubb:meterSide")),
      '"left"',
    );
    await page.reload();
    await page.waitForSelector("body[data-ready='1']");
    await waitPhase(page, "aim", 10000);
    assert.equal(await side(), "left", "kept over a reload");
    await page.click("[data-test=menu]");
    await page.click("[data-test=menu-settings]");
    await page.click("[data-test=menu-side] >> text=Right");
    assert.equal(await side(), "right");
    assert.deepEqual(page.errors, []);
  } finally {
    await page.context().close();
  }
});

browserTest(
  "a solo match's report: the card holds the aim, and the report arrives with the throw to replay",
  async () => {
    const rooms = await startPitchServer();
    const report = keptUnder(rooms, "reports/");
    try {
      const page = await open(
        env,
        `/p/abcdefgh?solo=1&nohowto=1&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`,
      );
      await page.click("[data-test=start]");
      await page.waitForSelector("[data-test=handoff]");
      await page.click("[data-test=handoff-go]");
      await waitPhase(page, "aim", 10000);
      await throwOnce(page);
      await waitPhase(page, "play", 5000);
      await page.evaluate(() => window.__kubb.game.skip());
      await waitPhase(page, "aim", 10000);

      await page.click("[data-test=menu]");
      await page.click("[data-test=report]");
      await page.waitForSelector("[data-test=report-card]");
      assert.equal(
        await page.locator("[data-test=menu-card]").count(),
        0,
        "the menu closed",
      );
      assert.ok(
        await page.isChecked("[data-test=report-kind-throw]"),
        "a game with a throw starts on the throw",
      );
      assert.match(
        await page.textContent("[data-test=report-card]"),
        /kept privately and not published/,
      );
      // paint on the pitch picture: two strokes, UNDO, CLEAR, then one to send
      const pad = page.locator("[data-test=report-paint]");
      await pad.scrollIntoViewIfNeeded();
      const scroller = () =>
        page.evaluate(
          () => document.querySelector("[data-test=report-card]").scrollTop,
        );
      const stroke = async (fx0, fy0, fx1, fy1) => {
        const b = await pad.boundingBox();
        await page.mouse.move(b.x + b.width * fx0, b.y + b.height * fy0);
        await page.mouse.down();
        for (let i = 1; i <= 8; i++)
          await page.mouse.move(
            b.x + b.width * (fx0 + ((fx1 - fx0) * i) / 8),
            b.y + b.height * (fy0 + ((fy1 - fy0) * i) / 8),
          );
        await page.mouse.up();
      };
      const strokes = () =>
        pad.getAttribute("data-strokes").then((n) => Number(n ?? 0));
      const top = await scroller();
      await stroke(0.3, 0.2, 0.6, 0.3);
      await stroke(0.4, 0.6, 0.5, 0.7);
      assert.equal(await scroller(), top, "painting does not scroll the card");
      assert.equal(await strokes(), 2);
      await page.click("[data-test=report-paint-undo]");
      assert.equal(await strokes(), 1);
      await page.click("[data-test=report-paint-clear]");
      assert.equal(await strokes(), 0);
      await stroke(0.35, 0.25, 0.65, 0.35);
      assert.equal(await strokes(), 1);
      // the game holds: modal, and typing reaches the card, not the pitch
      const before = await page.evaluate(() => {
        const g = window.__kubb.game;
        return { modal: g.modal, marker: g.out?.aim?.marker };
      });
      assert.equal(before.modal, 1);
      // SEND with nothing typed says what is wanted and sends nothing
      await page.click("[data-test=report-send]");
      assert.match(
        await page.textContent("[data-test=report-status]"),
        /Write what happened/,
      );
      await page.fill(
        "[data-test=report-happened]",
        "The baton went through the kubb. ÅÄÖ",
      );
      await page.keyboard.press("ArrowLeft");
      await page.fill(
        "[data-test=report-should]",
        "It should have knocked it down.",
      );
      const held = await page.evaluate(
        () => window.__kubb.game.out?.aim?.marker,
      );
      assert.deepEqual(
        held,
        before.marker,
        "arrow keys in the card move no circle",
      );
      await page.click("[data-test=report-send]");
      await page.waitForFunction(
        () =>
          document.querySelector("[data-test=report-status]")?.textContent ===
          "Sent, thank you.",
        null,
        { timeout: 10000 },
      );
      await page.click("[data-test=report-done]");
      assert.equal(await page.evaluate(() => window.__kubb.game.modal), 0);
      assert.equal(await page.locator("[data-test=report-card]").count(), 0);
      assert.equal(
        await page.locator("[inert]").count(),
        0,
        "nothing left inert",
      );

      assert.equal(report.kept.length, 1);
      const kept = JSON.parse(report.kept[0].text);
      const r = kept.report;
      assert.equal(r.mode, "solo");
      assert.equal(r.happened, "The baton went through the kubb. ÅÄÖ");
      assert.equal(r.selectedPieces, undefined, "no longer sent");
      assert.equal(r.paint.strokes.length, 1);
      assert.ok(r.paint.strokes[0].length >= 2);
      assert.equal(paintProblem(r.paint), null);
      assert.equal(r.should, "It should have knocked it down.");
      assert.equal(r.options.cpu.join(), "B");
      assert.ok(Number.isInteger(r.options.seed));
      assert.equal(r.lastThrow.action.type, "throw");
      assert.equal(r.actions.length, 1);
      assert.ok(r.build.lua.startsWith("lua-sources-"));
      assert.match(r.engine, /^\d+\.\d+\.\d+$/);
      assert.deepEqual(
        { w: r.viewport.w, h: r.viewport.h },
        { w: 1280, h: 768 },
      );
      assert.ok(!report.kept[0].text.includes("HeadlessChrome"));
      // it replays to what this browser had
      const engine = await Engine.create({ sources: await bundleLua() });
      const out = replayReport(engine, kept);
      assert.equal(out.same, true);
      assert.equal(out.whole.same, true);
      assert.deepEqual(page.errors, []);
      await page.context().close();
    } finally {
      await rooms.close();
    }
  },
);

browserTest(
  "reports from practice and from watching the computer, which goes on while the card is open",
  async () => {
    const rooms = await startPitchServer();
    const report = keptUnder(rooms, "reports/");
    const q = `nohowto=1&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`;
    try {
      const send = async (page, text) => {
        await page.click("[data-test=menu]");
        await page.click("[data-test=report]");
        await page.check("[data-test=report-kind-throw]");
        await page.fill("[data-test=report-happened]", text);
        await page.click("[data-test=report-send]");
        await page.waitForSelector(".report[data-sent='1']", {
          timeout: 10000,
        });
        await page.click("[data-test=report-done]");
      };
      // practice: a throw, then a report with the steps to replay it
      const practice = await open(env, `/practice/?${q}`);
      await waitPhase(practice, "aim", 10000);
      await throwOnce(practice);
      await waitPhase(practice, "play", 5000);
      await practice.evaluate(() => window.__kubb.game.skip());
      await waitPhase(practice, "aim", 10000);
      await send(practice, "Practice report");
      const p = JSON.parse(report.kept[0].text).report;
      assert.equal(p.mode, "practice");
      assert.equal(p.practice.ops.length, 1);
      assert.equal(p.practice.ops[0].type, "throw");
      assert.deepEqual(practice.errors, []);
      await practice.context().close();

      // watching: the computer keeps throwing under the card
      const watch = await open(env, `/p/abcdefgh?watch=1&${q}`);
      await watch.evaluate(() => (window.__kubb.game.zen = null));
      await watchThrows(watch);
      await watch.click("[data-test=menu]");
      await watch.click("[data-test=report]");
      await watch.check("[data-test=report-kind-throw]");
      const n0 = await watch.evaluate(() => window.__throws.length);
      await watch.waitForFunction((n) => window.__throws.length > n, n0, {
        timeout: 30000,
      });
      // above the winner card and the panels, which can appear under it
      assert.ok(
        await watch.evaluate(() => {
          const z = (sel) =>
            Number(getComputedStyle(document.querySelector(sel)).zIndex) || 0;
          return (
            z(".report-scrim") > Math.max(z(".card-layer"), z(".panel-host"))
          );
        }),
      );
      // and the rest is inert: a card shown under it takes no focus
      assert.ok(
        await watch.evaluate(() =>
          [...document.querySelector(".report-scrim").parentElement.children]
            .filter((el) => !el.classList.contains("report-scrim"))
            .every((el) => el.inert),
        ),
      );
      await watch.fill("[data-test=report-happened]", "Watch report");
      await watch.click("[data-test=report-send]");
      await watch.waitForSelector(".report[data-sent='1']", { timeout: 10000 });
      const w = JSON.parse(report.kept[1].text).report;
      assert.equal(w.mode, "watch");
      assert.deepEqual(w.options.cpu, ["A", "B"]);
      assert.deepEqual(watch.errors, []);
      await watch.context().close();
    } finally {
      await rooms.close();
    }
  },
);

browserTest(
  "feedback about anything: the card's choice, one box, sent with the game",
  async () => {
    const rooms = await startPitchServer();
    const report = keptUnder(rooms, "reports/");
    try {
      const page = await open(
        env,
        `/practice/?nohowto=1&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`,
      );
      await waitPhase(page, "aim", 10000);
      await page.click("[data-test=menu]");
      assert.equal(
        (await page.textContent("[data-test=report]")).trim(),
        "FEEDBACK",
      );
      await page.click("[data-test=report]");
      await page.waitForSelector("[data-test=report-card]");
      assert.match(
        await page.textContent("[data-test=report-card] h2"),
        /Send feedback/,
      );
      // no throw yet: "Something else" is chosen, its box shown and focused
      assert.ok(await page.isChecked("[data-test=report-kind-feedback]"));
      assert.ok(!(await page.isChecked("[data-test=report-kind-throw]")));
      assert.ok(await page.isVisible("[data-test=report-text]"));
      assert.ok(!(await page.isVisible("[data-test=report-happened]")));
      await page.waitForFunction(
        () => document.activeElement?.dataset.test === "report-text",
      );
      assert.match(
        await page.textContent("[data-test=report-card]"),
        /What would you like to tell us\?A problem, an idea, something you liked or did not\. Anything\./,
      );
      // a real radio group a keyboard moves through
      const group = await page.evaluate(() => {
        const inputs = [...document.querySelectorAll(".report-kind input")];
        return {
          radios: inputs.map((i) => i.type),
          names: inputs.map((i) => i.labels[0].textContent),
          legend: document.querySelector(".report-kind legend")?.textContent,
        };
      });
      assert.deepEqual(group.radios, ["radio", "radio"]);
      assert.deepEqual(group.names, ["A throw looked wrong", "Something else"]);
      assert.ok(group.legend);
      await page.focus("[data-test=report-kind-feedback]");
      await page.keyboard.press("ArrowLeft");
      assert.ok(await page.isChecked("[data-test=report-kind-throw]"));
      assert.ok(await page.isVisible("[data-test=report-happened]"));
      assert.ok(!(await page.isVisible("[data-test=report-text]")));
      await page.keyboard.press("ArrowRight");
      assert.ok(await page.isChecked("[data-test=report-kind-feedback]"));
      // SEND with the box blank asks for it and sends nothing
      await page.click("[data-test=report-send]");
      assert.match(
        await page.textContent("[data-test=report-status]"),
        /Write what you would like to tell us/,
      );
      assert.equal(report.kept.length, 0);
      const said = "The practice pitch could have a wind. ÅÄÖ";
      await page.fill("[data-test=report-text]", `  ${said}\n`);
      assert.equal(
        await page.getAttribute("[data-test=report-text]", "maxlength"),
        "2000",
      );
      await page.click("[data-test=report-send]");
      await page.waitForFunction(
        () =>
          document.querySelector("[data-test=report-status]")?.textContent ===
          "Sent, thank you.",
        null,
        { timeout: 10000 },
      );
      await page.click("[data-test=report-done]");
      assert.equal(await page.evaluate(() => window.__kubb.game.modal), 0);
      assert.equal(report.kept.length, 1);
      const r = JSON.parse(report.kept[0].text).report;
      assert.equal(r.kind, "feedback");
      assert.equal(r.text, said);
      assert.equal(r.mode, "practice");
      assert.equal(r.happened, undefined);
      assert.equal(r.should, undefined);
      assert.ok(r.practice, "the game as it stood goes with it");
      assert.deepEqual(page.errors, []);
      await page.context().close();
    } finally {
      await rooms.close();
    }
  },
);

// QA, 2026-11-22: closing the menu, or a card it opened (the score sheet, Send
// feedback), left the keyboard's focus on the page, so a keyboard player had to Tab
// round from the top. Each now gives it back to MENU; the cards are named dialogs.
browserTest(
  "the menu, the score sheet and Send feedback give the focus back to MENU",
  async () => {
    const rooms = await startPitchServer();
    try {
      const page = await open(
        env,
        `/p/abcdefgh?solo=1&nohowto=1&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`,
      );
      await page.click("[data-test=start]");
      await page.waitForSelector("[data-test=handoff]");
      await page.click("[data-test=handoff-go]");
      await waitPhase(page, "aim", 10000);
      const focused = () =>
        page.evaluate(() => document.activeElement?.dataset?.test ?? null);
      const backOnMenu = () =>
        page.waitForFunction(
          () => document.activeElement?.dataset?.test === "menu",
          null,
          { timeout: 2000 },
        );
      await page.focus("[data-test=menu]");
      await page.keyboard.press("Enter");
      await page.waitForSelector("[data-test=menu-card]");
      await page.keyboard.press("Escape");
      await backOnMenu();
      for (const [open, card, name] of [
        ["menu-sheet", "sheet-card", "Score sheet"],
        ["report", "report-card", "Send feedback"],
      ]) {
        await page.keyboard.press("Enter");
        await page.waitForSelector("[data-test=menu-card]");
        await page.click(`[data-test=${open}]`);
        await page.waitForSelector(`[data-test=${card}]`);
        assert.equal(
          await page.getAttribute(`[data-test=${card}]`, "role"),
          "dialog",
        );
        assert.equal(
          await page.getAttribute(`[data-test=${card}]`, "aria-label"),
          name,
        );
        await page.keyboard.press("Escape");
        await page.waitForSelector(`[data-test=${card}]`, {
          state: "detached",
        });
        await backOnMenu();
      }
      assert.equal(await focused(), "menu");
      assert.deepEqual(page.errors, []);
      await page.context().close();
    } finally {
      await rooms.close();
    }
  },
);

// QA, 2026-11-22: BATONS, KUBBS and RESET pressed while a practice throw was still
// playing did nothing at all (practiceDo took presses only while aiming), and the
// buttons gave no sign. The throw is now skipped to its end and the press made.
browserTest(
  "practice: KUBBS and RESET pressed while a throw plays are made",
  async () => {
    const page = await open(env, "/practice/?nohowto=1");
    await waitPhase(page, "aim", 10000);
    await throwOnce(page);
    await waitPhase(page, "play", 5000);
    await page.click("[data-test=drill]");
    await page.waitForFunction(
      () =>
        window.__kubb.game.need?.drill === true &&
        window.__kubb.game.phase === "aim",
      null,
      { timeout: 10000 },
    );
    assert.equal(
      await page.getAttribute("[data-test=drill]", "aria-pressed"),
      "true",
    );
    await page.click("[data-test=batons]");
    await page.waitForFunction(() => window.__kubb.game.need?.drill === false);
    await throwOnce(page);
    await waitPhase(page, "play", 5000);
    await page.click("[data-test=reset]");
    await page.waitForFunction(
      () =>
        window.__kubb.game.phase === "aim" &&
        window.__kubb.game.trail?.ops?.some((o) => o.type === "reset"),
      null,
      { timeout: 10000 },
    );
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },
);

// QA, 2026-11-22: a device that came in by a pitch link's welcome threw without ever
// seeing the guide, so reloading the pitch mid-match opened HOW TO THROW over its
// turn while the others waited. The automatic guide is for a device with no throws.
browserTest(
  "a device that has thrown gets no automatic HOW TO THROW",
  async () => {
    for (const [path, throwsMade, shown] of [
      ["/practice/", 3, false],
      ["/practice/", 0, true],
    ]) {
      const page = await open(env, path, "desktop", { prefs: { throwsMade } });
      await page.waitForTimeout(500);
      assert.equal(
        await page.locator("[data-test=howto]").count(),
        shown ? 1 : 0,
        `${throwsMade} throws`,
      );
      assert.deepEqual(page.errors, []);
      await page.context().close();
    }
  },
);

// QA, 2026-11-22: practice's KUBBS was "Kubbs (drilling)" to a screen reader, a
// Playdate word; its name is the word on it.
browserTest("practice's KUBBS is named by its word", async () => {
  const page = await open(env, "/practice/?nohowto=1");
  await waitPhase(page, "aim", 10000);
  const name = await page
    .getByRole("button", { name: "KUBBS", exact: true })
    .count();
  assert.equal(name, 1);
  assert.equal(
    await page.getAttribute("[data-test=drill]", "aria-label"),
    null,
  );
  await page.context().close();
});

// QA, 2026-11-22: on a phone held on its side the guide's first step spoke of "your
// finger or mouse" (the words followed the finger track, which a wide screen has
// none of); a touchscreen gets the finger's words however it is held.
browserTest(
  "HOW TO THROW speaks to a finger on a phone on its side",
  async () => {
    const page = await open(env, "/practice/", "landscape");
    await page.waitForSelector("[data-test=howto]");
    const text = await page.textContent("[data-test=howto]");
    assert.doesNotMatch(text, /mouse/i);
    assert.match(text, /Grab the clock/);
    assert.match(text, /finger/);
    await page.context().close();
  },
);

// QA, 2026-11-22: after THROW on the hand-off the focus was left on the page, and the
// next Tabs went MENU, the page, MENU before the meter. It now goes to the meter's
// stand-in (or the raise panel's first choice when a raise comes next).
browserTest("after the hand-off the keyboard is on the meter", async () => {
  const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1");
  await page.click("[data-test=start]");
  await page.waitForSelector("[data-test=handoff-go]");
  await page.focus("[data-test=handoff-go]");
  await page.keyboard.press("Enter");
  await waitPhase(page, "aim", 10000);
  await page.waitForFunction(
    () => document.activeElement?.dataset?.test === "meter-proxy",
    null,
    { timeout: 3000 },
  );
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

// QA, 2026-11-22: an observer played every throw through at full length while the
// players SKIPped, and fell turns behind. A watcher with actions waiting behind the one
// playing plays it skipped until it is one throw from live; a player never is.
browserTest(
  "a watcher with a backlog catches up; a player is never hurried",
  async () => {
    // watching the computer has no side: a scripted backlog stands in for the pitch's
    const watch = await open(env, "/p/abcdefgh?watch=1", "desktop", {
      prefs: { throwsMade: 5, howtoSeen: true },
    });
    try {
      const next = (backlog) =>
        watch.evaluate(async (backlog) => {
          const g = window.__kubb.game;
          g.backlogOf = () => backlog;
          const start = g.startPlayback.bind(g);
          return new Promise((done) => {
            g.startPlayback = (rec, local, out) => {
              g.startPlayback = start;
              const r = start(rec, local, out);
              requestAnimationFrame(() =>
                requestAnimationFrame(() => done(!!g.play?.skipped)),
              );
              return r;
            };
          });
        }, backlog);
      assert.equal(await next(2), true, "a backlog: skipped");
      await watch.waitForFunction(() => !window.__kubb.game.play, null, {
        timeout: 20000,
      });
      assert.equal(await next(0), false, "caught up: played at full length");
      assert.deepEqual(watch.errors, []);
    } finally {
      await watch.context().close();
    }
    // a player watching the computer's turn with a backlog: played through
    const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1");
    try {
      await page.click("[data-test=start]");
      await page.click("[data-test=handoff-go]");
      await waitPhase(page, "aim", 10000);
      await page.evaluate(() => {
        window.__kubb.game.backlogOf = () => 5;
      });
      for (let i = 0; i < 2; i++) {
        await waitPhase(page, "aim", 10000);
        await throwOnce(page);
        await waitPhase(page, "play", 5000);
        assert.equal(
          await page.evaluate(() => !!window.__kubb.game.play?.skipped),
          false,
        );
        await page.evaluate(() => window.__kubb.game.skip());
      }
      await page.waitForFunction(
        () =>
          window.__kubb.game.need?.cpu && window.__kubb.game.phase === "play",
        null,
        { timeout: 30000 },
      );
      assert.equal(
        await page.evaluate(() => !!window.__kubb.game.play?.skipped),
        false,
        "the computer's throw a player watches is not hurried",
      );
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

// QA, 2026-11-22: the winner card said "under a min" of every match, and the score
// sheet "Duration 0m": no action carried the clock, so the engine's finish was the
// start. A resign carries it now (`at`, part of the action); a length that is not
// known is not shown at all.
browserTest(
  "a match's length: a resign carries the clock; an unknown length is not shown",
  async () => {
    for (const ahead of [7, 0]) {
      const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1");
      try {
        await page.click("[data-test=start]");
        await page.click("[data-test=handoff-go]");
        await waitPhase(page, "aim", 10000);
        // the device's clock some minutes on, as if the match had gone on that long
        await page.evaluate((ahead) => {
          const Real = Date;
          const shift = ahead * 60000;
          window.Date = class extends Real {
            constructor(...a) {
              super(...(a.length ? a : [Real.now() + shift]));
            }
            static now() {
              return Real.now() + shift;
            }
          };
        }, ahead);
        await page.click("[data-test=menu]");
        await page.click("[data-test=menu-resign]");
        await page.waitForSelector("[data-test=winner]");
        const st = await page.evaluate(() => {
          const g = window.__kubb.game;
          return {
            action: g.trail.actions.at(-1),
            finish: JSON.parse(g.engine.snapshot()).finish,
            card: document.querySelector("[data-test=winner]").textContent,
          };
        });
        assert.equal(st.action.type, "resign");
        assert.ok(st.action.at?.year, "the resign carries the clock");
        assert.deepEqual(st.finish, st.action.at, "the engine took it");
        await page.click("[data-test=winner-sheet]");
        const sheet = await page.textContent("[data-test=sheet-text]");
        if (ahead) {
          assert.match(st.card, /7 min/);
          assert.match(sheet, /\[Duration "7m"\]/);
        } else {
          assert.doesNotMatch(st.card, /min\b/);
          assert.doesNotMatch(sheet, /Duration/);
        }
        // (the record's POST has no api in this test server: its 404 is not the page's)
        assert.deepEqual(
          page.errors.filter((e) => !/Failed to load resource/.test(e)),
          [],
        );
      } finally {
        await page.context().close();
      }
    }
  },
);

// QA, 2026-11-22: reloading a match against the computer lost it (and, recorded only
// at its end, it was never recorded). It is kept on the device after every action and
// offered back: RESUME carries on from the same hash with the whole trail, so the match
// is still recorded once, whole; NEW MATCH clears it; a finished match is not offered.
browserTest("a match against the computer survives a reload", async () => {
  // an api to keep the record: a finished match's save goes once its record is kept
  const rooms = await startPitchServer();
  const api = `&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`;
  const ctx = await env.browser.newContext(VIEWPORTS.desktop);
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem("qa")) return;
    sessionStorage.setItem("qa", "1");
    localStorage.setItem("kubb:throwsMade", "5");
    localStorage.setItem("kubb:howtoSeen", "true");
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const ready = () =>
    page.waitForSelector("body[data-ready='1']", { timeout: 30000 });
  try {
    await page.goto(`${env.base}/p/abcdefgh?solo=1&nohowto=1${api}`);
    await ready();
    assert.equal(await page.locator("[data-test=resume]").count(), 0);
    await page.click("[data-test=start]");
    await page.click("[data-test=handoff-go]");
    await waitPhase(page, "aim", 10000);
    await throwOnce(page);
    await waitPhase(page, "play", 5000);
    await page.evaluate(() => window.__kubb.game.skip());
    await waitPhase(page, "aim", 10000);
    const before = await page.evaluate(() => ({
      hash: window.__kubb.game.engine.hash().hash,
      actions: window.__kubb.game.trail.actions.length,
    }));
    assert.ok(before.actions >= 1);
    // reloaded: the card, then RESUME
    await page.reload();
    await ready();
    await page.waitForSelector("[data-test=resume]");
    assert.match(
      await page.textContent("[data-test=resume-text]"),
      /kept on this device \(Park, turn 1\)/,
    );
    await page.click("[data-test=resume-go]");
    await page.waitForFunction(() => window.__kubb.game.mode === "match");
    const after = await page.evaluate(() => ({
      hash: window.__kubb.game.engine.hash().hash,
      actions: window.__kubb.game.trail.actions.length,
      start: window.__kubb.game.trail.start.length > 0,
    }));
    assert.equal(after.hash, before.hash, "the same match, the same hash");
    assert.equal(after.actions, before.actions, "the whole trail");
    // PLAY NOW with a match in progress offers it too; NEW MATCH clears it
    await page.goto(`${env.base}/p/abcdefgh?solo=1&play=1&nohowto=1${api}`);
    await ready();
    await page.waitForSelector("[data-test=resume]");
    await page.click("[data-test=resume-go]");
    await page.waitForFunction(() => window.__kubb.game.mode === "match");
    // it ends (RESIGN): recorded once, whole, and the save is gone
    if (await page.locator("[data-test=handoff-go]").count())
      await page.click("[data-test=handoff-go]");
    await page.click("[data-test=menu]");
    await page.click("[data-test=menu-resign]");
    await page.waitForSelector("[data-test=winner]");
    const rec = await page.evaluate(() => ({
      n: window.__kubb.recorded.length,
      actions: window.__kubb.game.trail.actions.length,
    }));
    assert.equal(rec.n, 1, "recorded once");
    assert.equal(
      rec.actions,
      before.actions + 1,
      "the whole match: and the resign",
    );
    await page.waitForFunction(
      () => localStorage.getItem("kubb:soloMatch") === "null",
      null,
      { timeout: 10000 },
    );
    await page.reload();
    await ready();
    assert.equal(await page.locator("[data-test=resume]").count(), 0);
    // a new match kept, then NEW MATCH: cleared, the options card
    await page.click("[data-test=start]");
    await page.click("[data-test=handoff-go]");
    await waitPhase(page, "aim", 10000);
    await page.reload();
    await ready();
    await page.click("[data-test=resume-new]");
    await page.waitForSelector("[data-test=options]");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("kubb:soloMatch")),
      "null",
    );
    // a save that does not end on its own hash is refused, and the card is the options
    await page.click("[data-test=start]");
    await page.click("[data-test=handoff-go]");
    await waitPhase(page, "aim", 10000);
    await throwOnce(page);
    await waitPhase(page, "play", 5000);
    await page.evaluate(() => {
      window.__kubb.game.onTracked = null;
      const s = JSON.parse(localStorage.getItem("kubb:soloMatch"));
      s.hashes[s.hashes.length - 1] = "forged";
      localStorage.setItem("kubb:soloMatch", JSON.stringify(s));
    });
    await page.reload();
    await ready();
    await page.click("[data-test=resume-go]");
    await page.waitForSelector("[data-test=options]");
    assert.deepEqual(errors, []);
  } finally {
    await ctx.close();
    await rooms.close();
  }
});

browserTest(
  "blocked storage never stops a match against the computer",
  async () => {
    const page = await open(env, "/p/abcdefgh?solo=1&play=1", "desktop", {
      init: () => {
        Storage.prototype.setItem = () => {
          throw new DOMException("full", "QuotaExceededError");
        };
      },
    });
    try {
      // a first visit (nothing could be kept): the guide over the hand-off
      await page.waitForSelector("[data-test=howto]");
      await page.click("[data-test=howto-close]");
      await page.click("[data-test=handoff-go]");
      await waitPhase(page, "aim", 10000);
      await throwOnce(page);
      await waitPhase(page, "play", 5000);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

// Codex on #117: a reload during the winning throw's playback kept the finished match
// as one to RESUME, and resuming it recorded a match with no actions, then the whole
// one again. The save says what the engine says (over), the trail is in place before
// the view is entered, and a kept match that is over goes straight to its winner card,
// recorded once, then cleared. A record that fails is tried once more on the next load,
// then dropped (said in the console): never sent twice, never kept for ever.
browserTest(
  "reloads mid-throw, after the winning action and with the record failing: one whole record each",
  async () => {
    const rooms = await startPitchServer();
    const games = keptUnder(rooms, "games/browser/");
    const ctx = await env.browser.newContext(VIEWPORTS.desktop);
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem("qa")) return;
      sessionStorage.setItem("qa", "1");
      localStorage.setItem("kubb:throwsMade", "5");
      localStorage.setItem("kubb:howtoSeen", "true");
    });
    const page = await ctx.newPage();
    const errors = [];
    const warnings = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "warning") warnings.push(m.text());
    });
    const url = `${env.base}/p/abcdefgh?solo=1&nohowto=1&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`;
    const load = async () => {
      await page.goto(url);
      await page.waitForSelector("body[data-ready='1']", { timeout: 30000 });
    };
    const kept = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("kubb:soloMatch")));
    const startMatch = async () => {
      await page.click("[data-test=start]");
      await page.click("[data-test=handoff-go]");
      await waitPhase(page, "aim", 10000);
    };
    const waitKept = (n) =>
      page
        .waitForFunction(
          async () => {
            const all = await Promise.all(window.__kubb.recorded);
            return all.length > 0;
          },
          null,
          { timeout: 10000 },
        )
        .then(async () => {
          const deadline = Date.now() + 10000;
          while (games.kept.length < n && Date.now() < deadline)
            await page.waitForTimeout(100);
          return games.kept.length;
        });
    try {
      // 1. an ordinary throw, reloaded while it plays: offered, and the throw is in it
      await load();
      await startMatch();
      await throwOnce(page);
      await waitPhase(page, "play", 5000);
      const mid = await page.evaluate(() => ({
        hash: window.__kubb.game.engine.hash().hash,
        n: window.__kubb.game.trail.actions.length,
      }));
      assert.equal((await kept()).over, false);
      await load();
      await page.click("[data-test=resume-go]");
      await page.waitForFunction(() => window.__kubb.game.mode === "match");
      assert.equal(
        await page.evaluate(() => window.__kubb.game.engine.hash().hash),
        mid.hash,
      );
      // 2. the winning action made, the page gone before its end was shown (as during
      // the winning throw's playback): never offered, its winner card, one whole record
      const before = await page.evaluate(() => {
        const g = window.__kubb.game;
        g.enter = () => {};
        g.resign("A");
        return g.trail.actions.length;
      });
      assert.equal((await kept()).over, true);
      await load();
      assert.equal(await page.locator("[data-test=resume]").count(), 0);
      await page.waitForSelector("[data-test=winner]");
      assert.equal(await waitKept(1), 1);
      const rec = JSON.parse(games.kept[0].text).game;
      assert.equal(
        rec.actions.length,
        before,
        "the whole match, from its start",
      );
      assert.equal(rec.end.over, true);
      assert.equal(await kept(), null, "cleared once kept");
      await load();
      await page.waitForSelector("[data-test=options]");
      assert.equal(games.kept.length, 1, "not sent again");
      // 3. a resign whose record fails: the match leaves the slot, its record waits
      // apart and goes on the next load, in the background, once
      const pending = () =>
        page.evaluate(() =>
          JSON.parse(localStorage.getItem("kubb:soloPending") ?? "{}"),
        );
      const keptCount = async (n) => {
        const deadline = Date.now() + 10000;
        while (games.kept.length < n && Date.now() < deadline)
          await page.waitForTimeout(100);
        return games.kept.length;
      };
      await page.route("**/api/game", (r) => r.abort());
      await startMatch();
      await page.click("[data-test=menu]");
      await page.click("[data-test=menu-resign]");
      await page.waitForSelector("[data-test=winner]");
      await page.waitForFunction(() => Promise.all(window.__kubb.recorded));
      assert.equal(await kept(), null, "the finished match left the slot");
      assert.deepEqual(
        Object.values(await pending()).map((p) => p.tries),
        [1],
      );
      await page.unroute("**/api/game");
      await load();
      await page.waitForSelector("[data-test=options]");
      assert.equal(await keptCount(2), 2, "sent on the next load");
      await page.waitForFunction(
        () => localStorage.getItem("kubb:soloPending") === "{}",
      );
      await load();
      await page.waitForSelector("[data-test=options]");
      await page.waitForTimeout(500);
      assert.equal(games.kept.length, 2, "once");
      // 4. failing twice: dropped, and said
      await page.route("**/api/game", (r) => r.abort());
      await startMatch();
      await page.click("[data-test=menu]");
      await page.click("[data-test=menu-resign]");
      await page.waitForFunction(() =>
        Object.values(
          JSON.parse(localStorage.getItem("kubb:soloPending") ?? "{}"),
        ).some((p) => p.tries === 1),
      );
      await load();
      await page.waitForFunction(
        () => localStorage.getItem("kubb:soloPending") === "{}",
      );
      assert.ok(warnings.some((w) => /could not be recorded/.test(w)));
      assert.equal(games.kept.length, 2);
      assert.deepEqual(errors, []);
    } finally {
      await ctx.close();
      await rooms.close();
    }
  },
);

// Codex on #117, again: a REMATCH made while the last match's record was still on its
// way had the new match's save cleared (a kept record) or marked over (a failed one).
// Every step that clears or marks a save or a waiting record checks the match's id;
// a closed tab mid-send leaves the record waiting, sent on a later load, once.
browserTest(
  "a record still on its way never touches the next match's save",
  async () => {
    const rooms = await startPitchServer();
    const games = keptUnder(rooms, "games/browser/");
    const ctx = await env.browser.newContext(VIEWPORTS.desktop);
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem("qa")) return;
      sessionStorage.setItem("qa", "1");
      localStorage.setItem("kubb:throwsMade", "5");
      localStorage.setItem("kubb:howtoSeen", "true");
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const url = `${env.base}/p/abcdefgh?solo=1&nohowto=1&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`;
    const load = async () => {
      await page.goto(url);
      await page.waitForSelector("body[data-ready='1']", { timeout: 30000 });
    };
    const slot = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("kubb:soloMatch")));
    const pending = () =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("kubb:soloPending") ?? "{}"),
      );
    const startMatch = async () => {
      await page.click("[data-test=start]");
      await page.click("[data-test=handoff-go]");
      await waitPhase(page, "aim", 10000);
    };
    const resign = async () => {
      await page.click("[data-test=menu]");
      await page.click("[data-test=menu-resign]");
      await page.waitForSelector("[data-test=winner]");
    };
    const keptCount = async (n) => {
      const deadline = Date.now() + 10000;
      while (games.kept.length < n && Date.now() < deadline)
        await page.waitForTimeout(100);
      return games.kept.length;
    };
    try {
      for (const outcome of ["kept", "failed"]) {
        // the record held 1.5 s, then kept or refused; REMATCH and START meanwhile
        let release;
        const held = new Promise((r) => (release = r));
        await page.route("**/api/game", async (r) => {
          await held;
          if (outcome === "kept") await r.continue();
          else await r.abort();
        });
        await load();
        await startMatch();
        await resign();
        const first = (await pending()) && Object.keys(await pending());
        assert.equal(first.length, 1, "the record waits apart");
        await page.click("[data-test=rematch]");
        await startMatch();
        const next = (await slot()).id;
        assert.notEqual(next, first[0]);
        release();
        await page.waitForFunction(() => Promise.all(window.__kubb.recorded));
        await page.waitForTimeout(300);
        const s = await slot();
        assert.equal(s.id, next, `${outcome}: the new match's save is its own`);
        assert.equal(s.over, false, `${outcome}: and not over`);
        const p = await pending();
        if (outcome === "kept") assert.deepEqual(Object.keys(p), []);
        else assert.deepEqual(Object.keys(p), first, "the old record waits");
        await page.unroute("**/api/game");
        // reloaded: the new match is offered (not taken for over)
        await load();
        await page.waitForSelector("[data-test=resume]");
        await page.click("[data-test=resume-new]");
        await page.waitForSelector("[data-test=options]");
      }
      // the failed one was sent on that load, in the background, once
      assert.equal(await keptCount(2), 2);
      // leaving mid-send (HOME, a closed tab): the record waits; the next load sends it
      await page.route("**/api/game", () => {}); // never answered
      await startMatch();
      await resign();
      await load();
      assert.equal(
        Object.values(await pending()).length,
        1,
        "left waiting, its try counted",
      );
      await page.unroute("**/api/game");
      await load();
      assert.equal(await keptCount(3), 3, "sent on the next load");
      await page.waitForFunction(
        () => localStorage.getItem("kubb:soloPending") === "{}",
      );
      assert.deepEqual(errors, []);
    } finally {
      await ctx.close();
      await rooms.close();
    }
  },
);

// Two tabs on one device, each playing the computer: one kept match a device, the
// newest wins. A match live in one tab is never offered for RESUME in another; a newer
// match takes the slot, and the older tab is told once and stops being kept.
browserTest("two tabs never resume or clear each other's match", async () => {
  const ctx = await env.browser.newContext(VIEWPORTS.desktop);
  await ctx.addInitScript(() => {
    if (localStorage.getItem("kubb:throwsMade") === null) {
      localStorage.setItem("kubb:throwsMade", "5");
      localStorage.setItem("kubb:howtoSeen", "true");
    }
  });
  const url = `${env.base}/p/abcdefgh?solo=1&nohowto=1`;
  const tab = async () => {
    const p = await ctx.newPage();
    p.errors = [];
    p.on("pageerror", (e) => p.errors.push(e.message));
    await p.goto(url);
    await p.waitForSelector("body[data-ready='1']", { timeout: 30000 });
    return p;
  };
  const slotId = (p) =>
    p.evaluate(() => JSON.parse(localStorage.getItem("kubb:soloMatch"))?.id);
  const myId = (p) =>
    p.evaluate(() => {
      const o = JSON.parse(window.__kubb.game.trail.start).opts;
      const s = o.start;
      return `${o.seed}@${s.year}-${s.month}-${s.day}T${s.hour}:${s.min}`;
    });
  try {
    const a = await tab();
    await a.click("[data-test=start]");
    await a.click("[data-test=handoff-go]");
    await waitPhase(a, "aim", 10000);
    const idA = await myId(a);
    assert.equal(await slotId(a), idA);
    // B: A's match is live there, so it is not offered: the options card
    const b = await tab();
    await b.waitForSelector("[data-test=options]");
    assert.equal(await b.locator("[data-test=resume]").count(), 0);
    await b.click("[data-test=start]");
    await b.click("[data-test=handoff-go]");
    await waitPhase(b, "aim", 10000);
    const idB = await myId(b);
    assert.equal(await slotId(b), idB, "the newest wins");
    // A's next action finds the slot taken: told once, and B's save stands
    await throwOnce(a);
    await a.waitForSelector("[data-test=kept-elsewhere]");
    assert.equal(await slotId(a), idB);
    await a.click("[data-test=kept-elsewhere] .btn");
    await a.evaluate(() => window.__kubb.game.skip());
    await waitPhase(a, "aim", 10000);
    await throwOnce(a);
    await a.waitForTimeout(300);
    assert.equal(await a.locator("[data-test=kept-elsewhere]").count(), 0);
    assert.equal(await slotId(a), idB);
    // B closed: its match is offered to the next tab; A's, still live, never was
    await b.close();
    const c = await tab();
    await c.waitForSelector("[data-test=resume]");
    await c.click("[data-test=resume-go]");
    await c.waitForFunction(() => window.__kubb.game.mode === "match");
    assert.equal(await myId(c), idB);
    for (const p of [a, c]) assert.deepEqual(p.errors, []);
  } finally {
    await ctx.close();
  }
});
