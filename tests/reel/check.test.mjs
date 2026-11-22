// The renderer's check of a shared match against the computer (backend/reels/check.mjs,
// docs/ROOMS.md section 13) on a real match: a short club game played the way the
// iPhone's solo game plays it (tools/reel/solo.mjs), then changed one way at a time.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Engine } from "../../src/engine/index.js";
import { useRoomEngine } from "../../src/net/lobby.js";
import { bundleLua } from "../../tools/lua-bundle.mjs";
import { playSolo, soloSetup } from "../../tools/reel/solo.mjs";
import { checkShare, nameAllowed } from "../../backend/reels/check.mjs";
import { checkHandler } from "../../backend/reels/handler.mjs";
import engineInfo from "../../vendor/engine.json" with { type: "json" };

const sources = bundleLua();
const ENGINE = engineInfo.tag.replace(/^v/, "");
const played = await playSolo(soloSetup(2), sources);

const share = (over = {}) => ({
  engine: ENGINE,
  start: played.start,
  log: played.log,
  end: { winner: played.end.winner, throws: played.end.throws },
  ...over,
});
const check = (g) =>
  checkShare({
    g,
    sources,
    engine: ENGINE,
    engines: [ENGINE.split(".").slice(0, 2).join(".")],
  });
const copy = (log) => JSON.parse(JSON.stringify(log));

// The start and log under other names, as the device's share card makes them.
async function renamed(names) {
  const e = await Engine.create({ sources });
  useRoomEngine(e);
  try {
    const r = e.call("renameStart", {
      start: played.start,
      names,
      log: played.log,
    });
    return { start: r.start, log: r.log };
  } finally {
    e.lua.global.close();
  }
}

test("check: names a share may carry: a generated player name or a default", async () => {
  const e = await Engine.create({ sources });
  try {
    for (const ok of ["Mighty Maple", "Lucky Larch", "Player 1", "Computer"])
      assert.equal(nameAllowed(e, ok), true, ok);
    for (const bad of [
      "",
      "Ann",
      "Riverside",
      "You",
      "mighty maple",
      " Mighty Maple",
      "Mighty  Maple",
      "Wobbly Towers", // a team's name, not a player's
      "Mighty Yew", // a word taken out for safety
      "Ünïcödé 🪵",
      7,
      null,
    ])
      assert.equal(nameAllowed(e, bad), false, String(bad));
  } finally {
    e.lua.global.close();
  }
});

test("check: a fair match replays, and the room gets the engine's document and replay", async () => {
  const out = await check(share());
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.actions, played.log.length);
  assert.equal(out.throws, played.end.throws);
  const doc = JSON.parse(out.document);
  const replay = JSON.parse(out.replay);
  assert.equal(doc.match.over, true);
  assert.equal(doc.match.cpu, "B");
  // the engine's own seat id, never a member id from the device
  assert.equal(doc.match.host, "A1");
  assert.deepEqual(doc.teams, { A: ["A1"], B: [] });
  assert.equal(replay.log.length, played.log.length);
  assert.equal(replay.snap, doc.match.snap);
  // ASCII JSON, as the room keeps text
  assert.match(out.document, /^[\x20-\x7e]*$/);
});

test("check: a renamed side under a generated name replays", async () => {
  const r = await renamed({ A: "Lucky Larch" });
  const out = await check(share(r));
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(
    JSON.parse(out.document).match.setup.teams.A.name,
    "Lucky Larch",
  );
});

test("check: a typed name, You, or a team's name is refused: Pick a name", async () => {
  for (const name of ["Ann", "You", "a".repeat(17), "Wobbly Towers"]) {
    const out = await check(share(await renamed({ A: name })));
    // the engine's names.check finds it first; sidesOf's own check stands behind it
    assert.deepEqual(
      out,
      { ok: false, why: "name", step: "names-check" },
      name,
    );
  }
});

