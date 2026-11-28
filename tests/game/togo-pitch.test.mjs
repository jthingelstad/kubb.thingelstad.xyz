// Engine 1.4 on a shared pitch in real browsers (docs/MULTIPLAYER.md): the host writes
// the throw to go on, the lobby shows its row, the Throw row and each person's throw;
// both browsers throw their own baton blind, the first waits for the other with
// nothing of its baton shown, both play the combined recording and read the same
// verdict, and the match goes on in step. Each player sees it from their own end.
// Then a pitch with an iPhone on 1.0 in it (announced by a socket client): no Throw to
// go row, no Throw row, no throw words.
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
    "# tests/game/togo-pitch.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

let env, rooms;
before(async () => {
  if (!available) return;
  rooms = await startPitchServer();
  env = await serve({ build: true, togo: true });
});
after(async () => {
  if (env) await env.close();
  if (rooms) await rooms.close();
});

async function join(code, name, kind = "desktop", prefs = {}) {
  const ctx = await env.browser.newContext(VIEWPORTS[kind]);
  await played(ctx);
  await ctx.addInitScript((prefs) => {
    for (const [k, v] of Object.entries(prefs))
      localStorage.setItem(`kubb:${k}`, JSON.stringify(v));
  }, prefs);
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
  await page.waitForSelector("[data-test=lobby]");
  await page.evaluate((n) => window.__kubb.game.setPlayerName(n), name);
  await page.waitForFunction(
    () => window.__kubb.pitch?.state().status === "open",
    null,
    { timeout: 10000 },
  );
  return page;
}

const pst = (page) => page.evaluate(() => window.__kubb.pitch.state());

