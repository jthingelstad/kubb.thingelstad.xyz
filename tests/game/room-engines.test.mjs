// A pitch on the room's engine (docs/ENGINES.md "Playing together") through the real
// controller, the built site and the local room server: the page carries 0.8 and 0.7,
// announces the room's engine, starts on it, plays it, and says what blocks START when
// the players share none. An older client is stood in for by a page that announces less
// than it carries (`only`), or by one that writes a lone `engine` as an older tab does.
// Skipped with a notice when Playwright's Chromium is not installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, sweep, swing, VIEWPORTS } from "./browser.mjs";
import { startRoomsServer } from "../../tools/rooms-dev.mjs";
import { makeRoomCode } from "../../src/net/room.js";
import { memoryReporter } from "../../backend/rooms/reports.mjs";

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
const reports = memoryReporter();
before(async () => {
  if (!available) return;
  rooms = await startRoomsServer({ port: 0, report: reports });
  env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
  if (rooms) await rooms.close();
});

async function join(code, name, { lobby = true } = {}) {
  const ctx = await env.browser.newContext(VIEWPORTS.desktop);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") page.errors.push(m.text());
  });
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(
    `${env.base}/p/${code}?nohowto=1&rooms=${encodeURIComponent(rooms.url)}`,
  );
  await page.waitForSelector("body[data-ready='1']", { timeout: 30000 });
  if (lobby) {
    await page.waitForSelector("[data-test=lobby]");
    await page.fill("[data-test=lobby-name]", name);
    await page.press("[data-test=lobby-name]", "Enter");
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

const close = (...pages) => Promise.all(pages.map((p) => p.context().close()));

browserTest(
  "two pages start on 0.8; a watcher that carries only 0.7 does not pull the room down",
  async () => {
    const code = makeRoomCode();
    const host = await join(code, "Hanna");
    const guest = await join(code, "Ola");
    const watcher = await join(code, "Per");
    try {
      await host.click("[data-test=join-A]");
      await guest.click("[data-test=join-B]");
      await waitFor(
        host,
        () => window.__kubb.pitch.room.doc?.teams.B.length === 1,
      );
      // what a page carrying both says: the room's engine, marked, and its list
      await waitFor(
        guest,
        () =>
          window.__kubb.pitch.room.me.engine === "0.8+engines" &&
          window.__kubb.pitch.room.me.engines.join() === "0.8,0.7",
      );
      await only(watcher, ["0.7"]);
      await sawMember(host, "0.7+engines");
      assert.equal(await roomEngine(host), "0.8");
      assert.equal(await host.isHidden("[data-test=lobby-engine]"), true);
      await host.click("[data-test=lobby-start]");
      await waitFor(guest, () => window.__kubb.pitch.mode === "match");
      const [h, g] = await Promise.all([pst(host), pst(guest)]);
      assert.equal(h.matchEngine, "0.8");
      assert.deepEqual(
        [h.engine, g.engine, h.announced, g.announced],
        ["0.8.1", "0.8.1", "0.8+engines", "0.8+engines"],
      );
      assert.equal(
        await host.evaluate(() => window.__kubb.engines.loaded("0.7")),
        null,
        "nobody asked for 0.7: it never loaded",
      );
      for (const p of [host, guest, watcher]) assert.deepEqual(p.errors, []);
    } finally {
      await close(host, guest, watcher);
    }
  },
);

browserTest(
  "a player on 0.7 alone (an older tab) moves the pitch to 0.7: both play it on 0.7.4, the rider names it, and the lobby is back on 0.8 after",
  async () => {
    const code = makeRoomCode();
    const host = await join(code, "Hanna");
    const guest = await join(code, "Ola");
    try {
      await host.click("[data-test=join-A]");
      await guest.click("[data-test=join-B]");
      await waitFor(
        guest,
        () => window.__kubb.pitch.room.me.engines?.length === 2,
      );
      // an older tab under the same member id: a lone engine over a stale list
      await freeze(guest, { engine: "0.7" });
      await sawMember(host, "0.7");
      await waitFor(
        host,
        () =>
          window.__kubb.pitch.room.me.engine === "0.7+engines" &&
          window.__kubb.engines.loaded("0.7")?.version === "0.7.4",
      );
      assert.equal(await roomEngine(host), "0.7");
      await host.click("[data-test=lobby-start]");
      await waitFor(guest, () => window.__kubb.pitch.mode === "match");
      const [h, g] = await Promise.all([pst(host), pst(guest)]);
      assert.equal(h.matchEngine, "0.7");
      assert.deepEqual([h.engine, g.engine], ["0.7.4", "0.7.4"]);

      // a throw on 0.7, applied by the other page to the same hash
      const riders = [];
      for (const p of [host, guest]) {
        await p.exposeFunction("__rider", (w) => riders.push(w));
        await p.evaluate(() =>
          window.__kubb.pitch.room.on(
            "doc",
            (e) => !e.mine && e.with && window.__rider(e.with),
          ),
        );
      }
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
      assert.ok(riders.length >= 1, "the other page saw a rider");
      assert.equal(riders[0].e, "0.7.4");
      assert.equal(riders[0].c, "web");

      // a report from the 0.7 match names 0.7.4 and the 0.7 bundle
      await host.click("[data-test=menu]");
      await host.click("[data-test=report]");
      await host.waitForSelector("[data-test=report-card]");
      await host.check("[data-test=report-kind-throw]");
      await host.fill("[data-test=report-happened]", "On 0.7.");
      await host.click("[data-test=report-send]");
      await waitFor(
        host,
        () =>
          document.querySelector("[data-test=report-status]")?.textContent ===
          "Sent, thank you.",
      );
      await host.click("[data-test=report-done]");
      const sent = JSON.parse(reports.kept.at(-1).text).report;
      assert.equal(sent.engine, "0.7.4");
      assert.match(sent.build.lua, /^lua-sources-0\.7-/);

      // the match ends; REMATCH: the lobby and practice are the newest again
      await host.evaluate(() => window.__kubb.game.resign("A"));
      await waitFor(host, () => window.__kubb.game.need?.kind === "over");
      await host.evaluate(() => window.__kubb.pitch.rematch());
      await waitFor(host, () => window.__kubb.pitch.mode === "lobby");
      await waitFor(guest, () => window.__kubb.pitch.mode === "lobby");
      assert.equal((await pst(host)).engine, "0.8.1");
      assert.equal((await pst(guest)).engine, "0.8.1");
      assert.deepEqual(host.errors, []);
      assert.deepEqual(guest.errors, []);
    } finally {
      await close(host, guest);
    }
  },
);

browserTest(
  "no engine in common: the lobby says who and what to do, and START stays off",
  async () => {
    const code = makeRoomCode();
    const host = await join(code, "Hanna");
    const guest = await join(code, "Ola");
    try {
      await host.click("[data-test=join-A]");
      await guest.click("[data-test=join-B]");
      await waitFor(
        host,
        () => window.__kubb.pitch.room.doc?.teams.B.length === 1,
      );
      await only(guest, ["0.3"]);
      await sawMember(host, "0.3+engines");
      await host.waitForSelector("[data-test=lobby-engine]:not([hidden])");
      assert.equal(
        await host.textContent("[data-test=lobby-engine]"),
        "Ola has an older version of Throwing Wood (0.3) than this pitch plays (0.8), so the match cannot start. Ola: reload the page or update the app.",
      );
      assert.equal(
        await host.evaluate(
          () => document.querySelector("[data-test=lobby-start]").disabled,
        ),
        true,
      );
      // the guest, counted too, says the same of itself
      await guest.waitForSelector("[data-test=lobby-engine]:not([hidden])");
      assert.match(
        await guest.textContent("[data-test=lobby-engine]"),
        /older version of Throwing Wood \(0\.3\)/,
      );
      await host.evaluate(() => window.__kubb.pitch.start());
      assert.equal(
        await host.evaluate(() => window.__kubb.pitch.room.doc.started),
        false,
      );

      // a newer app than the rest of the pitch
      await only(guest, ["0.9"]);
      await sawMember(host, "0.9+engines");
      await waitFor(host, () =>
        /newer version of Throwing Wood \(0\.9\) than the rest of this pitch \(0\.8\)/.test(
          document.querySelector("[data-test=lobby-engine]").textContent,
        ),
      );

      // a client from before engines were named
      await freeze(guest, { engine: null, engines: null });
      await waitFor(host, () =>
        /too old to say which it is/.test(
          document.querySelector("[data-test=lobby-engine]").textContent,
        ),
      );

      // the guest goes to watch: nothing blocks, START is on
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
  "a page that arrives at a 0.7 match loads 0.7 first, holding the room's news, then watches it on 0.7.4",
  async () => {
    const code = makeRoomCode();
    const host = await join(code, "Hanna");
    const guest = await join(code, "Ola");
    try {
      await host.click("[data-test=join-A]");
      await guest.click("[data-test=join-B]");
      await waitFor(
        guest,
        () => window.__kubb.pitch.room.me.engines?.length === 2,
      );
      await freeze(guest, { engine: "0.7" });
      await waitFor(
        host,
        () => window.__kubb.pitch.room.me.engine === "0.7+engines",
      );
      await host.click("[data-test=lobby-start]");
      await waitFor(guest, () => window.__kubb.pitch.mode === "match");
      const late = await join(code, "Per", { lobby: false });
      try {
        await waitFor(late, () => window.__kubb.pitch.mode === "match");
        const st = await pst(late);
        assert.equal(st.engine, "0.7.4");
        assert.equal(st.playing, null);
        assert.equal(st.hash, st.docHash);
        const log = await late.evaluate(() =>
          window.__kubb.pitch.log.map((e) => e[1]),
        );
        assert.ok(log.includes("engine-wait"), "it waited for 0.7");
        assert.equal(
          await late.locator("[data-test=engine-differs]").count(),
          0,
        );
        assert.deepEqual(late.errors, []);
      } finally {
        await close(late);
      }
    } finally {
      await close(host, guest);
    }
  },
);

browserTest(
  "a page that cannot play the match and becomes host mid-match says so",
  async () => {
    const code = makeRoomCode();
    const host = await join(code, "Hanna");
    const other = await join(code, "Ola");
    try {
      // a match of an engine no page here carries, against the computer
      await host.evaluate(async () => {
        const { pitch, engine: e } = window.__kubb;
        e.newMatch({ seed: 6, cpu: "B" });
        await pitch.room.update(() => ({
          v: 1,
          teams: { A: [pitch.you], B: [] },
          started: true,
          n: 1,
          match: {
            n: 1,
            seq: 0,
            engine: "0.9",
            players: { A: [{ id: pitch.you, name: "Hanna" }], B: [] },
            cpu: "B",
            snap: e.snapshot(),
            hash: e.hash().hash,
          },
        }));
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
