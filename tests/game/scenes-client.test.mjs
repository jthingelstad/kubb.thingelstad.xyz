// The Scene in a real browser (src/render/scenes.js, docs/SCENES.md): a match option
// on engine 0.9, a look only. The solo card keeps it with its options and the pitch
// behind shows the pick; MENU sets the practice pitch's; on a pitch the host sets it
// in the lobby (the room's `settings.scene`) and every page draws it. ?scene= picks
// one off a pitch, never on one. (A pitch on 0.8 had no Scene row; the site carries the
// newest engine alone since 2026-11-21, so that test went with 0.8.)
// Skipped with a notice when Playwright's Chromium is not installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import {
  serve,
  open,
  waitPhase,
  VIEWPORTS,
  played,
  swing,
  sweep,
} from "./browser.mjs";
import { startPitchServer } from "../../tools/pitch-dev.mjs";
import { makePitchCode } from "../../src/net/pitch-client.js";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/scenes-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

let env, rooms;
before(async () => {
  if (!available) return;
  rooms = await startPitchServer();
  env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
  if (rooms) await rooms.close();
});

const matchOpts = (page) =>
  page.evaluate(() => JSON.parse(window.__kubb.game.engine.snapshot()).opts);
// what the page draws now: the Stage's scene, the view's and the page's skin
const drawn = (page) =>
  page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => r()));
    await new Promise((r) => requestAnimationFrame(() => r()));
    const g = window.__kubb.game;
    return {
      stage: g.stage.id,
      view: g.viewData?.scene ?? null,
      page: document.documentElement.dataset.scene ?? "day",
    };
  });
const checked = (page, test) =>
  page.getAttribute(`[data-test=${test}] [aria-checked=true]`, "data-value");

browserTest(
  "solo: the card restores its Scene, the pitch behind shows the pick, the match carries it",
  async () => {
    const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1", "desktop", {
      prefs: { solo: { name: "Brave Birch", scene: "neon" } },
    });
    try {
      await page.waitForSelector("[data-test=options]");
      assert.equal(
        await page.textContent("[data-test=solo-opt-scene] .opt-label"),
        "Scene",
      );
      // seven picture tiles (engine 0.14's catalogue), named by the engine's rows
      // (pitch.optionRows), each the game's own drawing of the pitch in that scene
      assert.deepEqual(
        await page.$$eval("[data-test=solo-opt-scene] .tile-name", (bs) =>
          bs.map((b) => b.textContent),
        ),
        [
          "Park",
          "Beach",
          "Camping",
          "Techno",
          "Minnesota",
          "Tournament",
          "Black & White",
        ],
      );
      await page.waitForFunction(() =>
        [
          ...document.querySelectorAll("[data-test=solo-opt-scene] canvas"),
        ].every((c) => c.width === 192),
      );
      // seven different pictures, none blank: each canvas's pixels summed
      const painted = await page.$$eval(
        "[data-test=solo-opt-scene] canvas",
        (cs) =>
          cs.map((c) => {
            const d = c
              .getContext("2d")
              .getImageData(0, 0, c.width, c.height).data;
            let h = 0,
              alpha = 0;
            for (let i = 0; i < d.length; i += 4) {
              h = (h * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13) >>> 0;
              alpha += d[i + 3];
            }
            return `${h}:${alpha > 0}`;
          }),
      );
      assert.equal(new Set(painted).size, 7, `seven pictures: ${painted}`);
      assert.ok(
        painted.every((p) => p.endsWith(":true")),
        "drawn, not blank",
      );
      assert.equal(await checked(page, "solo-opt-scene"), "neon");
      // the pitch behind the card shows the saved scene, then the pick
      assert.deepEqual(
        { ...(await drawn(page)), view: null },
        { stage: "neon", view: null, page: "neon" },
      );
      await page.click("[data-test=solo-opt-scene] [data-value=night]");
      const behind = await drawn(page);
      assert.equal(behind.stage, "night");
      assert.equal(behind.page, "night");
      await page.click("[data-test=start]");
      await waitPhase(page, "aim", 15000);
      assert.equal((await matchOpts(page)).scene, "night");
      assert.deepEqual(await drawn(page), {
        stage: "night",
        view: "night",
        page: "night",
      });
      assert.equal(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("kubb:solo")).scene,
        ),
        "night",
      );
      // the trail a share is made from starts with it (src/net/share.js)
      assert.equal(
        await page.evaluate(
          () => JSON.parse(window.__kubb.game.trail.start).opts.scene,
        ),
        "night",
      );
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