async function waitFor(page, fn, arg, ms = 20000) {
  await page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
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

// This browser's baton to go: its card, then aiming.
async function myTogo(page, ms = 20000) {
  await page.waitForSelector("[data-test=togo]", { timeout: ms });
  await page.click("[data-test=togo-go]");
  await waitFor(
    page,
    () =>
      window.__kubb.game.phase === "aim" &&
      window.__kubb.game.need?.kind === "togo" &&
      !window.__kubb.game.modal,
  );
}

const status = (page) => page.textContent("[data-test=status]");

browserTest(
  "a pitch on 1.4: throw to go on, both batons blind, one verdict, then the match in step",
  async () => {
    const code = makePitchCode();
    const host = await join(code, "Happy Hazel", "desktop", { throw: "easy" });
    const guest = await join(code, "Gentle Ginkgo", "portrait");
    try {
      await host.click("[data-test=join-A]");
      await guest.click("[data-test=join-B]");
      // the host wrote the throw to go on; both read it
      for (const p of [host, guest])
        await waitFor(
          p,
          () =>
            document
              .querySelector(
                ".lobby-options [data-key=togo] [aria-checked=true]",
              )
              ?.getAttribute("data-value") === "on" ||
            /Throw to go\s*On/.test(
              document.querySelector(".lobby-options")?.textContent || "",
            ),
        );
      // the Throw row, and each person's throw beside their name
      assert.equal(
        await host.locator("[data-test=lobby-opt-throw]").isVisible(),
        true,
      );
      await waitFor(guest, () => {
        const w = [...document.querySelectorAll("[data-test=member-throw]")]
          .map((e) => e.textContent)
          .join("|");
        return w.includes("Easy throw") && w.includes("Standard throw");
      });
      const words = await guest.$$eval("[data-test=member-throw]", (els) =>
        els.map((e) => e.textContent.trim()),
      );
      assert.ok(
        words.some((w) => /Standard throw/.test(w)),
        `words: ${words}`,
      );

      await host.click("[data-test=lobby-start]");
      await waitFor(guest, () => window.__kubb.pitch.state().mode === "match");
      const [h0] = await inStep([host, guest]);
      assert.equal(h0.playing, "A");
      const opts = await host.evaluate(
        () => JSON.parse(window.__kubb.game.engine.snapshot()).opts,
      );
      assert.ok(opts.togo, "the match has the throw to go");
      assert.equal(opts.teams.A.players[0].throw, "easy", "me.throw carried");

      // each browser is offered only its own baton
      await myTogo(host);
      await myTogo(guest);
      // (the seat takes the need's togo control on the pitch's next seat refresh, about
      // a tenth of a second after the card: read too soon it was not there yet)
      for (const p of [host, guest])
        await waitFor(p, () => !!window.__kubb.game.seat.togo, null, 5000);
      const hc = await host.evaluate(() => window.__kubb.game.seat.togo);
      const gc = await guest.evaluate(() => window.__kubb.game.seat.togo);
      assert.deepEqual([hc, gc], [["A"], ["B"]], "the togo control");
      assert.equal(await status(host), "YOUR THROW TO GO");

      // the host throws first: it waits for Team B, with nothing of its baton shown
      await throwOnce(host);
      await waitFor(host, () => window.__kubb.game.phase === "wait");
      await waitFor(host, () =>
        /^WAITING FOR /.test(
          document.querySelector("[data-test=status]")?.textContent || "",
        ),
      );
      const batons = await host.evaluate(
        () =>
          (window.__kubb.game.items || []).filter((i) => i.kind === "baton")
            .length,
      );
      assert.equal(batons, 0, "nothing of the baton already in");
      // the guest is still aiming, its own baton, nothing of the host's drawn
      assert.equal(
        await guest.evaluate(() => window.__kubb.game.phase),
        "aim",
        "the host's release did not take the guest's aim",
      );
      await throwOnce(guest);

      // both play the combined recording and read the same verdict
      const flags = [];
      for (const p of [host, guest]) {
        await waitFor(
          p,
          () =>
            /GOES FIRST|THROW AGAIN/.test(
              document.querySelector("[data-test=flag]")?.textContent || "",
            ),
          null,
          30000,
        );
        flags.push(await p.textContent("[data-test=flag]"));
      }
      assert.equal(flags[0], flags[1], "one verdict");
      await inStep([host, guest]);
      assert.deepEqual(host.errors, []);
      assert.deepEqual(guest.errors, []);
    } finally {
      await host.context().close();
      await guest.context().close();
    }
  },
);

browserTest(
  "both batons to go released at once: the one the pitch refused is thrown again, not lost",
  async () => {
    const code = makePitchCode();
    const host = await join(code, "Happy Hazel");
    const guest = await join(code, "Gentle Ginkgo", "portrait");
    try {
      await host.click("[data-test=join-A]");
      await guest.click("[data-test=join-B]");
      await waitFor(host, () =>
        /Throw to go\s*On/.test(
          document.querySelector(".lobby-options")?.textContent || "",
        ),
      );
      await host.click("[data-test=lobby-start]");
      await waitFor(guest, () => window.__kubb.pitch.state().mode === "match");
      await inStep([host, guest]);
      await myTogo(host);
      await myTogo(guest);
      // the host's commit is held back (as if still on the wire) while the guest's
      // reaches the pitch first: both are for the same seq
      await host.evaluate(() => {
        const room = window.__kubb.pitch.room;
        const act = room.act.bind(room);
        window.__held = [];
        window.__release = () => {
          room.act = act;
          for (const m of window.__held) act(m);
        };
        room.act = (m) => window.__held.push(m);
      });
      await throwOnce(host);
      await waitFor(host, () => window.__held.length === 1);
      const seq = await host.evaluate(() => window.__held[0].seq);
      await throwOnce(guest);
      await waitFor(guest, () => window.__kubb.pitch.state().docSeq >= 1);
      assert.equal(
        rooms.pitch(code).match.seq,
        seq,
        "the guest's took the seq",
      );
      // now the host's arrives late: refused, the pitch taken, the baton again
      await host.evaluate(() => window.__release());
      const flags = [];
      for (const p of [host, guest]) {
        await waitFor(
          p,
          () =>
            /GOES FIRST|THROW AGAIN/.test(
              document.querySelector("[data-test=flag]")?.textContent || "",
            ),
          null,
          30000,
        );
        flags.push(await p.textContent("[data-test=flag]"));
      }
      assert.equal(flags[0], flags[1], "one verdict");
      const [h] = await inStep([host, guest]);
      assert.equal(h.docSeq, seq + 1, "both batons are in the match");
      assert.deepEqual(host.errors, []);
      assert.deepEqual(guest.errors, []);
    } finally {
      await host.context().close();
      await guest.context().close();
    }
  },
);

browserTest(
  "the host stands in for a player who left: that baton is aimed from the thrower's end",
  async () => {
    const code = makePitchCode();
    const host = await join(code, "Happy Hazel");
    const guest = await join(code, "Gentle Ginkgo", "portrait");
    try {
      await host.click("[data-test=join-A]");
      await guest.click("[data-test=join-B]");
      await waitFor(host, () =>
        /Throw to go\s*On/.test(
          document.querySelector(".lobby-options")?.textContent || "",
        ),
      );
      await host.click("[data-test=lobby-start]");
      await waitFor(guest, () => window.__kubb.pitch.state().mode === "match");
      await inStep([host, guest]);
      await myTogo(host);
      // the host's own baton: seen from its own end, Team A's (once the pitch's seat
      // refresh has told the engine the side, a moment after the card)
      await waitFor(
        host,
        () => window.__kubb.game.engine.view().need.frame === "A",
        null,
        5000,
      );
      await throwOnce(host);
      await waitFor(host, () => window.__kubb.game.phase === "wait");
      // the guest goes before throwing: the host throws Team B's baton for it
      await guest.context().close();
      await myTogo(host, 45000); // once the pitch has the guest gone
      const seen = await host.evaluate(() => {
        const g = window.__kubb.game;
        const v = g.engine.view();
        return { side: g.need.side, frame: v.need.frame, local: g.localSide };
      });
      assert.deepEqual(
        seen,
        { side: "B", frame: "B", local: "A" },
        "aimed in the thrower's frame, where setTarget takes it",
      );
      await throwOnce(host);
      await waitFor(
        host,
        () =>
          /GOES FIRST|THROW AGAIN/.test(
            document.querySelector("[data-test=flag]")?.textContent || "",
          ),
        null,
        30000,
      );
      // and after it, whoever goes first: Team A first, or a tie (both batons to go
      // again), is the host's own and back at its own end; Team B first is the host
      // standing in for Team B's first throw, seen from the thrower's end again
      const flag = await host.textContent("[data-test=flag]");
      const bFirst = /GENTLE GINKGO GOES FIRST/.test(flag);
      await waitFor(
        host,
        (b) => {
          const g = window.__kubb.game;
          const n = g.engine.view().need;
          return (
            g.phase === "aim" &&
            n.frame === (b ? "B" : "A") &&
            (n.side ?? "A") === (b ? "B" : "A")
          );
        },
        bFirst,
        30000,
      );
      assert.equal(
        await host.evaluate(() => window.__kubb.game.localSide),
        "A",
        "the host's own side all along",
      );
      assert.deepEqual(host.errors, []);
    } finally {
      await host.context().close();
      await guest
        .context()
        .close()
        .catch(() => {});
    }
  },
);

// This page announces only `carries` from here on (an iPhone build that carries less).
const only = (page, carries) =>
  page.evaluate((c) => {
    const p = window.__kubb.pitch;
    p.carries = c;
    p.roomKey = null;
    p.renderLobby();
  }, carries);

browserTest(
  "a pitch with a player on 1.0: it plays 1.0, no Throw to go, no Throw row, no throw words",
  async () => {
    const code = makePitchCode();
    const host = await join(code, "Happy Hazel", "desktop", { throw: "easy" });
    const guest = await join(code, "Gentle Ginkgo", "portrait");
    try {
      await only(guest, ["1.0"]);
      await host.click("[data-test=join-A]");
      await guest.click("[data-test=join-B]");
      // the guest's presence says it carries 1.0 alone
      await waitFor(host, () =>
        window.__kubb.pitch.room.members.some(
          (m) =>
            m.id !== window.__kubb.pitch.you && m.me.engines?.join() === "1.0",
        ),
      );
      await waitFor(host, () => {
        const p = window.__kubb.pitch;
        p.roomKey = null;
        return p.roomEngine().engine === "1.0";
      });
      await host.evaluate(() => window.__kubb.pitch.renderLobby());
      await host.waitForSelector("[data-test=lobby-opt-raising]");
      // each page draws the lobby for the room's engine once it knows it is 1.0
      for (const p of [host, guest])
        await waitFor(
          p,
          () =>
            !document.querySelector(".lobby-options [data-key=togo]") &&
            !/Throw to go/.test(
              document.querySelector(".lobby-options")?.textContent || "",
            ) &&
            !document.querySelector("[data-test=member-throw]"),
        );
      assert.equal(
        await host.locator("[data-test=lobby-opt-throw]").isVisible(),
        false,
        "no Throw row",
      );

      await host.click("[data-test=lobby-start]");
      await waitFor(guest, () => window.__kubb.pitch.state().mode === "match");
      const [h] = await inStep([host, guest]);
      assert.equal(h.matchEngine, "1.0");
      const n = await host.evaluate(() => window.__kubb.game.need);
      assert.equal(n.kind, "throw", "the match opens on a throw, not togo");
      await host.waitForSelector("[data-test=handoff]", { timeout: 15000 });
      assert.equal(await host.locator("[data-test=togo]").count(), 0);
      const opts = await host.evaluate(
        () => JSON.parse(window.__kubb.game.engine.snapshot()).opts,
      );
      assert.ok(!opts.togo, "no throw to go in a 1.0 match");
      assert.equal(opts.teams.A.players[0].throw, undefined, "no me.throw");
      assert.deepEqual(host.errors, []);
      assert.deepEqual(guest.errors, []);
    } finally {
      await host.context().close();
      await guest.context().close();
    }
  },
);
