// Computer players in teams on a shared pitch (engine 0.17; docs/MULTIPLAYER.md
// "Computer players", docs/SYSTEM.md "Computer seats"), in real browsers against the
// local pitch server (tools/pitch-dev.mjs) and the preview, one browser context a
// person. The owner's two examples, played until every seat has thrown, a person has
// raised and (three people against three computers) the computers' team has raised;
// then the host leaves and comes back. And the lobby: a seat added, re-levelled, moved
// and removed; six a team; START refused with no person; Kid with seats; the pitch
// server's refusal of a seat name the game did not make.
//
// KUBB_SEAT_SHOTS=<dir> also saves the screenshots the design review asked for.
// Skipped with a notice when Playwright's Chromium is not installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import {
  assertLocalPath,
  serve,
  sweep,
  swingInPage,
  VIEWPORTS,
  played,
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
    "# tests/game/computer-seats-client.test.mjs SKIPPED: no Playwright Chromium",
  );
// a match played through takes minutes on a loaded machine; never forever
const browserTest = (name, fn) =>
  (available ? test : test.skip)(name, { timeout: 1500000 }, fn);

let env, rooms;
before(async () => {
  if (!available) return;
  // the host passes on a second after it goes (15 s live)
  rooms = await startPitchServer({
    options: { limits: { hostGraceMs: 1000 } },
  });
  // three or four people's pages each draw and throw: none behind the others may stop
  // drawing frames (Chromium backgrounds a page it thinks hidden)
  env = await serve({
    build: true,
    args: [
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
    ],
  });
});
after(async () => {
  if (env) await env.close();
  if (rooms) await rooms.close();
});

const SHOTS = process.env.KUBB_SEAT_SHOTS;
async function shot(page, name, opts = {}) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, ...opts });
}

const SIZES = {
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  portrait: VIEWPORTS.portrait,
};

// A person: their own context (their own member id) on the pitch's lobby.
async function join(code, name, kind = "desktop", ctx = null) {
  ctx ??= await env.browser.newContext(SIZES[kind] ?? VIEWPORTS[kind]);
  await played(ctx);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  const url = `${env.base}/p/${code}?nohowto=1&pitchserver=${encodeURIComponent(rooms.url)}&api=${encodeURIComponent(rooms.apiUrl)}`;
  // never a pitch server or api off this machine (AGENTS.md "Build and check")
  assertLocalPath(url.slice(env.base.length));
  await page.goto(url);
  await page.waitForSelector("body[data-ready='1']", { timeout: 30000 });
  await page.waitForFunction(
    () => window.__kubb.pitch?.state().status === "open",
    null,
    { timeout: 20000 },
  );
  if (name && (await page.locator("[data-test=lobby]").isVisible()))
    await page.evaluate((n) => window.__kubb.game.setPlayerName(n), name);
  page.ctx = ctx;
  page.touch = kind === "portrait";
  return page;
}

const pst = (page) => page.evaluate(() => window.__kubb.pitch.state());

async function waitFor(page, fn, arg, ms = 30000) {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
  } catch (err) {
    const st = await page
      .evaluate(() => JSON.stringify(window.__kubb.pitch?.state()))
      .catch(() => "?");
    throw new Error(`waiting for ${String(fn).slice(0, 200)}\n${st}`, {
      cause: err,
    });
  }
}

// The document as this browser holds it.
const docOf = (page) => page.evaluate(() => window.__kubb.pitch.room.doc);
const seatsOf = async (page, side) => {
  const d = await docOf(page);
  return (d?.teams?.[side] ?? []).filter((id) => /^cpu:/.test(id));
};

// The host adds a computer to `side` and sets its level; returns its seat id.
async function addSeat(host, side, level = "club") {
  const before = new Set(await seatsOf(host, side));
  await host.click(`[data-test=add-computer-${side}]`);
  let id = null;
  for (let i = 0; i < 100 && !id; i++) {
    id = (await seatsOf(host, side)).find((s) => !before.has(s)) ?? null;
    if (!id) await host.waitForTimeout(100);
  }
  assert.ok(id, `a seat on ${side}`);
  await host.waitForSelector(`[data-seat="${id}"]`);
  if (level !== "club") await setLevel(host, id, level);
  return id;
}

