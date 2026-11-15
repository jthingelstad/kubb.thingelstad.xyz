// Work on the game locally: build dist/, serve it on 127.0.0.1:4322 as the
// preview does, rebuild on every change under src/, public/, lua/ and
// vendor/, and run the rooms server (tools/rooms-dev.mjs on
// ws://127.0.0.1:8788) when it is in place. Ctrl-C stops all of it.
//
// A rebuild is the whole build (esbuild bundles the client in well under a
// second), so a page, the Lua sources and the client never disagree. Reload
// the browser to see it.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { buildSite } from "./build.mjs";
import { startPreview } from "./preview.mjs";

const port = Number(process.env.PORT || 4322);
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
const server = await startPreview({ port });
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

let rooms;
if (fs.existsSync("tools/rooms-dev.mjs")) {
  rooms = spawn(process.execPath, ["tools/rooms-dev.mjs"], {
    stdio: "inherit",
  });
  rooms.on("exit", (code) => {
    if (code) console.error(`tools/rooms-dev.mjs exited with ${code}`);
  });
}

function stop() {
  for (const watcher of watchers) watcher.close();
  server.close();
  server.closeAllConnections?.();
  rooms?.kill("SIGTERM");
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
