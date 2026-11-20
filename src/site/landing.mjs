// The landing pages: the game as a whole at /, the iPhone app at /ios/, the
// Playdate game at /playdate/, the Kubb Engine at /engine/ and the Kubb sites we
// love at /love/ (Jamie, 2026-11-20: "We need to separately land the
// throwingwood.com website as a real landing page for the game, not just the
// game."). The web game's own page is /web/ (src/site/pages.mjs).
//
// Every picture is a real capture: the web game in Playwright, the iPhone app's
// App Store screenshots (throwingwood-ios docs/store), the Playdate game's
// launcher card (playdate-kubb source/launcher/card.png) and a frame of a
// highlight reel rendered by backend/reels from tests/fixtures. They live in
// public/landing/ as WebP; img() reads each one's size from the file, so the
// page holds its place before it loads.
import fs from "node:fs";
import { esc, page } from "./layout.mjs";
import { heroScene } from "./art.mjs";
import {
  ENGINE_REPO,
  IOS_REPO,
  PLAYDATE_GAME,
  PLAYDATE_REPO,
  SITE_TITLE,
  TESTFLIGHT_URL,
  WEB_REPO,
  ref,
} from "./site.mjs";

// A WebP's width and height from its header (VP8X, VP8 or VP8L).
export function webpSize(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF")
    throw new Error("not a RIFF file");
  if (buf.toString("ascii", 8, 12) !== "WEBP") throw new Error("not a WebP");
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8X")
    return {
      width: 1 + buf.readUIntLE(24, 3),
      height: 1 + buf.readUIntLE(27, 3),
    };
  if (chunk === "VP8 ")
    return {
      width: buf.readUInt16LE(26) & 0x3fff,
      height: buf.readUInt16LE(28) & 0x3fff,
    };
  if (chunk === "VP8L") {
    const b = buf.readUInt32LE(21);
    return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
  }
  throw new Error(`unknown WebP chunk ${chunk}`);
}

const PUBLIC = new URL("../../public/", import.meta.url);

// <img> for public/landing/<name>.webp, its size read from the file.
// eager: the hero's picture, loaded at once; every other one waits.
export function img(name, alt, { eager = false, cls = "shot" } = {}) {
  const src = `/landing/${name}.webp`;
  const { width, height } = webpSize(
    fs.readFileSync(new URL(src.slice(1), PUBLIC)),
  );
  return `<img class="${cls}" src="${src}" width="${width}" height="${height}" alt="${esc(alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async">`;
}

const external = (href, text) =>
  `<a href="${esc(href)}" rel="noopener">${text}</a>`;

