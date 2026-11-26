// What every page of the site shares. Edit here, never in a page.
import fs from "node:fs";

export const ORIGIN = "https://throwingwood.com";
export const HOST = new URL(ORIGIN).hostname;
export const SITE_NAME = "Kubb: Throwing Wood";
export const SITE_TITLE = "Kubb: Throwing Wood";

// Whether the game client is in place: practice, a match against the
// computer and a pitch shared on a link are playable. While false, the home
// page says the game is still being built.
export const GAME_READY = true;

// Tinylytics' shared script, keyed by data-site, loaded only by the deploy
// build (KUBB_PRODUCTION=true) and only on the production host. The id is the
// embed id of this site in Tinylytics; null until the site is made there.
export const TINYLYTICS_SCRIPT = "https://tinylytics.app/js/script.js";
export const TINYLYTICS_SITE = "gXy1ayRzgXUVfn_G3nvb";

// The pitch server (backend/pitch-server, docs/PITCH-SERVER.md): live play on a link.
// Its production address is the Worker's workers.dev name (the owner, 2026-11-21;
// docs/PITCH-SERVER.md section 11), kept as this one value: the deploy build gives it
// to the page and the CSP allows it (src/site/csp.mjs).
export const PITCH_URL = "wss://throwingwood-pitches.throwingwood.workers.dev";
// The dev Worker: only a build asked for it by name (KUBB_DEV_WORKER=true,
// tools/build.mjs pitchUrl) talks to it; every other non-production build talks to the
// server on this machine (LOCAL_PITCH_URL), which `npm run dev` runs.
export const DEV_PITCH_URL =
  "wss://throwingwood-pitches-dev.throwingwood.workers.dev";
export const LOCAL_PITCH_URL = "ws://127.0.0.1:8797"; // wrangler dev, backend/pitch-server
// The api function (backend/api/API.md): on the site's own origin, where CloudFront
// sends /api/* to it, so the page's `connect-src 'self'` covers it. `npm run dev`'s
// preview hands /api/* to the local stand-in (tools/pitch-dev.mjs).
export const API_URL = "/api";

// The pitch server's https origin, for GET /open: the same host as its socket.
export const httpOrigin = (wsUrl) =>
  wsUrl ? new URL(String(wsUrl).replace(/^ws/, "http")).origin : null;

// A pitch's code: 8 characters from an alphabet with no look-alikes (no i, l,
// o, 0 or 1). The same alphabet is in public/js/start.js and in
// infra/viewer-request.js; tests/site holds the three together.
export const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const CODE_LENGTH = 8;

// owner in thingelstad.com/shared/sites.json, vendored by tools/shared.mjs
// (the h-card every site carries).
const shared = JSON.parse(
  fs.readFileSync(new URL("./sites.json", import.meta.url), "utf8"),
);
export const OWNER = {
  name: shared.owner.name,
  url: shared.owner.url,
  avatar: shared.owner.avatar,
  note: shared.owner.note,
  relMe: shared.owner.rel_me,
};

// Links to Jamie's other sites carry ?ref=kubb-<placement>, so Tinylytics'
// Sources report on the far side shows where a click came from. Identity
// links (the h-card, rel=me) stay clean.
export const ref = (url, placement) =>
  `${url}${url.includes("?") ? "&" : "?"}ref=kubb-${placement}`;

// The other places the game lives (the /ios/ and /playdate/ pages).
export const ENGINE_REPO = "https://github.com/jthingelstad/kubb-engine";
export const WEB_REPO = "https://github.com/jthingelstad/kubb.thingelstad.xyz";
export const IOS_REPO = "https://github.com/jthingelstad/throwingwood-ios";
export const PLAYDATE_REPO = "https://github.com/jthingelstad/playdate-kubb";

// The iPhone app's public TestFlight link (Jamie, 2026-11-20). With the app in
// the App Store it is the second way in: /ios/ has a section for testing new
// versions early, with JOIN THE TESTFLIGHT pointing here (the owner, 2026-11-24:
// "I still want to allow people into the test flight to be part of testing new
// versions but the primary highlight should be the App Store version."). Cleared
// to "", that section goes (src/site/landing.mjs iosBeta).
export const TESTFLIGHT_URL = "https://testflight.apple.com/join/rTx8uTn1";

// The iPhone app's App Store page (live since 2026-11-24, version 1.0.0): the one
// switch for the store badge (src/site/landing.mjs storeLink). Set, / and /ios/
// show Apple's "Download on the App Store" badge, from APP_STORE_BADGE (Apple's
// own artwork, unchanged, in public/landing/). Emptied, every page falls back to
// the TestFlight wording.
export const APP_STORE_URL =
  "https://apps.apple.com/us/app/kubb-throwing-wood/id6836326990";
export const APP_STORE_BADGE = "/landing/app-store-badge.svg";

// Kubb: Pitchside, the iPhone scorekeeper for real games of kubb (the owner,
// 2026-11-26: "lets create throwingwood.com/pitchside as the landing page for
// this app"). Its App Store page is the one switch for its badge
// (src/site/pitchside.mjs pitchsideStore): empty while the app is not in the
// store, so /pitchside/ says only that it is not there yet and shows no badge
// and no button. Set it to the app's store URL once the listing is live, and
// /pitchside/ shows Apple's badge in the hero, as /ios/ does.
export const PITCHSIDE_APP_STORE_URL = "";
export const PITCHSIDE_REPO = "https://github.com/jthingelstad/pitchside";

// The address on /support/ (the owner, 2026-11-22: "Approved: build
// throwingwood.com/support/"), where the App Store listing's Support URL points.
// It is the game's own address (the owner, 2026-11-22: "use
// hello@throwingwood.com"), and the one email address this public repository
// and the built site carry (AGENTS.md "Rules"): written here and nowhere else in the repository,
// and validate:site allows it on the two support pages alone, /support/ and
// /pitchside/support/ (SUPPORT_PAGES).
export const SUPPORT_EMAIL = "hello@throwingwood.com";
export const SUPPORT_PAGES = ["/support/", "/pitchside/support/"];

// The newsletter: a Buttondown list (Jamie, 2026-11-20: "Here is mailing list
// subscribe information for the website. Use the link or modify the embed
// however you wish."). The list's name is the one switch: its page, the form's
// target and the "Powered by Buttondown" referral link all follow from it. The
// form is a plain post that opens Buttondown's own page in the same tab, so
// form-action in src/site/csp.mjs allows NEWSLETTER_ORIGIN and nothing else.
export const NEWSLETTER_LIST = "throwing-wood";
export const NEWSLETTER_ORIGIN = "https://buttondown.com";
export const NEWSLETTER_URL = `${NEWSLETTER_ORIGIN}/${NEWSLETTER_LIST}`;
export const NEWSLETTER_ACTION = `${NEWSLETTER_ORIGIN}/api/emails/embed-subscribe/${NEWSLETTER_LIST}`;
export const NEWSLETTER_REFER = `${NEWSLETTER_ORIGIN}/refer/${NEWSLETTER_LIST}`;
