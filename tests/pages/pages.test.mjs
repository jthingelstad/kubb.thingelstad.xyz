// The pitch pages function (backend/pages): a pitch's share preview and the state
// an embed starts from, per state, with the fallback; and its share image.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import {
  ORIGIN,
  SITE_NAME,
  cardOf,
  embedState,
  injectPreview,
  pitchState,
  previewOf,
  readPitch,
} from "../../backend/pages/pitch.mjs";
import { gzipSync } from "node:zlib";
import { renderer } from "../../backend/pages/render.mjs";
import { createPages, siteBase } from "../../backend/pages/server.mjs";
import * as site from "../../src/site/site.mjs";
import { gamePage } from "../../src/site/layout.mjs";

const fixture = (name) => fs.readFile(`tests/fixtures/${name}`, "utf8");
// The snapshot fixtures were captured with the sides named North and South, typed
// names as the game had then; a pitch's match now carries generated names (the
// engine's docs/NAMES.md), so the sides are renamed here, in memory, and the typed
// names kept for the test that they are left off.
const typedInPlay = await fixture("snap-in-play.json");
const renamed = (text) => {
  const s = JSON.parse(text);
  s.save.game.teams.A.name = "Mighty Maple";
  s.save.game.teams.B.name = "Lucky Larch";
  return JSON.stringify(s);
};
const inPlay = renamed(typedInPlay);
const over = renamed(await fixture("snap-over.json"));
const replay = await fixture("replay-north-south.json");
const overGame = JSON.parse(over).save.game;
// the kept replay's own last snapshot (tools/replay-fixture.mjs writes it)
const keptGame = JSON.parse(JSON.parse(replay).snap).save.game;

// A pitch's records as the api function keeps them (backend/api/dynamo-store.mjs), as
// readPitch hands them on: the state (its latest match) and the kept replay.
const M = 1_763_700_000_000; // when the pitch object was made
const r = JSON.parse(replay);
const RECORDS = {
  playing: {
    state: {
      v: 7,
      made: M,
      n: 1,
      seq: 4,
      over: false,
      snap: inPlay,
      hash: "h4",
    },
  },
  // over, its replay not kept (yet): no replay to promise
  over: {
    state: { v: 42, made: M, n: 1, seq: 9, over: true, snap: over, hash: "h9" },
  },
  // the state gone, the kept replay still there
  kept: {
    kept: { v: M + 1000, made: M, n: r.n, snap: r.snap, hash: r.hash },
  },
  none: {},
};
// "waiting" comes from no record (the pitch server pushes no lobby), but an embed may
// be handed one, and its words and image are kept
const STATES = {
  waiting: { state: "waiting", v: 0 },
  ...Object.fromEntries(
    Object.entries(RECORDS).map(([k, x]) => [k, pitchState(x)]),
  ),
};

const base = gamePage({
  path: "/pitch/",
  title: `A pitch · ${site.SITE_TITLE}`,
  description:
    "A pitch of Kubb: Throwing Wood. Open the link to join the match.",
  config: { mode: "pitch" },
  script: "/assets/main.js",
  noindex: true,
});

const meta = (html, key) =>
  html.match(
    new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)">`),
  )?.[1];

test("the function's site constants are the site's", () => {
  assert.equal(ORIGIN, site.ORIGIN);
  assert.equal(SITE_NAME, site.SITE_NAME);
});

