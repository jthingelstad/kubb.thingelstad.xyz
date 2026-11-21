// Work on the game locally: build dist/, serve it on 127.0.0.1:4322 as the preview does,
// rebuild on every change under src/, public/, lua/ and vendor/, and run the pitch
// server and the api on this machine. Ctrl-C stops all of it.
//
// The pitch server is the real one: `wrangler dev` from backend/pitch-server/ on
// ws://127.0.0.1:8797 (its Durable Objects in workerd, as on Cloudflare), once its
// packages are in (`npm ci --prefix backend/pitch-server`). Beside it the api stand-in,
// tools/pitch-dev.mjs --api-only on 127.0.0.1:8798, takes the pitch server's pushes
// and answers the page's /api/* (the preview sends /api/* on to it). Without wrangler,
// tools/pitch-dev.mjs runs the pitch core and the api in one Node process on 8797.
// The build points the page at ws://127.0.0.1:8797 (KUBB_PITCH_URL).
//
// A rebuild is the whole build (esbuild bundles the client in well under a second), so
// a page, the Lua sources and the client never disagree. Reload the browser to see it.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { buildSite } from "./build.mjs";
import { startPreview } from "./preview.mjs";
import { LOCAL_PITCH_URL } from "../src/site/site.mjs";
import { LOCAL_PUSH_KEY } from "./pitch-dev.mjs";

const port = Number(process.env.PORT || 4322);
const PITCH_PORT = 8797;
const API_PORT = 8798;
const wrangler = "backend/pitch-server/node_modules/.bin/wrangler";
const useWrangler =
  fs.existsSync(wrangler) && process.env.KUBB_NODE_PITCH !== "1";

process.env.KUBB_PITCH_URL ??= LOCAL_PITCH_URL;
const rebuild = async () => {
  const started = Date.now();
  try {
    await buildSite({ production: false, quiet: true });
    console.log(`Rebuilt in ${Date.now() - started} ms`);
  } catch (error) {
    console.error(`Build failed: ${error.message}`);
  }
};
await rebuild();

const children = [];
function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: "inherit", ...opts });
  child.on("exit", (code) => {
    if (code) console.error(`${cmd} ${args.join(" ")} exited with ${code}`);
  });
  children.push(child);
  return child;
}

let apiOrigin;
if (useWrangler) {
  run(process.execPath, [
    "tools/pitch-dev.mjs",
    "--api-only",
    "--port",
    String(API_PORT),
  ]);
  apiOrigin = `http://127.0.0.1:${API_PORT}`;
  run(
    "node_modules/.bin/wrangler",
    [
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      String(PITCH_PORT),
      "--var",
      `PUSH_URL:${apiOrigin}/api/push`,
      "--var",
      `PUSH_SECRET:${LOCAL_PUSH_KEY}`,
    ],
    { cwd: "backend/pitch-server" },
  );
} else {
  run(process.execPath, ["tools/pitch-dev.mjs", "--port", String(PITCH_PORT)]);
  apiOrigin = `http://127.0.0.1:${PITCH_PORT}`;
}

const server = await startPreview({ port, api: apiOrigin });
console.log(`http://127.0.0.1:${port}/`);

let timer;
let running = Promise.resolve();
const watchers = ["src", "public", "lua", "vendor"]
  .filter((dir) => fs.existsSync(dir))
  .map((dir) =>
    fs.watch(dir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        running = running.then(rebuild);
      }, 120);
    }),
  );

function stop() {
  for (const watcher of watchers) watcher.close();
  server.close();
  server.closeAllConnections?.();
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
