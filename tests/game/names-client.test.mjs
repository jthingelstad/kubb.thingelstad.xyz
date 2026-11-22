// Generated names on a shared pitch, in real browsers through the local pitch server
// (tools/pitch-dev.mjs runs the real pitch core, names check and all): a page that
// sends a typed name, as an old client would, is shown to everyone as "Player n" (the
// pitch server drops it; the pages check it again); two members with one name are told
// apart in the lobby ("II"), never by changing a name; the host picks the name a side
// of several plays under, which everyone sees and the match carries; and a match whose
// snapshot holds a name the game did not make is not shown.
// Skipped with a notice when Playwright's Chromium is not installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, VIEWPORTS, played } from "./browser.mjs";
import { startPitchServer } from "../../tools/pitch-dev.mjs";
import { makePitchCode } from "../../src/net/pitch-client.js";

// The forgery Codex found: the replay fixture's last snapshot with only the saved
// game's side A name changed; its options keep the generated names.
const FIXTURE = JSON.parse(
  fs.readFileSync("tests/fixtures/replay-north-south.json", "utf8"),
);
const forge = (snapText) => {
  const s = JSON.parse(snapText);
  s.save.game.teams.A.name = "Typed Text";
  return JSON.stringify(s);
};
const FORGED = forge(FIXTURE.snap);
const NAMES_LINE =
  "This match has a name the game did not make, so it cannot be shown.";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/names-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
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

async function join(code, name) {
  const ctx = await env.browser.newContext(VIEWPORTS.desktop);
  await played(ctx);
  await ctx.addInitScript((n) => {
    localStorage.setItem("kubb:name", JSON.stringify(n));
    localStorage.setItem("kubb:howtoSeen", "true");
  }, name);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(
    `${env.base}/p/${code}?nohowto=1&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`,
  );
  await page.waitForSelector("body[data-ready='1']", { timeout: 30000 });
  await page.waitForSelector("[data-test=lobby]");
  await page.waitForFunction(
    () => window.__kubb.pitch?.state().status === "open",
  );
  return page;
}

const names = (page, side) =>
  page.$$eval(`[data-test=team-${side}] .member-name`, (els) =>
    els.map((e) => e.textContent),
  );
const close = (...pages) => Promise.all(pages.map((p) => p.context().close()));

async function until(page, fn, arg, ms = 15000) {
  await page.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
}

browserTest(
  "a page that sends a typed name, as an old client would, is Player n to everyone",
  async () => {
    const code = makePitchCode();
    const host = await join(code, "Happy Hazel");
    const old = await join(code, "Lucky Larch");
    try {
      await host.click("[data-test=join-A]");
      await old.click("[data-test=join-B]");
      await until(
        host,
        () => window.__kubb.pitch.room.doc?.teams.B.length === 1,
      );
      // the old client's own message: a typed name in `me`
      await old.evaluate(() =>
        window.__kubb.pitch.room.setMe({ name: "Anna" }),
      );
      // the pitch server dropped it: no page holds the typed text
      await until(host, () =>
        window.__kubb.pitch.room.members.every(
          (m) => m.me.name !== "Anna" && m.me.name !== "Lucky Larch",
        ),
      );
      for (const p of [host, old])
        await until(
          p,
          () =>
            [...document.querySelectorAll("[data-test=team-B] .member-name")]
              .map((e) => e.textContent)
              .join() === "Player 1",
        );
      assert.deepEqual(await names(host, "B"), ["Player 1"]);
      assert.deepEqual(await names(old, "B"), ["Player 1"], "itself too");
      assert.equal(
        rooms
          .pitch(code)
          .members.get(await old.evaluate(() => window.__kubb.pitch.you)).me
          .name,
        undefined,
      );
      for (const p of [host, old])
        assert.ok(!(await p.textContent("[data-test=lobby]")).includes("Anna"));
      // the match starts all the same, the old client playing as Player 1
      await host.click("[data-test=lobby-start]");
      await until(old, () => window.__kubb.pitch.mode === "match");
      const m = await host.evaluate(
        () => window.__kubb.pitch.room.doc.match.players,
      );
      assert.deepEqual(
        [m.A.map((p) => p.name), m.B.map((p) => p.name)],
        [["Happy Hazel"], ["Player 1"]],
      );
      const opts = await old.evaluate(
        () => JSON.parse(window.__kubb.game.engine.snapshot()).opts.teams,
      );
      assert.equal(opts.B.name, "Player 1");
      assert.deepEqual(host.errors, []);
    } finally {
      await close(host, old);
    }
  },
);

