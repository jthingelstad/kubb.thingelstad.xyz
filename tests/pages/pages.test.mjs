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
  readRoom,
} from "../../backend/pages/pitch.mjs";
import { gzipSync } from "node:zlib";
import { renderer } from "../../backend/pages/render.mjs";
import { createPages, siteBase } from "../../backend/pages/server.mjs";
import * as site from "../../src/site/site.mjs";
import { gamePage } from "../../src/site/layout.mjs";

const fixture = (name) => fs.readFile(`tests/fixtures/${name}`, "utf8");
const inPlay = await fixture("snap-in-play.json");
const over = await fixture("snap-over.json");
const replay = await fixture("replay-north-south.json");
const overGame = JSON.parse(over).save.game;

// The room's document as the rooms keep it: the lobby's teams are member ids.
const SECRET = "m-0123456789abcdef";
const doc = (d, v = 7) => ({ v, doc: JSON.stringify(d) });
const ROOMS = {
  waiting: { doc: doc({ started: false, teams: { A: [SECRET], B: [] } }) },
  playing: {
    doc: doc({
      started: true,
      n: 1,
      teams: { A: [SECRET], B: [] },
      match: {
        n: 1,
        snap: inPlay,
        setup: {},
        players: { A: [{ id: SECRET }] },
      },
    }),
  },
  over: {
    doc: doc(
      {
        started: true,
        n: 1,
        teams: { A: [SECRET], B: [] },
        match: { n: 1, over: true, snap: over, setup: {}, log: [], seq: 0 },
      },
      42,
    ),
  },
  kept: { doc: null, replay },
  none: { doc: null, replay: null },
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
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(ROOMS).map(([k, r]) => {
        const p = previewOf(pitchState(r));
        return [k, p && [p.title, p.description]];
      }),
    ),
    {
      waiting: [
        "A pitch waiting for players · Kubb: Throwing Wood",
        "Waiting for players. Join the pitch.",
      ],
      playing: ["North vs South · Kubb: Throwing Wood", "In play: turn 2"],
      // the document's match has no complete log: no replay to promise
      over: [
        "North vs South · Kubb: Throwing Wood",
        `Final: ${winner} won, 1 to 0, in ${turns} turns.`,
      ],
      // the document gone, the kept replay still there
      kept: [
        "North vs South · Kubb: Throwing Wood",
        `Final: ${winner} won, 1 to 0, in ${turns} turns. Watch the replay.`,
      ],
      none: null,
    },
  );
  const withReplay = pitchState({
    doc: doc({
      started: true,
      match: { over: true, snap: over, setup: {}, log: [{ a: {} }], seq: 1 },
    }),
  });
  assert.match(previewOf(withReplay).description, /Watch the replay\.$/);
  // beside a finished document, the kept replay counts only when it is this match
  const r = JSON.parse(replay);
  const finished = (n) =>
    doc({
      started: true,
      match: {
        over: true,
        n,
        snap: r.snap,
        hash: r.hash,
        setup: {},
        log: null,
      },
    });
  const own = pitchState({ doc: finished(r.n), kept: replay });
  assert.equal(own.replay, true);
  assert.deepEqual(embedState(own, "abcd2345").match, { n: r.n, hash: r.hash });
  const rematch = pitchState({ doc: finished(r.n + 1), kept: replay });
  assert.equal(rematch.replay, false);
  assert.doesNotMatch(previewOf(rematch).description, /replay/);
  assert.equal(pitchState({ doc: finished(r.n), kept: null }).replay, false);
  // a document that cannot be read is no room
  assert.equal(pitchState({ doc: { v: 1, doc: "{not json" } }).state, "none");
});

