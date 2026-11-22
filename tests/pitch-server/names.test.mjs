// The pitch server's names check (backend/pitch-server/names.mjs, PROTOCOL.md "Names"):
// its JSON copy of the word lists is the vendored engine's own names.words, its check
// gives the engine's names.valid answer on every name and on thousands of near misses
// (as the engine's tests/node/names.test.mjs does), and the pitch drops a name that
// fails on join, `me` and waking, never refusing the member, and refuses a lobby write or
// a start that names one.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { engine } from "../net/room-engine.mjs";
import { NAMES, makeNameCheck } from "../../backend/pitch-server/names.mjs";
import { badNames } from "../../backend/pitch-server/core.mjs";
import { Harness, id, start } from "./harness.mjs";

const WORDS = JSON.parse(
  fs.readFileSync(
    new URL("../../backend/pitch-server/names-words.json", import.meta.url),
    "utf8",
  ),
);

const fnv = (text) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
};
const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v);

test("the server's words are the engine's names.words, hash and all", () => {
  const w = engine.call("names.words", {});
  assert.deepEqual(WORDS, w);
  const { hash, ...rest } = WORDS;
  assert.equal(fnv(canonical(rest)), hash);
  assert.equal(NAMES.hash, w.hash);
});

test("the port agrees with names.valid on every name and on near misses", () => {
  const valid = (kind, text) => engine.call("names.valid", { kind, text });
  const all = {};
  for (const kind of ["player", "team"]) {
    all[kind] = engine.call("names.all", { kind }).names;
    for (const s of all[kind]) assert.equal(NAMES.valid(kind, s), true, s);
  }
  const title = (s) =>
    s
      .split(" ")
      .map((x) => x.charAt(0).toUpperCase() + x.slice(1))
      .join(" ");
  const near = new Set([
    ...WORDS.never,
    ...WORDS.defaults,
    "",
    " ",
    "Anna",
    "Riverside",
    "North",
    "You",
    "Player 7",
    "Player 0",
    "computer",
    "team a",
    "Mighty",
    "Maple",
    "The",
    "The The",
    "Mighty Maple Maple",
    "Pine Pinecones",
    "Mighty Yew",
    "Wandering Yew",
    "Bamboo Batons",
    "Mighty Maple",
    "Mïghty Maple",
  ]);
  for (const kind of ["player", "team"])
    all[kind].forEach((s, i) => {
      if (i % 11) return;
      const ws = s.split(" ");
      for (const b of [
        s.toLowerCase(),
        s.toUpperCase(),
        ` ${s}`,
        `${s} `,
        s.replace(" ", "  "),
        s.replace(" ", "\t"),
        ws.slice().reverse().join(" "),
        `${s}s`,
        ws.join(""),
        `The ${s}`,
        title(s.toLowerCase()) + "x",
      ])
        near.add(b);
    });
  let refused = 0;
  for (const text of near)
    for (const kind of ["player", "team"]) {
      const v = valid(kind, text);
      assert.equal(
        NAMES.valid(kind, text),
        v.ok,
        `${kind}: ${JSON.stringify(text)}`,
      );
      assert.equal(
        NAMES.passes(kind, text),
        v.ok || v.default,
        `${kind}: ${JSON.stringify(text)}`,
      );
      if (!v.ok) refused++;
    }
  assert.ok(near.size > 2000 && refused > 3000, `${near.size} near misses`);
  // other types are never names
  for (const x of [null, 3, {}, ["Mighty Maple"]])
    assert.equal(NAMES.passes("player", x), false);
  // a check made from other words knows other names (and says so by its hash)
  const more = makeNameCheck({
    ...WORDS,
    lists: { ...WORDS.lists, woods: [...WORDS.lists.woods, "Banana"] },
    hash: "other",
  });
  assert.equal(more.valid("player", "Mighty Banana"), true);
  assert.equal(NAMES.valid("player", "Mighty Banana"), false);
});

test("a typed name on join or me is dropped, never refused: everyone shows Player n", () => {
  const h = new Harness();
  // an older client's typed name: the member joins, with no name
  const j = h.join("a", "anna", { me: { name: "Anna", level: "club" } });
  assert.equal(j.t, "joined");
  assert.deepEqual(j.members[0].me, { level: "club" });
  // a generated name is kept, and a default too
  const k = h.join("b", "bert", { me: { name: "Lucky Larch" } });
  assert.deepEqual(
    k.members.map((m) => m.me.name),
    [undefined, "Lucky Larch"],
  );
  const toA = h.take("a").at(-1);
  assert.equal(toA.member.me.name, "Lucky Larch");
  // `me` with a typed name: the name goes, the rest stays; the sender hears it too
  h.send("b", { t: "me", me: { name: "Bert the Great", engine: "0.13" } });
  const seenB = h.take("b").at(-1);
  assert.equal(seenB.t, "member");
  assert.deepEqual(seenB.member.me, { engine: "0.13" });
  assert.deepEqual(h.take("a").at(-1).member.me, { engine: "0.13" });
  h.send("b", { t: "me", me: { name: "Player 2" } });
  assert.equal(h.take("b").at(-1).member.me.name, "Player 2");
  // kept as dropped
  assert.equal(
    h.store.members.find((m) => m.id === id("anna")).me.name,
    undefined,
  );
});

