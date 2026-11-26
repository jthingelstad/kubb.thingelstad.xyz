// Kubb: Pitchside, the iPhone scorekeeper for real games of kubb (the owner,
// 2026-11-26: "lets create throwingwood.com/pitchside as the landing page for
// this app"): /pitchside/, and the two pages its App Store record names,
// /pitchside/support/ and /pitchside/privacy/.
//
// Every claim is from Pitchside's own repository (../pitchside, read only from
// here): its README.md and AGENTS.md sections 1 to 3 and 7 for what it does, and
// its code for what it keeps. Say only what its main branch does; when it gains
// something, add it here after it ships, never before.
// - Scoring: README.md (tap the kubbs that fell, record a miss, pinch to zoom
//   into a drilled group, Undo and redo, tap a turn to correct a throw, Add turn
//   note), AGENTS.md section 7 (the record rows, the roster, teams of 1 to 6).
//   How kubbs lay is a row marked Later in its New game (NewGameFlow), so it is
//   not named here.
// - After the game: README.md (the Planet Kubb Notation file, the Score sheet
//   PDF, Play by play, player stats, "Print a Throwing Wood game").
// - What it keeps (the privacy page): Pitchside has no network code at all (no
//   URLSession or any other, no analytics, no entitlements); games and the roster
//   are files in the app's own folder (PitchsideKit GameStore.standard(),
//   Application Support/Pitchside: games/ and roster.json); a file leaves the
//   phone only through the share sheet (ScoreSheetView ShareLink, the PDF
//   preview's Share) and comes in only through Games, Open file (HomeView
//   fileImporter). "Delete this game" (HomeView) and "Forget this name"
//   (RosterView) are the app's own words.
//
// The store link is one switch, PITCHSIDE_APP_STORE_URL in src/site/site.mjs:
// empty, the hero says the app is not in the App Store yet and shows no badge and
// no button; set, Apple's badge (the same artwork as /ios/'s) takes that place.
// The pages announce nothing else: no date, no promise.
//
// The pictures are the app's own build captures (pitchside docs/design/build-shots)
// as WebP in public/landing/, iPhone captures at half size. img() reads each one's
// size from the file, so a new capture is a new file of the same name.
import { esc, page } from "./layout.mjs";
import { img } from "./landing.mjs";
import {
  APP_STORE_BADGE,
  PITCHSIDE_APP_STORE_URL,
  PITCHSIDE_REPO,
  SITE_TITLE,
  SUPPORT_EMAIL,
} from "./site.mjs";

export const PITCHSIDE_NAME = "Kubb: Pitchside";
export const PITCHSIDE_SHARE = {
  image: "/share/pitchside.png",
  imageAlt:
    "KUBB in cut wood letters over PITCHSIDE, a tally of five in ink, and a kubb knocked flat beside the king on green grass",
};

const external = (href, text) =>
  `<a href="${esc(href)}" rel="noopener">${text}</a>`;

// The hero's way in: Apple's badge once the app is in the store, until then a
// plain line that says it is not, with no button.
export function pitchsideStore(url = PITCHSIDE_APP_STORE_URL) {
  if (url)
    return `<p class="actions"><a class="store-badge" href="${esc(url)}" rel="noopener" data-test="pitchside-app-store"><img src="${APP_STORE_BADGE}" width="144" height="48" alt="Download on the App Store"></a></p>
<p class="actions__note">For iPhone.</p>`;
  return `<p class="notice" data-test="pitchside-not-yet">Not in the App Store yet.</p>
<p class="actions__note">It is an iPhone app. Until it is in the store, a pencil still works.</p>`;
}