async function setLevel(host, id, level) {
  await host.click(`[data-seat="${id}"] .seg-btn[data-value=${level}]`);
  await waitFor(
    host,
    ([s, l]) => window.__kubb.pitch.room.doc?.computers?.[s]?.level === l,
    [id, level],
  );
}

async function throwOnce(page) {
  const p = await page.evaluate(() => window.__kubb.game.out.aim.plan);
  assert.ok(p, "an aim plan");
  // one pointer event a frame from inside the page, as a browser delivers a drag: the
  // flick's speed holds on a loaded machine (a kubb's slow flick makes no throw)
  await swingInPage(
    page,
    sweep({
      back: (p.powerLo + p.powerHi) / 2,
      stop: p.release,
      backDps: 900,
      flickDps: 3600,
    }),
    { type: page.touch ? "touch" : "mouse" },
  );
}

const trace = (line) => {
  if (process.env.KUBB_SEAT_LOG)
    fs.appendFileSync(process.env.KUBB_SEAT_LOG, `${line}\n`);
};

// One look at a page in a match: close its own cards, raise by hand where it may (AUTO,
// the person's own raise action), place a punishment kubb, and say what it sees: the
// thrower the engine names, whether this page may throw now, the engine's own raises.
async function look(page) {
  return page.evaluate(() => {
    const g = window.__kubb.game;
    const out = {
      phase: g.phase,
      mode: window.__kubb.pitch.mode,
      thrower: null,
      mine: false,
      raised: false,
      settled: [],
      over: g.need?.kind === "over",
      rail: document.querySelector("[data-test=rail-what]")?.textContent ?? "",
      pill: window.__kubb.pitch.state().who?.text ?? "",
      handoffCpu:
        document.querySelector("[data-test=handoff-cpu]")?.textContent ?? "",
    };
    const n = g.need;
    if (n?.kind === "throw" && n.setup?.thrower)
      out.thrower = {
        key: n.setup.thrower.key,
        cpu: !!n.setup.thrower.cpu,
        level: n.setup.thrower.level,
        side: n.side,
      };
    for (const e of n?.setup?.settled?.list ?? [])
      out.settled.push({ kind: e.kind, side: e.side });
    const go = document.querySelector(
      "[data-test=handoff-go], [data-test=settle-go], [data-test=pass] .btn",
    );
    if (go && g.mayAct()) go.click();
    if (g.phase === "raise" && g.mayAct()) {
      const auto = document.querySelector("[data-test=raise-auto]");
      if (auto) {
        auto.click();
        out.raised = true;
      }
    }
    if (g.phase === "punish" && g.mayAct()) g.punish();
    out.mine =
      g.phase === "aim" && n?.kind === "throw" && g.mayAct() && !g.modal;
    return out;
  });
}

// Play on every page until `done(seen)` holds; seen: { threw: Set of seat and member
// keys that threw, raisedBy: Set of member ids, settledBy: Set of sides the engine
// raised for, cpuShown: [{ rail, pill, handoffCpu }] }.
async function playUntil(pages, done, { ms = 600000, seen = null } = {}) {
  seen ??= {
    threw: new Set(),
    raisedBy: new Set(),
    settledBy: new Set(),
    cpuShown: [],
    noControlsForCpu: true,
  };
  const deadline = Date.now() + ms;
  const last = new Map();
  while (Date.now() < deadline) {
    for (const p of pages) {
      if (p.isClosed()) continue;
      const o = await look(p);
      if (o.over) return seen;
      if (o.raised) seen.raisedBy.add(p.memberId);
      for (const e of o.settled)
        if (e.kind === "raise") seen.settledBy.add(e.side);
      if (o.thrower) {
        // a thrower stays the thrower until the throw lands: counted once its need is
        // gone (another thrower, or another baton)
        const prev = last.get(p);
        if (prev && prev !== JSON.stringify(o.thrower))
          seen.threw.add(JSON.parse(prev).key);
        last.set(p, JSON.stringify(o.thrower));
        // the pictures: the hand-off naming a computer partner, its throw on the rail
        if (o.handoffCpu && !seen.shotHandoff) {
          seen.shotHandoff = true;
          await shot(p, "handoff-computer-partner");
        }
        if (o.thrower.cpu && o.phase === "aim" && !seen.shotRail) {
          seen.shotRail = true;
          await shot(p, "rail-computer-partner-throw");
        }
        if (o.thrower.cpu) {
          seen.cpuShown.push({
            rail: o.rail,
            pill: o.pill,
            handoffCpu: o.handoffCpu,
          });
          if (o.mine) seen.noControlsForCpu = false;
        }
      }
      if (o.mine && !o.thrower?.cpu) {
        trace(`throw ${pages.indexOf(p)} ${JSON.stringify(o.thrower)}`);
        await throwOnce(p);
        trace(`thrown ${pages.indexOf(p)}`);
      }
    }
    if (done(seen)) return seen;
    if (process.env.KUBB_SEAT_LOG && Date.now() - (seen.logged ?? 0) > 20000) {
      seen.logged = Date.now();
      fs.appendFileSync(
        process.env.KUBB_SEAT_LOG,
        `# seen ${JSON.stringify({
          threw: [...seen.threw],
          raisedBy: [...seen.raisedBy],
          settledBy: [...seen.settledBy],
          cpu: seen.cpuShown.length,
        })}\n`,
      );
    }
    await pages[0].waitForTimeout(150);
  }
  throw new Error(
    `played for ${ms} ms: ${JSON.stringify({
      threw: [...seen.threw],
      raisedBy: [...seen.raisedBy],
      settledBy: [...seen.settledBy],
    })}`,
  );
}