test("the preview goes into the page's head; the fallback leaves it as built", () => {
  const code = "abcd2345";
  for (const [k, r] of Object.entries(ROOMS)) {
    const s = pitchState(r);
    const html = injectPreview(base, { code, s, path: `/p/${code}` });
    assert.ok(!html.includes(SECRET), `${k}: a member id`);
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

test("names are escaped, and the embed's state block cannot close its element", () => {
  const snap = JSON.parse(inPlay);
  snap.save.game.teams.A.name = '</script><b x="1">&';
  const s = pitchState({
    doc: doc({
      started: true,
      match: { snap: JSON.stringify(snap), setup: {} },
    }),
  });
  const html = injectPreview(base, {
    code: "abcd2345",
    s,
    path: "/e/abcd2345",
    embed: true,
  });
  assert.ok(!html.includes('</script><b x="1">'));
  assert.match(
    meta(html, "og:title"),
    /^&lt;\/script&gt;&lt;b x=&quot;1&quot;&gt;&amp; vs South/,
  );
  const block = html.match(
    /<script type="application\/json" id="kubb-pitch">(.*?)<\/script>/s,
  )[1];
  const state = JSON.parse(block);
  assert.equal(state.state, "playing");
  assert.equal(state.teams.A, '</script><b x="1">&');
  assert.equal(state.turn, 2);
});

test("a $ sequence in a team name is written as it is", () => {
  const snap = JSON.parse(inPlay);
  snap.save.game.teams.A.name = "$& $1 $` $'";
  const s = pitchState({
    doc: doc({
      started: true,
      match: { snap: JSON.stringify(snap), setup: {} },
    }),
  });
  const html = injectPreview(base, {
    code: "abcd2345",
    s,
    path: "/e/abcd2345",
    embed: true,
  });
  assert.equal(html.match(/<title>/g).length, 1);
  assert.equal(html.match(/property="og:title"/g).length, 1);
  assert.match(meta(html, "og:title"), /^\$&amp; \$1 \$` \$&#39; vs South/);
  const block = html.match(
    /<script type="application\/json" id="kubb-pitch">(.*?)<\/script>/s,
  )[1];
  assert.equal(JSON.parse(block).teams.A, "$& $1 $` $'");
});

test("the server: each state's page, and the built page on any failure", async () => {
  const calls = [];
  const handle = createPages({
    load: async (code) => {
      calls.push(code);
      if (code === "bbbbbbbb") throw new Error("down");
      return (
        ROOMS[
          { wwwwwwww: "waiting", pppppppp: "playing", vvvvvvvv: "over" }[code]
        ] ?? ROOMS.none
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
    "North vs South · Kubb: Throwing Wood",
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
    load: async () => ROOMS.playing,
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
    const png = await render(cardOf(pitchState(ROOMS[k])));
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
  assert.equal(cardOf(pitchState(ROOMS.none)), null);
  // a fallen king when the match ended on him
  const pieces = cardOf(pitchState(ROOMS.over)).pieces;
  const king = pieces.find((p) => p.kind === "king");
  assert.equal(king.standing, !/^king/.test(overGame.how));
});

test("readRoom: a match from before replays is over by its snapshot, and its kept replay is read", async () => {
  const r = JSON.parse(replay);
  // no "over" of its own, no log: a document from before replays
  const old = doc({
    started: true,
    match: { n: r.n, snap: r.snap, hash: r.hash },
  });
  const items = {
    doc: { ...old, exp: 2e9 },
    replay: { z: gzipSync(replay), exp: 2e9 },
  };
  const asked = [];
  const item = async (pk, sk, fields) => {
    asked.push([pk, sk, fields.join(",")]);
    return items[sk] ?? null;
  };
  const read = await readRoom(item, "abcd2345");
  assert.deepEqual(asked, [
    ["room#abcd2345", "doc", "v,doc,exp"],
    ["room#abcd2345", "replay", "z,exp"],
  ]);
  const s = pitchState(read);
  assert.equal(s.state, "over");
  assert.equal(s.replay, true);
  assert.match(previewOf(s).description, /Watch the replay\.$/);
  // a match in play reads nothing more
  asked.length = 0;
  items.doc = {
    ...doc({ started: true, match: { snap: inPlay, setup: {} } }),
    exp: 2e9,
  };
  assert.equal(pitchState(await readRoom(item, "abcd2345")).state, "playing");
  assert.equal(asked.length, 1);
  // the document gone: the kept replay alone
  delete items.doc;
  const gone = pitchState(await readRoom(item, "abcd2345"));
  assert.equal(gone.state, "over");
  assert.equal(gone.replay, true);
});
