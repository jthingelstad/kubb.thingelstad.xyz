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
// Every other build (local, preview, CI) talks to the dev Worker; `npm run dev` runs
// the server on this machine instead (tools/dev.mjs sets KUBB_PITCH_URL to it).
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

// The iPhone app's public TestFlight link (Jamie, 2026-11-20). /ios/ shows
// JOIN THE TESTFLIGHT pointing here. Cleared to "", /ios/ says the beta is by
// invitation and shows no button (src/site/landing.mjs iosJoin).
export const TESTFLIGHT_URL = "https://testflight.apple.com/join/rTx8uTn1";

// The iPhone app's App Store page, once the app is live: the one switch for the
// store badge (src/site/landing.mjs storeLink). Empty, every page keeps the
// TestFlight wording above. Set, / and /ios/ show Apple's "Download on the App
// Store" badge in its place, from APP_STORE_BADGE (Apple's own artwork, added to
// public/landing/ with the switch; validate:site fails while it is missing).
export const APP_STORE_URL = "";
export const APP_STORE_BADGE = "/landing/app-store-badge.svg";

// The words of /ios/#support, where the App Store listing's support link points:
// the owner's to give (what it says and how to reach him). The one switch for
// support: empty, /ios/ has no Support section and the footer no Support link, so
// nothing on the site points at a section that is not there; set, both appear,
// the words as plain text. This repository is public: no email address here.
export const SUPPORT_TEXT = "";

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
