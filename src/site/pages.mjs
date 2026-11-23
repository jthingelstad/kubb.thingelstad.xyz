// Every page of the site: the path it is served at, the file it is built to,
// and its HTML. The game pages take the build's runtime config and assets.
import { esc, gamePage, page } from "./layout.mjs";
import { GAME_READY, SITE_TITLE, SUPPORT_EMAIL } from "./site.mjs";
import { LANDING_PAGES } from "./landing.mjs";

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

// The web game's page, /web/, was folded into the landing page by the 1.0 design
// (src/site/landing.mjs): its buttons and the open games are on / under #play,
// and /web/ answers 301 to /#play (infra/viewer-request.js).

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
<section class="frame prose" aria-labelledby="kid">
  <h2 class="display" id="kid">A Kid match</h2>
  <p>Pick Kid as the computer and the whole match is gentler, for both sides. It is made for children to have fun with kubb.</p>
  <ul>
    <li>Each side has three base kubbs, not five.</li>
    <li>Throw your kubbs and batons from the Kid line, two metres in front of your own line. A cone marks each end. The king shot is still from your own line.</li>
    <li>Knock the king down too early and he is stood back up. Nobody loses for it, and the turn goes on.</li>
    <li>A kubb thrown out twice is stood up for you. There are no punishment kubbs.</li>
    <li>A baton that spins flat still counts.</li>
    <li>The meter is wider, so more throws go where you aim.</li>
  </ul>
</section>
<section class="frame prose" aria-labelledby="throw">
  <h2 class="display" id="throw">Throwing on the web</h2>
  ${GAME_READY ? "" : `<p class="notice">The game is still being built; this is how its throw is designed to work.</p>`}
  <p>You throw with the meter, low on the screen beside the pitch. It can be a clock or a straight track (Settings, Meter). It can sit on the left or the right (Settings, Meter side).</p>
  <ol class="throw-steps">
    <li><strong>Pull back to the stripes.</strong> On the clock, drag the knob from the bottom up the left side. On the track, drag the knob down. Go at any speed. How far back you go is the power.</li>
    <li><strong>Flick through and let go on the solid mark.</strong> Swing quickly back through the bottom and up, and let go on the solid mark. Where you let go is the arc. A slow flick throws short.</li>
    <li><strong>Or change your mind.</strong> Bring the knob back to the bottom slowly and nothing is thrown.</li>
  </ol>
  <p>Your finger does not have to cover the meter. You can drag outside the clock’s ring, or stroke anywhere low on the screen with the track. For your first few throws, and after a slow one, the meter tells you what to do next. Your last throw’s marks stay on it as faint knobs.</p>
  <table class="controls">
    <caption class="label">Before the throw</caption>
    <tbody>
      <tr><th scope="row">Tap or drag the pitch, or the arrow keys</th><td>Aim. The circle is where the throw should land. A tap puts it there. A drag moves it at half your finger’s speed, so you can see it.</td></tr>
      <tr><th scope="row">ARC, or R and F</th><td>A higher arc drops in steeper. A lower arc drives in harder: close to a kubb ARC goes down into DRIVE, where the baton leaves your hand low and hard and does not flip.</td></tr>
      <tr><th scope="row">TILT, or Q and E</th><td>Tilt leans the baton to steer it through a group. For a kubb it is SPIN, which keeps it steady in the air.</td></tr>
      <tr><th scope="row">ARC open, or hold Shift</th><td>The side view: the camera out over your shoulder, with the arc drawn. Sliding TILT shows it too.</td></tr>
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
      <tr><th scope="row">MENU, FEEDBACK</th><td>Tell us a throw looked wrong, or anything else.</td></tr>
    </tbody>
  </table>
  <p>Or just throw: the circle starts on a good target.</p>
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
  <p>Every name in the game is made by the game from its own lists of words, such as Mighty Maple or The Lumberjacks. You pick your name from those words; you never type one, so a name says nothing about who you are. The game picks one for you the first time you play, and you can change it whenever you like.</p>
  <p>A match on a pitch runs through the game’s own server. It gets what the match needs: your name, your team, your throws, the score, and that random number. Everyone on the pitch sees your name and team. The server takes only names the game made: any other name, such as one typed into an older test build of the iPhone app, is not passed on, and that player is shown as Player 1, Player 2 and so on. Live online play passes through Cloudflare on its way between players.</p>
  <p>Matches are recorded to help make the game better. A record holds the throws and the players’ names. I keep records privately. They are never published or shared. Practice is not recorded.</p>
  <p>When a match ends, its replay is kept for a year, and anyone with the pitch’s link can watch it, names included. An open game’s place in the list on the home page shows only how many are on the pitch and whether the match has started, never names.</p>
  <p>Anyone with a finished pitch’s link can ask for a highlight reel: a short video of the match’s best throws, made on the game’s server from the kept replay. A reel shows the team names, which for a player alone on a side is that player’s name, as the replay does. Reels are stored with the website, anyone with the link can watch or download them, and they are deleted a year after the match. A video downloaded or posted elsewhere is out of my hands.</p>
  <p>A match you play against the computer is shared only if you press SHARE AND MAKE THE REEL on its winner card, and only that match, each time you choose to. What is sent is how the match started (including the day and time it began), every throw, and the name you pick on that card for your side; the other side is Computer. Nothing else about you or your device goes with it, and it is not linked to any private record of the match. A shared match is kept for a year under its own link, like a pitch, and anyone with the link can watch its replay and its reel.</p>
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
  <p>The game doesn’t ask your age or anything about you. Your name is one you pick from the game’s words. The newsletter asks only for your email address.</p>