test("each state's words", () => {
  const winner = overGame.teams[overGame.winner].name;
  const turns = overGame.turn;
  const keptWinner = keptGame.teams[keptGame.winner].name;
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(STATES).map(([k, st]) => {
        const p = previewOf(st);
        return [k, p && [p.title, p.description]];
      }),
    ),
    {
      waiting: [
        "A pitch waiting for players · Kubb: Throwing Wood",
        "Waiting for players. Join the pitch.",
      ],
      playing: [
        "Mighty Maple vs Lucky Larch · Kubb: Throwing Wood",
        "In play: turn 2",
      ],
      over: [
        "Mighty Maple vs Lucky Larch · Kubb: Throwing Wood",
        `Final: ${winner} won, 1 to 0, in ${turns} turns.`,
      ],
      kept: [
        "Mighty Maple vs Lucky Larch · Kubb: Throwing Wood",
        `Final: ${keptWinner} won, 1 to 0, in ${keptGame.turn} turns. Watch the replay.`,
      ],
      none: null,
    },
  );
  assert.equal(STATES.playing.v, 7);
  assert.equal(STATES.kept.v, M + 1000);
  // beside a finished state, the kept replay counts only when it is this match
  const kept = RECORDS.kept.kept;
  const finished = (n, made = M) => ({
    v: 9,
    made,
    n,
    seq: 372,
    over: true,
    snap: r.snap,
    hash: r.hash,
  });
  const own = pitchState({ state: finished(r.n), kept });
  assert.equal(own.replay, true);
  assert.match(previewOf(own).description, /Watch the replay\.$/);
  assert.deepEqual(embedState(own, "abcd2345").match, { n: r.n, hash: r.hash });
  const rematch = pitchState({ state: finished(r.n + 1), kept });
  assert.equal(rematch.replay, false);
  assert.doesNotMatch(previewOf(rematch).description, /replay/);
  // the code wiped and used again: another pitch object, not this replay
  assert.equal(pitchState({ state: finished(r.n, M + 1), kept }).replay, false);
  assert.equal(pitchState({ state: finished(r.n), kept: null }).replay, false);
  // a rematch in play shows the rematch, not the last match
  assert.equal(
    pitchState({ state: { ...RECORDS.playing.state, n: 2 }, kept }).state,
    "playing",
  );
  // a snapshot that cannot be read is no state; the kept replay is then shown
  assert.equal(
    pitchState({ state: { v: 1, snap: "{not json" } }).state,
    "none",
  );
  assert.equal(
    pitchState({ state: { v: 1, snap: "{not json" }, kept }).state,
    "over",
  );
  // the names from the match's start where the snapshot has none
  const nameless = JSON.parse(inPlay);
  delete nameless.save.game.teams.A.name;
  delete nameless.save.game.teams.B.name;
  const named = pitchState({
    state: {
      ...RECORDS.playing.state,
      snap: JSON.stringify(nameless),
      names: { A: "Wobbly Towers", B: "Birch Batons" },
    },
  });
  assert.deepEqual(named.teams, { A: "Wobbly Towers", B: "Birch Batons" });
});

test("a match against the computer says so, and at what level", () => {
  const vsComputer = (cpu, level) =>
    pitchState({
      state: { ...RECORDS.over.state, cpu, level },
      kept: { v: M + 5, made: M, n: 1, snap: over, hash: "h9", cpu, level },
    });
  const w = overGame.winner;
  const l = w === "A" ? "B" : "A";
  const name = { A: overGame.teams.A.name, B: overGame.teams.B.name };
  // the person won
  const person = vsComputer(l, "club");
  assert.deepEqual(person.computer, { side: l, level: "club" });
  assert.equal(
    previewOf(person).description,
    `Final: ${name[w]} won, against the computer (club), in ${overGame.turn} turns. Watch the replay.`,
  );
  // the computer won
  assert.equal(
    previewOf(vsComputer(w, "pro")).description,
    `Final: ${name[w]} (pro) won, against ${name[l]}, in ${overGame.turn} turns. Watch the replay.`,
  );
  // a level it does not know is left out; no computer, the usual form
  assert.match(
    previewOf(vsComputer(l, "grand")).description,
    /against the computer, in/,
  );
  assert.equal(STATES.over.computer, null);
  // the kept replay alone says it too
  assert.deepEqual(
    pitchState({
      kept: { v: M + 5, made: M, n: 1, snap: over, cpu: l, level: "pro" },
    }).computer,
    { side: l, level: "pro" },
  );
});

test("the preview goes into the page's head; the fallback leaves it as built", () => {
  const code = "abcd2345";
  for (const [k, s] of Object.entries(STATES)) {
    const html = injectPreview(base, { code, s, path: `/p/${code}` });
    if (k === "none") {
      assert.equal(html, base);
      continue;
    }
    const p = previewOf(s);
    assert.equal(html.match(/<title>([^<]*)<\/title>/)[1], p.title);
    assert.equal(meta(html, "og:title"), p.title);
    assert.equal(meta(html, "description"), p.description);
    assert.equal(meta(html, "og:description"), p.description);
    assert.equal(meta(html, "og:url"), `${ORIGIN}/p/${code}`);
    assert.equal(meta(html, "twitter:card"), "summary_large_image");
    const image = `${ORIGIN}/og/${code}.png${s.v ? `?v=${s.v}` : ""}`;
    assert.equal(meta(html, "og:image"), image);
    assert.equal(meta(html, "twitter:image"), image);
    assert.equal(meta(html, "og:image:width"), "1200");
    assert.ok(!html.includes('id="kubb-pitch"'), "no state block on /p/");
  }
});

