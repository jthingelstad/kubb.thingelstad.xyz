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
} from "./browser.mjs";
import { startRoomsServer } from "../../tools/rooms-dev.mjs";
import { memoryReporter } from "../../backend/rooms/reports.mjs";
import { memoryGameRecorder } from "../../backend/rooms/recorder.mjs";
import { Engine } from "../../src/engine/index.js";
import { bundleLua } from "../../tools/lua-bundle.mjs";
import { replayReport } from "../../tools/reports.mjs";
import { browserMatch, replayBrowser } from "../../tools/games.mjs";

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

browserTest(
  "a solo match plays your throw, the computer's WATCH and a hand-off",
  async () => {
    const page = await open(env, "/p/abcdefgh?solo=1&nohowto=1");
    await page.click("[data-test=start]");
    await page.waitForSelector("[data-test=handoff]");
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
    await page.waitForFunction(
      () =>
        document.querySelector("[data-test=status]")?.textContent === "WATCH",
      null,
      { timeout: 5000 },
    );
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

browserTest(
  "watching the computer: both sides throw, in a hidden tab too, and the next match starts by itself",
  async () => {
    const recordGame = memoryGameRecorder();
    const rooms = await startRoomsServer({ port: 0, recordGame });
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
    // the finished match is sent to a rooms server, as every watched one is
    const rooms = await startRoomsServer({
      port: 0,
      recordGame: memoryGameRecorder(),
    });
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
      `/p/abcdefgh?watch=1&rooms=${encodeURIComponent(rooms.url)}`,
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
      `/p/abcdefgh?watch=1&rooms=${encodeURIComponent(rooms.url)}`,
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
    // a room server that keeps no matches answers `unavailable`
    const rooms = await startRoomsServer({ port: 0 });
    try {
      const page = await open(
        env,
        `/p/abcdefgh?watch=1&rooms=${encodeURIComponent(rooms.url)}`,
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
      await page.waitForSelector("[data-test=winner]", {
        state: "detached",
        timeout: 5000,
      });
      assert.equal(
        (await page.evaluate(() => window.__kubb.game.need)).turn,
        1,
        "the next match started",
      );
      assert.deepEqual(page.errors, []);
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
    // on screen without the positions (" (@ x,y ...)"); the file keeps them
    assert.equal(shown, file.replace(/\n$/, "").replace(/ ?\(@[^()]*\)/g, ""));
    assert.ok(!shown.includes("(@"), "positions hidden");
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

browserTest(
  "a solo match's report: the card holds the aim, and the report arrives with the throw to replay",
  async () => {
    const report = memoryReporter();
    const rooms = await startRoomsServer({ port: 0, report });
    try {
      const page = await open(
        env,
        `/p/abcdefgh?solo=1&nohowto=1&rooms=${encodeURIComponent(rooms.url)}`,
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
      assert.match(
        await page.textContent("[data-test=report-card]"),
        /kept privately and not published/,
      );
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
      assert.equal(r.should, "It should have knocked it down.");
      assert.equal(r.options.cpu.join(), "B");
      assert.ok(Number.isInteger(r.options.seed));
      assert.equal(r.lastThrow.action.type, "throw");
      assert.equal(r.actions.length, 1);
      assert.ok(r.build.lua.startsWith("lua-sources-"));
      assert.match(r.build.core, /^[0-9a-f]{40}$/);
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
    const report = memoryReporter();
    const rooms = await startRoomsServer({ port: 0, report });
    const q = `nohowto=1&rooms=${encodeURIComponent(rooms.url)}`;
    try {
      const send = async (page, text) => {
        await page.click("[data-test=menu]");
        await page.click("[data-test=report]");
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