// the forgery Codex found: the start's options keep the generated name, its saved game
// carries typed text, which is what a restored match shows
test("check: a start whose saved game names another side than its options is refused: name", async () => {
  const s = JSON.parse(played.start);
  assert.equal(s.opts.teams.A.name, "Mighty Maple");
  s.save.game.teams.A.name = "Typed Text";
  const out = await check(share({ start: JSON.stringify(s) }));
  assert.deepEqual(out, { ok: false, why: "name", step: "names-check" });
});

test("check: the computer's side under another name is refused", async () => {
  // a typed name there is a name the game did not make
  let out = await check(share(await renamed({ B: "Robot" })));
  assert.deepEqual(out, { ok: false, why: "name", step: "names-check" });
  // a generated name there is not the computer: the sides check refuses it
  out = await check(share(await renamed({ B: "Lucky Larch" })));
  assert.deepEqual(out, { ok: false, why: "does-not-replay", step: "sides" });
});

test("check: a forged computer throw is found", async () => {
  const log = copy(played.log);
  const i = log.findIndex((x) => x.a.type === "throw" && x.a.scripted);
  assert.ok(i >= 0, "the match has a computer throw");
  log[i].a.launch.speed += 0.4;
  const out = await check(share({ log }));
  assert.deepEqual(out, {
    ok: false,
    why: "does-not-replay",
    step: "computer",
  });
});

test("check: a person's throw the dial cannot make is out of bounds", async () => {
  const log = copy(played.log);
  const i = log.findIndex((x) => x.a.type === "throw" && !x.a.scripted);
  log[i].a.launch.speed = 60;
  const out = await check(share({ log }));
  assert.deepEqual(out, { ok: false, why: "does-not-replay", step: "bounds" });
});

test("check: a wrong claimed winner or throw count is refused", async () => {
  const other = played.end.winner === "A" ? "B" : "A";
  for (const end of [
    { winner: other, throws: played.end.throws },
    { winner: played.end.winner, throws: played.end.throws - 1 },
  ]) {
    const out = await check(share({ end }));
    assert.deepEqual(out, { ok: false, why: "does-not-replay", step: "end" });
  }
});

test("check: an action out of turn, or a match not over, does not replay", async () => {
  const log = copy(played.log);
  log.splice(1, 0, { a: { type: "raise" } });
  assert.deepEqual(await check(share({ log })), {
    ok: false,
    why: "does-not-replay",
    step: "refused",
  });
  assert.deepEqual(await check(share({ log: played.log.slice(0, -1) })), {
    ok: false,
    why: "does-not-replay",
    step: "not-over",
  });
});

test("check: another engine, a broken start or a log the engine cannot read", async () => {
  assert.deepEqual(await check(share({ engine: "0.6.3" })), {
    ok: false,
    why: "engine",
    step: "engine",
  });
  assert.equal(
    (
      await checkShare({
        g: share(),
        sources,
        engine: ENGINE,
        engines: ["0.10"],
      })
    ).why,
    "engine",
  );
  const start = JSON.parse(played.start);
  start.opts.seed += 1;
  assert.equal(
    (await check(share({ start: JSON.stringify(start) }))).step,
    "start",
  );
  const out = await check(
    share({ log: [{ a: { type: "throw", launch: "x" } }] }),
  );
  assert.equal(out.ok, false);
  assert.equal(out.why, "does-not-replay");
});

test("check: the handler logs the step and engine, never a name", async () => {
  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    const r = await renamed({ A: "Jolly Juniper" });
    const out = await checkHandler(
      { check: share(r) },
      {
        sources,
        engine: ENGINE,
        engines: [ENGINE.split(".").slice(0, 2).join(".")],
      },
    );
    assert.equal(out.ok, true);
  } finally {
    console.log = log;
  }
  assert.ok(lines.length >= 1);
  assert.ok(!lines.join("\n").includes("Jolly Juniper"));
  assert.match(lines.join("\n"), /"check":"ok"|"check":true/);
});