browserTest(
  "two members with one name: the lobby shows the second as II, and the name stays",
  async () => {
    const code = makePitchCode();
    const a = await join(code, "Mighty Maple");
    const b = await join(code, "Mighty Maple");
    try {
      await a.click("[data-test=join-A]");
      await b.click("[data-test=join-A]");
      await until(a, () => window.__kubb.pitch.room.doc?.teams.A.length === 2);
      await until(
        b,
        () =>
          document.querySelectorAll("[data-test=team-A] .member-name")
            .length === 2,
      );
      for (const p of [a, b])
        assert.deepEqual(await names(p, "A"), [
          "Mighty Maple",
          "Mighty Maple II",
        ]);
      // the names themselves are unchanged, on the wire and on the device
      const sent = await a.evaluate(() =>
        window.__kubb.pitch.room.members.map((m) => m.me.name),
      );
      assert.deepEqual(sent, ["Mighty Maple", "Mighty Maple"]);
      assert.equal(
        await b.evaluate(() => window.__kubb.game.playerName),
        "Mighty Maple",
      );
      assert.deepEqual([...a.errors, ...b.errors], []);
    } finally {
      await close(a, b);
    }
  },
);

browserTest(
  "a side of several plays under the team name the host picks; everyone sees it; a side of one under its player's",
  async () => {
    const code = makePitchCode();
    const host = await join(code, "Happy Hazel");
    const mate = await join(code, "Lucky Larch");
    const other = await join(code, "Kind Oak");
    try {
      await host.click("[data-test=join-A]");
      await mate.click("[data-test=join-A]");
      await other.click("[data-test=join-B]");
      // the host rolls the side's name once it has two players
      await until(host, () => !!window.__kubb.pitch.room.doc?.teamNames?.A);
      const rolled = await host.evaluate(
        () => window.__kubb.pitch.room.doc.teamNames.A,
      );
      assert.equal(
        await host.evaluate(
          (t) => window.__kubb.game.names.valid("team", t).ok,
          rolled,
        ),
        true,
        rolled,
      );
      // the host's name row; everyone else reads it
      await host.waitForSelector("[data-test=team-A-name]");
      await until(
        host,
        (t) =>
          document.querySelector("[data-test=team-A-name-text]")
            ?.textContent === t,
        rolled,
      );
      await until(
        mate,
        (t) =>
          document.querySelector("[data-test=team-A-name-text]")
            ?.textContent === t,
        rolled,
      );
      assert.equal(
        await mate.locator("[data-test=team-A-name-shuffle]").count(),
        0,
      );
      // a side of one shows no team name: it plays under its player's
      assert.equal(await other.isHidden("[data-test=team-B-name-box]"), true);
      // the host shuffles: the others see the new name
      await host.click("[data-test=team-A-name-shuffle]");
      const picked = await host.textContent("[data-test=team-A-name-text]");
      await until(
        other,
        (t) =>
          document.querySelector("[data-test=team-A-name-text]")
            ?.textContent === t,
        picked,
      );
      await until(
        host,
        (t) => window.__kubb.pitch.room.doc.teamNames?.A === t,
        picked,
      );
      // the match carries it
      await host.click("[data-test=lobby-start]");
      await until(other, () => window.__kubb.pitch.mode === "match");
      const teams = await other.evaluate(
        () => JSON.parse(window.__kubb.game.engine.snapshot()).opts.teams,
      );
      assert.equal(teams.A.name, picked);
      assert.deepEqual(
        teams.A.players.map((p) => p.name),
        ["Happy Hazel", "Lucky Larch"],
      );
      assert.equal(teams.B.name, "Kind Oak");
      for (const p of [host, mate, other]) assert.deepEqual(p.errors, []);
    } finally {
      await close(host, mate, other);
    }
  },
);