function pitchside({ tinylytics, config = {} }) {
  const body = `<section class="hero">
  <div class="frame hero__inner hero__split">
    <div class="hero__text">
      <h1 class="display">Kubb: Pitchside</h1>
      <p class="lede">Keep score of a real game of kubb on your iPhone. Stand at the edge of the pitch, tap the kubbs that fell, and get back to throwing wood.</p>
      ${pitchsideStore()}
    </div>
    <figure class="hero__shot">
      ${img("pitchside-scorer", "Pitchside on its side. The pitch from above is on the left, with the kubbs that stand and the king. On the right are the turns so far, and Turn 5 with a big 1 down button.", { eager: true })}
    </figure>
  </div>
</section>
<section class="frame feel" aria-labelledby="score">
  <h2 class="display" id="score">Score it as it happens</h2>
  <ol class="feel__steps">
    <li><span class="feel__n" aria-hidden="true">1</span><p><strong>Tap the kubbs that fell.</strong> The pitch is on the screen. Tap a kubb right where it stood. A miss is one tap too.</p></li>
    <li><span class="feel__n" aria-hidden="true">2</span><p><strong>It knows the rules.</strong> It knows whose turn it is, how many batons are left and when the inkast is done.</p></li>
    <li><span class="feel__n" aria-hidden="true">3</span><p><strong>Fix it later.</strong> Undo a tap. Tap an old turn to change a throw.</p></li>
  </ol>
  <p>One hand for the batons, one thumb for the score. A drilled group of kubbs? Pinch to zoom in and tap the one that fell.</p>
</section>
<section class="band band--wood" aria-labelledby="after">
  <div class="frame">
    <h2 class="display" id="after">When the king falls</h2>
    <div class="phones phones--three">
      ${img("pitchside-sheet", "The score sheet: Mossy Stakes beat Crooked Crowns, king down in turn 7, with every turn on its own line.", { cls: "shot shot--tall" })}
      ${img("pitchside-replay", "Play by play: turn 2 on the pitch from above, with a cross on the field kubb that fell. Cy, 1 field down. Previous and Next.", { cls: "shot shot--tall" })}
      ${img("pitchside-stats", "Game stats: hit percent, first baton efficiency and Zero B at T number for both teams, as bars.", { cls: "shot shot--tall" })}
    </div>
    <ul class="features">
      <li><h3>The score sheet</h3><p>Every game is written down in Planet Kubb Notation, a plain text file anyone can read. Make a score sheet PDF to print or save.</p></li>
      <li><h3>Play by play</h3><p>Step back through the game on the pitch, throw by throw. Go forward or back, or jump to a turn.</p></li>
      <li><h3>Stats</h3><p>Hit rate, the first baton, rethrows and more, the way the Planet Kubb score sheet counts them. For each game and for each player.</p></li>
    </ul>
  </div>
</section>
<section class="frame" aria-labelledby="more">
  <h2 class="display" id="more">Also in the bag</h2>
  <ul class="features">
    <li><h3>Your players</h3><p>Save the names of the people you play with. Make teams of one to six, in throwing order.</p></li>
    <li><h3>As much as you like</h3><p>Score just the turn. Or add who threw, where the kubbs stand and where each baton was thrown from. Turn any of it on or off between turns.</p></li>
    <li><h3>Notes on a turn</h3><p>Big inkast? Wild king shot? Add a note to the turn.</p></li>
    <li><h3>Throwing Wood games too</h3><p>Save a score sheet in Throwing Wood. Open it in Pitchside to print it or watch it play by play.</p></li>
  </ul>
</section>
<section class="band band--baton" aria-label="Support and privacy">
  <div class="frame help">
    <div class="help__one" id="support">
      <h2 class="display">Support</h2>
      <p>Stuck, or have an idea? The support page says how to reach Jamie.</p>
      <p><a class="more" href="/pitchside/support/">Pitchside support</a></p>
    </div>
    <div class="help__one" id="privacy">
      <h2 class="display">Privacy</h2>
      <p>No account. Nothing is sent to us. Your games and names stay on your phone until you share a file.</p>
      <p><a class="more" href="/pitchside/privacy/">Pitchside privacy</a></p>
    </div>
  </div>
</section>
<section class="frame prose" aria-labelledby="real">
  <h2 class="display" id="real">The game and the real thing</h2>
  <p><a href="/">Kubb: Throwing Wood</a> is the game. Pitchside is for the real thing, on grass, with wood you can drop on your toe. Both run the same <a href="/engine/">Kubb Engine</a> and play by the same <a href="/rules/">rules</a>.</p>
  <p>Kubb unites people and creates peace on earth. Somebody still has to keep score.</p>
  <p>Pitchside is open source under the MIT license. Its code is ${external(PITCHSIDE_REPO, "on GitHub")}.</p>
</section>`;
  return page({
    path: "/pitchside/",
    title: `${PITCHSIDE_NAME} · ${SITE_TITLE}`,
    description:
      "Kubb: Pitchside keeps score of real kubb on your iPhone. Tap the kubbs that fell. Get a Planet Kubb score sheet, play by play and stats. No account.",
    body,
    tinylytics,
    release: config.release?.text,
    share: PITCHSIDE_SHARE,
  });
}

