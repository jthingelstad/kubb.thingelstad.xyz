// The pages function's HTTP handler (docs/ROOMS.md "11. Pitch pages"): CloudFront
// sends /p/<code>, /e/<code> and /og/<code>.png here, rewritten by the viewer
// request function (infra/viewer-request.js) to the static file each one is,
// with the code as ?pitch=. Read only: one or two reads of the room store.
//
//   GET /pitch/index.html?pitch=<code>   the game page with this pitch's preview
//   GET /embed/index.html?pitch=<code>   the embed page, preview and starting state
//   GET /share/kubb.png?pitch=<code>     this pitch's share image (1200 x 630 PNG)
//   GET /health                          200
//
// Never an error page for a pitch: an unknown code, or a room that cannot be read,
// gets the page as the site built it (the site's own title and share image), and
// the image the site's own share image (a 302). Only when the page itself cannot
// be had does it answer 502, and CloudFront then serves the static page.
import { CODE, cardOf, injectPreview, pitchState } from "./pitch.mjs";

const PAGES = {
  "/pitch/index.html": { path: (c) => `/p/${c}`, embed: false },
  "/embed/index.html": { path: (c) => `/e/${c}`, embed: true },
};
const IMAGE = "/share/kubb.png";

// load(code) -> { state, kept, reel } (pitch.mjs readPitch)
// base(file) -> the built page's HTML (throws when it cannot be had)
// render(card) -> PNG bytes
export function createPages({ load, base, render, site, log = () => {} }) {
  const read = async (code) => {
    try {
      return pitchState(await load(code));
    } catch (error) {
      log({ event: "read-failed", error: String(error?.message || error) });
      return null;
    }
  };

  return async function handle(req, res) {
    const url = new URL(req.url, "http://pages.invalid");
    const send = (status, headers, body = "") => {
      res.writeHead(status, headers);
      res.end(req.method === "HEAD" ? undefined : body);
    };
    if (req.method !== "GET" && req.method !== "HEAD")
      return send(405, { allow: "GET, HEAD" });
    if (url.pathname === "/health")
      return send(200, { "content-type": "text/plain" }, "ok\n");
    const raw = url.searchParams.get("pitch") || "";
    const code = CODE.test(raw) ? raw : null;

    const page = PAGES[url.pathname];
    if (page) {
      let html;
      try {
        html = await base(url.pathname);
      } catch (error) {
        log({ event: "base-failed", error: String(error?.message || error) });
        return send(502, { "cache-control": "no-store" });
      }
      const s = code ? await read(code) : null;
      const body =
        code && s
          ? injectPreview(html, {
              code,
              s,
              path: page.path(code),
              embed: page.embed,
            })
          : html;
      // a finished pitch changes only when a rematch starts
      const shared = !s ? 30 : s.state === "over" ? 300 : 60;
      return send(
        200,
        {
          "content-type": "text/html; charset=utf-8",
          "cache-control": `public, max-age=0, s-maxage=${shared}, must-revalidate`,
        },
        body,
      );
    }

    if (url.pathname === IMAGE) {
      const fallback = () =>
        send(302, {
          location: `${site}${IMAGE}`,
          "cache-control": "public, max-age=60, s-maxage=60",
        });
      const s = code ? await read(code) : null;
      const card = s && cardOf(s);
      if (!card) return fallback();
      let png;
      try {
        png = await render(card);
      } catch (error) {
        log({ event: "render-failed", error: String(error?.message || error) });
        return fallback();
      }
      return send(
        200,
        {
          "content-type": "image/png",
          "content-length": String(png.length),
          "cache-control":
            s.state === "over"
              ? "public, max-age=3600, s-maxage=86400"
              : "public, max-age=60, s-maxage=300",
        },
        png,
      );
    }
    return send(404, { "content-type": "text/plain" }, "Not found\n");
  };
}

// The built pages, fetched from the site and kept a minute: a deploy shows here
// within that minute (its hashed assets are never deleted, so a page a minute old
// still loads).
export function siteBase({
  site,
  ttl = 60_000,
  fetchImpl = fetch,
  now = Date.now,
}) {
  const kept = new Map();
  return async (file) => {
    const hit = kept.get(file);
    if (hit && now() - hit.at < ttl) return hit.html;
    const res = await fetchImpl(`${site}${file}`, {
      headers: { "user-agent": "kubb-pages" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`${file}: ${res.status}`);
    const html = await res.text();
    kept.set(file, { html, at: now() });
    return html;
  };
}