// The engine's docs/NAMES.md section 6: the pitch card leaves off a name the game did
// not make. A typed name (as the captured fixture has), markup or a $ sequence never
// reaches the page, the image or the embed's state block: the side is "Team A".
test("a team name the game did not make is left off: Team A / Team B", () => {
  const typed = pitchState({
    state: { ...RECORDS.playing.state, snap: typedInPlay },
  });
  assert.deepEqual(typed.teams, { A: "Team A", B: "Team B" });
  assert.equal(
    previewOf(typed).title,
    "Team A vs Team B · Kubb: Throwing Wood",
  );
  for (const bad of ['</script><b x="1">&', "$& $1 $` $'", "Anna", "North"]) {
    const snap = JSON.parse(inPlay);
    snap.save.game.teams.A.name = bad;
    const s = pitchState({
      state: { ...RECORDS.playing.state, snap: JSON.stringify(snap) },
    });
    const html = injectPreview(base, {
      code: "abcd2345",
      s,
      path: "/e/abcd2345",
      embed: true,
    });
    assert.ok(!html.includes(bad), bad);
    assert.equal(html.match(/<title>/g).length, 1);
    assert.equal(
      meta(html, "og:title"),
      "Team A vs Lucky Larch · Kubb: Throwing Wood",
    );
    const block = html.match(
      /<script type="application\/json" id="kubb-pitch">(.*?)<\/script>/s,
    )[1];
    const state = JSON.parse(block);
    assert.equal(state.state, "playing");
    assert.equal(state.teams.A, "Team A");
    assert.equal(state.turn, 2);
  }
  // a side of one may carry its player's name; a side of several needs a team's
  const snap = JSON.parse(inPlay);
  const players = snap.save.game.teams.A.players?.length ?? 1;
  snap.save.game.teams.A.name = "Wobbly Towers";
  assert.equal(
    pitchState({
      state: { ...RECORDS.playing.state, snap: JSON.stringify(snap) },
    }).teams.A,
    "Wobbly Towers",
  );
  assert.ok(players >= 1);
});

test("the server: each state's page, and the built page on any failure", async () => {
  const calls = [];
  const handle = createPages({
    load: async (code) => {
      calls.push(code);
      if (code === "bbbbbbbb") throw new Error("down");
      return (
        RECORDS[{ pppppppp: "playing", vvvvvvvv: "over" }[code]] ?? RECORDS.none
      );
    },
    base: async (file) =>
      file === "/embed/index.html"
        ? base.replace("<title>", "<title>embed ")
        : base,
    render: async () => Buffer.from("png"),
    site: ORIGIN,
  });
  const get = async (url, method = "GET") => {
    const out = { status: 0, headers: {}, body: "" };
    await handle(
      { url, method },
      {
        writeHead(status, headers) {
          out.status = status;
          out.headers = headers;
        },
        end(body) {
          out.body = body == null ? "" : body;
        },
      },
    );
    return out;
  };
  const playing = await get("/pitch/index.html?pitch=pppppppp");
  assert.equal(playing.status, 200);
  assert.equal(
    meta(playing.body, "og:title"),
    "Mighty Maple vs Lucky Larch · Kubb: Throwing Wood",
  );
  assert.match(playing.headers["cache-control"], /s-maxage=60/);
  const done = await get("/pitch/index.html?pitch=vvvvvvvv");
  assert.match(done.headers["cache-control"], /s-maxage=300/);
  const embed = await get("/embed/index.html?pitch=vvvvvvvv");
  assert.match(embed.body, /id="kubb-pitch"/);
  assert.equal(meta(embed.body, "og:url"), `${ORIGIN}/e/vvvvvvvv`);
  for (const url of [
    "/pitch/index.html?pitch=uuuuuuuu",
    "/pitch/index.html?pitch=bbbbbbbb",
    "/pitch/index.html?pitch=NOT-A-CODE",
    "/pitch/index.html",
  ]) {
    const r = await get(url);
    assert.equal(r.status, 200, url);
    assert.equal(r.body, base, url);
  }
  assert.ok(!calls.includes("NOT-A-CODE"), "a bad code is never read");
  // the image: a PNG per state, the site's own image otherwise
  const png = await get("/share/kubb.png?pitch=vvvvvvvv");
  assert.equal(png.headers["content-type"], "image/png");
  assert.match(png.headers["cache-control"], /s-maxage=86400/);
  assert.match(
    (await get("/share/kubb.png?pitch=pppppppp")).headers["cache-control"],
    /s-maxage=300/,
  );
  for (const code of ["uuuuuuuu", "bbbbbbbb", "NOT-A-CODE"]) {
    const r = await get(`/share/kubb.png?pitch=${code}`);
    assert.equal(r.status, 302, code);
    assert.equal(r.headers.location, `${ORIGIN}/share/kubb.png`);
  }
  assert.equal(
    (await get("/pitch/index.html?pitch=pppppppp", "HEAD")).body,
    "",
  );
  assert.equal((await get("/elsewhere")).status, 404);
  assert.equal((await get("/pitch/index.html", "POST")).status, 405);
  // no page to be had: 502, and CloudFront serves the static one
  const away = createPages({
    load: async () => RECORDS.playing,
    base: async () => {
      throw new Error("no site");
    },
    render: async () => Buffer.alloc(0),
    site: ORIGIN,
  });
  const res = { writeHead: (s) => (res.status = s), end() {} };
  await away({ url: "/pitch/index.html?pitch=pppppppp", method: "GET" }, res);
  assert.equal(res.status, 502);
});