test("a name kept from before the check is dropped when the pitch wakes", () => {
  const h = new Harness();
  h.join("a", "anna", { me: { name: "Mighty Maple" } });
  h.store.members[0].me = { name: "Typed Before", level: "pro" };
  h.wake();
  h.send("a", { t: "resync" });
  const st = h.take("a").at(-1);
  assert.deepEqual(st.members[0].me, { level: "pro" });
});

test("a lobby write or start naming a name the game does not make is refused", () => {
  const h = new Harness();
  h.join("a", "anna", { me: { name: "Mighty Maple" } });
  h.send("a", {
    t: "set",
    id: "w1",
    base: 0,
    doc: { teams: { A: [], B: [] }, teamNames: { A: "Riverside" } },
  });
  assert.equal(h.take("a").at(-1).code, "bad-name");
  h.send("a", {
    t: "set",
    id: "w2",
    base: 0,
    doc: { teams: { A: [], B: [] }, teamNames: { A: "Wobbly Towers" } },
  });
  assert.equal(h.take("a").at(-1).t, "ok");
  const setup = (A, B) => ({ engine: "0.13", setup: { teams: { A, B } } });
  const one = (name) => ({ name, players: [{ name }] });
  h.send("a", start(1, 1, { meta: setup(one("Anna"), one("Computer")) }));
  assert.equal(h.take("a").at(-1).code, "bad-name");
  // a side of several under a player's name, or a team's name for a player: refused
  h.send(
    "a",
    start(1, 1, {
      meta: setup(
        {
          name: "Mighty Maple",
          players: [{ name: "Mighty Maple" }, { name: "Lucky Larch" }],
        },
        one("Computer"),
      ),
    }),
  );
  assert.equal(h.take("a").at(-1).code, "bad-name");
  h.send(
    "a",
    start(1, 1, {
      doc: {
        teams: { A: [], B: [] },
        started: true,
        n: 1,
        match: { players: { A: [{ id: "x", name: "Ann" }], B: [] } },
      },
      meta: setup(one("Mighty Maple"), one("Computer")),
    }),
  );
  assert.equal(h.take("a").at(-1).code, "bad-name");
  h.send(
    "a",
    start(1, 1, {
      meta: setup(
        {
          name: "Wobbly Towers",
          players: [{ name: "Mighty Maple" }, { name: "Player 2" }],
        },
        one("Lucky Larch"),
      ),
    }),
  );
  assert.equal(h.take("a").at(-1).t, "ok");
  assert.deepEqual(badNames({ teamNames: { B: "The Lumberjacks" } }), []);
});

// Computer seats (engine 0.17, its docs/PITCH.md "Computer seats"): a seat's record in the
// document's top-level `computers` names a player, checked like one in `match.players`.
test("a computer seat's name is a player name: a typed one is refused, a generated one taken", () => {
  const h = new Harness();
  h.join("a", "anna", { me: { name: "Mighty Maple" } });
  const seated = (name) => ({
    teams: { A: ["cpu:1"], B: [] },
    computers: { "cpu:1": { level: "pro", ...(name ? { name } : {}) } },
  });
  h.send("a", { t: "set", id: "w1", base: 0, doc: seated("Robo Rick") });
  assert.equal(h.take("a").at(-1).code, "bad-name");
  // a team name in a seat is not a player name either
  h.send("a", { t: "set", id: "w2", base: 0, doc: seated("Wobbly Towers") });
  assert.equal(h.take("a").at(-1).code, "bad-name");
  h.send("a", { t: "set", id: "w3", base: 0, doc: seated("Lucky Larch") });
  assert.equal(h.take("a").at(-1).t, "ok");
  // a seat that keeps no name (shown as "Computer")
  h.send("a", { t: "set", id: "w4", base: 1, doc: seated(null) });
  assert.equal(h.take("a").at(-1).t, "ok");
  assert.deepEqual(badNames(seated("Robo Rick")), ["Robo Rick"]);
  assert.deepEqual(badNames({ computers: { "cpu:1": "x" } }), []);
  // a start whose players carry computer players: their generated names pass
  const players = {
    A: [
      { id: "anna", name: "Mighty Maple" },
      { id: "cpu:1", name: "Lucky Larch", cpu: true, level: "pro" },
    ],
    B: [{ id: "cpu:2", name: "Brisk Birch", cpu: true, level: "club" }],
  };
  assert.deepEqual(
    badNames(
      { ...seated("Lucky Larch"), match: { players } },
      {
        players,
        setup: {
          teams: {
            A: {
              name: "Wobbly Towers",
              players: [
                { name: "Mighty Maple" },
                { name: "Lucky Larch", cpu: true },
              ],
            },
            B: {
              name: "Brisk Birch",
              players: [{ name: "Brisk Birch", cpu: true }],
            },
          },
        },
      },
    ),
    [],
  );
});