// Every action committed and every open page on the pitch's hash.
async function inStep(pages, ms = 60000) {
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
    await pages[0].waitForTimeout(200);
  }
  throw new Error(`not in step: ${JSON.stringify(last)}`);
}

async function memberOf(page) {
  page.memberId = await page.evaluate(() => window.__kubb.pitch.you);
  return page.memberId;
}

// The host leaves mid-throw of a computer (its browser held the throw), the next
// person's browser becomes host and resumes it, and the old host comes back in step.
async function hostLeavesAndReturns(host, others, code) {
  // play on to a computer's throw (while it thinks, before the host's browser has sent
  // it): the host's browser is the one that throws it
  const pages = [host, ...others];
  const deadline = Date.now() + 600000;
  const cpuNow = () =>
    host.evaluate(() => {
      const g = window.__kubb.game;
      return g.need?.kind === "throw" && !!g.need?.cpu;
    });
  let said = 0;
  wait: for (;;) {
    assert.ok(Date.now() < deadline, "a computer's throw came");
    for (const p of pages) {
      if (await cpuNow()) break wait;
      const o = await look(p);
      assert.ok(!o.over, "the match ended before a computer threw");
      if (o.mine && !o.thrower?.cpu) await throwOnce(p);
      if (Date.now() - said > 20000) {
        said = Date.now();
        trace(
          `leave-wait ${pages.indexOf(p)} ${JSON.stringify({ ...o, settled: undefined })}`,
        );
      }
    }
    await host.waitForTimeout(50);
  }
  const ctx = host.ctx;
  const before = (await pst(others[0])).docSeq;
  await host.close();
  // the next host's browser takes over the computer and throws for it
  await waitFor(
    others[0],
    (was) => {
      const s = window.__kubb.pitch.state();
      return s.host === s.you && s.control?.cpu && (s.docSeq ?? 0) > was;
    },
    before,
    120000,
  );
  // the old host comes back in its own context (its own member id) and is in step
  const back = await join(code, "", "desktop", ctx);
  await memberOf(back);
  await inStep([back, ...others], 120000);
  return back;
}

