// Checks the built site (dist/) after npm run build, and the repository's
// Markdown, for what must never ship.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { contentType } from "./delivery-plan.mjs";
import { loadViewerRequest, cloudfrontRequest } from "./preview.mjs";
import { PAGES } from "../src/site/pages.mjs";
import { LOVE, webpSize } from "../src/site/landing.mjs";
import { NAV } from "../src/site/layout.mjs";
import { NEWSLETTER_PAGES } from "../src/site/newsletter.mjs";
import { robotsTxt } from "../src/site/robots.mjs";
import {
  NEWSLETTER_ACTION,
  ORIGIN,
  SUPPORT_EMAIL,
  TESTFLIGHT_URL,
  TINYLYTICS_SITE,
} from "../src/site/site.mjs";

async function walk(dir, skip = () => false) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (skip(name)) continue;
    if (entry.isDirectory()) out.push(...(await walk(name, skip)));
    else out.push(name);
  }
  return out;
}
const files = await walk("dist");
const keys = new Set(
  files.map((f) => path.relative("dist", f).split(path.sep).join("/")),
);
for (const key of keys) assert.ok(contentType(key), `No MIME type for ${key}`);
const read = (name) => fs.readFile(path.join("dist", name), "utf8");

// A local address resolves when CloudFront would serve a built file for it:
// the viewer request function first (so /p/<code> is the game page and /p/
// a redirect to one), then the bucket.
const viewerRequest = await loadViewerRequest();
function resolves(ref, hops = 0) {
  const url = new URL(ref, ORIGIN);
  const result = viewerRequest({ request: cloudfrontRequest(url) });
  if (result.statusCode)
    return (
      hops < 2 &&
      [301, 302].includes(result.statusCode) &&
      resolves(result.headers.location.value, hops + 1)
    );
  return keys.has(result.uri.slice(1));
}

