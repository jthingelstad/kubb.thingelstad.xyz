// The landing pages: the game as a whole at /, the iPhone app at /ios/, the
// Playdate game at /playdate/, the Kubb Engine at /engine/ and the Kubb sites we
// love at /love/ (Jamie, 2026-11-20: "We need to separately land the
// throwingwood.com website as a real landing page for the game, not just the
// game."). The web game's own page, /web/, is part of / since the 1.0 design.
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
import { signup } from "./newsletter.mjs";
import {
  APP_STORE_BADGE,
  APP_STORE_URL,
  ENGINE_REPO,
  GAME_READY,
  IOS_REPO,
  PLAYDATE_REPO,
  SITE_TITLE,
  SUPPORT_TEXT,
  TESTFLIGHT_URL,
  WEB_REPO,
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

// The engine's golden corpus, as vendored: /engine/ counts it, never a number
// typed by hand (it said 505 after 0.9.0 made it 523).
const GOLDEN = JSON.parse(
  fs.readFileSync(
    new URL("../../vendor/engine/golden/hashes.json", import.meta.url),
    "utf8",
  ),
).matches;
export const GOLDEN_COUNT = {
  matches: GOLDEN.length,
  hashes: GOLDEN.reduce((n, m) => n + m.actions.length, 0),
};

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

// PLAY NOW (the Throwing Wood 1.0 build list, "The website" 1): a match against
// the computer on a pitch of its own (public/js/start.js makes the code; without
// scripts /p/ does). `play=1` asks the game to start at once on a device with no
// kept match options, and to open the options card on one that has played
// (src/main.js startSolo, src/ui/cards.js soloKept).
export const PLAY_NOW = "?solo=1&play=1";
export const playNow = () =>
  `<a class="button button--start" href="/p/${esc(PLAY_NOW)}" data-pitch="${esc(PLAY_NOW)}" data-test="play-now">Play now</a>`;

// The iPhone app's way in, wherever a page offers it: Apple's badge once
// APP_STORE_URL is set (src/site/site.mjs, the one switch), until then the
// TestFlight wording, and the /ios/ page if neither link is there.
export function storeLink({
  appStore = APP_STORE_URL,
  testflight = TESTFLIGHT_URL,
} = {}) {
  if (appStore)
    return `<a class="store-badge" href="${esc(appStore)}" rel="noopener" data-test="app-store"><img src="${APP_STORE_BADGE}" width="144" height="48" alt="Download on the App Store"></a>`;
  if (testflight)
    return `<a class="button" href="${esc(testflight)}" rel="noopener" data-test="testflight">Join the TestFlight</a>`;
  return `<a class="button" href="/ios/">iPhone and iPad</a>`;
}

// Everything the page promises is playable once the game is in place: a
// pitch link with friends, the computer and practice. No notice then.
const BUILDING = GAME_READY
  ? ""
  : `<p class="notice">The game is still being built. Until it is, a pitch only says so.</p>`;

// The list of open games (public/js/open-games.js reads the pitch server's
// GET /open): only when this build has a pitch server.
function openGames(pitchUrl) {
  if (!pitchUrl) return "";
  return `<div class="open-games" aria-labelledby="open-games" role="region" data-pitchserver="${esc(pitchUrl)}" hidden>
      <h3 class="display" id="open-games">Open games</h3>
      <p>These pitches are open to anyone. Join one and pick a side, or watch a match.</p>
      <ul class="open-list" data-open-list></ul>
      <p class="open-status" data-open-status role="status">Looking for open games...</p>
    </div>`;
}

// The home of the game, and since the 1.0 design its one landing page: the web
// game's page (/web/) is folded in as "Three ways to start" and the open games,
// under the id `play` that /web/ now redirects to (infra/viewer-request.js). The
// words are short and plain (Jamie, 2026-11-20: "Keep the language simple and
// short. 5th grade level. it is a game. This is fun."); they are the site's own
// from before, where the build list gives none. PLAY NOW is the page's one
// marigold button; every other button is plain.
//
// The newsletter block stays (the owner, 2026-11-21: "Keep the block"), last
// before the footer, its button plain.
function landing({ tinylytics, config = {} }) {
  const body = `<section class="hero hero--landing">
  <div class="frame hero__inner hero__split">
    <div class="hero__text">
      <h1 class="hero__title"><span class="hero__kubb">Kubb</span> <span class="hero__band">Throwing Wood</span></h1>
      <p class="lede">Throw sticks of wood at blocks of wood. Knock them all over, then topple the king. That is kubb, the lawn game from Sweden. Some folks call it Viking chess.</p>
      <div class="actions">
        <div class="actions__row">
          ${playNow()}
          ${storeLink()}
        </div>
        <p class="actions__note">It runs in your browser. No sign-up and nothing to download.</p>
      </div>
      ${BUILDING}
    </div>
    <figure class="hero__shot">
      ${img("web-hit", "A baton hits a kubb on the far baseline with a TOK! burst. The throwing meter is at the right.", { eager: true })}
    </figure>
  </div>
</section>
<section class="band band--baton" id="play" aria-labelledby="ways">
  <div class="frame">
    <h2 class="display" id="ways">Three ways to start</h2>
    <ul class="ways__list">
      <li class="way card">
        <h3 class="way__title">Against the computer</h3>
        <p>Play a full match against the computer, from Kid to Pro, in one of seven scenes: a park, a beach, a campsite at night, a neon floor, a Minnesota winter, a tournament, or the Playdate’s black and white.</p>
        <p class="way__go"><a class="button" href="/p/?solo=1" data-pitch="?solo=1">Play the computer</a></p>
      </li>
      <li class="way card">
        <h3 class="way__title">With friends</h3>
        <p>Start a pitch and send its link. Friends pick a name and a side, up to six a side. Each plays on their own screen. The computer plays any empty side.</p>
        <fieldset class="access" data-access hidden>
          <legend class="label">Who can join</legend>
          <div class="access__bar">
            <label><input type="radio" name="access" value="invite" checked><span>Invite only</span></label>
            <label><input type="radio" name="access" value="open"><span>Open</span></label>
          </div>
          <p class="access__note">Invite only is for people with the link. Open puts it in the list below for anyone.</p>
        </fieldset>
        <p class="way__go"><a class="button" href="/p/" data-pitch="" data-start>Start a pitch</a></p>
      </li>
      <li class="way card">
        <h3 class="way__title">Just throw</h3>
        <p>Throw batons on the practice pitch. Nothing counts.</p>
        <p class="way__go"><a class="button" href="/practice/">Practice</a></p>
      </li>
    </ul>
    <p class="ways__more">Or sit back and <a href="/p/?watch=1" data-pitch="?watch=1">watch the computer</a> play itself, match after match. Your name, the meter and the sound are in <a href="/settings/">Settings</a>.</p>
    ${openGames(config.pitchUrl)}
    <p class="ways__more">Matches are recorded to help make the game better. Practice is not recorded. The <a href="/privacy/">privacy page</a> says what the game keeps.</p>
  </div>
</section>
<section class="frame feel" aria-labelledby="feel">
  <h2 class="display" id="feel">Throw by feel</h2>
  <ol class="feel__steps">
    <li><span class="feel__n" aria-hidden="true">1</span><p><strong>Pull back for power.</strong> No dice here.</p></li>
    <li><span class="feel__n" aria-hidden="true">2</span><p><strong>Flick and let go.</strong> The baton flips end over end.</p></li>
    <li><span class="feel__n" aria-hidden="true">3</span><p><strong>Real physics does the rest.</strong> TOK!</p></li>
  </ol>
  <p>You play by the U.S. National Kubb Championship rules. <a class="more" href="/rules/">How to play kubb</a></p>
</section>
<section class="band band--wood" aria-label="On iPhone and Playdate">
  <div class="frame screens">
    <div class="screens__one" id="app">
      <h2 class="display">On iPhone and iPad</h2>
      <p>Throw with your thumb. Your phone can join the same pitch as a browser.</p>
      <p class="screens__go">${storeLink()} <a class="button" href="/ios/">The iPhone app</a></p>
    </div>
    <div class="screens__one" id="playdate">
      <h2 class="display">On Playdate</h2>
      <p>This is where the game began. You throw by turning the crank.</p>
      <p class="screens__go"><a class="button" href="/playdate/">The Playdate game</a></p>
    </div>
  </div>
</section>
${signup({ size: "big" })}`;
  return page({
    path: "/",
    title: SITE_TITLE,
    description:
      "Kubb, the lawn game, in your browser, on iPhone and iPad, and on Playdate. Start a pitch and send friends the link.",
    body,
    bodyClass: "landing",
    tinylytics,
    release: config.release?.text,
    scripts: [
      "/js/start.js",
      ...(config.pitchUrl ? ["/js/open-games.js"] : []),
    ],
  });
}

// /ios/: the iPhone and iPad app, in TestFlight. Its button comes from the
// switches in src/site/site.mjs: APP_STORE_URL, once set, puts Apple's badge in
// its place (storeLink); until then TESTFLIGHT_URL, and no button if that is ever
// emptied.
export function iosJoin(url = TESTFLIGHT_URL, appStore = APP_STORE_URL) {
  if (appStore) return `<p class="actions">${storeLink({ appStore })}</p>`;
  if (url)
    return `<p class="actions"><a class="button button--start" href="${esc(url)}" rel="noopener" data-test="testflight">Join the TestFlight</a></p>
<p class="actions__note">TestFlight is Apple’s app for trying apps early. Get it, then open the link on your iPhone or iPad.</p>`;
  return `<p class="notice" data-test="testflight-invite">The beta is by invitation for now.</p>
<p class="actions__note">You can play the same game in your browser.</p>
<p><a class="button" href="/#play">Play on the web</a></p>`;
}

// The two sections the App Store listing's links point at (the 1.0 build list,
// "The iPhone page for the store"): /ios/#support and /ios/#privacy. Support is
// there only once its words are set (SUPPORT_TEXT in src/site/site.mjs, the
// owner's to give; empty today, so the page has no Support section and the footer
// no Support link). Privacy is the privacy page's own words, and a link to it.
export function storeSections(support = SUPPORT_TEXT) {
  const help = support
    ? `
    <div class="help__one" id="support">
      <h2 class="display">Support</h2>
      <p data-test="support">${esc(support)}</p>
      <p><a class="more" href="/rules/">How to play and how to throw</a></p>
    </div>`
    : "";
  return `<section class="band band--baton" aria-label="${support ? "Support and privacy" : "Privacy"}">
  <div class="frame help">${help}
    <div class="help__one" id="privacy">
      <h2 class="display">Privacy</h2>
      <p>There are no accounts and no ads, and nothing is ever sold. The privacy page says what the game keeps, on the web and in the app.</p>
      <p><a class="more" href="/privacy/">The privacy page</a></p>
    </div>
  </div>
</section>`;
}

function ios({ tinylytics, config = {} }) {
  const body = `<section class="hero">
  <div class="frame hero__inner hero__split">
    <div class="hero__text">
      ${APP_STORE_URL ? "" : `<p class="label kicker">In beta on TestFlight</p>`}
      <h1 class="display">On iPhone and iPad</h1>
      <p class="lede">Kubb in the palm of your hand. Wind up with your thumb and feel the meter tick. On an iPad the pitch is just bigger.</p>
      ${iosJoin()}
    </div>
    <div class="phones">
      ${img("ios-aim", "The iPhone app before a throw. Turn 1, two batons left, and the meter reads WIND BACK.", { eager: true, cls: "shot shot--tall" })}
      ${img("ios-flight", "The iPhone app mid-throw. A baton flies toward the far baseline.", { cls: "shot shot--tall" })}
    </div>
  </div>
</section>
<section class="frame" aria-labelledby="app">
  <h2 class="display" id="app">In the app</h2>
  <ul class="features">
    <li><h3>Play online</h3><p>Join a pitch with a link or a code. Phones and browsers meet in the same lobby.</p></li>
    <li><h3>Play the computer</h3><p>Play a full match against the computer. Stop partway and pick it up later.</p></li>
    <li><h3>Practice</h3><p>Pick a surface, tap a kubb and throw. Nothing counts.</p></li>
    <li><h3>Hear the wood</h3><p>Wood knocks when it hits. The king rings when he falls. Sound and the buzz each have their own switch.</p></li>
    <li><h3>Highlight reels</h3><p>Make a short video of a match’s best throws.</p></li>
    <li><h3>The score sheet</h3><p>Every match is written down in Planet Kubb Notation. Copy it at the end.</p></li>
  </ul>
</section>
<section class="band band--wood" aria-labelledby="same">
  <div class="frame">
    <h2 class="display" id="same">Same throw, both screens</h2>
    <p class="section__lede">The app and the web run the same engine and the same math. A throw on an iPhone lands right where it lands in a browser. That is how the two can share one match.</p>
    <p><a class="more" href="/engine/">How the engine keeps them together</a></p>
  </div>
</section>
<section class="frame prose" aria-labelledby="source">
  <h2 class="display" id="source">Open source</h2>
  <p>The app is open source under the MIT license. Its code is ${external(IOS_REPO, "on GitHub")}. The <a href="/privacy/">privacy page</a> says what the game keeps, on the web and in the app.</p>
</section>
${storeSections()}
${signup()}`;
  return page({
    path: "/ios/",
    title: `iPhone and iPad · ${SITE_TITLE}`,
    description: `Kubb: Throwing Wood for iPhone and iPad${APP_STORE_URL ? "" : ", in beta on TestFlight"}. Throw with your thumb and play friends on the web.`,
    body,
    tinylytics,
    release: config.release?.text,
  });
}

// /playdate/: the Playdate game, watched and installed right here (Jamie,
// 2026-11-20: "do not require people to go to the playdate site to download
// and install… reference the same file on that page… pull the video that we
// are using into the throwing wood.com page so folks can see the game before
// doing the work"). The reel, its poster, the screens and the build are the
// ones the Playdate games site shows (its src/pages.mjs and src/games.mjs),
// by their URLs there: one copy of each. The CSP allows that one origin for
// images and media (src/site/csp.mjs). When the Playdate site moves to a new
// build, change PLAYDATE_BUILD to its URL, size and notes. The version shown
// is read from the file's own name (`make release` in playdate-kubb names it
// from the game's pdxinfo), so the page never names another.
export const PLAYDATE_MEDIA = "https://playdate.thingelstad.xyz/throwing-wood";
export const PLAYDATE_REEL = `${PLAYDATE_MEDIA}/reel/throwing-wood-0.9.5`;
export const PLAYDATE_BUILD = {
  url: "https://files.thingelstad.com/playdate/throwing-wood/ThrowingWood-0.9.7.pdx.zip",
  size: "571 KB", // its Content-Length, 570,996 bytes
  notes: [
    "Club and Pro throwers try for a half turn of the baton. Long throws from the baseline wobble more.",
    "The computer puts spin on its drilled kubbs at Club and Pro.",
    "A sliding baton can shove a fallen kubb into another piece.",
  ],
};
export const playdateBuildFile = (url = PLAYDATE_BUILD.url) =>
  new URL(url).pathname.split("/").pop();
export const playdateBuildVersion = (url = PLAYDATE_BUILD.url) =>
  playdateBuildFile(url).match(/^ThrowingWood-(\d+\.\d+\.\d+)\.pdx\.zip$/)[1];

// Simulator captures from the Playdate site (800 x 480). They are from before
// the clock throw, so the page says the meter looks different now.
const PLAYDATE_SCREENS = [
  [
    "flight",
    "A baton in the air over the pitch, flying toward the far baseline and its kubbs.",
  ],
  [
    "hit",
    "A baton strikes a kubb, which starts to tip. Its shadow is on the ground.",
  ],
  [
    "three-kubbs",
    "A low baton heads into three kubbs standing close together.",
  ],
  [
    "hand-off",
    "A black card between turns: pass the Playdate to Team A, with a small map of the pitch.",
  ],
  [
    "winner",
    "A black card at the end: Team A wins, with the turns, the hit rate and a broken king.",
  ],
];

const SIDELOAD_HELP = "https://help.play.date/games/sideloading/";

function playdate({ tinylytics, config = {} }) {
  const version = playdateBuildVersion();
  const body = `<section class="hero">
  <div class="frame hero__inner hero__split">
    <div class="hero__text">
      <p class="label kicker">In development</p>
      <h1 class="display">On Playdate</h1>
      <p class="lede">This is where the game began. Kubb in black and white on the little yellow handheld. The crank is your throwing arm.</p>
      <p>It is not in a store yet, but you can put the test build on your own Playdate today. It is free.</p>
      <p class="actions"><a class="button button--start" href="#get">Get the test build</a></p>
    </div>
    <figure class="hero__shot reel">
      <video class="shot shot--pixel reel__video" data-reel src="${PLAYDATE_REEL}.mp4" poster="${PLAYDATE_REEL}-poster.png" width="800" height="480" controls playsinline preload="metadata" aria-label="Kubb: Throwing Wood on Playdate, 26 seconds with no sound" aria-describedby="reel-about">
        <a href="${PLAYDATE_REEL}.mp4" rel="noopener">Watch the game in play (MP4, 26 seconds)</a>
      </video>
      <figcaption id="reel-about">The game in the Playdate Simulator. The title screen, the first HOW TO PLAY card, the Playdate passed to the next team, a first baton, two field kubbs down with one baton, a kubb thrown in with a little spin, a shot at the king and the winner card. 26 seconds, no sound.</figcaption>
    </figure>
  </div>
</section>
<section class="frame prose" aria-labelledby="what">
  <h2 class="display" id="what">What it is</h2>
  <p>Kubb is a lawn game played with blocks of wood. You throw batons at the other side’s kubbs. Knock them all down, then topple the king to win.</p>
  <p>Here it plays on the Playdate’s tiny black and white screen. The pitch is 5 meters by 8, seen from behind the thrower. Every baton and kubb is its real size, and real physics decides what falls. A baton can tumble, skid, or knock one kubb into the next. Throw it sideways like a helicopter and it does not count.</p>
  <p>You play by the U.S. National Kubb Championship rules, with a 2-4-6 start. Every finished match is written down in Planet Kubb Notation, and you can read it back as a score sheet.</p>
</section>
<section class="frame prose" aria-labelledby="crank">
  <h2 class="display" id="crank">Crank to throw</h2>
  <p class="section__lede">Think of the crank as a clock. Hanging straight down is 6. That is your arm.</p>
  <ol class="steps">
    <li><strong>Wind it back.</strong> Pull it up the left side for power. 9 o’clock throws about 4 meters. 10 o’clock throws about 8.</li>
    <li><strong>Swing it forward.</strong> Bring it through 6 and up the right side, then stop. Where you stop sets the arc: 3 for a base kubb, 4 for a field kubb, half past 3 for the king. Crank all the way to 12 and it is a sky ball.</li>
    <li><strong>Let it fly.</strong> TOK! The game tells you in a word how your power, your release and your aim went. Stop before 6 and you drop the wind-up with no throw.</li>
  </ol>
  <p>Just want to throw? The aim circle starts on a kubb and the arc is picked for you. All you do is crank. HOW TO PLAY teaches the rules on six short cards, and HOW TO THROW walks you through a throw with the real crank.</p>
  <table class="controls">
    <caption class="label">Before the throw</caption>
    <tbody>
      <tr><th scope="row">D-pad</th><td>Move the aim circle. It does not stick to a kubb, so you can aim off one for the wind.</td></tr>
      <tr><th scope="row">Hold A and the d-pad</th><td>Walk along the throwing line, step back, or come up to the advantage line</td></tr>
      <tr><th scope="row">Hold B, up and down</th><td>Plan the arc. You see the pitch over your shoulder.</td></tr>
      <tr><th scope="row">Hold B, left and right</th><td>Tilt the baton, or spin a drilled kubb</td></tr>
      <tr><th scope="row">Crank back, forward, stop</th><td>Power, throw, and the arc</td></tr>
    </tbody>
  </table>
</section>
<section class="frame" aria-labelledby="modes">
  <h2 class="display" id="modes">What you can play</h2>
  <ul class="features">
    <li><h3>Play the Playdate</h3><p>A whole match against the computer. It throws like you do, and you see its swing on the clock.</p></li>
    <li><h3>Pass and play</h3><p>Pass the Playdate around. One to six can play on each side.</p></li>
    <li><h3>Saved players</h3><p>Each player keeps their own level (Beginner, Club or Pro), their games and their drill records.</p></li>
    <li><h3>Seven drills</h3><p>8 Meters, The House, King Shots, Blast, The Wall, Around the Pitch and Doubles. Or just throw on an open pitch.</p></li>
    <li><h3>Grass, sand or snow</h3><p>Pick the ground, add wind if you dare, and choose from five kubb sets.</p></li>
    <li><h3>Real wood sounds</h3><p>The knock of wood on wood, recorded from a real set.</p></li>
    <li><h3>Pick it up later</h3><p>Stop a match partway and finish it later.</p></li>
    <li><h3>Score sheets</h3><p>Every finished game is saved as a Planet Kubb score sheet you can read back.</p></li>
  </ul>
</section>
<section class="frame" aria-labelledby="screens">
  <h2 class="display" id="screens">Screens</h2>
  <p class="section__lede">From an earlier build, at twice the Playdate’s size. The throwing meter looks different now.</p>
  <ul class="pd-screens">
    ${PLAYDATE_SCREENS.map(
      ([name, alt]) =>
        `<li><img class="shot shot--pixel" src="${PLAYDATE_MEDIA}/screens/${name}.png" width="800" height="480" alt="${esc(alt)}" loading="lazy" decoding="async"></li>`,
    ).join("\n    ")}
  </ul>
</section>
<section class="band band--wood" aria-labelledby="get">
  <div class="frame prose">
    <h2 class="display" id="get">Put it on your Playdate</h2>
    <p class="section__lede">This is test build ${esc(version)}. It is free. It may still change, and a thing or two may break.</p>
    <p class="actions"><a class="button button--start" href="${esc(PLAYDATE_BUILD.url)}" rel="noopener" data-test="playdate-download">Download the game</a></p>
    <p class="actions__note">${esc(playdateBuildFile())}, ${esc(PLAYDATE_BUILD.size)}. A zipped Playdate game.</p>
    <ol class="steps pd-install">
      <li>Download the file and keep it zipped.</li>
      <li>Sign in at ${external("https://play.date/account/sideload/", "play.date")} and open your account’s Sideload page. Upload the file there. Your Playdate must be registered to your account.</li>
      <li>On your Playdate, open the Game Library (Settings, then Games, on older system versions). Refresh the list if it has not, then download Kubb: Throwing Wood.</li>
    </ol>
    <p>A newer build goes on the same way and replaces this one. Panic’s ${external(SIDELOAD_HELP, "sideloading help")} shows other ways, like over USB.</p>
    <h3>New in ${esc(version)}</h3>
    <ul class="pd-notes">
      ${PLAYDATE_BUILD.notes.map((n) => `<li>${esc(n)}</li>`).join("\n      ")}
    </ul>
  </div>
</section>
<section class="frame prose" aria-labelledby="open">
  <h2 class="display" id="open">One game, three screens</h2>
  <p>No Playdate? The same game plays <a href="/#play">in your browser</a> and <a href="/ios/">on iPhone and iPad</a>, in color. They grew from this one, and all three run the same <a href="/engine/">Kubb Engine</a>.</p>
  <p>The Playdate game is open source. Its code is ${external(PLAYDATE_REPO, "on GitHub")}.</p>
</section>
${signup()}`;
  return page({
    path: "/playdate/",
    title: `Playdate · ${SITE_TITLE}`,
    description:
      "Kubb: Throwing Wood for Playdate. Watch it play, then put the free test build on your Playdate. The crank is your throwing arm.",
    body,
    tinylytics,
    scripts: ["/js/reel.js"],
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
    <p class="lede">A baton clips a corner. One kubb tips into the next. KLAK. The engine is the code that decides where the wood goes.</p>
    <p class="actions">${playNow()}</p>
  </div>
  ${heroScene()}
</section>
<section class="frame" aria-labelledby="one">
  <h2 class="display" id="one">One engine, three games</h2>
  <div class="cards">
    <article class="card">
      <h3 class="card__title">Written once</h3>
      <p>The rules, the physics and the computer player live in one place. Each game adds its own pictures and controls.</p>
    </article>
    <article class="card">
      <h3 class="card__title">Copied exactly</h3>
      <p>Each game carries an exact copy. If one tiny piece is different, the game will not build.</p>
    </article>
    <article class="card">
      <h3 class="card__title">Fixed in one place</h3>
      <p>To change how the game plays, we change the engine. Then every game takes the new version.</p>
    </article>
  </div>
</section>
<section class="frame" aria-labelledby="checks">
  <h2 class="display" id="checks">Checked against real kubb</h2>
  <div class="cards">
    <article class="card">
      <h3 class="card__title">150 tournament games</h3>
      <p>Volunteers scored 150 tournament games by hand, throw by throw. We had the computer play and compared.</p>
      <p>From the 8 meter line, the computer at its best hits a base kubb 33.5% of the time. Real players hit 32.7%. At the king it is 82.8% to 83.8%.</p>
      <p>Taking two field kubbs with one baton is harder. The computer does it 5.7% of the time. Real players do it 16%.</p>
    </article>
    <article class="card">
      <h3 class="card__title">220 moments on video</h3>
      <p>We marked 220 moments in videos of real games, frame by frame. The painted pitch lines worked as a ruler.</p>
      <p>An inkast is a kubb thrown back over to the other side. In 73 inkasts we saw where the kubb landed and where it stopped. That told us how far a kubb rolls on grass.</p>
    </article>
    <article class="card">
      <h3 class="card__title">1,063 physics tests</h3>
      <p>We built the same pieces in MuJoCo, another physics program. Then we ran 1,063 tests with them.</p>
      <p>One test caught a baton sliding too far after a bounce. We fixed its friction. Now it stops closer to where MuJoCo says.</p>
    </article>
  </div>
</section>
<section class="frame prose" aria-labelledby="hashes">
  <h2 class="display" id="hashes">Phone and browser agree</h2>
  <p>A browser and an iPhone can share a pitch. Each works out every throw by itself. Then each turns the whole game into a short code, called a hash. If the two ever disagreed, the codes would not match.</p>
  <p>They match. The web uses WebAssembly, which does math the same way in every browser. The iPhone uses the same math code, built to round numbers the same way.</p>
  <p>We keep ${GOLDEN_COUNT.hashes} hashes from ${GOLDEN_COUNT.matches} test matches. Every change to the engine must match them all.</p>
  <p>We also played three full matches between a browser and an iPhone, on grass, sand and snow. Every throw matched. The Playdate does its math its own way, so it plays alone.</p>
</section>
<section class="frame prose" aria-labelledby="versions">
  <h2 class="display" id="versions">Old matches still work</h2>
  <p>A change that could move a throw gets a new engine version. Each match keeps the version it started on. So do its replay and its reel. That is why last month’s match still plays back just as it happened.</p>
</section>
<section class="frame prose" aria-labelledby="notation">
  <h2 class="display" id="notation">What the scorekeeper writes</h2>
  <p>Planet Kubb Notation writes each throw in a mark or two. A dash is a miss. <code>2F</code> means one baton took two field kubbs. <code>K</code> means the king fell. Read the marks in order and you can follow a whole turn.</p>
  <p>The engine writes the same marks as you play.</p>
</section>
<section class="frame prose" aria-labelledby="open">
  <h2 class="display" id="open">Open source</h2>
  <p>The engine is open source under the MIT license, on GitHub as ${external(ENGINE_REPO, "kubb-engine")}. So are ${external(WEB_REPO, "the web game")}, ${external(IOS_REPO, "the iPhone app")} and ${external(PLAYDATE_REPO, "the Playdate game")}.</p>
</section>
${signup()}`;
  return page({
    path: "/engine/",
    title: `The Kubb Engine · ${SITE_TITLE}`,
    description:
      "One kubb engine for Playdate, the web and iPhone. Tuned on 150 tournament games and video of real throws. A throw lands the same on a phone and in a browser.",
    body,
    tinylytics,
    release: config.release?.text,
    scripts: ["/js/start.js"],
  });
}

// /love/: the Kubb sites Jamie named (2026-11-20), in his order, with his names
// and addresses. Each line is from what the site says about itself.
export const LOVE = [
  {
    name: "USA Kubb",
    url: "https://www.usakubb.org",
    text: "Home of the U.S. National Kubb Championship. They call it the oldest and biggest kubb tournament outside Europe. This game plays its rules.",
  },
  {
    name: "Kubb World Championship",
    url: "https://www.kubbvm.com",
    text: "The world championship, on the island of Gotland in Sweden. Its motto says kubb unites people and creates peace on earth.",
  },
  {
    name: "Minnesota Kubb",
    url: "http://minnesotakubb.com",
    text: "Home of the world’s biggest winter kubb tournament. It has leagues too, and a guide to the game.",
  },
  {
    name: "Planet Kubb",
    url: "https://planetkubb.com",
    text: "Home of Planet Kubb Notation, the way this game writes down every match. Our engine learned from 150 games scored with it.",
  },
  {
    name: "JP's Backyard Games",
    url: "https://www.jpsbackyardgames.com/",
    text: "Lawn games for fun with friends, family and neighbors. Buy or rent a set, or get help making your own.",
  },
];

function love({ tinylytics, config = {} }) {
  const body = `<section class="frame intro">
  <h1 class="display">Kubb Creates Peace and Unites People</h1>
  <p class="lede">Throwing Wood is a game about a game. The real one is played on grass, and even in the snow. Go say hi to the people who keep it going.</p>
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
      "Kubb creates peace and unites people. Visit USA Kubb, the Kubb World Championship, Minnesota Kubb, Planet Kubb and JP's Backyard Games.",
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
