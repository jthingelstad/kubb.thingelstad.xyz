// Every page of the site: the path it is served at, the file it is built to,
// and its HTML. The game pages take the build's runtime config and assets.
import { esc, gamePage, page } from "./layout.mjs";
import { heroScene } from "./art.mjs";
import { GAME_READY, PLAYDATE_GAME, SITE_TITLE, ref } from "./site.mjs";

// HOW TO PLAY, the Playdate game's six cards (playdate-kubb
// source/core/howtoplay.lua), in sentence case. The sixth card (the score
// sheet and the Playdate's games list) is left out: the web game keeps no
// games list yet.
export const RULES = [
  {
    title: "The pitch",
    text: [
      "Two teams, one at each end of a patch of lawn 8 m long and 5 m wide.",
      "Each team has five kubbs standing on its baseline. The king stands in the middle.",
      "Knock down all of their kubbs, then the king, and you win.",
    ],
  },
  {
    title: "Batons",
    text: [
      "On your turn you get six batons to throw at their kubbs.",
      "Throw them underarm so they turn end over end. One that spins flat like a helicopter doesn’t count.",
      "In the 2-4-6 opening the first turn gets two and the second four.",
    ],
  },
  {
    title: "Throw them back in",
    text: [
      "Every kubb you knock down, they throw back into your half.",
      "You stand them up where they land. Now they’re field kubbs.",
      "If one lands out they throw it again. Out twice, you pick the spot.",
    ],
  },
  {
    title: "Field kubbs first",
    text: [
      "Their field kubbs come first, then the ones on their baseline.",
      "Hit a base kubb too soon and it just gets stood back up.",
      "Leave any standing and next turn they step up and throw from the one nearest the middle.",
    ],
  },
  {
    title: "The king last",
    text: [
      "Once all their kubbs are down, go for the king from your baseline. Knock him over and you win.",
      "Knock the king over too early and you lose. Same if a kubb you throw in knocks him over.",
    ],
  },
];

// Everything the page promises is playable once the game is in place: a
// pitch link with friends, the computer and practice. No notice then.
const BUILDING = GAME_READY
  ? ""
  : `<p class="notice">The game is still being built. Until it is, a pitch only says so.</p>`;

// The home page's list of open games (public/js/open-games.js asks the rooms
// server for it): only when this build has a rooms server.
function openGames(roomsUrl) {
  if (!roomsUrl) return "";
  return `<section class="frame open-games" aria-labelledby="open-games" data-rooms="${esc(roomsUrl)}" hidden>
  <h2 class="display" id="open-games">Open games</h2>
  <p>Pitches whose host made them open. Join one and pick a side.</p>
  <ul class="open-list" data-open-list></ul>
  <p class="open-status" data-open-status role="status">Looking for open games...</p>
</section>`;
}

function home({ tinylytics, config = {} }) {
  const body = `<section class="hero">
  <div class="frame hero__inner">
    <h1 class="hero__title"><span class="hero__kubb">Kubb</span><span class="hero__band">Throwing Wood</span></h1>
    <p class="lede">The lawn game of wooden blocks and batons, in your browser. Friends on one pitch, each on their own screen.</p>
    <div class="actions">
      <a class="button button--start" href="/p/" data-pitch="" data-start>Start a pitch</a>
      <fieldset class="access" data-access hidden>
        <legend class="label">Who can join</legend>
        <label><input type="radio" name="access" value="invite" checked> Invite only: whoever has the link</label>
        <label><input type="radio" name="access" value="open"> Open: listed below so anyone can join</label>
      </fieldset>
      <div class="actions__more">
        <a class="button" href="/p/?solo=1" data-pitch="?solo=1">Play the computer</a>
        <a class="button" href="/p/?watch=1" data-pitch="?watch=1">Watch the computer</a>
        <a class="button" href="/practice/">Practice</a>
      </div>
    </div>
    ${BUILDING}
  </div>
  ${heroScene()}
</section>
${openGames(config.roomsUrl)}
<section class="frame how" aria-labelledby="how">
  <h2 class="display" id="how">How it works</h2>
  <ol class="steps">
    <li><strong>Start a pitch.</strong> You get a pitch of your own at its own link.</li>
    <li><strong>Send the link.</strong> Whoever opens it joins you, types a name and picks a team, up to six a side. An empty side is played by the computer. Make it open and it is listed here under Open games, so anyone can join.</li>
    <li><strong>Throw wood.</strong> Everyone watches every throw. Knock down their kubbs, then the king.</li>
  </ol>
  <p>No one to play with? Play the computer on a pitch of your own, or throw batons on the practice pitch. Or watch the computer play itself, one match after another.</p>
  <p>Every match is recorded, with the names typed, so the game can be tested against real play: matches with friends, against the computer, and the computer against itself. Practice is not. Records are kept privately and not published. An open game’s place in the list shows only how many are on the pitch and whether it has started, never names. A throw that looks wrong can be reported from the game’s menu; a report is kept the same way.</p>
</section>
<section class="frame about" aria-labelledby="about">
  <h2 class="display" id="about">The Playdate game, on the web</h2>
  <p>This is <a href="${ref(PLAYDATE_GAME, "home")}">Kubb: Throwing Wood</a>, Jamie’s Kubb game for the Playdate, running in the browser. The physics, the rules and the computer thrower are the Playdate game’s own code. The throw that the Playdate makes with its crank, you make here by dragging round a dial.</p>
  <p><a class="more" href="/rules/">How Kubb is played, and how to throw</a></p>
</section>`;
  return page({
    path: "/",
    title: SITE_TITLE,
    description:
      "Kubb, the lawn game, in your browser: start a pitch, send the link, and throw wood with your friends. Or play the computer, or practice.",
    body,
    bodyClass: "home",
    tinylytics,
    release: config.release?.text,
    scripts: [
      "/js/start.js",
      ...(config.roomsUrl ? ["/js/open-games.js"] : []),
    ],
  });
}

