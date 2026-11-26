// A kept match of engine 1.4 with the throw to go, watched again in a real browser
// (docs/ENGINES.md, the engine's docs/SESSION.md "The throw to go"): a person against
// the computer, its baton to go thrown first, made here through this checkout's engine
// and kept in the local api's store as a finished pitch's replay. WATCH THE LAST MATCH
// plays it: the two batons to go together with the verdict's words on the flag, then
// the match, NEXT THROW through to its end, nothing broken on the way.
// Skipped with a notice when Playwright's Chromium is not installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, played } from "./browser.mjs";
import { startPitchServer } from "../../tools/pitch-dev.mjs";
import { Engine } from "../../src/engine/index.js";
import { replayOf, useRoomEngine } from "../../src/net/lobby.js";
import { bundleLua } from "../../tools/lua-bundle.mjs";
import { SETUP } from "../../tools/replay-fixture.mjs";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/togo-replay.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

const CODE = "ttttgggg";

// The match: Team A a person whose throws are the computer's (from a computer-only
// match), Team B the computer; A's baton to go is one of those throws too.
async function togoMatch() {
  const sources = bundleLua();
  const cpu = await Engine.create({ sources });
  cpu.newMatch({ ...SETUP, seed: 3, cpu: "both", maxTurns: 12 });
  const throws = [];
  for (let f = 0; cpu.need().kind !== "over" && f < 2e6; f++) {
    const proj = cpu.need().setup?.projectile;
    const o = cpu.frame({ dt: 1 / 60 });
    if (o.action) throws.push({ proj, a: o.action });
  }
  const e = await Engine.create({ sources });
  useRoomEngine(e);
  const setup = { ...SETUP, seed: 3, cpu: "B", togo: true, maxTurns: 6 };
  e.newMatch(setup);
  const h0 = e.hash().hash;
  const log = [];
  let k = 0;
  const push = (a) => {
    const r = e.apply(a);
    assert.notEqual(r.ok, false, JSON.stringify(r));
    log.push({ a, h: e.hash().hash });
  };
  for (let g = 0; g < 5000 && e.need().kind !== "over"; g++) {
    const n = e.need();
    if (n.kind === "togo") {
      const t = throws.find((x) => x.proj === "baton").a;
      k++;
      push({
        type: "togo",
        side: "A",
        round: n.round,
        how: "baton",
        launch: t.launch,
        stance: t.stance,
        target: t.target,
      });
    } else if (n.side === "B") {
      const o = e.frame({ dt: 1 / 60 });
      if (o.action) log.push({ a: o.action, h: e.hash().hash });
    } else if (n.kind === "raise") push({ type: "raise", choice: n.default });
    else if (n.kind === "punish")
      push({ type: "punish", x: n.cursor.x, y: n.cursor.y });
    else {
      let j = k;
      while (throws[j % throws.length].proj !== n.setup.projectile) j++;
      k = j + 1;
      push({ ...structuredClone(throws[j % throws.length].a), seq: n.throws });
    }
  }
  assert.equal(e.need().kind, "over", "the match ended");
  assert.ok(log.some((l) => l.a.type === "togo"));
  return replayOf({
    over: true,
    n: 1,
    seq: log.length,
    setup,
    h0,
    log,
    snap: e.snapshot(),
    hash: e.hash().hash,
    players: { A: [], B: [] },
    cpu: "B",
    engine: e.version.split(".").slice(0, 2).join("."),
  });
}

let env, rooms;
before(async () => {
  if (!available) return;
  const replay = await togoMatch();
  rooms = await startPitchServer();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const { snap, hash, n, ...rest } = replay;
  await rooms.api.store.putFinal(CODE, { made: 1, n, snap, exp });
  await rooms.api.store.putKept(CODE, {
    made: 1,
    n,
    v: 9,
    data: JSON.stringify({ ...rest, hash, n }),
    hash,
    exp,
  });
  env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
  if (rooms) await rooms.close();
});

browserTest(
  "a kept 1.4 match with the throw to go plays again: the verdict, then the match to its end",
  async () => {
    const ctx = await env.browser.newContext({
      viewport: { width: 1200, height: 760 },
    });
    await played(ctx);
    const page = await ctx.newPage();
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") page.errors.push(m.text());
    });
    try {
      await page.goto(
        `${env.base}/p/${CODE}?nohowto=1&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`,
      );
      await page.waitForSelector("body[data-ready='1']", { timeout: 30000 });
      await page.waitForSelector("[data-test=lobby-replay]:not([hidden])", {
        timeout: 30000,
      });
      await page.click("[data-test=lobby-replay]");
      await page.waitForSelector("[data-test=replay-bar]");
      // the batons to go play back together, and the flag says who goes first
      await page.waitForFunction(
        () =>
          /GOES FIRST|THROW AGAIN/.test(
            document.querySelector("[data-test=flag]")?.textContent || "",
          ),
        null,
        { timeout: 30000, polling: 50 },
      );
      // then NEXT THROW to the end
      for (let i = 0; i < 200; i++) {
        const done = await page.evaluate(() => {
          const p = window.__kubb.pitch.replay;
          if (!p || p.ended) return true;
          p.next();
          return false;
        });
        if (done) break;
        await page.waitForTimeout(30);
      }
      assert.equal(
        await page.evaluate(() => window.__kubb.pitch.replay?.ended ?? null),
        true,
        "played to its end",
      );
      assert.deepEqual(page.errors, []);
    } finally {
      await ctx.close();
    }
  },
);
