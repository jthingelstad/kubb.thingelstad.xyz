// A shared pitch in real browsers (docs/MULTIPLAYER.md): the room server
// (tools/rooms-dev.mjs) and the preview (tools/preview.mjs) on free
// 127.0.0.1 ports, and one browser context per player on one /p/<code>,
// each passed the room server with ?rooms= (honoured only on 127.0.0.1).
// Skipped with a notice when Playwright's Chromium is not installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, sweep, swing, waitPhase, VIEWPORTS } from "./browser.mjs";
import { startRoomsServer } from "../../tools/rooms-dev.mjs";
import { makeRoomCode } from "../../src/net/room.js";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/multiplayer.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

let env, rooms;
before(async () => {
  if (!available) return;
  rooms = await startRoomsServer({ port: 0 });
  env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
  if (rooms) await rooms.close();
});

const SHOTS = process.env.KUBB_MP_SHOTS; // a directory: also take screenshots

// A player: their own context (own member id), on the pitch's lobby.
async function join(
  code,
  name,
  kind = "desktop",
  { lobby = true, query = "" } = {},
) {
  const ctx = await env.browser.newContext(VIEWPORTS[kind]);
  // a name remembered from before, for a browser that skips the lobby
  if (!lobby)
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
  const url = `${env.base}/p/${code}?nohowto=1&rooms=${encodeURIComponent(rooms.url)}${query}`;
  await page.goto(url);
  await page.waitForSelector("body[data-ready='1']", { timeout: 30000 });
  if (lobby) {
    await page.waitForSelector("[data-test=lobby]");
    await page.fill("[data-test=lobby-name]", name);
    await page.press("[data-test=lobby-name]", "Enter");
  }
  await page.waitForFunction(
    () => window.__kubb.pitch?.state().status === "open",
    null,
    { timeout: 10000 },
  );
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

// Wait until this browser may throw (closing its own hand-off card).
async function myThrow(page, ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const ok = await page.evaluate(() => {
      const g = window.__kubb.game;
      const go = document.querySelector(
        "[data-test=handoff-go], [data-test=pass] .btn",
      );
      if (go && g.mayAct()) go.click();
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
  assert.ok(p, "an aim plan");
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

// Every action committed and every browser on the room's hash.
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

// Play on (settling raises and punishment kubbs where this browser may)
// until `until(state)` holds in the first page.
async function settle(page) {
  await page.evaluate(() => {
    const g = window.__kubb.game;
    if (g.phase === "play") g.skip();
    if (g.phase === "raise" && g.mayAct())
      document.querySelector("[data-test=raise-auto]")?.click();
    if (g.phase === "punish" && g.mayAct()) g.punish();
    const go = document.querySelector(
      "[data-test=pass] .btn, [data-test=settle] .btn",
    );
    if (go && g.need?.cpu) go.click();
  });
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

browserTest("two browsers on opposite teams play the same throws", async () => {
  const code = makeRoomCode();
  const host = await join(code, "Hanna");
  const guest = await join(code, "Gus");
  await host.click("[data-test=join-A]");
  await guest.click("[data-test=join-B]");
  await waitFor(host, () =>
    document.querySelector("[data-test=team-B]")?.textContent.includes("Gus"),
  );
  await waitFor(guest, () =>
    document
      .querySelector("[data-test=waiting]")
      ?.textContent.includes("Hanna"),
  );
  // the guest sees the options read-only and no START
  assert.equal(
    await guest.locator("[data-test=lobby-start]").isVisible(),
    false,
  );
  assert.ok(await guest.locator(".lobby-options .opt-value").count());
  await host.click(".lobby-options [data-key=wind] [data-value=light]");
  await waitFor(guest, () =>
    document.querySelector(".lobby-options")?.textContent.includes("Light"),
  );
  await shot(host, "lobby-host-1280");
  await shot(guest, "lobby-guest-1280");

  await host.click("[data-test=lobby-start]");
  await waitFor(guest, () => window.__kubb.pitch.state().mode === "match");
  let [h, g] = await inStep([host, guest]);
  assert.equal(h.playing, "A");
  assert.equal(g.playing, "B");
  assert.deepEqual(h.control, { sides: ["A", "B"], cpu: true });
  assert.deepEqual(g.control, { sides: ["B"], cpu: false });

  // the host throws; the guest watches the same throw
  await myThrow(host);
  assert.equal(g.mayAct, false);
  await waitFor(
    host,
    () =>
      document.querySelector("[data-test=status]")?.textContent ===
      "YOUR THROW",
  );
  await waitFor(
    guest,
    () =>
      document.querySelector("[data-test=status]")?.textContent ===
      "HANNA THROWS",
  );
  await guest.evaluate(() => {
    window.__played = 0;
    const g = window.__kubb.game;
    const start = g.startPlayback.bind(g);
    g.startPlayback = (rec, local, out) => {
      window.__played++;
      return start(rec, local, out);
    };
  });
  await throwOnce(host);
  await waitFor(guest, () => window.__played === 1);
  await shot(guest, "guest-watching-1280");
  [h, g] = await inStep([host, guest]);
  assert.equal(h.local.seq, 1);
  assert.equal(g.hash, h.hash, "the same hash after the same throw");
  assert.ok(
    (await guest.evaluate(() => window.__kubb.pitch.log)).some(
      (e) => e[1] === "apply" && e[3] === "ok",
    ),
    "the guest applied the action (not adopted)",
  );

  // the host's second baton, then the turn passes to the guest
  await host.evaluate(
    () => window.__kubb.game.phase === "play" && window.__kubb.game.skip(),
  );
  await myThrow(host);
  await throwOnce(host);
  await inStep([host, guest]);
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    await settle(host);
    await settle(guest);
    const s = await pst(guest);
    if (s.mayAct && s.phase === "aim") break;
    await host.waitForTimeout(100);
  }
  await myThrow(guest);
  const before = (await pst(host)).local.seq;
  await host.evaluate(() => {
    window.__played = 0;
    const g = window.__kubb.game;
    const start = g.startPlayback.bind(g);
    g.startPlayback = (rec, local, out) => {
      window.__played++;
      return start(rec, local, out);
    };
  });
  await throwOnce(guest);
  await waitFor(host, () => window.__played === 1);
  [h, g] = await inStep([host, guest]);
  assert.ok(h.local.seq > before, "the guest's throw reached the host");
  assert.equal(h.hash, g.hash);
  assert.deepEqual(host.errors, []);
  assert.deepEqual(guest.errors, []);

  // a third browser arrives mid-match: it adopts at once and watches
  const late = await join(code, "Lou", "desktop", { lobby: false });
  await waitFor(late, () => window.__kubb.pitch.state().mode === "match");
  const [, , l] = await inStep([host, guest, late]);
  assert.equal(l.playing, null);
  assert.equal(l.mayAct, false);
  await waitFor(late, () =>
    document.querySelector("[data-test=net]")?.textContent.includes("WATCHING"),
  );
  assert.equal(await late.locator("[data-test=lobby]").count(), 0);
  assert.deepEqual(late.errors, []);

  // a shout reaches the others
  await guest.click("[data-test=shout]");
  await guest.click("[data-shout='TOK!']");
  await waitFor(host, () =>
    [...document.querySelectorAll(".shout")].some(
      (e) => e.textContent.includes("Gus") && e.textContent.includes("TOK!"),
    ),
  );

  // the guest's connection drops: it comes back and is still in step
  await guest.evaluate(() => window.__kubb.pitch.room._socket.close());
  await waitFor(guest, () => window.__kubb.pitch.state().status === "open");
  await inStep([host, guest, late]);

  // the guest resigns: everyone gets the winner card, only the host REMATCH
  await guest.evaluate(() => {
    const g = window.__kubb.game;
    if (g.phase === "play") g.skip();
  });
  await waitFor(guest, () => window.__kubb.game.phase !== "play");
  // (a resignation during a raise waits for it: the engine's resignPending)
  await guest.evaluate(() => window.__kubb.game.resign("B"));
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    await settle(host);
    await settle(guest);
    const over = await Promise.all(
      [host, guest, late].map((p) =>
        p.evaluate(() => !!document.querySelector("[data-test=winner]")),
      ),
    );
    if (over.every(Boolean)) break;
    await host.waitForTimeout(100);
  }
  for (const p of [host, guest, late])
    await waitFor(p, () => !!document.querySelector("[data-test=winner]"));
  assert.equal(await guest.locator("[data-test=rematch]").count(), 0);
  assert.equal(await late.locator("[data-test=rematch]").count(), 0);
  await host.click("[data-test=rematch]");
  for (const p of [host, guest, late])
    await waitFor(p, () => !!document.querySelector("[data-test=lobby]"));
  const back = await pst(guest);
  assert.equal(back.mode, "lobby");
  assert.equal(back.side, "B", "the same teams for the rematch");
  assert.deepEqual(guest.errors, []);

  for (const p of [host, guest, late]) await p.context().close();
});

browserTest("one person against the computer through the room", async () => {
  const code = makeRoomCode();
  const solo = await join(code, "Ada", "portrait");
  await solo.click("[data-test=join-B]");
  await waitFor(solo, () =>
    document.querySelector(".team-a")?.textContent.includes("computer"),
  );
  await shot(solo, "lobby-host-390");
  await solo.click("[data-test=lobby-start]");
  await waitFor(solo, () => window.__kubb.pitch.state().mode === "match");
  // A throws first: the computer, in this (the host's) browser
  await waitFor(solo, () => window.__kubb.game.need?.cpu === true);
  await waitFor(
    solo,
    () =>
      document.querySelector("[data-test=status]")?.textContent ===
      "COMPUTER THROWS",
  );
  const deadline = Date.now() + 90000;
  let mine = false;
  while (Date.now() < deadline && !mine) {
    await settle(solo);
    const s = await pst(solo);
    mine = s.mayAct && s.phase === "aim";
    if (!mine) await solo.waitForTimeout(100);
  }
  assert.ok(mine, "back to the person after the computer's turn");
  const s = (await inStep([solo]))[0];
  assert.ok(
    s.local.seq >= 2,
    `the computer's batons were committed (${s.local.seq})`,
  );
  await myThrow(solo);
  await throwOnce(solo);
  await inStep([solo]);
  assert.deepEqual(solo.errors, []);
  await solo.context().close();
});

// A finished pitch (docs/CLIENT.md "Replays"): the player's winner card offers WATCH
// REPLAY; a browser that opens the link after the end gets the result with WATCH REPLAY
// as its main action, plays the match again through its own engine (read only) to the
// same end, and goes back to the pitch; after REMATCH the lobby offers the last match.
browserTest("a finished pitch plays its match again", async () => {
  const code = makeRoomCode();
  const solo = await join(code, "Ada");
  await solo.click("[data-test=join-B]");
  await waitFor(solo, () =>
    document.querySelector(".team-a")?.textContent.includes("computer"),
  );
  await solo.click("[data-test=lobby-start]");
  await waitFor(solo, () => window.__kubb.pitch.state().mode === "match");
  const deadline = Date.now() + 90000;
  let mine = false;
  while (Date.now() < deadline && !mine) {
    await settle(solo);
    const s = await pst(solo);
    mine = s.mayAct && s.phase === "aim";
    if (!mine) await solo.waitForTimeout(100);
  }
  assert.ok(mine, "the person's throw");
  await myThrow(solo);
  await throwOnce(solo);
  await inStep([solo]);
  await waitFor(solo, () => window.__kubb.game.phase !== "play");
  await solo.evaluate(() => window.__kubb.game.resign("B"));
  await waitFor(solo, () => !!document.querySelector("[data-test=winner]"));
  const played = await pst(solo);
  // the player: REMATCH leads, WATCH REPLAY beside it
  await waitFor(
    solo,
    () => !!document.querySelector("[data-test=watch-replay]"),
  );
  assert.equal(
    await solo.getAttribute("[data-test=rematch]", "data-default"),
    "",
  );
  // the room was told to keep it
  await waitFor(solo, () =>
    window.__kubb.pitch.log.some((e) => e[1] === "keep"),
  );

  // a visitor after the end
  const late = await join(code, "Vic", "desktop", { lobby: false });
  await waitFor(late, () => !!document.querySelector("[data-test=winner]"));
  assert.equal(
    await late.getAttribute("[data-test=watch-replay]", "data-default"),
    "",
    "WATCH REPLAY is the main action",
  );
  assert.match(await late.textContent("[data-test=winner-teams]"), /Ada/);
  await shot(late, "replay-arrived");
  await late.click("[data-test=watch-replay]");
  await late.waitForSelector("[data-test=replay-bar]");
  assert.equal((await pst(late)).mode, "replay");
  // read only: the engine refuses an action from outside
  const refused = await late.evaluate(() => {
    try {
      window.__kubb.engine.apply({ type: "resign", side: "A" });
      return "taken";
    } catch (e) {
      return String(e.message);
    }
  });
  assert.match(refused, /read only/);
  // pause, then NEXT THROW plays one throw and holds
  await late.click("[data-test=replay-play]");
  const before = await late.evaluate(() => window.__kubb.engine.replayInfo());
  await late.click("[data-test=replay-next]");
  await waitFor(late, () => window.__kubb.game.phase !== "play");
  const after1 = await late.evaluate(() => window.__kubb.engine.replayInfo());
  assert.equal(after1.thrown, before.thrown + 1, "one throw on");
  await late.waitForTimeout(400);
  assert.equal(
    (await late.evaluate(() => window.__kubb.engine.replayInfo())).i,
    after1.i,
    "and held there",
  );
  assert.match(
    await late.textContent("[data-test=replay-count]"),
    /THROW 1 OF \d+/,
  );
  // no SEND FEEDBACK in a replay: its throws are the log's, not played here
  await late.click("[data-test=menu]");
  await late.waitForSelector("[data-test=menu-card]");
  assert.equal(await late.locator("[data-test=report]").count(), 0);
  await late.keyboard.press("Escape");
  await waitFor(late, () => !document.querySelector("[data-test=menu-card]"));
  // BACK in the first turn: the start of the match
  await late.click("[data-test=replay-back]");
  assert.equal(
    (await late.evaluate(() => window.__kubb.engine.replayInfo())).i,
    0,
  );
  // on at 4x to the end
  await late.click("[data-speed='4']");
  await late.click("[data-test=replay-play]");
  await shot(late, "replay-playing");
  await waitFor(
    late,
    () =>
      document.querySelector("[data-test=watch-replay]")?.textContent ===
      "REPLAY AGAIN",
    undefined,
    90000,
  );
  const end = await late.evaluate(() => ({
    info: window.__kubb.engine.replayInfo(),
    hash: window.__kubb.engine.hash().hash,
    differs: !document.querySelector("[data-test=replay-differs]").hidden,
  }));
  assert.equal(end.info.done, true);
  assert.equal(end.differs, false);
  assert.equal(end.hash, played.docHash, "the same end as the match");
  await shot(late, "replay-end");
  // REPLAY AGAIN, paused, and NEXT THROW to the end: the log ends on a resignation,
  // which plays nothing back, and the end card still comes
  await late.click("[data-test=watch-replay]");
  await late.waitForSelector("[data-test=replay-bar]");
  await late.click("[data-test=replay-play]");
  for (let i = 0; i < 40; i++) {
    if (await late.locator("[data-test=winner]").count()) break;
    await waitFor(late, () => window.__kubb.game.phase !== "play");
    await late.click("[data-test=replay-next]");
    await late.waitForTimeout(50);
  }
  await waitFor(
    late,
    () =>
      document.querySelector("[data-test=watch-replay]")?.textContent ===
      "REPLAY AGAIN",
  );
  assert.equal(
    (await late.evaluate(() => window.__kubb.engine.replayInfo())).done,
    true,
  );
  // and back to the pitch from the end card: the finished match, the room's own state
  await late.click("[data-test=replay-back-to-pitch]");
  await waitFor(late, () => !!document.querySelector("[data-test=winner]"));
  const back = await pst(late);
  assert.equal(back.mode, "match");
  assert.equal(back.hash, played.docHash);
  assert.equal(await late.locator("[data-test=replay-bar]").count(), 0);
  assert.ok(
    await late.evaluate(() => !!window.__kubb.menu.hooks.report),
    "SEND FEEDBACK is back",
  );

  // REMATCH: the lobby offers the last match
  await solo.click("[data-test=rematch]");
  await waitFor(solo, () => !!document.querySelector("[data-test=lobby]"));
  await waitFor(
    solo,
    () => !document.querySelector("[data-test=lobby-replay]")?.hidden,
  );

  // a phone: the bar fits, no sideways scroll
  const phone = await join(code, "Pia", "portrait", { lobby: false });
  await waitFor(
    phone,
    () => !document.querySelector("[data-test=lobby-replay]")?.hidden,
  );
  await phone.click("[data-test=lobby-replay]");
  await phone.waitForSelector("[data-test=replay-bar]");
  const fits = await phone.evaluate(() => {
    const r = document
      .querySelector("[data-test=replay-bar]")
      .getBoundingClientRect();
    return (
      r.left >= 0 &&
      r.right <= innerWidth &&
      document.documentElement.scrollWidth <= innerWidth
    );
  });
  assert.ok(fits, "the replay bar fits a phone");
  await shot(phone, "replay-phone");
  await phone.click("[data-test=replay-close]");
  await waitFor(phone, () => !!document.querySelector("[data-test=lobby]"));

  for (const p of [solo, late, phone]) {
    assert.deepEqual(p.errors, []);
    await p.context().close();
  }
});

browserTest(
  "a match from before replays offers the replay the room keeps for it",
  async () => {
    const code = makeRoomCode();
    const solo = await join(code, "Ada");
    await solo.click("[data-test=join-B]");
    await waitFor(solo, () =>
      document.querySelector(".team-a")?.textContent.includes("computer"),
    );
    await solo.click("[data-test=lobby-start]");
    await waitFor(solo, () => window.__kubb.pitch.state().mode === "match");
    await settle(solo);
    await solo.evaluate(() => window.__kubb.game.resign("B"));
    await waitFor(solo, () => !!document.querySelector("[data-test=winner]"));
    await waitFor(solo, () =>
      window.__kubb.pitch.log.some((e) => e[1] === "keep"),
    );
    const played = await pst(solo);
    await solo.context().close();
    // the document as one written before replays: no setup, start hash, log or end
    const stored = await rooms.store.getDoc(code);
    const doc = JSON.parse(stored.doc);
    for (const k of ["setup", "h0", "log", "over"]) delete doc.match[k];
    assert.ok(
      await rooms.store.putDoc(
        code,
        { ...stored, doc: JSON.stringify(doc) },
        stored.v,
      ),
    );
    // the room keeps a replay of that match (as tools/backfill-replay.mjs writes one)
    assert.ok(await rooms.store.getReplay(code));

    const late = await join(code, "Vic", "desktop", { lobby: false });
    await waitFor(late, () => !!document.querySelector("[data-test=winner]"));
    await waitFor(
      late,
      () => !!document.querySelector("[data-test=watch-replay]"),
    );
    assert.ok(
      await late.evaluate(() =>
        window.__kubb.pitch.log.some((e) => e[1] === "kept"),
      ),
    );
    assert.match(await late.textContent("[data-test=winner-teams]"), /Ada/);
    await late.click("[data-test=watch-replay]");
    await late.waitForSelector("[data-test=replay-bar]");
    await late.click("[data-speed='4']");
    await waitFor(
      late,
      () =>
        document.querySelector("[data-test=watch-replay]")?.textContent ===
        "REPLAY AGAIN",
      undefined,
      60000,
    );
    assert.equal(
      await late.evaluate(() => window.__kubb.engine.hash().hash),
      played.docHash,
      "the recorded result",
    );
    assert.deepEqual(late.errors, []);
    await late.context().close();
  },
);

browserTest("the lobby on a phone, as a guest", async () => {
  const code = makeRoomCode();
  const host = await join(code, "Hanna");
  await host.click("[data-test=join-A]");
  const guest = await join(code, "Gus", "portrait");
  await guest.click("[data-test=join-B]");
  await waitFor(guest, () =>
    document.querySelector("[data-test=team-A]")?.textContent.includes("Hanna"),
  );
  const over = await guest.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert.ok(over <= 0, "no sideways scroll");
  await shot(guest, "lobby-guest-390");
  const land = await join(code, "Lee", "landscape");
  await shot(land, "lobby-guest-landscape");
  assert.ok(await land.locator("[data-test=waiting]").isVisible());
  for (const p of [host, guest, land]) await p.context().close();
});

browserTest(
  "an open game: listed on the web game’s page, joined from the list, taken off by the host",
  async () => {
    const code = makeRoomCode();
    const host = await join(code, "Hanna", "desktop", { query: "&open=1" });
    const access = () =>
      host.evaluate(
        () =>
          document.querySelector("[data-test=lobby-access] [aria-checked=true]")
            ?.textContent,
      );
    await waitFor(host, () => window.__kubb.pitch.state().open === true);
    assert.equal(await access(), "Open");

    // the web game's page, /web/, as someone passing by
    const ctx = await env.browser.newContext(VIEWPORTS.portrait);
    const home = await ctx.newPage();
    home.errors = [];
    home.on("console", (m) => {
      if (m.type() === "error") home.errors.push(m.text());
    });
    const look = async () => {
      await home.goto(
        `${env.base}/web/?rooms=${encodeURIComponent(rooms.url)}`,
      );
      await home.waitForFunction(
        () =>
          document.querySelector("[data-open-list]").children.length ||
          /No open games/.test(
            document.querySelector("[data-open-status]").textContent,
          ),
        null,
        { timeout: 10000 },
      );
      return home.evaluate(() =>
        [...document.querySelectorAll(".open-game")].map((li) => ({
          text: li.querySelector(".open-game__text").textContent,
          href: li.querySelector("a").getAttribute("href"),
        })),
      );
    };
    // the host says so on its next tick: look until it shows
    let rows = [];
    let mine = null;
    for (let i = 0; i < 20 && !mine; i++) {
      if (i) await home.waitForTimeout(250);
      rows = await look();
      mine = rows.find((r) => r.href.startsWith(`/p/${code}`));
    }
    assert.ok(mine, JSON.stringify(rows));
    assert.match(
      mine.text,
      /^1 of 12 on the pitch · waiting to start · made just now$/,
    );
    assert.ok(!mine.text.includes("Hanna"), "no names");

    // JOIN from the list: the guest lands in the lobby, which says it is open
    await home.click(`a[href^="/p/${code}"]`);
    await home.waitForSelector("[data-test=lobby]", { timeout: 30000 });
    await waitFor(home, () => window.__kubb.pitch?.state().status === "open");
    assert.match(
      await home.textContent("[data-test=lobby-access]"),
      /Who can join\s*Open/,
    );
    await waitFor(host, () => window.__kubb.pitch.state().members === 2);
    const guestPage = home;
    const ctx2 = await env.browser.newContext(VIEWPORTS.desktop);
    const passer = await ctx2.newPage();
    const lookAgain = async () => {
      await passer.goto(
        `${env.base}/web/?rooms=${encodeURIComponent(rooms.url)}`,
      );
      await passer.waitForFunction(
        () =>
          document.querySelector("[data-open-list]").children.length ||
          /No open games/.test(
            document.querySelector("[data-open-status]").textContent,
          ),
        null,
        { timeout: 10000 },
      );
      return passer.evaluate(() =>
        [...document.querySelectorAll(".open-game")].map((li) =>
          li.querySelector("a").getAttribute("href"),
        ),
      );
    };
    // two on the pitch now
    let count = "";
    for (let i = 0; i < 20 && !/^2 of 12/.test(count); i++) {
      if (i) await passer.waitForTimeout(250);
      await lookAgain();
      count = await passer.evaluate(
        (c) =>
          document.querySelector(`.open-game:has(a[href^="/p/${c}"])`)
            ?.textContent ?? "",
        code,
      );
    }
    assert.match(count, /^2 of 12 on the pitch/);

    // the host makes it invite only: off the list
    await host.click("[data-test=lobby-access] [data-value=invite]");
    await waitFor(host, () => window.__kubb.pitch.state().open === false);
    assert.equal(await access(), "Invite only");
    for (let i = 0; i < 20; i++) {
      if (i) await passer.waitForTimeout(250);
      rows = await lookAgain();
      if (!rows.some((h) => h.startsWith(`/p/${code}`))) break;
    }
    assert.ok(!rows.some((h) => h.startsWith(`/p/${code}`)));
    await waitFor(guestPage, () =>
      /Invite only/.test(
        document.querySelector("[data-test=lobby-access]")?.textContent,
      ),
    );
    assert.deepEqual(host.errors, []);
    assert.deepEqual(guestPage.errors, []);
    for (const c of [host.context(), ctx, ctx2]) await c.close();
  },
);

browserTest("a bad pitch code and a missing room server say so", async () => {
  const ctx = await env.browser.newContext(VIEWPORTS.desktop);
  const page = await ctx.newPage();
  await page.goto(`${env.base}/p/abcdefgh?nohowto=1&rooms=ws://127.0.0.1:1`);
  await page.waitForSelector("body[data-ready='1']", { timeout: 30000 });
  await page.waitForSelector("[data-test=lobby]");
  assert.match(
    await page.textContent("[data-test=lobby]"),
    /CONNECTING|RECONNECTING/,
  );
  await ctx.close();
});