browserTest(
  "2 v 2: two people, each with a pro partner, play; the host leaves and returns",
  async () => {
    const code = makePitchCode();
    const host = await join(code, "Mighty Maple");
    const guest = await join(code, "Lucky Larch");
    await memberOf(host);
    await memberOf(guest);
    await host.click("[data-test=join-A]");
    await guest.click("[data-test=join-B]");
    await waitFor(host, () =>
      document
        .querySelector("[data-test=team-B]")
        ?.textContent.includes("Lucky Larch"),
    );
    const a = await addSeat(host, "A", "pro");
    const b = await addSeat(host, "B", "pro");
    // the computer opens Team B's order: its turn's hand-off names it
    await host.click(`[data-seat="${b}"] [data-test=seat-up]`);
    await waitFor(
      host,
      (s) => window.__kubb.pitch.room.doc.teams.B[0] === s,
      b,
    );
    // the guest reads the seats: "Bold Birch · computer · Pro", one group each
    await waitFor(
      guest,
      (s) => !!document.querySelector(`[data-seat="${s}"]`),
      b,
    );
    const row = await guest.locator(`[data-seat="${b}"]`);
    assert.match(await row.textContent(), / · computer · Pro$/);
    assert.match(
      await row.getAttribute("aria-label"),
      /^[A-Z][a-z]+ [A-Z][a-z]+, computer, Pro, 1 of 2 in Team B$/,
    );
    assert.equal(
      await guest.locator("[data-test=add-computer-A]").isVisible(),
      false,
    );
    assert.equal(await guest.locator(`[data-seat="${b}"] .seg`).count(), 0);
    // raising by hand (the default), so a person raises
    assert.equal((await docOf(host)).options?.raising ?? "hand", "hand");
    await host.evaluate(() =>
      document
        .querySelector("[data-test=lobby]")
        ?.scrollIntoView({ block: "start" }),
    );
    await host.evaluate(() => {
      const t = document.querySelector(".teams");
      t?.scrollIntoView({ block: "start" });
    });
    await shot(host, "lobby-host-1280x800");
    await shot(guest, "lobby-guest-read-only");
    await host.click("[data-test=lobby-start]");
    await waitFor(host, () => window.__kubb.pitch.mode === "match");
    await waitFor(guest, () => window.__kubb.pitch.mode === "match");
    const header = (await docOf(host)).match.players;
    // a seat's name is no member's
    const people = new Set([header.A[0].name, header.B[1].name]);
    for (const p of [header.A[1], header.B[0]])
      assert.ok(!people.has(p.name), p.name);
    assert.equal(header.A[1].cpu, true);
    assert.equal(header.B[0].level, "pro");

    const seen = await playUntil(
      [host, guest],
      (s) =>
        [host.memberId, guest.memberId, a, b].every((k) => s.threw.has(k)) &&
        s.raisedBy.size > 0,
    );
    assert.ok(seen.noControlsForCpu, "no person was given a computer's throw");
    const shown = seen.cpuShown.find((x) => x.rail && x.pill);
    assert.ok(shown, "a computer's throw was shown");
    assert.match(shown.rail, /· computer · pro$/i);
    assert.match(shown.pill, / THROWS · COMPUTER · PRO$/);
    assert.ok(
      seen.cpuShown.some((x) =>
        / throws first · computer · Pro$/.test(x.handoffCpu),
      ),
      "the hand-off names the computer who opens the turn",
    );
    await inStep([host, guest]);
    const back = await hostLeavesAndReturns(host, [guest], code);
    // play on a little after: the new host's browser throws for both computers
    await playUntil([guest, back], (s) => s.threw.size >= 2, { ms: 300000 });
    await inStep([guest, back], 120000);
    // the winner card and the score sheet name the computer players by their names
    await guest.evaluate(() => window.__kubb.game.resign("B"));
    for (const p of [guest, back])
      await waitFor(
        p,
        () => !!document.querySelector("[data-test=winner]"),
        null,
        60000,
      );
    await shot(back, "winner-mixed");
    const names = (await docOf(back)).match?.players ?? header;
    await back.evaluate(() =>
      document
        .querySelector(
          "[data-test=winner-sheet], [data-test=winner] [data-test*=sheet]",
        )
        ?.click(),
    );
    await back
      .waitForSelector("[data-test=sheet-text]", { timeout: 10000 })
      .catch(() => {});
    await shot(back, "score-sheet-mixed");
    const text = JSON.stringify(
      await back.evaluate(() => window.__kubb.game.engine.sheet()),
    );
    for (const p of [...header.A, ...header.B])
      assert.ok(text.includes(p.name), p.name);
    assert.ok(names);
    for (const p of [guest, back]) assert.deepEqual(p.errors, []);
    await guest.ctx.close();
    await back.ctx.close();
  },
);