// The home of the game: what it is, the three ways in, and why it feels right.
// One click from the top to the web game.
function landing({ tinylytics, config = {} }) {
  const body = `<section class="hero hero--landing">
  <div class="frame hero__inner hero__split">
    <div class="hero__text">
      <h1 class="hero__title"><span class="hero__kubb">Kubb</span><span class="hero__band">Throwing Wood</span></h1>
      <p class="lede">Kubb, the Swedish lawn game of wooden batons and blocks, played the way it is on the grass: the tournament rules, real physics, and a throw you make by feel.</p>
      <div class="actions">
        <a class="button button--start" href="/web/">Play now</a>
        <p class="actions__note">Free in your browser. No sign-up, no download.</p>
        <div class="actions__more">
          <a class="button" href="/ios/">iPhone and iPad</a>
          <a class="button" href="/playdate/">Playdate</a>
        </div>
      </div>
    </div>
    <figure class="hero__shot">
      ${img("web-hit", "The thrower’s view on the web: a baton strikes a kubb on the far baseline and a TOK! burst marks the hit, with the throwing dial at the right", { eager: true })}
    </figure>
  </div>
</section>
<section class="frame ways" aria-labelledby="ways">
  <h2 class="display" id="ways">Three ways to play</h2>
  <p class="section__lede">One game in three places. The same rules, the same physics and the same computer opponent, because the same engine runs underneath all three.</p>
  <ul class="ways__list">
    <li class="way">
      ${img("web-aim", "The web game before a throw: the aim circle on a kubb, the plan controls and the throwing dial")}
      <h3 class="way__title">In your browser</h3>
      <p>Start a pitch and send the link, play the computer, watch the computer play itself, or practice. Throw with a finger or a mouse.</p>
      <p><a class="button" href="/web/">Play on the web</a></p>
    </li>
    <li class="way">
      ${img("ios-aim", "The iPhone app before a throw: the aim circle on a kubb and the throwing dial, wind back", { cls: "shot shot--tall" })}
      <h3 class="way__title">iPhone and iPad</h3>
      <p>A native app with haptics under your thumb. It plays on the same pitches as the web, so a phone and a browser can share a match.</p>
      <p><a class="button" href="/ios/">The iPhone app</a></p>
    </li>
    <li class="way">
      ${img("playdate-card", "The Playdate game’s launcher card in one-bit black and white: KUBB in block letters with a baton striking the B, over THROWING WOOD", { cls: "shot shot--pixel" })}
      <h3 class="way__title">Playdate</h3>
      <p>Where the game began. The crank is your throwing arm: wind it back, swing it forward and let go.</p>
      <p><a class="button" href="/playdate/">The Playdate game</a></p>
    </li>
  </ul>
</section>
<section class="band band--grass" aria-labelledby="friends">
  <div class="frame split">
    <div>
      <h2 class="display" id="friends">A pitch is a link</h2>
      <p>Start a pitch and you get a link of its own. Send it. Whoever opens it joins you, types a name and picks a side, up to six a side, each on their own screen. Everyone sees every throw. An empty side is played by the computer.</p>
      <p>Make a pitch open and anyone can find it in the list of open games and join.</p>
      <p><a class="button" href="/web/">Start a pitch</a></p>
    </div>
    <figure class="split__shot">
      ${img("lobby", "A pitch’s lobby on the web: Pick a side, a name typed, a level of Beginner, Club or Pro, and Team A and Team B with room for six each")}
    </figure>
  </div>
</section>
<section class="frame split" aria-labelledby="again">
  <div>
    <h2 class="display" id="again">Every throw, again</h2>
    <p>When a match ends, its pitch keeps the replay for a year. Anyone with the link can watch the whole match again, throw by throw, from high on the sideline, and put it on another website.</p>
    <p>Ask for a highlight reel and the game’s server cuts a short video of the match’s best throws, tall for a phone and wide for everything else, ready to share.</p>
  </div>
  <figure class="split__shot">
    ${img("reel", "A frame of a highlight reel: two kubbs knocked over by one baton with KLAK! bursts, captioned NORTH: THREE KUBBS WITH ONE BATON")}
  </figure>
</section>
<section class="frame split split--flip" aria-labelledby="feel">
  <div>
    <h2 class="display" id="feel">Thrown by feel</h2>
    <p>There are no dice. Pull the meter back for power, flick it through and let go for the arc, and the baton flies, turns end over end and hits the wood where the physics says it does. A kubb tips into the next one. A clipped corner spins away.</p>
    <p>The rules are the U.S. National Kubb Championship’s, with the 2-4-6 opening, and every match is written down as a score sheet in Planet Kubb Notation, the way a scorekeeper on the lawn writes it.</p>
    <p><a class="more" href="/rules/">How Kubb is played</a></p>
  </div>
  <figure class="split__shot">
    ${img("web-flight", "A baton in flight toward two standing kubbs in the thrower’s view, in slow motion")}
  </figure>
</section>
<section class="band band--wood" aria-labelledby="engine-teaser">
  <div class="frame">
    <h2 class="display" id="engine-teaser">Why it feels right</h2>
    <p class="section__lede">The Kubb Engine works out where the wood goes. It was tuned against 150 tournament games scored by hand and against video of real throws, and it gives the same answer to the last bit in a browser and on an iPhone.</p>
    <p><a class="button" href="/engine/">Meet the engine</a></p>
  </div>
</section>
<section class="frame love-teaser" aria-labelledby="love-teaser">
  <h2 class="display" id="love-teaser">Kubb creates peace and unites people</h2>
  <p>Kubb is played on real lawns by real clubs. Go and find them: the championships, the leagues and the people who make the sets.</p>
  <p><a class="more" href="/love/">Kubb sites we love</a></p>
</section>`;
  return page({
    path: "/",
    title: SITE_TITLE,
    description:
      "Kubb, the lawn game, with the tournament rules and real physics: play in your browser, on iPhone and iPad, or on Playdate. Start a pitch and send friends the link.",
    body,
    bodyClass: "landing",
    tinylytics,
    release: config.release?.text,
  });
}