// Analytics only in the deploy build, and only once a site id is set.
const analytics = process.env.KUBB_PRODUCTION === "true" && TINYLYTICS_SITE;
for (const page of PAGES) {
  const html = await read(page.file);
  const count = html.split("tinylytics.app").length - 1;
  const counted = analytics && page.analytics !== false;
  assert.equal(count, counted ? 1 : 0, `tinylytics.app in ${page.file}`);

  // Every local file or route a page names is served.
  for (const [, ref] of html.matchAll(/(?:src|href)="(\/[^"#]*)"/g))
    assert.ok(resolves(ref), `${page.file} names ${ref}, which is not served`);
  // Every image has alt text (empty only when it repeats a link's words).
  for (const [tag] of html.matchAll(/<img\b[^>]*>/g)) {
    assert.match(tag, /\balt="/, `${page.file}: an image without alt`);
    // A picture holds its place: its width and height are the file's own.
    const src = tag.match(/\bsrc="\/([^"]+\.webp)"/)?.[1];
    if (!src) continue;
    const size = webpSize(await fs.readFile(path.join("dist", src)));
    assert.match(
      tag,
      new RegExp(`width="${size.width}" height="${size.height}"`),
      `${page.file}: ${src} size`,
    );
  }
  // External links on reading pages open nothing that can reach back.
  if (!page.game)
    for (const [tag] of html.matchAll(/<a\b[^>]*href="https?:[^"]*"[^>]*>/g))
      if (!/rel="me|class="u-url/.test(tag) && !tag.includes("thingelstad"))
        assert.match(
          tag,
          /rel="noopener"/,
          `${page.file}: ${tag} without noopener`,
        );
  // No inline script: the CSP allows none. A JSON data block is not script.
  for (const [tag] of html.matchAll(/<script\b[^>]*>/g))
    assert.ok(
      /\bsrc="/.test(tag) || /type="application\/json"/.test(tag),
      `${page.file}: inline script ${tag}`,
    );
  for (const tag of ["<title>", 'name="description"', 'property="og:image"'])
    assert.ok(html.includes(tag), `${page.file}: no ${tag}`);
  assert.ok(html.includes('rel="me"'), `${page.file}: no rel=me`);

  if (page.game) {
    assert.match(html, /<canvas id="pitch"/, `${page.file}: canvas#pitch`);
    assert.match(html, /<div id="ui">/, `${page.file}: div#ui`);
    assert.match(html, /<noscript>/, `${page.file}: noscript`);
    const config = JSON.parse(
      html.match(
        /<script type="application\/json" id="kubb-config">(.*?)<\/script>/s,
      )[1],
    );
    for (const key of [
      "version",
      "commit",
      "mode",
      "pitchUrl",
      "apiUrl",
      "wasmUrl",
      "luaUrl",
      "sounds",
    ])
      assert.ok(key in config, `${page.file}: config has no ${key}`);
    assert.ok(keys.has(config.wasmUrl.slice(1)), `${page.file}: wasm`);
    if (config.luaUrl)
      assert.ok(keys.has(config.luaUrl.slice(1)), `${page.file}: Lua`);
  } else {
    // The h-card every site carries, with its explicit url.
    assert.match(html, /class="h-card"[^>]*>.*class="u-url"/s, "h-card url");
  }

  if (page.noindex) {
    assert.match(html, /name="robots" content="noindex"/);
    continue;
  }
  assert.match(
    html,
    new RegExp(`<link rel="canonical" href="${ORIGIN}${page.path}">`),
    `canonical for ${page.path}`,
  );
  const image = html.match(/property="og:image" content="([^"]+)"/)[1];
  assert.ok(keys.has(new URL(image).pathname.slice(1)), `og:image ${image}`);
}

// The site's pages: each served with and without its trailing slash,
// indexed, in llms.txt and in the header every reading page carries. An entry
// that opens a section of a page (Play, /#play) is checked by its page.
const landing = await read("index.html");
for (const { href, page = href } of NAV) {
  assert.ok(resolves(page), `${page} is served`);
  if (page !== "/")
    assert.ok(resolves(page.slice(0, -1)), `${page.slice(0, -1)} redirects`);
  assert.ok(!PAGES.find((p) => p.path === page).noindex, `${page} is indexed`);
  assert.ok(
    (await read("llms.txt")).includes(`${ORIGIN}${page}`),
    `${page} in llms.txt`,
  );
  assert.match(landing, new RegExp(`<a href="${href}"`), `/ links ${href}`);
}
// / is the landing page and, since the 1.0 design, the web game's page too
// (/web/ was folded in and answers 301 to /#play): PLAY NOW in its hero, then
// under #play the three ways to start, watching the computer, settings and the
// open games. It is still a reading page, never the game's own page or its lobby:
// no canvas, no game client.
assert.ok(
  !/<canvas|id="kubb-config"|id="ui"/.test(landing),
  "/ is a reading page, not the game",
);
assert.match(
  landing.slice(0, landing.indexOf("</section>")),
  /<a class="button button--start" href="\/p\/\?solo=1&amp;play=1" data-pitch="\?solo=1&amp;play=1"/,
  "/ plays from its hero: PLAY NOW",
);
assert.equal(
  landing.split("button--start").length - 1,
  1,
  "/ has one go button",
);
const play = landing.slice(landing.indexOf('id="play"'));
for (const mark of [
  'data-pitch=""',
  'data-pitch="?solo=1"',
  'data-pitch="?watch=1"',
  'href="/practice/"',
  'href="/settings/"',
  "data-access",
])
  assert.ok(play.includes(mark), `/#play has ${mark}`);
assert.ok(landing.includes('src="/js/start.js"'), "/ runs start.js");
assert.ok(!keys.has("web/index.html"), "/web/ is no page of its own");
assert.ok(resolves("/web/"), "/web/ redirects to a page");
// /engine/ plays too
assert.match(
  await read("engine/index.html"),
  /<a class="button button--start" href="\/p\/\?solo=1&amp;play=1"/,
  "/engine/ has PLAY NOW",
);
// /ios/ shows a TestFlight button only when there is a link to put on it.
const iosPage = await read("ios/index.html");
assert.equal(
  iosPage.includes('data-test="testflight"'),
  Boolean(TESTFLIGHT_URL),
  "/ios/ TestFlight button",
);
assert.equal(
  iosPage.includes('data-test="testflight-invite"'),
  !TESTFLIGHT_URL,
  "/ios/ by invitation",
);
// /love/: the heading and the five sites, in order, each a noopener link.
const lovePage = await read("love/index.html");
assert.match(
  lovePage,
  /<h1 class="display">Kubb Creates Peace and Unites People<\/h1>/,
);
const named = [
  ...lovePage.matchAll(
    /<h3 class="card__title"><a href="([^"]+)" rel="noopener">([^<]+)<\/a>/g,
  ),
].map((m) => [m[1], m[2].replace("&#39;", "'")]);
assert.deepEqual(
  named,
  LOVE.map((s) => [s.url, s.name]),
  "/love/ lists the five sites",
);
assert.deepEqual(
  LOVE.map((s) => s.url),
  [
    "https://www.usakubb.org",
    "https://www.kubbvm.com",
    "http://minnesotakubb.com",
    "https://planetkubb.com",
    "https://www.jpsbackyardgames.com/",
  ],
);

