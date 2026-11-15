// What every page of the site shares. Edit here, never in a page.
import fs from "node:fs";

export const ORIGIN = "https://kubb.thingelstad.xyz";
export const HOST = new URL(ORIGIN).hostname;
export const SITE_NAME = "Kubb: Throwing Wood";
export const SITE_TITLE = "Kubb: Throwing Wood on the web";

// Whether the game client is in place. While false, the home page says the
// game is still being built and a pitch says so too (src/main.js is the
// placeholder). The client's work sets it to true with its first real entry.
export const GAME_READY = false;

// Tinylytics' shared script, keyed by data-site, loaded only by the deploy
// build (KUBB_PRODUCTION=true) and only on the production host. The id is the
// embed id of this site in Tinylytics; null until the site is made there.
export const TINYLYTICS_SCRIPT = "https://tinylytics.app/js/script.js";
export const TINYLYTICS_SITE = null;

// Where the game's rooms are in a local build (tools/rooms-dev.mjs).
export const DEV_ROOMS_URL = "ws://127.0.0.1:8788";

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

export const PLAYDATE_GAME = "https://playdate.thingelstad.xyz/throwing-wood/";
