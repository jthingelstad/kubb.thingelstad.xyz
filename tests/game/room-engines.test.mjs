// A pitch's engine (docs/ENGINES.md "Playing together") through the real controller, the
// built site and the local pitch server and api (tools/pitch-dev.mjs). The site carries
// the newest engine alone (the owner, 2026-11-21: "Let's force all clients to the most
// recent engine"): two current pages play it, a watcher on an older client does not
// hold the pitch back, and a player on one (an iPhone build on 0.9) leaves the players
// with no engine in common, so both the host and that player are told the pitch needs
// the newest version and START stays off. An older client is stood in for by a page
// that announces less than it carries (`only`), or by one that writes its presence as
// an older client does (`freeze`).
// Skipped with a notice when Playwright's Chromium is not installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, sweep, swing, VIEWPORTS, played } from "./browser.mjs";
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
    "# tests/game/room-engines.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

let env, rooms;
before(async () => {
  if (!available) return;
  // the host passes on two seconds after it goes (live: 15 s)
  rooms = await startPitchServer({
    options: { limits: { hostGraceMs: 2000 } },
  });
  env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
  if (rooms) await rooms.close();
});

async function join(code, name, { lobby = true } = {}) {
  const ctx = await env.browser.newContext(VIEWPORTS.desktop);
  await played(ctx);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") page.errors.push(m.text());
  });
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(
    `${env.base}/p/${code}?nohowto=1&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`,
  );
  await page.waitForSelector("body[data-ready='1']", { timeout: 30000 });
  if (lobby) {
    await page.waitForSelector("[data-test=lobby]");
    // the name a player picks in the lobby's name row
    await page.evaluate((n) => window.__kubb.game.setPlayerName(n), name);
  }
  await page.waitForFunction(
    () => window.__kubb.pitch?.state().status === "open",
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

// This page announces only `carries` from here on (a client that carries less).
const only = (page, carries) =>
  page.evaluate((c) => {
    const p = window.__kubb.pitch;
    p.carries = c;
    p.roomKey = null;
    p.renderLobby();
  }, carries);

// This page stops announcing and writes its presence as given (an older tab).
const freeze = (page, fields) =>
  page.evaluate((f) => {
    const p = window.__kubb.pitch;
    p.speak = () => {};
    p.room.setMe(f);
  }, fields);

// The room's engine as the host works it out now.
const roomEngine = (page) =>
  page.evaluate(() => {
    const p = window.__kubb.pitch;
    p.roomKey = null;
    return p.roomEngine().engine;
  });

const sawMember = (page, engine) =>
  waitFor(
    page,
    (e) =>
      window.__kubb.pitch.room.members.some(
        (m) => m.id !== window.__kubb.pitch.you && m.me.engine === e,
      ),
    engine,
  );

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

async function inStep(pages, ms = 20000) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    last = await Promise.all(pages.map(pst));
    const h = last[0].docHash;
    if (
      h &&
      last[0].docSeq > 0 &&
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

// The reports the api kept, oldest first (backend/api/records.mjs memoryRecords).
const reportsKept = () =>
  [...rooms.api.records.kept]
    .filter(([k]) => k.startsWith("reports/"))
    .map(([, text]) => JSON.parse(text).report);

// Let whoever throws first throw once; both pages end on the same hash. Returns the
// match as the pitch server holds it: its meta (the engine it plays) and its actions
// (each with the client tag it came with).
async function oneThrowInStep(host, guest, code) {
  // whoever throws first (the match's opening decides)
  let first = null;
  for (let i = 0; i < 300 && !first; i++) {
    for (const p of [host, guest])
      if (
        await p.evaluate(
          () =>
            window.__kubb.game.need?.kind === "throw" &&
            window.__kubb.game.mayAct(),
        )
      )
        first = p;
    if (!first) await host.waitForTimeout(100);
  }
  assert.ok(first, "someone throws");
  await myThrow(first);
  await throwOnce(first);
  const st = await inStep([host, guest]);
  assert.ok(st[0].docSeq >= 1);
  const m = rooms.pitch(code).match;
  assert.ok(m.acts.length >= 1, "the pitch committed the throw");
  return m;
}

// The iPhone app on engine 0.9, carrying 0.8 and 0.7 beside it (throwingwood-ios
// scripts/vendor-engine.sh: TAG v0.9.0, OLDER v0.8.2 v0.7.4).
const IPHONE_09 = { engine: "0.9+engines", engines: ["0.9", "0.8", "0.7"] };

const close = (...pages) => Promise.all(pages.map((p) => p.context().close()));

browserTest(
  "two pages start on the newest; a watcher on an older client does not pull the room down",
  async () => {
    const code = makePitchCode();
    const host = await join(code, "Happy Hazel");
    const guest = await join(code, "Lucky Larch");
    const watcher = await join(code, "Kind Oak");
    try {
      await host.click("[data-test=join-A]");
      await guest.click("[data-test=join-B]");
      await waitFor(
        host,
        () => window.__kubb.pitch.room.doc?.teams.B.length === 1,
      );
      // what a page says: the newest, marked, and nothing else
      await waitFor(
        guest,
        () =>
          window.__kubb.pitch.room.me.engine === "0.16+engines" &&
          window.__kubb.pitch.room.me.engines.join() === "0.16",
      );
      await freeze(watcher, IPHONE_09);
      await sawMember(host, "0.9+engines");
      assert.equal(await roomEngine(host), "0.16");
      assert.equal(await host.isHidden("[data-test=lobby-engine]"), true);
      await host.waitForSelector("[data-test=lobby-opt-computer]");
      await host.click("[data-test=lobby-start]");
      await waitFor(guest, () => window.__kubb.pitch.mode === "match");
      const [h, g] = await Promise.all([pst(host), pst(guest)]);
      assert.equal(h.matchEngine, "0.16");
      const v = await host.evaluate(() => window.__kubb.engine.version);
      assert.deepEqual(
        [h.engine, g.engine, h.announced, g.announced],
        [v, v, "0.16+engines", "0.16+engines"],
      );
      assert.deepEqual(
        await host.evaluate(() => window.__kubb.engines.carried()),
        ["0.16"],
      );
      for (const p of [host, guest, watcher]) assert.deepEqual(p.errors, []);
    } finally {
      await close(host, guest, watcher);
    }
  },
);

browserTest(
  "a player on an older client: both sides are told the pitch needs the newest version, and START stays off",
  async () => {
    const code = makePitchCode();
    const host = await join(code, "Happy Hazel");
    const guest = await join(code, "Lucky Larch");
    try {
      await host.click("[data-test=join-A]");
      await guest.click("[data-test=join-B]");
      await waitFor(
        host,
        () => window.__kubb.pitch.room.doc?.teams.B.length === 1,
      );
      // the guest stands in for an iPhone build on 0.9: it carries 0.9 and older
      await only(guest, ["0.9", "0.8", "0.7"]);
      await sawMember(host, "0.9+engines");
      await host.waitForSelector("[data-test=lobby-engine]:not([hidden])");
      assert.equal(
        await host.textContent("[data-test=lobby-engine]"),
        "Lucky Larch has an older version of the game. This pitch needs the newest version of the game. Lucky Larch: update to play.",
      );
      assert.equal(
        await host.evaluate(
          () => document.querySelector("[data-test=lobby-start]").disabled,
        ),
        true,
      );
      // the older client, counted too, hears it of itself
      await guest.waitForSelector("[data-test=lobby-engine]:not([hidden])");
      assert.equal(
        await guest.textContent("[data-test=lobby-engine]"),
        "This pitch needs the newest version of the game. Reload the page to update.",
      );
      // START, pressed anyway, starts nothing, on no engine
      await host.evaluate(() => window.__kubb.pitch.start());
      assert.equal(
        await host.evaluate(() => window.__kubb.pitch.room.doc.started),
        false,
      );
      assert.equal(rooms.pitch(code).match ?? null, null, "no match began");

      // a client from before engines were named
      await freeze(guest, { engine: null, engines: null });
      await waitFor(host, () =>
        /Lucky Larch has an older version of the game\. This pitch needs the newest version of the game/.test(
          document.querySelector("[data-test=lobby-engine]").textContent,
        ),
      );

      // the older client goes to watch: nothing blocks, START is on
      await guest.evaluate(() => window.__kubb.pitch.pickTeam(null));
      await host.waitForSelector("[data-test=lobby-engine]", {
        state: "hidden",
      });
      assert.equal(
        await host.evaluate(
          () => document.querySelector("[data-test=lobby-start]").disabled,
        ),
        false,
      );
      assert.deepEqual(host.errors, []);
    } finally {
      await close(host, guest);
    }
  },
);

browserTest(
  "a match an older client started on 0.9: the page watches nothing of it and says the pitch plays an older version",
  async () => {
    const code = makePitchCode();
    const host = await join(code, "Happy Hazel");
    const other = await join(code, "Lucky Larch");
    try {
      // a 0.9 host (an iPhone build) starts a match no page here carries
      await host.evaluate(async () => {
        const { pitch, engine: e } = window.__kubb;
        e.newMatch({ seed: 6, cpu: "B" });
        const players = { A: [{ id: pitch.you, name: "Happy Hazel" }], B: [] };
        const r = await pitch.room.start({
          doc: {
            v: 1,
            teams: { A: [pitch.you], B: [] },
            started: true,
            n: 1,
            match: { n: 1, players, cpu: "B", host: pitch.you, engine: "0.9" },
          },
          n: 1,
          h: e.hash().hash,
          snap: e.snapshot(),
          meta: { v: 1, engine: "0.9", players, cpu: "B" },
        });
        if (!r) throw new Error("the start was refused");
      });
      await other.waitForSelector("[data-test=engine-differs]");
      assert.match(
        await other.textContent("[data-test=engine-differs]"),
        /older version of the game, which this page no longer plays/,
      );
      const st = await pst(other);
      assert.deepEqual(st.control, { sides: [], cpu: false });
      assert.deepEqual(other.errors, []);
    } finally {
      await close(host, other);
    }
  },
);

browserTest(
  "a page that cannot play the match and becomes host mid-match says so",
  async () => {
    const code = makePitchCode();
    const host = await join(code, "Happy Hazel");
    const other = await join(code, "Lucky Larch");
    try {
      // a match of an engine no page here carries, against the computer, started on
      // the local pitch server by the host's page as a newer client would
      await host.evaluate(async () => {
        const { pitch, engine: e } = window.__kubb;
        e.newMatch({ seed: 6, cpu: "B" });
        const players = { A: [{ id: pitch.you, name: "Happy Hazel" }], B: [] };
        const r = await pitch.room.start({
          doc: {
            v: 1,
            teams: { A: [pitch.you], B: [] },
            started: true,
            n: 1,
            match: { n: 1, players, cpu: "B", host: pitch.you, engine: "0.14" },
          },
          n: 1,
          h: e.hash().hash,
          snap: e.snapshot(),
          meta: { v: 1, engine: "0.14", players, cpu: "B" },
        });
        if (!r) throw new Error("the start was refused");
      });
      await other.waitForSelector("[data-test=engine-differs]");
      assert.equal(
        await other.locator("[data-test=host-refused]").count(),
        0,
        "not the host: nothing more to say",
      );
      await host.context().close();
      await other.waitForSelector("[data-test=host-refused]", {
        timeout: 40000,
      });
      assert.match(
        await other.textContent("[data-test=host-refused]"),
        /the computer cannot take its turns from here/,
      );
      const st = await pst(other);
      assert.deepEqual(st.control, { sides: [], cpu: false });
    } finally {
      await close(other);
    }
  },
);
