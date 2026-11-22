// The page shells: the reading pages (home, rules, 404) and the game page
// (a full-window canvas and a root for the client's UI).
//
// No inline scripts anywhere: the Content-Security-Policy (src/site/csp.mjs)
// allows none. The game page carries its settings as a JSON data block, which
// is data, not script; small helpers live in public/js/.
import {
  HOST,
  ORIGIN,
  OWNER,
  SITE_NAME,
  TINYLYTICS_SCRIPT,
  TINYLYTICS_SITE,
  NEWSLETTER_URL,
  SUPPORT_TEXT,
  ref,
} from "./site.mjs";

const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export const esc = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

// Analytics: only in the deploy build, only on the production host (checked
// in the browser by public/js/analytics.js), and only once a Tinylytics site
// id is set in src/site/site.mjs.
export function analytics(enabled) {
  if (!enabled || !TINYLYTICS_SITE) return "";
  return `<script src="/js/analytics.js" data-host="${HOST}" data-src="${TINYLYTICS_SCRIPT}" data-site="${esc(TINYLYTICS_SITE)}" defer></script>`;
}

function head({ title, description, path, noindex, image, imageAlt }) {
  const url = `${ORIGIN}${path}`;
  const imageUrl = `${ORIGIN}${image}`;
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex">\n' : ""}<meta name="color-scheme" content="light">
<meta name="theme-color" content="#4f9a3b">
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/shared/tokens.css">
<link rel="stylesheet" href="/style.css">
<link rel="preload" href="/fonts/LondrinaSolid-Black.woff2" as="font" type="font/woff2" crossorigin>
${noindex ? "" : `<link rel="canonical" href="${url}">\n`}<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
${noindex ? "" : `<meta property="og:url" content="${url}">\n`}<meta property="og:image" content="${imageUrl}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(imageAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${imageUrl}">
${OWNER.relMe.map((href) => `<link rel="me" href="${href}">`).join("\n")}`;
}

const SHARE = {
  image: "/share/kubb.png",
  imageAlt:
    "KUBB in cut wood letters over THROWING WOOD, a baton flying at a kubb and the king on green grass",
};

// The site's header and footer (the Throwing Wood 1.0 design's build list,
// "Navigation"): the header names the ways in, the footer the rest, with the
// version. Play is the landing page's own section (the web game's page, /web/,
// was folded into / and answers 301 to /#play). `page` is the page an entry
// opens, for validate:site and aria-current.
export const NAV = [
  { href: "/#play", page: "/", label: "Play" },
  { href: "/ios/", label: "iPhone" },
  { href: "/playdate/", label: "Playdate" },
  { href: "/rules/", label: "How to play" },
];
// Support only once its words are set (SUPPORT_TEXT, src/site/site.mjs): before
// that /ios/ has no #support to point at.
export const footNav = (support = SUPPORT_TEXT) => [
  { href: "/rules/", label: "Rules" },
  { href: "/engine/", label: "The engine" },
  { href: "/love/", label: "Kubb sites we love" },
  { href: NEWSLETTER_URL, label: "Newsletter", external: true },
  ...(support
    ? [{ href: "/ios/#support", page: "/ios/", label: "Support" }]
    : []),
  { href: "/privacy/", label: "Privacy" },
];
// an entry is the current page only when it opens the page itself, not a section
const current = (href, path) => (href === path ? ' aria-current="page"' : "");

// release: the release label ("0.2.0 (0.8.1)": the app's version and the newest engine's,
// src/site/release.js), small at the foot; none in a build without one.
export function footer(release = null, path = "", support = SUPPORT_TEXT) {
  return `<footer class="foot">
  <div class="frame">
    <nav class="foot__nav" aria-label="Throwing Wood"><ul>${footNav(support)
      .map(
        ({ href, label, external }) =>
          `<li><a href="${href}"${external ? ' rel="noopener"' : current(href, path)}>${esc(label)}</a></li>`,
      )
      .join(
        "",
      )}</ul>${release ? `<p class="foot__release" data-release>Version ${esc(release)}</p>` : ""}</nav>
    <p>Made by
      <a class="h-card" href="${OWNER.url}" rel="me author"><img class="u-photo" src="${OWNER.avatar}" alt="" width="28" height="28"><span class="p-name">${esc(OWNER.name)}</span><data class="u-url" value="${OWNER.url}"></data><data class="p-note" value="${esc(OWNER.note)}"></data></a>.
      Throw wood in your browser, on iPhone and iPad, or on <a href="/playdate/">Playdate</a>. Jamie’s other projects are on <a href="${ref("https://thingelstad.xyz/", "footer")}">Things I’ve built</a>.
    </p>
    <p class="foot__small">Playdate is a trademark of Panic Inc. This game is not made by Panic. iPhone and iPad are trademarks of Apple Inc. The display type is Londrina Solid, under the <a href="/fonts/OFL-LondrinaSolid.txt">SIL Open Font License</a>.</p>
  </div>
</footer>`;
}

// A reading page: the landing pages, the web game's page, rules, privacy, 404.
export function page({
  path,
  title,
  description,
  body,
  bodyClass = "",
  noindex = false,
  tinylytics = false,
  scripts = [],
  release = null,
}) {
  return `<!doctype html>
<html lang="en">
<head>
${head({ title, description, path, noindex, ...SHARE })}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""}>
<a class="skip" href="#main">Skip to the page</a>
<header class="rail">
  <div class="frame rail__inner">
    <a class="rail__brand" href="/"${current("/", path)}>Kubb: Throwing Wood</a>
    <nav class="rail__nav" aria-label="Site"><ul>${NAV.map(
      ({ href, label }) =>
        `<li><a href="${href}"${current(href, path)}>${esc(label)}</a></li>`,
    ).join("")}</ul></nav>
  </div>
</header>
<main id="main">
${body}
</main>
${footer(release, path)}
<script type="module" src="/js/throw-mode.js"></script>
${scripts.map((src) => `<script src="${src}" defer></script>`).join("\n")}
${analytics(tinylytics)}
</body>
</html>
`;
}

// The game page: /p/<code> (a pitch; CloudFront serves /pitch/index.html for
// every code) and /practice/. The client fills #pitch and #ui.
export function gamePage({
  path,
  title,
  description,
  config,
  script,
  styles = [],
  noindex = false,
  tinylytics = false,
  bodyClass = "game",
}) {
  // A JSON data block: "<" is escaped so no value can close the element.
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en" class="game-html">
<head>
${head({ title, description, path, noindex, ...SHARE })}
${styles.map((href) => `<link rel="stylesheet" href="${href}">`).join("\n")}
<script type="application/json" id="kubb-config">${json}</script>
<script type="module" src="${script}"></script>
</head>
<body class="${bodyClass}">
<canvas id="pitch" aria-label="The pitch"></canvas>
<div id="ui"></div>
<noscript>
  <div class="noscript">
    <h1 class="display">Kubb needs JavaScript</h1>
    <p>The game runs in your browser: the pitch is drawn by a script and the Kubb is the Playdate game’s own code. Turn JavaScript on for this site to play.</p>
    <p>Meanwhile, <a href="/rules/">read the rules</a> or go <a href="/">back to the start</a>.</p>
  </div>
</noscript>
${analytics(tinylytics)}
</body>
</html>
`;
}
