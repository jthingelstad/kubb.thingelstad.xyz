// Observer mode in real browsers (docs/OBSERVER.md): WATCH on the open games list,
// /p/<code>?observe=1 on a match in play (in step at once, never acting, never the
// host), the watcher's card between matches, an empty pitch, and the free camera.
// The pitch server and the api (tools/pitch-dev.mjs, with a short host grace) and the
// preview on free 127.0.0.1 ports. Skipped with a notice when Playwright's Chromium is missing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, sweep, swing, VIEWPORTS } from "./browser.mjs";
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
    "# tests/game/observer.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

let env, rooms;
before(async () => {
  if (!available) return;
  // the host passes on half a second after it goes (live: 15 s)
  rooms = await startPitchServer({ options: { limits: { hostGraceMs: 500 } } });
  env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
  if (rooms) await rooms.close();
});

async function open(url, kind = "desktop", name = null) {
  const ctx = await env.browser.newContext(VIEWPORTS[kind]);
  if (name)
    await ctx.addInitScript(
      (n) => localStorage.setItem("kubb:name", JSON.stringify(n)),
      name,
    );
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") page.errors.push(m.text());
  });
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(url);
  return page;
}

const roomsQ = () =>
  `pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`;

// A browser on the pitch: the lobby's member, or with lobby false one that skips it.
async function join(code, name, { query = "", kind = "desktop" } = {}) {
  const page = await open(
    `${env.base}/p/${code}?nohowto=1&${roomsQ()}${query}`,
    kind,
    name,
  );
  await page.waitForSelector("body[data-ready='1']", { timeout: 30000 });
  await waitFor(page, () => window.__kubb.pitch?.state().status === "open");
  return page;
}

const pst = (page) => page.evaluate(() => window.__kubb.pitch.state());

async function waitFor(page, fn, arg, ms = 20000) {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
  } catch (err) {
    const st = await page
      .evaluate(() => JSON.stringify(window.__kubb.pitch?.state()))
      .catch(() => "?");
    throw new Error(`waiting for ${String(fn).slice(0, 160)}\n${st}`, {
      cause: err,
    });
  }
}

async function myThrow(page, ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const ok = await page.evaluate(() => {
      const g = window.__kubb.game;
      const go = document.querySelector(
        "[data-test=handoff-go], [data-test=pass] .btn",
      );
      if (go && g.mayAct()) go.click();
      if (g.phase === "play") g.skip();
      return (
        g.phase === "aim" && g.need?.kind === "throw" && g.mayAct() && !g.modal
      );
    });
    if (ok) return;
    await page.waitForTimeout(80);
  }
  throw new Error("never this browser's throw");
}

async function throwOnce(page) {
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
}

// One committed throw: a swing that made no throw (a loaded machine can drop the flick's
// speed under the meter's floor) is swung again, at most three times.
async function throwCommitted(page) {
  const from = (await pst(page)).docSeq;
  for (let i = 0; i < 3; i++) {
    await myThrow(page);
    await throwOnce(page);
    try {
      await page.waitForFunction(
        (n) => window.__kubb.pitch.state().docSeq > n,
        from,
        { timeout: 8000, polling: 50 },
      );
      return;
    } catch {
      // not thrown: swing again
    }
  }
  throw new Error(`no throw committed after docSeq ${from}`);
}

async function inStep(pages, ms = 20000) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    last = await Promise.all(pages.map(pst));
    const h = last[0].docHash;
    if (
      h &&
      last.every(
        (s) =>
          s.hash === h &&
          s.docHash === h &&
          s.local.seq === s.docSeq &&
          !s.pending &&
          !s.queued,
      )
    )
      return last;
    await pages[0].waitForTimeout(100);
  }
  throw new Error(`not in step: ${JSON.stringify(last)}`);
}

// A drag over the middle of the pitch with the mouse (button: "left" | "right").
async function dragPitch(page, dx, dy, button = "left") {
  const box = await page.locator("#pitch").boundingBox();
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down({ button });
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up({ button });
}