</section>
<section class="frame prose" aria-labelledby="ask">
  <h2 class="display" id="ask">Questions, or taking a match out</h2>
  <p>If you want a match taken out of the records, or have a question, <a href="https://www.thingelstad.com/contact/">get in touch</a>. Send the pitch’s link if you have it, and I’ll remove its records.</p>
  <p>If the game starts keeping something new, this page will say so first.</p>
  <p class="foot__small">Last updated 21 November 2026.</p>
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

// The support page (the owner, 2026-11-22: "Approved: build
// throwingwood.com/support/"): the App Store listing's Support URL, the footer's
// Support link and where /ios/#support points. The site's one support text, and
// the one page with an address on it (SUPPORT_EMAIL). Each answer is held to the
// game and to the privacy page; when one of them changes, change it here too:
// - MENU, FEEDBACK opens the "Send feedback" card in a match and in practice, on
//   the web (src/ui/menu.js, AGENTS.md "Reports") and in the iPhone app
//   (throwingwood-ios MatchCards.swift MenuGrid and PracticeMenu, ThrowReport.swift).
//   A report has no contact field (src/net/report.js), so nothing can be answered.
// - Start a pitch and SHARE THE LINK are the web's words (src/site/landing.mjs,
//   src/ui/lobby.js); PLAY ONLINE, START A PITCH and SHARE the iPhone's
//   (MatchCards.swift, OnlineCards.swift). The app and the web share a match only
//   on the same engine (docs/ENGINES.md), hence "up to date".
// - Names: AGENTS.md "Names". HOW TO THROW is in MENU on both.
// - What is kept says no more than /privacy/ does ("Playing a match", "Questions,
//   or taking a match out").
// Nothing here names the App Store: the app is not there yet.
function support({ tinylytics, config = {} }) {
  const mail = `<a href="mailto:${esc(SUPPORT_EMAIL)}">${esc(SUPPORT_EMAIL)}</a>`;
  const body = `<section class="frame intro">
  <h1 class="display">Support</h1>
  <p class="lede">Kubb: Throwing Wood is made by one person, Jamie Thingelstad, in his spare time. If something in the game is wobbly, or you have an idea, he wants to hear it.</p>
</section>
<section class="frame prose" aria-labelledby="reach">
  <h2 class="display" id="reach">Reach Jamie</h2>
  <p>In the game, open MENU and pick FEEDBACK. That opens Send feedback. Say a throw looked wrong, or anything else. It is there in a match and in practice, in the iPhone app and on the web.</p>
  <p>Feedback sent from the game has no return address, so Jamie can’t write back. For a question, email him at ${mail}.</p>
</section>
<section class="frame prose" aria-labelledby="answers">
  <h2 class="display" id="answers">Quick answers</h2>
  <h3>Do I need an account?</h3>
  <p>No. There are no accounts and nothing to sign in to. Just throw.</p>
  <h3>How do I play a friend?</h3>
  <p>Start a pitch and send its link. On the web, press Start a pitch on the <a href="/#play">home page</a>, then SHARE THE LINK. In the iPhone app, tap PLAY ONLINE, then START A PITCH, then SHARE. Your friend opens the link and picks a side. The iPhone app and the web can share one match, as long as the app is up to date.</p>
  <h3>Can I change my name?</h3>
  <p>Yes, in Settings. The game makes every name from its own words, like Mighty Maple. You pick one. You never type one.</p>
  <h3>Where are the rules?</h3>
  <p>On <a href="/rules/">How to play</a>: kubb in five short cards. Stuck on the throw? MENU has HOW TO THROW.</p>
  <h3>What does the game keep?</h3>
  <p>Matches are recorded to help make the game better. Practice is not. Jamie keeps the records to himself. When a match on a pitch ends, anyone with its link can watch the replay for a year. Want a match taken out? Email Jamie the pitch’s link and he will remove its records. The <a href="/privacy/">privacy page</a> has the rest.</p>
</section>
<section class="frame prose" aria-labelledby="more">
  <h2 class="display" id="more">More</h2>
  <ul>
    <li><a href="/rules/">How to play</a>: the rules of kubb, and how to throw.</li>
    <li><a href="/privacy/">Privacy</a>: what the game keeps and who sees it.</li>
    <li><a href="/ios/">iPhone and iPad</a>: the app.</li>
  </ul>
</section>`;
  return page({
    path: "/support/",
    title: `Support · ${SITE_TITLE}`,
    description:
      "How to reach Jamie Thingelstad, who makes Kubb: Throwing Wood, and quick answers about playing on the web and on iPhone.",
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
const GAME_PAGES = {
  practice: {
    path: "/practice/",
    title: `Practice · ${SITE_TITLE}`,
    description:
      "The practice pitch: throw batons and drill kubbs, no match around it.",
  },
  pitch: {
    path: "/pitch/",
    title: `A pitch · ${SITE_TITLE}`,
    description:
      "A pitch of Kubb: Throwing Wood. Open the link to join the match.",
  },
  // the device's settings (src/ui/settings.js), the same rows as the game's MENU
  settings: {
    path: "/settings/",
    title: `Settings · ${SITE_TITLE}`,
    description: "Your name, the meter and the sound, kept in this browser.",
  },
};

function game(mode) {
  const { path, title, description } = GAME_PAGES[mode];
  return ({ tinylytics, config, assets }) =>
    gamePage({
      path,
      title,
      description,
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
    path: "/settings/",
    file: "settings/index.html",
    render: game("settings"),
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
    path: "/support/",
    file: "support/index.html",
    render: support,
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
