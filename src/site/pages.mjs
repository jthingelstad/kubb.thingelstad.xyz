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
    scripts: [
      "/js/start.js",
      ...(config.roomsUrl ? ["/js/open-games.js"] : []),
    ],
  });
}

function rules({ tinylytics }) {
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
      <tr><th scope="row">Drag the thrower, or A and D, W and S</th><td>Walk along the line, or back from it</td></tr>
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
  });
}

function notFound({ tinylytics }) {
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

export const PAGES = [
  { path: "/", file: "index.html", render: home, sources: ["src/site"] },
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
    path: "/404.html",
    file: "404.html",
    render: notFound,
    noindex: true,
    sources: ["src/site"],
  },
];