// The newsletter sign-up: one plain post to Buttondown on each page that carries
// it, none anywhere else, and no form on the site posts to any other place.
for (const page of PAGES) {
  const html = await read(page.file);
  const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(
    (m) => m[0],
  );
  const news = forms.filter((f) => f.includes(`action="${NEWSLETTER_ACTION}"`));
  const carries = NEWSLETTER_PAGES.includes(page.path);
  assert.equal(news.length, carries ? 1 : 0, `${page.file}: newsletter form`);
  for (const form of forms)
    assert.ok(
      form.includes(`action="${NEWSLETTER_ACTION}"`) ||
        !/\baction="(?!\/)/.test(form),
      `${page.file}: a form posts off the site`,
    );
  for (const form of news) {
    assert.match(form, /method="post"/, `${page.file}: newsletter method`);
    assert.doesNotMatch(form, /\btarget=/, `${page.file}: same tab`);
    assert.match(
      form,
      /<input [^>]*id="news-email" type="email" name="email" autocomplete="email" required/,
      `${page.file}: newsletter field`,
    );
    assert.match(form, /<label [^>]*for="news-email"/, `${page.file}: label`);
    assert.match(form, /<button [^>]*type="submit">Sign me up<\/button>/);
  }
}
assert.match(
  await read("privacy/index.html"),
  /<h2 class="display" id="newsletter">/,
  "/privacy/ says where a sign-up goes",
);

// The pitch page is reached at /p/<code>, never at /pitch/ by a link.
assert.ok(resolves("/p/abcdefgh"), "/p/<code> serves the game page");
assert.ok(!resolves("/p/NOT-A-CODE"), "/p/ with a bad code is not a pitch");
// The embed at /e/<code>, and a pitch's share image at /og/<code>.png, whose
// static fallback is the site's own share image.
assert.ok(resolves("/e/abcdefgh"), "/e/<code> serves the embed page");
assert.ok(
  resolves("/og/abcdefgh.png"),
  "/og/<code>.png falls back to the share image",
);
for (const image of ["share/kubb.png", "favicon.png", "apple-touch-icon.png"])
  assert.ok(keys.has(image), `${image} was not built`);

assert.equal(
  await read("robots.txt"),
  robotsTxt(ORIGIN),
  "robots.txt is src/site/robots.mjs",
);
assert.match(
  await read("robots.txt"),
  new RegExp(`^Sitemap: ${ORIGIN}/sitemap\\.xml$`, "m"),
);
const locs = [
  ...(await read("sitemap.xml")).matchAll(/<loc>([^<]+)<\/loc>/g),
].map((m) => m[1]);
assert.deepEqual(
  locs,
  PAGES.filter((p) => !p.noindex).map((p) => `${ORIGIN}${p.path}`),
);
assert.match(
  await read("llms.txt"),
  /^# .+\n\n> .+/,
  "llms.txt opens with a title and a summary",
);

// What must never ship: email addresses and home-directory paths in anything
// published, and the bare AWS account id in the repository's Markdown.
const EMAIL =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
// (/home/web_user is Emscripten's virtual file system in wasmoon's glue, not
// anyone's home.)
const HOME = /\/Users\/[a-z]|\/home\/(?!web_user\b)[a-z]/;
const ACCOUNT = /\b\d{12}\b/;
const TEXT = [".html", ".txt", ".xml", ".css", ".js", ".json", ".map"];
// The one exception: Jamie's public contact address on the support page
// (SUPPORT_EMAIL, src/site/site.mjs), which must be there.
const SUPPORT_FILE = path.join("dist", "support", "index.html");
assert.ok(
  (await fs.readFile(SUPPORT_FILE, "utf8")).includes(
    `href="mailto:${SUPPORT_EMAIL}"`,
  ),
  "/support/ gives the support address",
);
for (const file of files.filter((f) => TEXT.includes(path.extname(f)))) {
  let text = await fs.readFile(file, "utf8");
  if (path.normalize(file) === SUPPORT_FILE)
    text = text.split(SUPPORT_EMAIL).join("");
  const email = text.match(EMAIL);
  assert.ok(!email, `${file}: an email address (${email?.[0]})`);
  assert.ok(!HOME.test(text), `${file}: a home-directory path`);
}
const markdown = (
  await walk(
    ".",
    (name) =>
      /(^|\/)(node_modules|dist|build|vendor|\.git)$/.test(name) ||
      name.endsWith(".DS_Store"),
  )
).filter((f) => f.endsWith(".md"));
for (const file of markdown) {
  const text = await fs.readFile(file, "utf8");
  assert.ok(
    !ACCOUNT.test(text),
    `${file}: an AWS account id (write <account>)`,
  );
  assert.ok(!EMAIL.test(text), `${file}: an email address`);
  assert.ok(!HOME.test(text), `${file}: a home-directory path`);
}
console.log(
  `Site checks passed (${files.length} files, ${markdown.length} Markdown files)`,
);