function rules({ tinylytics, config = {} }) {
  const cards = RULES.map(
    (card, i) => `<li class="card">
    <h3 class="card__title"><span class="card__n">${i + 1}</span> ${esc(card.title)}</h3>
    ${card.text.map((p) => `<p>${esc(p)}</p>`).join("\n    ")}
  </li>`,
  ).join("\n  ");
  const body = `<section class="frame intro">
  <h1 class="display">How to play</h1>
  <p class="lede">Kubb in five short cards, the way a friend explains it on the lawn. The game plays the U.S. National Kubb Championship rules.</p>
</section>
<section class="frame" aria-labelledby="rules">
  <h2 class="display visually-hidden" id="rules">The rules</h2>
  <ol class="cards">
  ${cards}
  </ol>
</section>
<section class="frame prose" aria-labelledby="throw">
  <h2 class="display" id="throw">Throwing on the web</h2>
  ${GAME_READY ? "" : `<p class="notice">The game is still being built; this is how its throw is designed to work.</p>`}
  <p>On the Playdate the crank is your arm on a clock: six o’clock is the arm hanging down. Here the clock is a dial at the lower right of the pitch (lower middle on a phone), and you throw by dragging round it.</p>
  <ol class="throw-steps">
    <li><strong>Press on the dial and wind back.</strong> Drag from the bottom up the left side. The arm follows your finger or the mouse. How far back you go is the power.</li>
    <li><strong>Swing through and let go.</strong> Swing down through the bottom and up the right side, and let go where the baton should leave. Where you let go is the arc. Holding still at the end lets go too.</li>
    <li><strong>Keep it smooth.</strong> A quick, steady flick throws straight. Bring the arm back down to six slowly and nothing is thrown.</li>
  </ol>
  <table class="controls">
    <caption class="label">Before the throw</caption>
    <tbody>
      <tr><th scope="row">Drag the circle on the pitch, or the arrow keys</th><td>Aim: the circle is where the throw should land</td></tr>
      <tr><th scope="row">WALK, then drag on the pitch; or A and D, W and S</th><td>Walk along the line, or back from it</td></tr>
      <tr><th scope="row">The buttons beside the dial, or R and F, Q and E</th><td>Plan the throw: a higher or lower arc, a baton’s tilt or a kubb’s spin</td></tr>
      <tr><th scope="row">Plan view: hold it (or Shift or B), or tap it on a phone</th><td>Take the camera out over your shoulder to see the arc</td></tr>
    </tbody>
  </table>
  <p>Touch nothing but the dial and the throw is a sensible one at the nearest kubb. Wind into the power mark, let go at the release mark, and see what falls.</p>
</section>`;
  return page({
    path: "/rules/",
    title: `How to play Kubb · ${SITE_TITLE}`,
    description:
      "How Kubb is played, in five short cards, and how to throw a baton on the web by dragging round the dial.",
    body,
    tinylytics,
    release: config.release?.text,
  });
}