// /ios/: the iPhone and iPad app, in TestFlight. Its button comes from the one
// value TESTFLIGHT_URL (src/site/site.mjs): none if it is ever emptied.
export function iosJoin(url = TESTFLIGHT_URL) {
  if (url)
    return `<p class="actions"><a class="button button--start" href="${esc(url)}" rel="noopener" data-test="testflight">Join the TestFlight</a></p>
<p class="actions__note">TestFlight is Apple’s app for trying apps before they are released. Install it, then open the link on your iPhone or iPad.</p>`;
  return `<p class="notice" data-test="testflight-invite">The beta is by invitation for now.</p>
<p class="actions__note">Meanwhile the same game is free in your browser.</p>
<p><a class="button" href="/web/">Play on the web</a></p>`;
}

function ios({ tinylytics, config = {} }) {
  const body = `<section class="hero">
  <div class="frame hero__inner hero__split">
    <div class="hero__text">
      <p class="label kicker">In beta on TestFlight</p>
      <h1 class="display">Throwing Wood for iPhone and iPad</h1>
      <p class="lede">The same Kubb, made for the phone in your hand: a native app with haptics, sound and a throw under your thumb. On an iPad it is the same game on a bigger screen.</p>
      ${iosJoin()}
    </div>
    <div class="phones">
      ${img("ios-aim", "The iPhone app before a throw: Turn 1, two batons left, the aim circle on a kubb and the dial reading WIND BACK", { eager: true, cls: "shot shot--tall" })}
      ${img("ios-flight", "The iPhone app mid-throw: a baton in the air toward the far baseline, one baton left", { cls: "shot shot--tall" })}
    </div>
  </div>
</section>
<section class="frame" aria-labelledby="app">
  <h2 class="display" id="app">What is in the app</h2>
  <ul class="features">
    <li><h3>Play online</h3><p>Start a pitch and share its link, or join one by link or code. Phones and browsers meet in the same lobby: pick a team or watch, with friends playing on the web.</p></li>
    <li><h3>Play the computer</h3><p>The full match: the turn order, raising the kubbs, punishment kubbs, and the computer’s throws. A match cut short picks up where you left it.</p></li>
    <li><h3>Practice</h3><p>Pick a surface, tap a kubb and throw, with nothing riding on it.</p></li>
    <li><h3>Felt as well as seen</h3><p>The dial ticks as your arm crosses a target. Wood knocks when it hits, and the king rings when he falls. Sound and haptics each have their own switch.</p></li>
    <li><h3>Highlight reels</h3><p>A finished pitch can make a short video of its best throws, and a match against the computer can be shared with a reel of its own.</p></li>
    <li><h3>The score sheet</h3><p>Every match is written in Planet Kubb Notation, ready to copy at the end.</p></li>
  </ul>
</section>
<section class="band band--wood" aria-labelledby="same">
  <div class="frame">
    <h2 class="display" id="same">The same throw on both screens</h2>
    <p class="section__lede">The app runs the Kubb Engine, the same Lua as the web, with the same maths library built in, so a throw on an iPhone lands exactly where the same throw lands in a browser. That is why a phone and a browser can play one match. Its tests replay the engine’s reference matches and check every hash.</p>
    <p><a class="more" href="/engine/">How the engine stays in step</a></p>
  </div>
</section>
<section class="frame prose" aria-labelledby="source">
  <h2 class="display" id="source">Open source</h2>
  <p>The app is open source under the MIT licence: ${external(IOS_REPO, "throwingwood-ios on GitHub")}. The <a href="/privacy/">privacy page</a> says what the game keeps, on the web and in the app.</p>
</section>`;
  return page({
    path: "/ios/",
    title: `iPhone and iPad · ${SITE_TITLE}`,
    description:
      "Kubb: Throwing Wood for iPhone and iPad, in beta on TestFlight: a native app with haptics that plays on the same pitches as the web.",
    body,
    tinylytics,
    release: config.release?.text,
  });
}