// /pitchside/support/: the App Store record's Support URL. Modelled on /support/:
// who makes it and how to reach him, then a few quick answers, each held to the
// app (the sources above) and, for what is kept, to /pitchside/privacy/. Pitchside
// has no feedback button and sends nothing, so email is the one way in.
function support({ tinylytics, config = {} }) {
  const mail = `<a href="mailto:${esc(SUPPORT_EMAIL)}">${esc(SUPPORT_EMAIL)}</a>`;
  const body = `<section class="frame intro">
  <h1 class="display">Pitchside support</h1>
  <p class="lede">Kubb: Pitchside is made by one person, Jamie Thingelstad, in his spare time. If something is wobbly, or you have an idea, he wants to hear it.</p>
</section>
<section class="frame prose" aria-labelledby="reach">
  <h2 class="display" id="reach">Reach Jamie</h2>
  <p>Email him at ${mail}. Say what you tapped and what you saw. If a game looks wrong, share its .txt file from the score sheet and send it along.</p>
</section>
<section class="frame prose" aria-labelledby="answers">
  <h2 class="display" id="answers">Quick answers</h2>
  <h3>Do I need an account?</h3>
  <p>No. There is nothing to sign in to, and it works with no signal at all.</p>
  <h3>I tapped the wrong kubb.</h3>
  <p>Tap Undo. Spotted it later? Tap that turn on the score sheet and change the throw.</p>
  <h3>How do I print a game?</h3>
  <p>Open the game’s score sheet and tap Score sheet PDF. Then use Share, then Print, or Save to Files.</p>
  <h3>Can I open a game from Throwing Wood?</h3>
  <p>Yes. In Throwing Wood, open the score sheet and tap Save on iPhone, or Download on the web. In Pitchside, go to Games, then Open file, and pick that file.</p>
  <h3>Where are my games kept?</h3>
  <p>On your phone, in Pitchside. A game leaves it only when you share a file. The <a href="/pitchside/privacy/">privacy page</a> has the rest.</p>
</section>
<section class="frame prose" aria-labelledby="links">
  <h2 class="display" id="links">More</h2>
  <ul>
    <li><a href="/pitchside/">Kubb: Pitchside</a>: what the app does.</li>
    <li><a href="/pitchside/privacy/">Pitchside privacy</a>: what the app keeps.</li>
    <li><a href="/rules/">How to play</a>: the rules of kubb.</li>
  </ul>
</section>`;
  return page({
    path: "/pitchside/support/",
    title: `Support · ${PITCHSIDE_NAME}`,
    description:
      "How to reach Jamie Thingelstad, who makes Kubb: Pitchside, and quick answers about scoring real kubb on iPhone.",
    body,
    tinylytics,
    release: config.release?.text,
    share: PITCHSIDE_SHARE,
  });
}

// /pitchside/privacy/: the App Store record's Privacy Policy URL. What the app
// does, from its code (the sources above), and no more. The website is its own
// thing with its own page, /privacy/: this page says so and does not mix them.
function privacy({ tinylytics, config = {} }) {
  const body = `<section class="frame intro">
  <h1 class="display">Pitchside privacy</h1>
  <p class="lede">Kubb: Pitchside is a hobby project. There is no company behind it, just me, Jamie Thingelstad. This page is about the Pitchside app on your iPhone. The short of it: the app sends nothing to anyone.</p>
</section>
<section class="frame prose" aria-labelledby="sent">
  <h2 class="display" id="sent">What the app sends</h2>
  <p>Nothing. Pitchside does not use the internet. There is no account, no sign-in, no ads, no analytics and no tracking. It never talks to my servers or anyone else’s.</p>
</section>
<section class="frame prose" aria-labelledby="kept">
  <h2 class="display" id="kept">What stays on your phone</h2>
  <p>Your games, the names in your roster and the notes you add are kept on your iPhone, in Pitchside’s own folder. I never see them. Like everything else on your phone, they go into your phone’s backups if you make them.</p>
  <p>Delete a game with Delete this game, or a name with Forget this name. Deleting the app deletes all of it.</p>
</section>
<section class="frame prose" aria-labelledby="share">
  <h2 class="display" id="share">When you share a file</h2>
  <p>A game leaves your phone only when you share it: its .txt file or its score sheet PDF. The file holds the names you typed for that game. It goes where you send it, and after that it is out of my hands.</p>
  <p>When you open a file with Open file, Pitchside reads that one file and keeps the game on your phone.</p>
</section>
<section class="frame prose" aria-labelledby="site">
  <h2 class="display" id="site">This website</h2>
  <p>This website, throwingwood.com, is not the app. It counts visits, and it has its own <a href="/privacy/">privacy page</a>.</p>
</section>
<section class="frame prose" aria-labelledby="ask">
  <h2 class="display" id="ask">Questions</h2>
  <p>The <a href="/pitchside/support/">support page</a> says how to reach me.</p>
  <p>If Pitchside ever starts sending or keeping something new, this page will say so first.</p>
  <p class="foot__small">Last updated 26 November 2026.</p>
</section>`;
  return page({
    path: "/pitchside/privacy/",
    title: `Privacy · ${PITCHSIDE_NAME}`,
    description:
      "Kubb: Pitchside sends nothing to anyone. No account, no analytics. Games and names stay on your iPhone until you share a file.",
    body,
    tinylytics,
    release: config.release?.text,
    share: PITCHSIDE_SHARE,
  });
}

export const PITCHSIDE_PAGES = [
  {
    path: "/pitchside/",
    file: "pitchside/index.html",
    render: pitchside,
    sources: ["src/site"],
  },
  {
    path: "/pitchside/support/",
    file: "pitchside/support/index.html",
    render: support,
    sources: ["src/site"],
  },
  {
    path: "/pitchside/privacy/",
    file: "pitchside/privacy/index.html",
    render: privacy,
    sources: ["src/site"],
  },
];
