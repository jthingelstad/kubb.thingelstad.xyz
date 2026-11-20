// Every page of the site: the path it is served at, the file it is built to,
// and its HTML. The game pages take the build's runtime config and assets.
import { esc, gamePage, page } from "./layout.mjs";
import { heroScene } from "./art.mjs";
import { GAME_READY, SITE_TITLE } from "./site.mjs";
import { LANDING_PAGES } from "./landing.mjs";
import { signup } from "./newsletter.mjs";

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

// The web game's list of open games (public/js/open-games.js asks the rooms
// server for it): only when this build has a rooms server.
function openGames(roomsUrl) {
  if (!roomsUrl) return "";
  return `<section class="frame open-games" aria-labelledby="open-games" data-rooms="${esc(roomsUrl)}" hidden>
  <h2 class="display" id="open-games">Open games</h2>
  <p>These pitches are open to anyone. Join one and pick a side.</p>
  <ul class="open-list" data-open-list></ul>
  <p class="open-status" data-open-status role="status">Looking for open games...</p>
</section>`;
}

// /web/: the web game's home (it was / until 2026-11-20, when / became the
// landing page for the whole game, src/site/landing.mjs). Start a pitch, play or
// watch the computer, practice, and the open games.
function web({ tinylytics, config = {} }) {
  const body = `<section class="hero">
  <div class="frame hero__inner">
    <h1 class="hero__title"><span class="hero__kubb">Kubb</span><span class="hero__band">Throwing Wood</span></h1>
    <p class="lede">Kubb in your browser. Play with friends on one pitch, each on your own screen.</p>
    <div class="actions">
      <a class="button button--start" href="/p/" data-pitch="" data-start>Start a pitch</a>
      <fieldset class="access" data-access hidden>
        <legend class="label">Who can join</legend>
        <label><input type="radio" name="access" value="invite" checked> Invite only, for people with the link</label>
        <label><input type="radio" name="access" value="open"> Open, in the list below for anyone</label>
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
    <li><strong>Start a pitch.</strong> You get a pitch with its own link.</li>
    <li><strong>Send the link.</strong> Friends open it, type a name and pick a team. Up to six can play on each side. The computer plays an empty side. Make your pitch open and it shows up under Open games for anyone.</li>
    <li><strong>Throw wood.</strong> Everyone sees every throw. Knock down their kubbs, then the king.</li>
  </ol>
  <p>No one to play with? Play the computer, or throw batons on the practice pitch. You can also sit back and watch the computer play itself, match after match.</p>
  <p>Every match is recorded, with the names typed. That helps us test the game against real play. It covers matches with friends, against the computer and the computer against itself. Practice is not recorded. Records stay private and are never published.</p>
  <p>The Open games list shows how many are on a pitch and if the match has started. It never shows names. Feedback from the game’s menu is kept privately too. It holds what you typed and the game as it stood, which can include the players’ names.</p>
  <p>Anyone with a finished pitch’s link can make a highlight reel. It is a short video of the best throws, with the team names. Like the replay, it is kept for a year.</p>
  <p>A match against the computer is shared only when you choose, one match at a time. It carries how the match started, with the day and time. It also carries every throw and the name you type for your side. It gets its own link. Anyone with the link can watch it, and it is kept for a year.</p>
</section>
<section class="frame about" aria-labelledby="about">
  <h2 class="display" id="about">The same game</h2>
  <p>This is <a href="/">Kubb: Throwing Wood</a>, Jamie’s kubb game. The rules, the physics and the computer player match the games on <a href="/playdate/">Playdate</a> and <a href="/ios/">iPhone</a>.</p>
  <p>Here you throw with a finger or a mouse. Pull the meter back to the orange mark. Then flick it through and let go on the blue mark.</p>
  <p><a class="more" href="/rules/">How to play and how to throw</a></p>
</section>
${signup()}`;
  return page({
    path: "/web/",
    title: `Play in your browser · ${SITE_TITLE}`,
    description:
      "Play kubb in your browser. Start a pitch, send the link and throw wood with friends. Or play the computer, or practice.",
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
  <p class="lede">Kubb in five short cards, the way a friend explains it on the lawn. The game uses the U.S. National Kubb Championship rules.</p>
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
  <p>You throw with the meter, low on the screen beside the pitch. It can be a clock or a straight track (MENU, Meter). It can sit on the left or the right (MENU, Meter side).</p>
  <ol class="throw-steps">
    <li><strong>Pull back to the orange mark.</strong> On the clock, drag the knob from the bottom up the left side. On the track, drag the knob down. Go at any speed. How far back you go is the power.</li>
    <li><strong>Flick through and let go on the blue mark.</strong> Swing quickly back through the bottom and up, and let go on the blue mark. Where you let go is the arc. A slow flick throws short.</li>
    <li><strong>Or change your mind.</strong> Bring the knob back to the bottom slowly and nothing is thrown.</li>
  </ol>
  <p>Your finger does not have to cover the meter. You can drag outside the clock’s ring, or stroke anywhere low on the screen with the track. For your first few throws, and after a slow one, the meter tells you what to do next. Your last throw’s marks stay on it as faint knobs.</p>
  <table class="controls">
    <caption class="label">Before the throw</caption>
    <tbody>
      <tr><th scope="row">Tap or drag the pitch, or the arrow keys</th><td>Aim. The circle is where the throw should land. A tap puts it there. A drag moves it at half your finger’s speed, so you can see it.</td></tr>
      <tr><th scope="row">ARC, or R and F</th><td>A higher arc drops in steeper. A lower one skids in.</td></tr>
      <tr><th scope="row">TILT, or Q and E</th><td>Tilt leans the baton to steer it through a group. For a kubb it is SPIN, which keeps it steady in the air.</td></tr>
      <tr><th scope="row">SIDE VIEW, or hold Shift</th><td>The camera out over your shoulder, with the arc drawn. Sliding ARC or TILT shows it too.</td></tr>
      <tr><th scope="row">STAND, or A and D, W and S</th><td>Where you stand. Drag the ring along your line or back from it. When there is an advantage line, you can go up to it.</td></tr>
    </tbody>
  </table>
  <table class="controls">
    <caption class="label">In a match</caption>
    <tbody>
      <tr><th scope="row">Touch the kubb</th><td>Raise a kubb. Touch it near the end it should stand on, or drag it up toward that end.</td></tr>
      <tr><th scope="row">AUTO, AUTO ALL</th><td>Let the game raise this kubb, or the rest of this turn’s. MENU, Raising does it for the rest of the game.</td></tr>
      <tr><th scope="row">Drag or tap, then PLACE IT</th><td>Put a punishment kubb in the defenders’ half, clear of the stakes and the king.</td></tr>
      <tr><th scope="row">SKIP, or Space</th><td>Skip to the end of a throw.</td></tr>
      <tr><th scope="row">MENU, SEND FEEDBACK</th><td>Tell us a throw looked wrong, or anything else.</td></tr>
    </tbody>
  </table>
  <p>If you only touch the meter, you get a good throw at the nearest kubb.</p>
</section>`;
  return page({
    path: "/rules/",
    title: `How to play Kubb · ${SITE_TITLE}`,
    description:
      "How to play kubb in five short cards, and how to throw on the web with a finger or a mouse.",
    body,
    tinylytics,
    release: config.release?.text,
  });
}

// The privacy policy (Jamie, 2026-11-18: "appropriately scaled for a hobby
// project where there is no company, it's just me"). The iPhone app's App Store
// listing links here, so it covers both the website and the app. Keep it in step
// with what the game keeps: AGENTS.md "Recorded games", "Reports", "Replays",
// "Analytics", "The site" (the newsletter) and throwingwood-ios
// docs/DISTRIBUTION.md.
function privacy({ tinylytics, config = {} }) {
  const body = `<section class="frame intro">
  <h1 class="display">Privacy</h1>
  <p class="lede">Kubb: Throwing Wood is a hobby project. There is no company behind it, just me, Jamie Thingelstad, making a Kubb game for fun. There are no accounts and no ads, and nothing is ever sold. This page says what the game keeps and why, on this website and in the iPhone app.</p>
</section>
<section class="frame prose" aria-labelledby="yours">
  <h2 class="display" id="yours">What stays with you</h2>
  <p>Your settings, such as sound, haptics and how you throw, stay in your browser or on your phone. So does a random number that lets you rejoin a pitch after a refresh; it is not tied to who you are. Practice stays on your device unless you choose to send feedback from it.</p>
</section>
<section class="frame prose" aria-labelledby="pitch">
  <h2 class="display" id="pitch">Playing a match</h2>
  <p>A match on a pitch runs through the game’s own server. It gets what the match needs: the name you type, your team, your throws, the score, and that random number. Everyone on the pitch sees your name and team. Any name will do, so use a nickname if you like.</p>
  <p>Every match is recorded, names included: matches with friends, against the computer, and the computer playing itself. I keep these records privately and use them to test and improve the game. They are never published or shared.</p>
  <p>When a match ends, its replay is kept for a year, and anyone with the pitch’s link can watch it, names included. An open game’s place in the list on the web game’s page shows only how many are on the pitch and whether the match has started, never names.</p>
  <p>Anyone with a finished pitch’s link can ask for a highlight reel: a short video of the match’s best throws, made on the game’s server from the kept replay. A reel shows the team names, which for a player alone on a side is the name they typed, as the replay does; nothing else typed in the lobby. Reels are stored with the website, anyone with the link can watch or download them, and they are deleted a year after the match. A video downloaded or posted elsewhere is out of my hands.</p>
  <p>A match you play against the computer is shared only if you press SHARE AND MAKE THE REEL on its winner card, and only that match, each time you choose to. What is sent is how the match started (including the day and time it began), every throw, and the name you type on that card for your side; the other side is Computer. Nothing else about you or your device goes with it, and it is not linked to the private record of the same match. A shared match is kept for a year under its own link, like a pitch, and anyone with the link can watch its replay and its reel.</p>
  <p>If you send feedback from the game’s menu, about a throw that looked wrong or anything else, what you type (and any pieces you mark) and the game as it stood are kept privately in the same way, and never published. The game as it stood can include the names of the players in that match.</p>
</section>
<section class="frame prose" aria-labelledby="visits">
  <h2 class="display" id="visits">Visiting the website</h2>
  <p>The website counts visits with Tinylytics, a small, privacy-minded counter. There are no advertising trackers. The iPhone app and embedded replays count nothing.</p>
  <p>The site’s hosting keeps a log of requests without IP addresses, for two years. The game server keeps error logs for 30 days.</p>
</section>
<section class="frame prose" aria-labelledby="newsletter">
  <h2 class="display" id="newsletter">The newsletter</h2>
  <p>You can sign up for news on this site. If you do, your email address goes to Buttondown. Buttondown keeps the list and sends the mail. I use your address only for this newsletter. Every mail has a link to stop it.</p>
  <p>This website keeps nothing about a sign-up and counts nothing about it.</p>
</section>
<section class="frame prose" aria-labelledby="who">
  <h2 class="display" id="who">Who sees it</h2>
  <p>Only me. Everything the game keeps is stored on Amazon Web Services in the United States. The newsletter list is the one thing kept elsewhere, with Buttondown. I don’t sell, rent or trade any of it, and I don’t share it with anyone for advertising or anything else.</p>
  <p>The game doesn’t ask your age or anything about you beyond a name you choose. The newsletter asks only for your email address.</p>
</section>
<section class="frame prose" aria-labelledby="ask">
  <h2 class="display" id="ask">Questions, or taking your name out</h2>
  <p>If you want your name taken out of the records, or have a question, <a href="https://www.thingelstad.com/contact/">get in touch</a>. Send the pitch’s link if you have it, and I’ll remove the records that carry your name.</p>
  <p>If the game starts keeping something new, this page will say so first.</p>
  <p class="foot__small">Last updated 20 November 2026.</p>
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
  ...LANDING_PAGES,
  { path: "/web/", file: "web/index.html", render: web, sources: ["src/site"] },
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