// /playdate/: where the game began. Not released and with no date (the
// Playdate games site says so), so the page promises neither.
function playdate({ tinylytics, config = {} }) {
  const body = `<section class="hero">
  <div class="frame hero__inner hero__split">
    <div class="hero__text">
      <p class="label kicker">In development</p>
      <h1 class="display">Throwing Wood for Playdate</h1>
      <p class="lede">Where the game began: Kubb on the little yellow handheld, in crisp one-bit black and white. The crank is your throwing arm.</p>
      <p>It is not released yet. A test build to sideload is on ${external(ref(PLAYDATE_GAME, "playdate"), "Jamie’s Playdate games site")}, and the source is ${external(PLAYDATE_REPO, "on GitHub")}.</p>
    </div>
    <figure class="hero__shot">
      ${img("playdate-card", "The Playdate game’s launcher card in one-bit black and white: KUBB in block letters with a baton striking the B, over THROWING WOOD", { eager: true, cls: "shot shot--pixel" })}
    </figure>
  </div>
</section>
<section class="frame" aria-labelledby="crank">
  <h2 class="display" id="crank">The crank is the arm</h2>
  <ol class="steps">
    <li><strong>Wind it back.</strong> Read the crank as a clock, with 6 as the arm hanging down. Turn it back up past 7 and the wind-up starts; how far back you go is the power.</li>
    <li><strong>Swing it forward.</strong> Bring it through 6 and on up the other side. Where the crank stops is where the baton leaves your hand, so it decides the arc.</li>
    <li><strong>Let the physics decide.</strong> The throw is a simulation at real dimensions, not a dice roll. Stop short and the wind-up drops; crank on past 12 and it is a sky ball.</li>
  </ol>
</section>
<section class="frame" aria-labelledby="modes">
  <h2 class="display" id="modes">On the device</h2>
  <ul class="features">
    <li><h3>Pass and play</h3><p>Hand the Playdate round. Up to six a side, each throwing in turn.</p></li>
    <li><h3>Against the Playdate</h3><p>The computer throws the same way you do: it plans a target and an arc and makes a swing.</p></li>
    <li><h3>Saved players</h3><p>Players are kept on the device with their histories: recent games, drill records and their level.</p></li>
    <li><h3>Seven drills</h3><p>8 Meters, The House, King Shots, Blast, The Wall, Around the Pitch and Doubles, each with its best and its last ten runs.</p></li>
    <li><h3>Score sheets</h3><p>Every finished game is saved as a score sheet in Planet Kubb Notation.</p></li>
    <li><h3>One bit, hard shadows</h3><p>Bold black outlines, solid shadows and a white pitch, drawn for the Playdate’s screen.</p></li>
  </ul>
  <p>The web and the iPhone app grew out of this game, and all three run the same <a href="/engine/">Kubb Engine</a>. The Playdate does its sums in 32-bit numbers, so it plays its matches on its own.</p>
</section>`;
  return page({
    path: "/playdate/",
    title: `Playdate · ${SITE_TITLE}`,
    description:
      "Kubb: Throwing Wood for Playdate, in development: throw with the crank, pass and play up to six a side, seven drills and score sheets in Planet Kubb Notation.",
    body,
    tinylytics,
    release: config.release?.text,
  });
}

