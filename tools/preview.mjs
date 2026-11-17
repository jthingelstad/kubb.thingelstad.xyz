// Serve dist/ on http://127.0.0.1:4322/ the way CloudFront does: every
// request goes through infra/viewer-request.js (the same file the
// distribution runs, so /p/<code> serves the game page), a missing file gets
// 404.html with status 404, and pages carry the site's CSP with the local
// rooms server (tools/rooms-dev.mjs) allowed.
//
//   node tools/preview.mjs        PORT=4400 to move it
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { mime, cacheControl } from "./delivery-plan.mjs";
import {
  contentSecurityPolicy,
  embedSecurityPolicy,
} from "../src/site/csp.mjs";
import { DEV_ROOMS_URL } from "../src/site/site.mjs";

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

// Preview only: any local port, so a test can run its own room server
// (tools/rooms-dev.mjs on a free port, passed to the page as ?rooms=).
const CONNECT = [
  "'self'",
  DEV_ROOMS_URL,
  "ws://localhost:8788",
  "ws://127.0.0.1:*",
  "ws://localhost:*",
];
const CSP = contentSecurityPolicy(CONNECT);
// /e/<code> is the one route any site may frame, as on the distribution.
const EMBED_CSP = embedSecurityPolicy(CONNECT);

// page(html, { uri, url }): a test's stand-in for the pages function, which
// writes a pitch's preview and state into /p/ and /e/ (backend/pages).
export async function startPreview({
  port = 4322,
  root = "dist",
  page = null,
} = {}) {
  const handler = await loadViewerRequest();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
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
    const file = path.join(root, key);
    const headers = {
      "content-security-policy": embed ? EMBED_CSP : CSP,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      ...(embed ? {} : { "x-frame-options": "DENY" }),
    };
    try {
      if (!file.startsWith(`${root}${path.sep}`))
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
        "content-type": mime[path.extname(file)] || "application/octet-stream",
        "cache-control": cacheControl(key),
      });
      res.end(body);
    } catch {
      res.writeHead(404, { ...headers, "content-type": mime[".html"] });
      res.end(await fs.readFile(path.join(root, "404.html")));
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4322);
  await startPreview({ port });
  console.log(`http://127.0.0.1:${port}/`);
}