test("the built page is fetched once a minute at most", async () => {
  let t = 0;
  let fetched = 0;
  const get = siteBase({
    site: ORIGIN,
    now: () => t,
    fetchImpl: async (url) => {
      fetched++;
      assert.equal(url, `${ORIGIN}/pitch/index.html`);
      return { ok: true, text: async () => "<html>" };
    },
  });
  await get("/pitch/index.html");
  t = 59_000;
  await get("/pitch/index.html");
  assert.equal(fetched, 1);
  t = 61_000;
  await get("/pitch/index.html");
  assert.equal(fetched, 2);
});

test("the share image renders per state at 1200 x 630", async () => {
  const require = createRequire(import.meta.url);
  const render = renderer({
    wasm: await fs.readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")),
    font: await fs.readFile("backend/pages/LondrinaSolid-Black.ttf"),
  });
  const sizes = {};
  for (const k of ["waiting", "playing", "over", "kept"]) {
    const png = await render(cardOf(STATES[k]));
    assert.deepEqual(
      [...png.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
      k,
    );
    assert.equal(png.readUInt32BE(16), 1200, k);
    assert.equal(png.readUInt32BE(20), 630, k);
    assert.ok(
      png.length > 10_000 && png.length < 400_000,
      `${k}: ${png.length}`,
    );
    sizes[k] = png.length;
  }
  // the pieces differ: a set-out pitch is not the end of a match
  assert.notEqual(sizes.waiting, sizes.over);
  assert.equal(cardOf(STATES.none), null);
  // a fallen king when the match ended on him
  const pieces = cardOf(STATES.over).pieces;
  const king = pieces.find((p) => p.kind === "king");
  assert.equal(king.standing, !/^king/.test(overGame.how));
});

test("readPitch: a match in play costs one read; a finished one reads its replay, then its reel", async () => {
  const code = "abcd2345";
  const pk = `pitch#${code}`;
  const items = {
    state: {
      rev: 3,
      made: M,
      n: 1,
      seq: 4,
      over: false,
      z: gzipSync(inPlay),
      hash: "h4",
      exp: 2e9,
    },
  };
  const asked = [];
  const item = async (pk, sk, fields) => {
    asked.push([pk, sk, fields.join(",")]);
    return items[sk] ?? null;
  };
  const playing = pitchState(await readPitch(item, code));
  assert.equal(playing.state, "playing");
  assert.equal(playing.v, 3);
  assert.deepEqual(asked, [
    [pk, "state", "rev,made,n,seq,over,z,hash,names,cpu,level,exp"],
  ]);
  // over, with its own kept replay and the computer's side and level
  asked.length = 0;
  items.state = {
    ...items.state,
    rev: 9,
    n: r.n,
    seq: r.log.length,
    over: true,
    z: gzipSync(r.snap),
    hash: r.hash,
    cpu: "B",
    level: "club",
  };
  items.replay = {
    v: M + 1000,
    made: M,
    n: r.n,
    s: gzipSync(r.snap),
    hash: r.hash,
    exp: 2e9,
  };
  const s = pitchState(await readPitch(item, code));
  assert.deepEqual(asked, [
    [pk, "state", "rev,made,n,seq,over,z,hash,names,cpu,level,exp"],
    [pk, "replay", "v,made,n,s,hash,cpu,level,exp"],
    [pk, "reel", "v,state,wide,exp"],
  ]);
  assert.equal(s.state, "over");
  assert.equal(s.replay, true);
  assert.deepEqual(s.computer, { side: "B", level: "club" });
  assert.match(previewOf(s).description, /Watch the replay\.$/);
  // half a replay (the final snapshot, not yet the kept log, or the other way) is none
  for (const half of [
    { made: M, n: r.n, s: gzipSync(r.snap), exp: 2e9 },
    { v: M + 1000, made: M, n: r.n, exp: 2e9 },
  ]) {
    items.replay = half;
    const h = pitchState(await readPitch(item, code));
    assert.equal(h.state, "over");
    assert.equal(h.replay, false);
  }
  // the state gone: the kept replay alone
  delete items.state;
  items.replay = {
    v: M + 1000,
    made: M,
    n: r.n,
    s: gzipSync(r.snap),
    exp: 2e9,
  };
  const gone = pitchState(await readPitch(item, code));
  assert.equal(gone.state, "over");
  assert.equal(gone.replay, true);
  // nothing at all
  delete items.replay;
  assert.equal(pitchState(await readPitch(item, code)).state, "none");
});

test("a finished reel: one more GetItem, og:video tags on the pitch page, the image kept", async () => {
  const code = "abcd2345";
  const wide = `/reels/${code}/7-r1-0.7/wide.mp4`;
  const items = {
    replay: { v: 7, made: M, n: 1, s: gzipSync(r.snap), exp: 2e9 },
    reel: { v: 7, state: "done", wide, exp: 2e9 },
  };
  const item = async (pk, sk) =>
    pk === `pitch#${code}` ? (items[sk] ?? null) : null;
  const s = pitchState(await readPitch(item, code));
  assert.deepEqual(s.reel, { wide });
  assert.match(
    previewOf(s).description,
    /Watch the replay\. Watch the highlights\.$/,
  );
  const base = `<html><head><title>x</title>
<meta name="description" content="x">
<meta property="og:title" content="x">
<meta property="og:description" content="x">
<meta property="og:image" content="x">
<meta property="og:image:alt" content="x">
<meta name="twitter:image" content="x">
</head><body></body></html>`;
  const html = injectPreview(base, { code, s, path: `/p/${code}` });
  const video = `https://throwingwood.com${wide}`;
  for (const [k, v] of [
    ["og:video", video],
    ["og:video:secure_url", video],
    ["og:video:type", "video/mp4"],
    ["og:video:width", "1920"],
    ["og:video:height", "1080"],
  ])
    assert.ok(
      html.includes(`<meta property="${k}" content="${v}">`),
      `${k} is set`,
    );
  assert.match(
    html,
    /<meta property="og:image" content="https:\/\/throwingwood\.com\/og\/abcd2345\.png\?v=7">/,
  );
  // the embed is a player already: no video tags there
  const embed = injectPreview(base, {
    code,
    s,
    path: `/e/${code}`,
    embed: true,
  });
  assert.doesNotMatch(embed, /og:video/);
});

test("no reel tags for a reel not done, of another version, of another pitch, or unreadable", async () => {
  const code = "abcd2345";
  const cases = [
    { v: 7, state: "rendering", wide: null },
    { v: 6, state: "done", wide: `/reels/${code}/6-r1-0.7/wide.mp4` },
    { v: 7, state: "done", wide: `/reels/zzzz2345/7-r1-0.7/wide.mp4` },
    { v: 7, state: "done", wide: "https://elsewhere.example/x.mp4" },
    { v: 7, state: "failed", why: "render" },
    "throw",
  ];
  for (const reel of cases) {
    const item = async (pk, sk) => {
      if (sk === "reel" && reel === "throw") throw new Error("boom");
      if (sk === "replay")
        return { v: 7, made: M, n: 1, s: gzipSync(r.snap), exp: 2e9 };
      if (sk === "reel") return { ...reel, exp: 2e9 };
      return null;
    };
    const s = pitchState(await readPitch(item, code));
    assert.equal(s.state, "over");
    assert.equal(s.reel, null, JSON.stringify(reel));
    assert.doesNotMatch(previewOf(s).description, /highlights/);
  }
  // no reel without a replay to go with it
  const s = pitchState({ state: null, kept: null, reel: { wide: "/reels/x" } });
  assert.equal(s.state, "none");
});