function engine({ tinylytics, config = {} }) {
  const body = `<section class="hero">
  <div class="frame hero__inner">
    <h1 class="display">The Kubb Engine</h1>
    <p class="lede">A baton clips a corner. The first kubb tips into the next. On Playdate, the web and iPhone, the same Lua code works out where the wood goes and what the throw scores.</p>
  </div>
  ${heroScene()}
</section>
<section class="frame" aria-labelledby="checks">
  <h2 class="display" id="checks">How close to the lawn?</h2>
  <div class="cards">
    <article class="card">
      <h3 class="card__title">150 scored games</h3>
      <p>We compared the computer’s play with 150 games in the Planet Kubb archive. The sheets tell us how often a baton missed, took one kubb or toppled a whole group.</p>
      <p>In the archive, 16% of batons aimed at field kubbs took exactly two. In a 150-game test at the computer’s pro level, 5.7% did. Taking two with one baton is still harder for the computer.</p>
    </article>
    <article class="card">
      <h3 class="card__title">11 videos of real play</h3>
      <p>We marked 220 events in YouTube footage. Most came from five tournament videos with a fixed camera. The painted pitch lines gave us a ruler for the near half of the field.</p>
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
  <h2 class="display" id="hashes">One match on two screens</h2>
  <p>A browser and an iPhone can sit on opposite sides of a pitch. Each plays the action locally, writes down the whole game state and calculates a short fingerprint called a hash. A difference shows up on the very action where the two states part ways.</p>
  <p>The iPhone uses the same maths as the web. Both are checked against 453 saved hashes from 12 reference matches. In three more matches played between the two clients, all 750 actions agreed, from the first throw through the kept replay. Playdate uses the same rules and throw model with its own 32-bit arithmetic.</p>
</section>
<section class="frame prose" aria-labelledby="notation">
  <h2 class="display" id="notation">What the scorekeeper writes</h2>
  <p>Planet Kubb Notation fits a throw into a few characters. A dash is a miss. <code>2F</code> means one baton took two field kubbs. <code>K</code> means the king fell. Read the marks in order and you can follow a turn, baton by baton.</p>
  <p>The engine writes that same notation as a match unfolds. The game can show you its score sheet, and the reader used for the archived games can score it.</p>
</section>`;
  return page({
    path: "/engine/",
    title: `The Kubb Engine · ${SITE_TITLE}`,
    description:
      "How Throwing Wood checks its throws against score sheets, video of real play and a second physics simulator.",
    noindex: true,
    body,
    tinylytics,
    release: config.release?.text,
  });
}

// The privacy policy (Jamie, 2026-11-18: "appropriately scaled for a hobby
// project where there is no company, it's just me"). The iPhone app's App Store
// listing links here, so it covers both the website and the app. Keep it in step
// with what the game keeps: AGENTS.md "Recorded games", "Reports", "Replays",
// "Analytics", and throwingwood-ios docs/DISTRIBUTION.md.
function privacy({ tinylytics, config = {} }) {
  const body = `<section class="frame intro">
  <h1 class="display">Privacy</h1>
  <p class="lede">Kubb: Throwing Wood is a hobby project. There is no company behind it, just me, Jamie Thingelstad, making a Kubb game for fun. There are no accounts and no ads, and nothing is ever sold. This page says what the game keeps and why, on this website and in the iPhone app.</p>
</section>
<section class="frame prose" aria-labelledby="yours">
  <h2 class="display" id="yours">What stays with you</h2>
  <p>Your settings, such as sound, haptics and how you throw, stay in your browser or on your phone. So does a random number that lets you rejoin a pitch after a refresh; it is not tied to who you are. Practice is never sent anywhere.</p>
</section>
<section class="frame prose" aria-labelledby="pitch">
  <h2 class="display" id="pitch">Playing a match</h2>
  <p>A match on a pitch runs through the game’s own server. It gets what the match needs: the name you type, your team, your throws, the score, and that random number. Everyone on the pitch sees your name and team. Any name will do, so use a nickname if you like.</p>
  <p>Every match is recorded, names included: matches with friends, against the computer, and the computer playing itself. I keep these records privately and use them to test and improve the game. They are never published or shared.</p>
  <p>When a match ends, its replay is kept for a year, and anyone with the pitch’s link can watch it, names included. An open game’s place in the list on the home page shows only how many are on the pitch and whether the match has started, never names.</p>
  <p>If you report a throw that looked wrong, what you type and the game as it stood are kept privately in the same way. The game state can include the names of the players in that match.</p>
</section>
<section class="frame prose" aria-labelledby="visits">
  <h2 class="display" id="visits">Visiting the website</h2>
  <p>The website counts visits with Tinylytics, a small, privacy-minded counter. There are no advertising trackers. The iPhone app and embedded replays count nothing.</p>
  <p>The site’s hosting keeps a log of requests without IP addresses, for two years. The game server keeps error logs for 30 days.</p>
</section>
<section class="frame prose" aria-labelledby="who">
  <h2 class="display" id="who">Who sees it</h2>
  <p>Only me. Everything is stored on Amazon Web Services in the United States. I don’t sell, rent or trade it, and I don’t share it with anyone for advertising or anything else.</p>
  <p>The game doesn’t ask your age or anything about you beyond a name you choose.</p>
</section>
<section class="frame prose" aria-labelledby="ask">
  <h2 class="display" id="ask">Questions, or taking your name out</h2>
  <p>If you want your name taken out of the records, or have a question, <a href="https://www.thingelstad.com/contact/">get in touch</a>. Send the pitch’s link if you have it, and I’ll remove the records that carry your name.</p>
  <p>If the game starts keeping something new, this page will say so first.</p>
  <p class="foot__small">Last updated 18 November 2026.</p>
</section>`;
  return page({
    path: "/privacy/",
    title: `Privacy · ${SITE_TITLE}`,
    description:
      "What Kubb: Throwing Wood keeps, on the web and on iPhone, and why. A hobby project by one person: no accounts, no ads, nothing sold.",
    body,
    tinylytics,
    release: config.release?.text,
  });
}