browserTest(
  "WATCH on the open games list: in step mid-match, never acting, the free camera, never the host",
  async () => {
    const code = makePitchCode();
    const host = await join(code, "Hanna", { query: "&open=1" });
    await host.waitForSelector("[data-test=lobby]");
    await host.click("[data-test=join-A]");
    await waitFor(host, () => window.__kubb.pitch.state().side === "A");
    await host.click("[data-test=lobby-start]");
    await waitFor(host, () => window.__kubb.pitch.state().mode === "match");
    await throwCommitted(host);

    // the web game's page: the row has JOIN and WATCH
    const home = await open(`${env.base}/web/?${roomsQ()}`, "desktop", "Olive");
    let watchHref = null;
    for (let i = 0; i < 40 && !watchHref; i++) {
      if (i) await home.reload();
      await home
        .waitForFunction(
          () => document.querySelector("[data-open-list]").children.length,
          null,
          { timeout: 3000 },
        )
        .catch(() => {});
      watchHref = await home.evaluate(
        (c) =>
          document
            .querySelector(`.open-game a[data-watch][href^="/p/${c}"]`)
            ?.getAttribute("href") ?? null,
        code,
      );
    }
    assert.ok(watchHref, "a WATCH link for the pitch");
    assert.match(watchHref, new RegExp(`^/p/${code}\\?observe=1&pitchserver=`));
    const joinHref = await home.evaluate(
      (c) =>
        document
          .querySelector(`.open-game:has(a[data-watch][href^="/p/${c}"]) a`)
          .getAttribute("href"),
      code,
    );
    assert.ok(
      !joinHref.includes("observe"),
      "JOIN is the first link, as before",
    );
    await home.click(`a[data-watch][href^="/p/${code}"]`);
    await home.waitForSelector("body[data-ready='1']", { timeout: 30000 });
    const obs = home;
    await waitFor(obs, () => window.__kubb.pitch.state().mode === "match");

    // late join: the room's snapshot puts it in step at once
    const [, o] = await inStep([host, obs]);
    assert.equal(o.observe, true);
    assert.equal(o.playing, null);
    assert.equal(o.mayAct, false);
    assert.deepEqual(o.control, { sides: [], cpu: false });
    assert.equal(o.observing, true);
    assert.equal(o.wide, "wide");
    // no lobby, no sides, no shouts; the view switch and the camera's bar
    for (const sel of [
      "[data-test=lobby]",
      "[data-test=join-A]",
      "[data-test=lobby-start]",
    ])
      assert.equal(await obs.locator(sel).count(), 0, sel);
    assert.equal(await obs.locator("[data-test=shout]").isVisible(), false);
    assert.ok(await obs.locator("[data-test=view]").isVisible());
    assert.ok(await obs.locator("[data-test=cam-hint]").isVisible());
    assert.equal(await obs.locator("[data-test=cam-reset]").isVisible(), false);
    await waitFor(obs, () =>
      /YOU ARE WATCHING/.test(
        document.querySelector("[data-test=net]")?.textContent,
      ),
    );
    // the host keeps its view (a player: no free camera)
    const h0 = await pst(host);
    assert.equal(h0.observing, false);
    assert.equal(h0.wide, "thrower");
    assert.equal(h0.members, 2, "the observer is a member, shown watching");

    // the hand-off card: a player keeps the engine's words, a watcher gets the teams
    const handoffOn = (page) =>
      page.evaluate(() => {
        const { cards, game } = window.__kubb;
        const card = {
          kind: "handoff",
          handoff: {
            to: "A",
            toName: game.need.teams.A,
            from: "B",
            fromName: game.need.teams.B,
            turn: 2,
            batons: 6,
            kubbs: 0,
            took: { field: 0, base: 1 },
            base: [4, 5],
            baseText: ["YOUR BASE 5", "THEIRS 4"],
            pieces: [],
          },
        };
        cards.engineCard(card, game.need, game);
        const el = document.querySelector("[data-test=handoff]");
        const out = {
          bases: [...el.querySelectorAll(".bases .chip")].map(
            (c) => c.textContent,
          ),
          go: el.querySelector("[data-test=handoff-go]").textContent,
          text: el.textContent,
        };
        cards.close();
        return { ...out, teams: game.need.teams };
      });
    const hc = await handoffOn(host);
    assert.deepEqual(
      hc.bases,
      ["YOUR BASE 5", "THEIRS 4"],
      "players unchanged",
    );
    const oc = await handoffOn(obs);
    assert.deepEqual(oc.bases, [
      `${oc.teams.B.toUpperCase()} BASE 4`,
      `${oc.teams.A.toUpperCase()} BASE 5`,
    ]);
    assert.equal(oc.go, "WATCH");
    assert.doesNotMatch(oc.text, /YOUR|THEIRS|you throw/i);

    // the free camera: a drag turns, the wheel zooms, RESET VIEW goes back
    await dragPitch(obs, 120, 40);
    await waitFor(obs, () => window.__kubb.pitch.state().camMoved);
    assert.ok(await obs.locator("[data-test=cam-reset]").isVisible());
    assert.equal(await obs.locator("[data-test=cam-hint]").isVisible(), false);
    const moved = await obs.evaluate(() => window.__kubb.game.freeCam.orbit);
    const box = await obs.locator("#pitch").boundingBox();
    await obs.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await obs.mouse.wheel(0, -300);
    await waitFor(
      obs,
      (d) => window.__kubb.game.freeCam.orbit.dist < d,
      moved.dist,
    );
    await obs.click("[data-test=cam-reset]");
    await waitFor(obs, () => !window.__kubb.pitch.state().camMoved);
    assert.equal(await obs.locator("[data-test=cam-reset]").isVisible(), false);
    // the keys: an arrow held turns, 0 goes back
    await obs.keyboard.down("ArrowLeft");
    await obs.waitForTimeout(200);
    await obs.keyboard.up("ArrowLeft");
    assert.ok((await pst(obs)).camMoved);
    await obs.keyboard.press("Digit0");
    await waitFor(obs, () => !window.__kubb.pitch.state().camMoved);
    // V: the thrower's view, no free camera; V again: back
    await obs.keyboard.press("KeyV");
    await waitFor(obs, () => window.__kubb.pitch.state().wide === "thrower");
    assert.equal(await obs.locator("[data-test=cam-bar]").isVisible(), false);
    await obs.keyboard.press("KeyV");
    await waitFor(obs, () => window.__kubb.pitch.state().wide === "wide");

    // the match goes on: the observer plays the same throws, still not acting
    await throwCommitted(host);
    await inStep([host, obs]);
    assert.equal((await pst(obs)).mayAct, false);
    assert.equal((await pst(obs)).pending, 0, "the observer wrote nothing");

    // a third arrives after the observer, then the host goes: the observer is first in
    // line, but the server hands the host to a player, never an observer
    const late = await join(code, "Lou", {});
    await waitFor(late, () => window.__kubb.pitch.state().mode === "match");
    await inStep([host, obs, late]);
    await host.context().close();
    await waitFor(
      late,
      () => {
        const s = window.__kubb.pitch.state();
        return s.host === s.you;
      },
      null,
      30000,
    );
    const after = await pst(obs);
    assert.notEqual(after.host, after.you, "the observer never hosts");
    assert.equal(after.host, (await pst(late)).you, "the player hosts");
    assert.equal(rooms.pitch(code).host, after.host, "as the server has it");
    // the new host runs the computer; the observer stays in step
    const l = await pst(late);
    assert.equal(l.control.cpu, true);
    await waitFor(obs, () => window.__kubb.pitch.state().status === "open");
    await inStep([late, obs], 30000);
    assert.equal((await pst(obs)).observing, true);
    assert.deepEqual(obs.errors, []);
    assert.deepEqual(late.errors, []);
    for (const p of [obs, late]) await p.context().close();
  },
);