// /engine/ (published 2026-11-19; Jamie, 2026-11-20: "brag about how amazing our
// Kubb engine is"). Every claim is from kubb-engine's docs or the clients':
// docs/notes/real-games.md, docs/reference (REALCLIPS) and reference-engine.md for
// the checks, DETERMINISM.md and VERSIONING.md for the hashes and versions,
// throwingwood-ios docs/ROOMS-CLIENT.md for the cross-play matches.
function engine({ tinylytics, config = {} }) {
  const body = `<section class="hero">
  <div class="frame hero__inner">
    <h1 class="display">The Kubb Engine</h1>
    <p class="lede">A baton clips a corner. The first kubb tips into the next. On Playdate, the web and iPhone, the same Lua code works out where the wood goes and what the throw scores.</p>
  </div>
  ${heroScene()}
</section>
<section class="frame" aria-labelledby="one">
  <h2 class="display" id="one">One engine, three games</h2>
  <div class="cards">
    <article class="card">
      <h3 class="card__title">Written once</h3>
      <p>The rules, the physics, the computer thrower, the score sheet and the online room are one body of pure Lua with no drawing, input or network of its own. Each game supplies those.</p>
    </article>
    <article class="card">
      <h3 class="card__title">Copied byte for byte</h3>
      <p>The Playdate, the web and the iPhone each carry a tagged release of the engine, unchanged. Each checks its copy against the release’s fingerprint of every file, and a build fails if a single byte differs.</p>
    </article>
    <article class="card">
      <h3 class="card__title">Fixed in one place</h3>
      <p>A change to how the game plays is made in the engine, released as a new tag and then taken up by each game. No game ever patches its own copy.</p>
    </article>
  </div>
</section>
<section class="frame" aria-labelledby="checks">
  <h2 class="display" id="checks">How close to the lawn?</h2>
  <div class="cards">
    <article class="card">
      <h3 class="card__title">150 tournament games</h3>
      <p>We compared the computer’s play with 150 tournament games, many from the final rounds of a bracket, scored by hand in Planet Kubb Notation. The sheets tell us how often a baton missed, took one kubb or toppled a whole group.</p>
      <p>At the computer’s pro level, a baton at a base kubb from 8 m hits 33.5% of the time; the tournament players hit 32.7%. Shots at the king: 82.8% against 83.8%. Taking two field kubbs with one baton is still harder for the computer: 5.7% against 16%.</p>
    </article>
    <article class="card">
      <h3 class="card__title">220 moments of real play</h3>
      <p>We marked 220 events frame by frame in public video of real play, most of them from tournament footage with a fixed camera. The painted pitch lines gave us a ruler for the near half of the field.</p>
      <p>For 73 throws of a kubb, we could see both its landing and its resting place. That let us measure how far it travelled after it hit the grass.</p>
    </article>
    <article class="card">
      <h3 class="card__title">1,063 physics cases</h3>
      <p>We gave MuJoCo, a rigid-body physics simulator, the same pieces, masses and starting throws. We compared drops, strikes and chains of falling kubbs. Its solver settings gave stable enough measurements to score 1,039 cases.</p>
      <p>One comparison caught a baton sliding too far after a bounce. Accounting for the friction during impact brought its stopping distance on grass closer to MuJoCo’s.</p>
    </article>
  </div>
</section>
<section class="frame prose" aria-labelledby="hashes">
  <h2 class="display" id="hashes">The same to the last bit</h2>
  <p>A browser and an iPhone can sit on opposite sides of a pitch. Each plays every action itself, writes down the whole game state and calculates a short fingerprint of it called a hash. If the two ever disagreed, it would show on the very action where they parted.</p>
  <p>They do not part. The web’s engine runs in WebAssembly with a portable maths library, the same bytes in every browser. The iPhone app builds that same maths library into its Lua, with the compiler told not to take shortcuts, so its floating point comes out identical. The engine’s reference corpus, 505 action hashes from 13 matches, is replayed on every change to the engine, and both the web and the iPhone app check it in their own tests.</p>
  <p>In three complete matches played between the two clients, on grass, sand and snow, every action’s hash agreed, and each kept replay played back without a single difference. Playdate uses the same rules and throw model with its own 32-bit arithmetic, so it plays alone.</p>
</section>
<section class="frame prose" aria-labelledby="versions">
  <h2 class="display" id="versions">A match keeps its engine</h2>
  <p>Anything that could change where a throw lands gets a new engine version. A match belongs to the version it started on for its whole life: its play, its replay, its embed, its highlight reel and its score sheet. The web carries more than one engine, so a match started last month still replays exactly as it was played.</p>
  <p>That is also what makes a replay honest. It is not a recording of pictures: it is the match played again from its start, action by action, by the same engine. A highlight reel is cut from that same re-run on the game’s server.</p>
</section>
<section class="frame prose" aria-labelledby="notation">
  <h2 class="display" id="notation">What the scorekeeper writes</h2>
  <p>Planet Kubb Notation fits a throw into a few characters. A dash is a miss. <code>2F</code> means one baton took two field kubbs. <code>K</code> means the king fell. Read the marks in order and you can follow a turn, baton by baton.</p>
  <p>The engine writes that same notation as a match unfolds. The game can show you its score sheet, and the reader used for the archived games can score it.</p>
</section>
<section class="frame prose" aria-labelledby="open">
  <h2 class="display" id="open">Open source</h2>
  <p>The engine is MIT-licensed and on GitHub: ${external(ENGINE_REPO, "kubb-engine")}. So are the games built on it: ${external(WEB_REPO, "the web")}, ${external(IOS_REPO, "the iPhone app")} and ${external(PLAYDATE_REPO, "the Playdate game")}.</p>
</section>`;
  return page({
    path: "/engine/",
    title: `The Kubb Engine · ${SITE_TITLE}`,
    description:
      "One Kubb engine for Playdate, the web and iPhone: tuned against 150 tournament games and video of real play, and the same to the last bit in a browser and on an iPhone.",
    body,
    tinylytics,
    release: config.release?.text,
  });
}