browserTest(
  "three people against two club and one pro; the computers raise for themselves",
  async () => {
    const code = makePitchCode();
    const host = await join(code, "Cheerful Cedar");
    const two = await join(code, "Brave Birch");
    const three = await join(code, "Jolly Juniper");
    // a fourth on a phone, upright, who only watches: the guest's lobby there
    const phone = await join(code, "Plucky Plum", "portrait");
    for (const p of [host, two, three]) {
      await memberOf(p);
      await p.click("[data-test=join-A]");
    }
    await waitFor(
      host,
      () => window.__kubb.pitch.room.doc?.teams?.A?.length === 3,
    );
    const seats = [
      await addSeat(host, "B", "club"),
      await addSeat(host, "B", "club"),
      await addSeat(host, "B", "pro"),
    ];
    await waitFor(
      phone,
      (id) => !!document.querySelector(`[data-seat="${id}"]`),
      seats[2],
    );
    await phone.evaluate(() =>
      document.querySelector(".teams")?.scrollIntoView({ block: "start" }),
    );
    await shot(phone, "lobby-guest-390x844");
    assert.match(
      await phone.textContent(`[data-seat="${seats[2]}"]`),
      / · computer · Pro$/,
    );
    // the open listing counts seats
    await host.click("[data-test=lobby-access] .seg-btn[data-value=open]");
    await waitFor(host, () => window.__kubb.pitch.room.doc?.open === true);
    await host.click("[data-test=lobby-start]");
    for (const p of [host, two, three])
      await waitFor(p, () => window.__kubb.pitch.mode === "match");
    const seen = await playUntil(
      [host, two, three],
      (s) =>
        [host, two, three].every((p) => s.threw.has(p.memberId)) &&
        seats.every((k) => s.threw.has(k)) &&
        s.raisedBy.size > 0 &&
        s.settledBy.has("B"),
    );
    assert.ok(seen.noControlsForCpu);
    await inStep([host, two, three]);
    const back = await hostLeavesAndReturns(host, [two, three], code);
    await inStep([back, two, three], 120000);
    for (const p of [two, three, back]) assert.deepEqual(p.errors, []);
    for (const p of [two, three, back, phone]) await p.ctx.close();
  },
);