browserTest(
  "between matches an observer sees the watching card, and is listed as watching",
  async () => {
    const code = makePitchCode();
    const host = await join(code, "Hanna");
    await host.waitForSelector("[data-test=lobby]");
    await host.click("[data-test=join-A]");
    await waitFor(host, () => window.__kubb.pitch.state().side === "A");
    const obs = await join(code, "Olive", {
      query: "&observe=1",
      kind: "landscape",
    });
    await obs.waitForSelector("[data-test=watch-card]");
    assert.equal(await obs.locator("[data-test=lobby-name]").count(), 0);
    assert.equal(await obs.locator("[data-test=lobby-start]").count(), 0);
    await waitFor(obs, () =>
      document
        .querySelector("[data-test=watch-team-A]")
        ?.textContent.includes("Hanna"),
    );
    assert.match(
      await obs.textContent("[data-test=watchers]"),
      /Olive \(you\)/,
    );
    assert.match(
      await obs.textContent("[data-test=watch-state]"),
      /Waiting for Hanna to start/,
    );
    await waitFor(host, () =>
      document
        .querySelector("[data-test=watchers]")
        ?.textContent.includes("Olive"),
    );
    // the observer is no player: START counts only the host
    const s = await pst(obs);
    assert.equal(s.side, null);
    assert.equal(s.observing, false, "no match: no free camera");
    // a name changed in MENU reaches the room: both Watching lines show it
    await obs.evaluate(() => window.__kubb.game.setPlayerName("Opal"));
    for (const p of [obs, host])
      await waitFor(p, () =>
        document
          .querySelector("[data-test=watchers]")
          ?.textContent.includes("Opal"),
      );
    // JOIN THIS PITCH: the same link, as a member who may pick a side
    await obs.click("[data-test=watch-join]");
    await obs.waitForSelector("[data-test=lobby]", { timeout: 30000 });
    assert.ok(!new URL(obs.url()).searchParams.has("observe"));
    assert.deepEqual(obs.errors, []);
    assert.deepEqual(host.errors, []);
    for (const p of [host, obs]) await p.context().close();
  },
);

