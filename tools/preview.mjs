// Serve dist/ on http://127.0.0.1:4322/ the way CloudFront does: every
// request goes through infra/viewer-request.js (the same file the
// distribution runs, so /p/<code> serves the game page), a missing file gets
// 404.html with status 404, and pages carry the site's CSP with a local pitch server
// and api (tools/pitch-dev.mjs, `wrangler dev`) and the dev Worker allowed. `/api/*`
// goes on to `api` when given (`npm run dev`'s local api), as CloudFront sends it to
// the api function.
//
//   node tools/preview.mjs        PORT=4400 to move it
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { contentType, cacheControl } from "./delivery-plan.mjs";
import {
  contentSecurityPolicy,
  embedSecurityPolicy,
} from "../src/site/csp.mjs";
import { DEV_PITCH_URL, httpOrigin } from "../src/site/site.mjs";

// The viewer request function, run as CloudFront runs it.
export async function loadViewerRequest() {
  const code = await fs.readFile("infra/viewer-request.js", "utf8");
  return vm.runInNewContext(`${code}\nhandler;`, {});
}

// Node's query string into CloudFront's event shape.
export function cloudfrontRequest(url) {
  const querystring = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    querystring[key] = { value: values[0] };
    if (values.length > 1)
      querystring[key].multiValue = values.map((value) => ({ value }));
  }
  return {
    uri: decodeURIComponent(url.pathname),
    querystring,
    headers: { host: { value: url.host } },
  };
}

// Preview only: any local port, so a test can run its own pitch server and api
// (tools/pitch-dev.mjs on a free port, passed to the page as ?pitchserver= and ?api=).
const CONNECT = [
  "'self'",
  DEV_PITCH_URL,
  httpOrigin(DEV_PITCH_URL),
  "ws://127.0.0.1:*",
  "ws://localhost:*",
  "http://127.0.0.1:*",
  "http://localhost:*",
];
const CSP = contentSecurityPolicy(CONNECT);
// /e/<code> is the one route any site may frame, as on the distribution.
const EMBED_CSP = embedSecurityPolicy(CONNECT);

// page(html, { uri, url }): a test's stand-in for the pages function, which
// writes a pitch's preview and state into /p/ and /e/ (backend/pages).
// /reels/... (highlight reels) come from `reels` (a reel rendered by hand with
// tools/reel/render.mjs can be put there), as CloudFront serves the bucket's reels/.
export async function startPreview({
  port = 4322,
  root = "dist",
  reels = "build/reels-dev",
  page = null,
  api = null,
} = {}) {
  const handler = await loadViewerRequest();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (api && url.pathname.startsWith("/api/")) return proxy(req, res, api);
    const embed = /^\/e\//.test(url.pathname);
    const result = handler({ request: cloudfrontRequest(url) });
    if (result.statusCode) {
      const headers = {};
      for (const [name, { value }] of Object.entries(result.headers || {}))
        headers[name] = value;
      res.writeHead(result.statusCode, headers);
      res.end();
      return;
    }
    const key = path.normalize(result.uri).replace(/^[/\\]+/, "");
    const from = key.startsWith(`reels${path.sep}`) ? reels : root;
    const file = path.join(from, key);
    const headers = {
      "content-security-policy": embed ? EMBED_CSP : CSP,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      ...(embed ? {} : { "x-frame-options": "DENY" }),
    };
    try {
      if (!file.startsWith(`${from}${path.sep}`))
        throw new Error("outside dist");
      let body = await fs.readFile(file);
      if (page && key.endsWith(".html"))
        body = Buffer.from(
          page(body.toString(), {
            uri: result.uri,
            url,
            query: result.querystring,
          }),
        );
      res.writeHead(200, {
        ...headers,
        "content-type":
          (key.endsWith(".mp4") ? "video/mp4" : contentType(key)) ||
          "application/octet-stream",
        "cache-control": cacheControl(key),
      });
      res.end(body);
    } catch {
      res.writeHead(404, {
        ...headers,
        "content-type": contentType("404.html"),
      });
      res.end(await fs.readFile(path.join(root, "404.html")));
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

// /api/* on to the local api (an http://127.0.0.1:<port> origin), as it is.
function proxy(req, res, api) {
  const to = new URL(req.url, api);
  const out = http.request(
    to,
    { method: req.method, headers: { ...req.headers, host: to.host } },
    (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    },
  );
  out.on("error", () => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(
      '{"error":"unavailable","message":"The local api is not running."}',
    );
  });
  req.pipe(out);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4322);
  await startPreview({ port });
  console.log(`http://127.0.0.1:${port}/`);
}