function notFound({ tinylytics, config = {} }) {
  return page({
    path: "/404.html",
    title: `Not found · ${SITE_TITLE}`,
    description: "There is no page at this address.",
    noindex: true,
    body: `<section class="frame intro">
  <h1 class="display">Out of bounds</h1>
  <p class="lede">There is no page at this address.</p>
  <p><a class="button" href="/">Back to the start</a></p>
</section>`,
    tinylytics,
    release: config.release?.text,
  });
}

// The build passes { tinylytics, config, assets }: config is the runtime
// config shared by both game pages, assets the hashed client files.
function game(mode) {
  return ({ tinylytics, config, assets }) =>
    gamePage({
      path: mode === "practice" ? "/practice/" : "/pitch/",
      title:
        mode === "practice"
          ? `Practice · ${SITE_TITLE}`
          : `A pitch · ${SITE_TITLE}`,
      description:
        mode === "practice"
          ? "The practice pitch: throw batons and drill kubbs, no match around it."
          : "A pitch of Kubb: Throwing Wood. Open the link to join the match.",
      config: { ...config, mode },
      script: assets.main,
      styles: ["/game.css", ...(assets.css ? [assets.css] : [])],
      // A pitch is one person's link: never indexed. Practice is a page.
      noindex: mode !== "practice",
      tinylytics,
    });
}

// The embed, /e/<code> (CloudFront serves /embed/index.html for every code; Jamie,
// 2026-11-16: "I would like an embed option that allows me to put a Kubb game
// played as an embed on another website"): the pitch's replay, read only, in
// another site's frame. The only page any site may frame (src/site/csp.mjs), and
// one with no analytics: its viewers are another site's readers.
function embed({ config, assets }) {
  return gamePage({
    path: "/embed/",
    title: `A pitch · ${SITE_TITLE}`,
    description:
      "A match of Kubb: Throwing Wood, played again. Open the link to see the pitch.",
    config: { ...config, mode: "embed" },
    script: assets.main,
    styles: ["/game.css", ...(assets.css ? [assets.css] : [])],
    noindex: true,
    tinylytics: false,
    bodyClass: "game embed",
  });
}

export const PAGES = [
  { path: "/", file: "index.html", render: home, sources: ["src/site"] },
  {
    path: "/engine/",
    file: "engine/index.html",
    render: engine,
    noindex: true,
    sources: ["src/site"],
  },
  {
    path: "/rules/",
    file: "rules/index.html",
    render: rules,
    sources: ["src/site"],
  },
  {
    path: "/practice/",
    file: "practice/index.html",
    render: game("practice"),
    game: true,
    sources: ["src/site", "src"],
  },
  {
    path: "/pitch/",
    file: "pitch/index.html",
    render: game("pitch"),
    game: true,
    noindex: true,
    sources: ["src"],
  },
  {
    path: "/embed/",
    file: "embed/index.html",
    render: embed,
    game: true,
    noindex: true,
    // no analytics in another site's frame
    analytics: false,
    sources: ["src"],
  },
  {
    path: "/privacy/",
    file: "privacy/index.html",
    render: privacy,
    sources: ["src/site"],
  },
  {
    path: "/404.html",
    file: "404.html",
    render: notFound,
    noindex: true,
    sources: ["src/site"],
  },
];