browserTest(
  "a start whose names the server cannot read but whose snapshot holds a typed one is not shown",
  async () => {
    const code = makePitchCode();
    const host = await join(code, "Happy Hazel");
    const other = await join(code, "Lucky Larch");
    try {
      // a forged start: the header and meta name generated names, the snapshot a typed one
      const r = await host.evaluate(async () => {
        const { pitch, engine: e } = window.__kubb;
        e.newMatch({
          seed: 6,
          cpu: "B",
          teams: {
            A: { name: "Riverside", players: [{ name: "Riverside" }] },
            B: { name: "Computer", players: [{ name: "Computer" }] },
          },
        });
        const players = { A: [{ id: pitch.you, name: "Happy Hazel" }], B: [] };
        return await pitch.room.start({
          doc: {
            v: 1,
            teams: { A: [pitch.you], B: [] },
            started: true,
            n: 1,
            match: { n: 1, players, cpu: "B", host: pitch.you, engine: "0.16" },
          },
          n: 1,
          h: e.hash().hash,
          snap: e.snapshot(),
          meta: { v: 1, engine: "0.16", players, cpu: "B" },
        });
      });
      assert.ok(r, "the pitch server cannot see into the snapshot");
      await other.waitForSelector("[data-test=names-refused]");
      assert.equal(
        await other.textContent("[data-test=names-refused] p:not(.kicker)"),
        "This match has a name the game did not make, so it cannot be shown.",
      );
      assert.notEqual(
        await other.evaluate(() => window.__kubb.pitch.mode),
        "match",
      );
      // and a start whose meta names one is refused by the pitch server itself
      const refused = await host.evaluate(async () => {
        const { pitch, engine: e } = window.__kubb;
        try {
          await pitch.room.start({
            doc: { v: 1, teams: { A: [], B: [] }, started: true, n: 2 },
            n: 2,
            h: e.hash().hash,
            snap: e.snapshot(),
            meta: {
              setup: {
                teams: {
                  A: { name: "Riverside", players: [{ name: "Riverside" }] },
                },
              },
            },
          });
          return null;
        } catch (err) {
          return err.code;
        }
      });
      assert.equal(refused, "bad-name");
      assert.deepEqual(other.errors, []);
    } finally {
      await close(host, other);
    }
  },
);

browserTest(
  "entering a pitch: a start whose saved game alone holds a typed name is not shown",
  async () => {
    const code = makePitchCode();
    const host = await join(code, "Happy Hazel");
    const other = await join(code, "Lucky Larch");
    try {
      // header and meta name generated names; the snapshot's options do too
      const r = await host.evaluate(async (snap) => {
        const { pitch } = window.__kubb;
        const players = { A: [{ id: pitch.you, name: "Mighty Maple" }], B: [] };
        return await pitch.room.start({
          doc: {
            v: 1,
            teams: { A: [pitch.you], B: [] },
            started: true,
            n: 1,
            match: { n: 1, players, cpu: "B", host: pitch.you, engine: "0.16" },
          },
          n: 1,
          h: "forged",
          snap,
          meta: { v: 1, engine: "0.16", players, cpu: "B" },
        });
      }, FORGED);
      assert.ok(r, "the pitch server cannot see into the snapshot");
      await other.waitForSelector("[data-test=names-refused]");
      assert.equal(
        await other.textContent("[data-test=names-refused] p:not(.kicker)"),
        NAMES_LINE,
      );
      assert.ok(
        !(await other.evaluate(() => document.body.innerText)).includes(
          "Typed Text",
        ),
      );
      assert.notEqual(
        await other.evaluate(() => window.__kubb.pitch.mode),
        "match",
      );
      assert.deepEqual(other.errors, []);
    } finally {
      await close(host, other);
    }
  },
);

browserTest(
  "a resync: a forged snapshot at the head of a match being played is not adopted",
  async () => {
    const code = makePitchCode();
    const host = await join(code, "Happy Hazel");
    const other = await join(code, "Lucky Larch");
    try {
      await host.click("[data-test=join-A]");
      await other.click("[data-test=join-B]");
      await until(
        host,
        () => window.__kubb.pitch.room.doc?.teams.B.length === 1,
      );
      await host.click("[data-test=lobby-start]");
      await until(other, () => window.__kubb.pitch.mode === "match");
      // the host commits an action whose snapshot is the forgery: the other page cannot
      // play it to that hash, asks for the whole pitch, and is handed the forgery
      await host.evaluate(async (snap) => {
        const { pitch } = window.__kubb;
        pitch.room.send?.({
          t: "act",
          id: "forged-1",
          n: pitch.local.n,
          seq: pitch.local.seq + 1,
          a: { type: "resign", side: "B" },
          h: "forged",
          snap,
        });
      }, FORGED);
      await other.evaluate(() => window.__kubb.pitch.room.resync());
      await other.waitForSelector("[data-test=names-refused]", {
        timeout: 20000,
      });
      assert.equal(
        await other.textContent("[data-test=names-refused] p:not(.kicker)"),
        NAMES_LINE,
      );
      // nothing of it was taken: the engine never held the forged snapshot
      assert.ok(
        !(
          await other.evaluate(() => window.__kubb.game.engine.snapshot())
        ).includes("Typed Text"),
      );
      assert.ok(
        !(await other.evaluate(() => document.body.innerText)).includes(
          "Typed Text",
        ),
      );
      assert.deepEqual(other.errors, []);
    } finally {
      await close(host, other);
    }
  },
);