// /love/: the Kubb sites Jamie named (2026-11-20), in his order, with his names
// and addresses. Each line is from what the site says about itself.
export const LOVE = [
  {
    name: "USA Kubb",
    url: "https://www.usakubb.org",
    text: "Home of the U.S. National Kubb Championship, the oldest and largest kubb tournament outside Europe, and the rules this game plays.",
  },
  {
    name: "Kubb World Championship",
    url: "https://www.kubbvm.com",
    text: "The world championship on Gotland in Sweden, whose own motto is that kubb unites people and creates peace on earth.",
  },
  {
    name: "Minnesota Kubb",
    url: "http://minnesotakubb.com",
    text: "Home of the world’s largest winter kubb tournament, with leagues and a guide to the game for players in Minnesota.",
  },
  {
    name: "Planet Kubb",
    url: "https://planetkubb.com",
    text: "The home of Planet Kubb Notation, the scoresheet this game writes every match in; the Kubb Engine was tuned against an archive of 150 tournament games scored in it.",
  },
  {
    name: "JP's Backyard Games",
    url: "https://www.jpsbackyardgames.com/",
    text: "Lawn games for fun with friends, family and neighbours: game sets to buy or rent, and help making your own.",
  },
];

function love({ tinylytics, config = {} }) {
  const body = `<section class="frame intro">
  <h1 class="display">Kubb Creates Peace and Unites People</h1>
  <p class="lede">Throwing Wood is a game about a game. The real one is played on lawns, beaches and frozen lakes by clubs and families. Here are some of the places that keep it going.</p>
</section>
<section class="frame" aria-labelledby="sites">
  <h2 class="display visually-hidden" id="sites">Kubb sites</h2>
  <ul class="love">
  ${LOVE.map(
    (s) => `<li class="card love__site">
    <h3 class="card__title"><a href="${esc(s.url)}" rel="noopener">${esc(s.name)}</a></h3>
    <p>${esc(s.text)}</p>
    <p class="love__host">${esc(new URL(s.url).hostname.replace(/^www\./, ""))}</p>
  </li>`,
  ).join("\n  ")}
  </ul>
</section>`;
  return page({
    path: "/love/",
    title: `Kubb sites we love · ${SITE_TITLE}`,
    description:
      "Kubb creates peace and unites people: USA Kubb, the Kubb World Championship, Minnesota Kubb, Planet Kubb and JP's Backyard Games.",
    body,
    tinylytics,
    release: config.release?.text,
  });
}

export const LANDING_PAGES = [
  { path: "/", file: "index.html", render: landing, sources: ["src/site"] },
  { path: "/ios/", file: "ios/index.html", render: ios, sources: ["src/site"] },
  {
    path: "/playdate/",
    file: "playdate/index.html",
    render: playdate,
    sources: ["src/site"],
  },
  {
    path: "/engine/",
    file: "engine/index.html",
    render: engine,
    sources: ["src/site"],
  },
  {
    path: "/love/",
    file: "love/index.html",
    render: love,
    sources: ["src/site"],
  },
];