browserTest(
  "a host who opens WATCH on their own pitch in another tab stays the host in the first",
  async () => {
    const code = makePitchCode();
    const host = await join(code, "Hanna");
    await host.waitForSelector("[data-test=lobby]");
    await host.click("[data-test=join-A]");
    await waitFor(host, () => window.__kubb.pitch.state().side === "A");
    const before = await pst(host);
    // the same browser (one localStorage, so one player id), a second tab
    const obs = await host.context().newPage();
    obs.errors = [];
    obs.on("pageerror", (e) => obs.errors.push(e.message));
    await obs.goto(`${env.base}/p/${code}?nohowto=1&observe=1&${roomsQ()}`);
    await obs.waitForSelector("[data-test=watch-card]", { timeout: 30000 });
    await waitFor(obs, () => window.__kubb.pitch.state().members === 2);
    const o = await pst(obs);
    assert.notEqual(o.you, before.you, "a member of its own");
    assert.equal(o.host, before.you, "the playing tab is still the host");
    assert.equal(o.side, null);
    // the playing tab was not taken over: still connected, the host, on its side
    await waitFor(host, () => window.__kubb.pitch.state().members === 2);
    const h = await pst(host);
    assert.equal(h.status, "open");
    assert.equal(h.host, before.you);
    assert.equal(h.side, "A");
    assert.deepEqual(obs.errors, []);
    assert.deepEqual(host.errors, []);
    await host.context().close();
  },
);

browserTest(
  "an observer at an empty pitch hears there is no game, and leaves",
  async () => {
    const code = makePitchCode();
    const obs = await open(
      `${env.base}/p/${code}?nohowto=1&observe=1&${roomsQ()}`,
      "desktop",
      "Olive",
    );
    await obs.waitForSelector("[data-test=no-game]", { timeout: 30000 });
    assert.equal((await pst(obs)).mode, "gone");
    // the pitch keeps no member and no document, and nothing reached the api
    const empty = () => {
      const p = rooms.pitch(code);
      return !p || (p.members.size === 0 && p.doc.value === null);
    };
    for (let i = 0; i < 40 && !empty(); i++) await obs.waitForTimeout(50);
    assert.ok(empty(), "no member and no document");
    assert.equal(await rooms.api.store.getState(code), null);
    assert.deepEqual(obs.errors, []);
    await obs.context().close();
  },
);

browserTest(
  "watching the computer: the free camera, and back to the wide view",
  async () => {
    const page = await open(
      `${env.base}/p/${makePitchCode()}?watch=1&nohowto=1`,
    );
    await page.waitForSelector("body[data-ready='1']", { timeout: 30000 });
    await page.waitForFunction(() => window.__kubb.game.wide, null, {
      timeout: 10000,
    });
    assert.ok(await page.evaluate(() => window.__kubb.game.observing));
    await dragPitch(page, -150, 0, "right");
    await page.waitForFunction(() => window.__kubb.game.freeCam.moved);
    // a right drag moves the point looked at and does not turn
    const o = await page.evaluate(() => {
      const g = window.__kubb.game;
      return { moved: g.freeCam.orbit, home: g.wide.camera };
    });
    assert.ok(
      Math.abs(o.moved.ty - o.home.ly) > 0.1 ||
        Math.abs(o.moved.tx - o.home.lx) > 0.1,
    );
    await page.click("[data-test=cam-reset]");
    await page.waitForFunction(() => !window.__kubb.game.freeCam.moved);
    assert.deepEqual(page.errors, []);
    await page.context().close();
  },
);