browserTest(
  "the lobby: a seat added, re-levelled, moved across and removed; six a team; START with no person; Kid",
  async () => {
    const code = makePitchCode();
    const host = await join(code, "Mighty Maple", "portrait");
    const guest = await join(code, "Lucky Larch");
    await memberOf(host);
    // START with no person: the host watches, computers on both sides
    const s1 = await addSeat(host, "A", "club");
    const s2 = await addSeat(host, "B", "pro");
    await host.click("[data-test=lobby-start]");
    await waitFor(
      host,
      () => !document.querySelector("[data-test=lobby-note]").hidden,
    );
    const note = await host.textContent("[data-test=lobby-note]");
    assert.ok(note.length > 10, note);
    assert.equal(await pst(host).then((s) => s.mode), "lobby");
    await shot(host, "start-refused-no-person");

    // re-levelled: said once, the guest reads it
    await setLevel(host, s1, "beginner");
    await waitFor(host, () =>
      /now plays at Beginner\./.test(
        document.querySelector("[data-test=lobby-said]").textContent,
      ),
    );
    await waitFor(
      guest,
      (s) =>
        document
          .querySelector(`[data-seat="${s}"]`)
          ?.textContent.endsWith("· computer · Beginner"),
      s1,
    );
    // the keyboard: the level bar keeps its focus through the redraw
    await host.focus(`[data-seat="${s1}"] .seg-btn[aria-checked=true]`);
    await host.keyboard.press("ArrowRight");
    await waitFor(
      host,
      (s) => window.__kubb.pitch.room.doc.computers[s].level === "club",
      s1,
    );
    await waitFor(
      host,
      (s) =>
        document.activeElement?.closest(`[data-seat="${s}"]`) &&
        document.activeElement.getAttribute("aria-checked") === "true",
      s1,
    );
    await shot(host, "level-changed-390x844");
    // moved across, then removed
    await host.click(`[data-seat="${s1}"] [data-test=seat-across]`);
    await waitFor(
      host,
      (s) => window.__kubb.pitch.room.doc.teams.B.includes(s),
      s1,
    );
    await host.click(`[data-seat="${s1}"] [data-test=seat-remove]`);
    await waitFor(
      host,
      (s) => !window.__kubb.pitch.room.doc.computers?.[s],
      s1,
    );
    await waitFor(
      guest,
      (s) => !document.querySelector(`[data-seat="${s}"]`),
      s1,
    );

    // six a team: the host and five computers fill A
    await host.click("[data-test=join-A]");
    for (let i = 0; i < 5; i++) await addSeat(host, "A");
    await waitFor(
      host,
      () => document.querySelector("[data-test=add-computer-A]").disabled,
    );
    await waitFor(
      guest,
      () =>
        document.querySelector("[data-test=join-A]").disabled &&
        /TEAM A IS FULL/i.test(
          document.querySelector("[data-test=join-A]").textContent,
        ),
    );
    assert.equal(
      await host
        .locator(`[data-seat="${s2}"] [data-test=seat-across]`)
        .isDisabled(),
      true,
    );
    // the lobby fits a phone upright with two full teams: it scrolls, nothing is cut
    await host.click(`[data-seat="${s2}"] [data-test=seat-remove]`);
    await waitFor(
      host,
      (s) => !window.__kubb.pitch.room.doc.computers?.[s],
      s2,
    );
    for (let i = 0; i < 6; i++) await addSeat(host, "B");
    await shot(host, "lobby-host-390x844-two-full-teams", { fullPage: false });
    const fit = await host.evaluate(() => {
      const card = document.querySelector("[data-test=lobby]");
      const over = [
        ...card.querySelectorAll("button, .seg, .member-name"),
      ].filter(
        (el) =>
          el.offsetParent &&
          el.getBoundingClientRect().right >
            card.getBoundingClientRect().right + 1,
      ).length;
      const small = [...card.querySelectorAll(".seat button")].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height < 44 || r.width < 44;
      }).length;
      return {
        over,
        small,
        wide: document.documentElement.scrollWidth <= innerWidth,
      };
    });
    assert.deepEqual(fit, { over: 0, small: 0, wide: true });

    // Kid: every seat reads Kid, keeping its own level for when Kid goes off
    await host.click("[data-key=computer-kid] .seg-btn[data-value=on]");
    await waitFor(host, () =>
      [...document.querySelectorAll("[data-seat]")].every(
        (r) => r.dataset.level === "kid",
      ),
    );
    await waitFor(guest, () =>
      [...document.querySelectorAll("[data-seat]")].every((r) =>
        r.textContent.endsWith("· computer · Kid"),
      ),
    );
    await host.evaluate(() =>
      document
        .querySelector("[data-test=lobby-opt-computer]")
        ?.scrollIntoView({ block: "center" }),
    );
    await shot(host, "kid-pitch-computer-row-390x844");
    await host.evaluate(() =>
      document
        .querySelector("[data-test=team-B-kid]")
        ?.scrollIntoView({ block: "center" }),
    );
    await shot(host, "kid-pitch-with-seats-390x844");
    await host.click("[data-key=computer-kid] .seg-btn[data-value=off]");
    await waitFor(host, () =>
      [...document.querySelectorAll("[data-seat]")].every(
        (r) => r.dataset.level === "club",
      ),
    );
    await host.click("[data-key=computer-kid] .seg-btn[data-value=on]");
    await waitFor(
      host,
      () => window.__kubb.pitch.room.doc.settings?.computer === "kid",
    );
    await host.click("[data-test=lobby-start]");
    await waitFor(host, () => window.__kubb.pitch.mode === "match");
    assert.equal(await host.evaluate(() => window.__kubb.game.need?.kid), true);
    assert.deepEqual(host.errors, []);
    await host.ctx.close();
    await guest.ctx.close();
  },
);

browserTest(
  "the pitch server refuses a seat name the game did not make",
  async () => {
    const code = makePitchCode();
    const host = await join(code, "Mighty Maple");
    const s = await addSeat(host, "A", "club");
    const why = await host.evaluate(async (id) => {
      try {
        await window.__kubb.pitch.room.update((d) => ({
          ...d,
          computers: {
            ...d.computers,
            [id]: { level: "club", name: "Robo Rick" },
          },
        }));
        return "taken";
      } catch (err) {
        return err.code;
      }
    }, s);
    assert.equal(why, "bad-name");
    // the seat's name is still the one the game made
    const name = (await docOf(host)).computers[s].name;
    assert.notEqual(name, "Robo Rick");
    assert.match(
      await host.textContent(`[data-seat="${s}"]`),
      new RegExp(name),
    );
    await host.ctx.close();
  },
);
