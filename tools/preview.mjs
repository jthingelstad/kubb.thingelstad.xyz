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
import { contentSecurityPolicy } from "../src/site/csp.mjs";
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
  return { uri: decodeURIComponent(url.pathname), querystring };
}

const CSP = contentSecurityPolicy([
  "'self'",
  DEV_ROOMS_URL,
  "ws://localhost:8788",
]);

export async function startPreview({ port = 4322, root = "dist" } = {}) {
  const handler = await loadViewerRequest();
  const server = http.createServer(async (req, res) => {
    const result = handler({
      request: cloudfrontRequest(new URL(req.url, "http://127.0.0.1")),
    });
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
      "content-security-policy": CSP,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    };
    try {
      if (!file.startsWith(`${root}${path.sep}`))
        throw new Error("outside dist");
      const body = await fs.readFile(file);
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