browserTest(
  "solo: the day is no scene in the match, and ?scene= is the card's pick over the saved one",
  async () => {
    const page = await open(
      env,
      "/p/abcdefgh?solo=1&nohowto=1&scene=day",
      "desktop",
      { prefs: { solo: { name: "Brave Birch", scene: "night" } } },
    );
    try {
      await page.waitForSelector("[data-test=options]");
      assert.equal(await checked(page, "solo-opt-scene"), "day");
      await page.click("[data-test=start]");
      await waitPhase(page, "aim", 15000);
      const o = await matchOpts(page);
      assert.equal(o.scene, undefined, "a day match starts as every match did");
      assert.deepEqual(await drawn(page), {
        stage: "day",
        view: "day",
        page: "day",
      });
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

browserTest(
  "an unknown saved scene is the day; watching the computer takes the card's scene",
  async () => {
    const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1", "desktop", {
      prefs: { solo: { name: "Brave Birch", scene: "dusk" } },
    });
    try {
      await page.waitForSelector("[data-test=options]");
      assert.equal(await checked(page, "solo-opt-scene"), "day");
      assert.equal((await drawn(page)).stage, "day");
    } finally {
      await page.context().close();
    }
    const watch = await open(env, "/p/abcdefgh?watch=1&nohowto=1", "desktop", {
      prefs: { solo: { name: "Brave Birch", scene: "neon" } },
    });
    try {
      await watch.waitForFunction(
        () => window.__kubb.game.mode === "match",
        null,
        { timeout: 15000 },
      );
      assert.equal((await matchOpts(watch)).scene, "neon");
      assert.equal((await drawn(watch)).stage, "neon");
      assert.deepEqual(watch.errors, []);
    } finally {
      await watch.context().close();
    }
  },
);

browserTest(
  "practice: MENU's Scene starts the pitch again in it, kept for next time",
  async () => {
    const page = await open(env, "/practice/?nohowto=1", "desktop", {
      prefs: { practiceScene: "neon" },
    });
    try {
      await waitPhase(page, "aim", 15000);
      assert.equal((await drawn(page)).view, "neon");
      await page.click("[data-test=menu]");
      await page.waitForSelector("[data-test=menu-scene]");
      const menuScene = () =>
        page.textContent(
          "[data-test=menu-scene] [aria-checked=true] .tile-name",
        );
      assert.equal(await menuScene(), "Techno");
      await page.click("[data-test=menu-scene] [data-value=night]");
      assert.equal(await menuScene(), "Camping");
      await page.keyboard.press("Escape");
      assert.deepEqual(await drawn(page), {
        stage: "night",
        view: "night",
        page: "night",
      });
      assert.equal(
        await page.evaluate(() =>
          JSON.parse(localStorage.getItem("kubb:practiceScene")),
        ),
        "night",
      );
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);

async function join(code, name) {
  const ctx = await env.browser.newContext(VIEWPORTS.desktop);
  await played(ctx);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") page.errors.push(m.text());
  });
  page.on("pageerror", (e) => page.errors.push(e.message));
  // ?scene= is never a shared pitch's: the host's choice is
  await page.goto(
    `${env.base}/p/${code}?nohowto=1&scene=neon&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`,
  );
  await page.waitForSelector("body[data-ready='1']", { timeout: 30000 });
  await page.waitForSelector("[data-test=lobby]");
  // the name a player picks in the lobby's name row
  await page.evaluate((n) => window.__kubb.game.setPlayerName(n), name);
  await page.waitForFunction(
    () => window.__kubb.pitch?.state().status === "open",
  );
  return page;
}

const sceneShown = (page, label) =>
  page.waitForFunction(
    (l) =>
      document.querySelector("[data-test=lobby-opt-scene] .opt-value")
        ?.textContent === l,
    label,
    { timeout: 20000, polling: 50 },
  );

browserTest(
  "a pitch on 0.9 or newer: the host sets the Scene, a guest and a late joiner see it, the match draws it on every page",
  async () => {
    const code = makePitchCode();
    const host = await join(code, "Happy Hazel");
    const guest = await join(code, "Lucky Larch");
    const pages = [host, guest];
    try {
      assert.equal(await checked(host, "lobby-opt-scene"), "day");
      assert.equal(
        (await drawn(guest)).page,
        "day",
        "?scene= is not a pitch's",
      );
      await host.click("[data-test=join-A]");
      await host.click("[data-test=lobby-opt-scene] [data-value=night]");
      await sceneShown(guest, "Camping");
      assert.equal(
        await guest.textContent("[data-test=lobby-opt-scene] .opt-label"),
        "Scene",
      );
      await host.waitForFunction(
        () => window.__kubb.pitch.room.doc?.settings?.scene === "night",
        null,
        { timeout: 20000, polling: 50 },
      );
      const doc = await host.evaluate(() => window.__kubb.pitch.room.doc);
      assert.equal(doc.options.scene, undefined, "not one of the five");
      // the lobby takes the scene's skin on every page
      for (const p of pages) assert.equal((await drawn(p)).page, "night");
      assert.equal(
        await host.evaluate(
          () => JSON.parse(localStorage.getItem("kubb:pitchOptions")).scene,
        ),
        "night",
      );
      const late = await join(code, "Kind Oak");
      pages.push(late);
      await sceneShown(late, "Camping");
      assert.equal((await drawn(late)).page, "night");
      await host.click("[data-test=lobby-start]");
      for (const p of pages)
        await p.waitForFunction(
          () => window.__kubb.pitch.mode === "match",
          null,
          { timeout: 20000 },
        );
      assert.equal(
        // the setup goes in the start's `meta`, not the document (PROTOCOL.md `start`)
        await host.evaluate(() => window.__kubb.pitch.meta?.setup?.scene),
        "night",
      );
      for (const p of pages) {
        assert.equal((await matchOpts(p)).scene, "night");
        assert.deepEqual(await drawn(p), {
          stage: "night",
          view: "night",
          page: "night",
        });
      }
      for (const p of pages) assert.deepEqual(p.errors, []);
    } finally {
      await Promise.all(pages.map((p) => p.context().close()));
    }
  },
);

// QA, 2026-11-22: Team B's violet with white type is 5.87:1, under the 7:1 the dark
// scenes hold. Camping and Techno draw Team B's controls in #6c3483 (8.55:1): the
// header's chip, the WATCH tab and the minimap; Park keeps #8e44ad.
browserTest(
  "Team B is the deeper violet in Camping and Techno only",
  async () => {
    const lum = (rgb) => {
      const c = rgb.map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    for (const [scene, want] of [
      ["night", "rgb(108, 52, 131)"],
      ["neon", "rgb(108, 52, 131)"],
      ["day", "rgb(142, 68, 173)"],
    ]) {
      const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1", "desktop", {
        prefs: { solo: { scene, computer: "kid" }, throwsMade: 5 },
      });
      try {
        await page.click("[data-test=start]");
        await page.click("[data-test=handoff-go]");
        await waitPhase(page, "aim", 15000);
        const chip = await page.evaluate(() => {
          const cs = getComputedStyle(
            document.querySelector("[data-test=rail-n-B]"),
          );
          return { bg: cs.backgroundColor, fg: cs.color };
        });
        assert.equal(chip.bg, want, scene);
        const nums = (s) => s.match(/\d+/g).slice(0, 3).map(Number);
        const r = ratio(nums(chip.bg), nums(chip.fg));
        if (scene !== "day") assert.ok(r >= 7, `${scene}: ${r.toFixed(2)}:1`);
        // the computer's WATCH tab draws from the same team colour (the computer is B)
        for (let i = 0; i < 2; i++) {
          await waitPhase(page, "aim", 15000);
          const p = await page.evaluate(() => window.__kubb.game.out.aim.plan);
          await swing(
            page,
            sweep({
              back: (p.powerLo + p.powerHi) / 2,
              stop: p.release,
              backDps: 900,
              flickDps: 3600,
            }),
          );
          await waitPhase(page, "play", 5000);
          await page.evaluate(() => window.__kubb.game.skip());
        }
        await page.waitForFunction(
          () => window.__kubb.game.meterShown?.prompt === "WATCH",
          null,
          { timeout: 20000 },
        );
        const tab = await page.evaluate(
          () => window.__kubb.game.meterShown.promptFill,
        );
        assert.equal(tab, scene === "day" ? "#8e44ad" : "#6c3483", scene);
        assert.deepEqual(page.errors, []);
      } finally {
        await page.context().close();
      }
    }
  },
);
