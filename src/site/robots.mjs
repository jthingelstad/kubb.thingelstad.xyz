// robots.txt (written by tools/build.mjs). Jamie, 2026-11-20: "we should block
// robots from crawling the URL's for saved games and replays via robots.txt".
//
// Crawlers stay off every per-match address: a pitch, its saved game and replay
// (/p/<code>), its embed (/e/<code>), its share image (/og/<code>.png), its
// highlight videos (/reels/) and the two shells those are served from (/pitch/,
// /embed/). The reading pages and /practice/ stay open, with the Sitemap.
//
// Link previews must keep working, and some preview fetchers obey robots.txt,
// so they have a group of their own that allows everything. A crawler obeys only
// the most specific group that names it, so that group stands alone. Applebot is
// a search crawler and stays in the general group; iMessage previews are fetched
// by the device and need nothing here.
//
// A known trade, and Jamie's choice: a crawler that may not fetch a page never
// reads its noindex, so a pitch link posted publicly can still be listed by its
// bare address (no title, no text). The pages keep their noindex for the
// preview fetchers that are let in.
export const CRAWL_BLOCKED = [
  "/p/",
  "/e/",
  "/og/",
  "/reels/",
  "/pitch/",
  "/embed/",
];

// Link-preview fetchers, by the user-agent token each sends.
export const PREVIEW_AGENTS = [
  "Twitterbot",
  "facebookexternalhit",
  "Facebot",
  "LinkedInBot",
  "Slackbot",
  "Slackbot-LinkExpanding",
  "Discordbot",
  "TelegramBot",
  "WhatsApp",
];

export function robotsTxt(origin) {
  return `User-agent: *
${CRAWL_BLOCKED.map((path) => `Disallow: ${path}`).join("\n")}
Allow: /

${PREVIEW_AGENTS.map((agent) => `User-agent: ${agent}`).join("\n")}
Allow: /

Sitemap: ${origin}/sitemap.xml
`;
}
