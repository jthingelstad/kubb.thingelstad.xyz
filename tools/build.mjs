// Build dist/: the files in public/, the game client bundled from src/main.js,
// wasmoon's WebAssembly Lua VM, the Lua sources (tools/lua-bundle.mjs), the
// pages from src/site/, and the files written from them (sitemap.xml,
// robots.txt, llms.txt, revision.json, version.json).
//
// version.json is the release (src/site/release.js): the web game's version
// (package.json), the web commit (GITHUB_SHA in CI, else git rev-parse HEAD)
// and the vendored kubb-engine's version. The pages carry the
// same object as config.release; the client asks for version.json to tell a
// player when a newer deploy is out (src/net/freshness.js).
//
//   node tools/build.mjs                          local, preview and CI checks
//   KUBB_PRODUCTION=true node tools/build.mjs     the deploy build
//
// Everything under dist/assets/ carries a content hash in its name and is
// cached for a year; the pages name those files, so a page always loads the
// client it was built with. The deploy build differs in two ways: the rooms
// address is the production one (infra/deployment.json) and the pages load
// Tinylytics (once its site id is set, and only on the production host).
//
// Sitemap lastmod is the last commit that touched a page's sources, never the
// build time (search-consoles rule, 2026-10-28). CI checks out full history.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { PAGES } from "../src/site/pages.mjs";
import { makeRelease } from "../src/site/release.js";
import { engineVersion } from "./lua-bundle.mjs";
import {
  DEV_ROOMS_URL,
  GAME_READY,
  ORIGIN,
  SITE_TITLE,
} from "../src/site/site.mjs";

const git = (...args) => {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};
const lastCommit = (paths) =>
  (paths.length && git("log", "-1", "--format=%cI", "--", ...paths)) ||
  git("log", "-1", "--format=%cI") ||
  new Date().toISOString();
const hash = (bytes) =>
  createHash("sha256").update(bytes).digest("hex").slice(0, 12);

// The rooms address the client is given. Locally: tools/rooms-dev.mjs. In the
// deploy build: wss://throwingwood.com/ws once the /ws route is on, else
// the API's own address, else null (the rooms are not deployed yet).
export async function roomsUrl(production) {
  if (!production) return DEV_ROOMS_URL;
  const deployment = JSON.parse(
    await fs.readFile("infra/deployment.json", "utf8"),
  );
  if (!deployment.rooms) return null;
  if (deployment.wsRoute) return `wss://${new URL(ORIGIN).host}/ws`;
  return deployment.rooms.webSocketUrl;
}

// A file under dist/assets/, named <name>-<hash><ext>.
async function hashedAsset(from, name) {
  const bytes = await fs.readFile(from);
  const ext = path.extname(from);
  const file = `assets/${name}-${hash(bytes)}${ext}`;
  await fs.writeFile(path.join("dist", file), bytes);
  return `/${file}`;
}

export async function buildSite({
  production = process.env.KUBB_PRODUCTION === "true",
  quiet = false,
} = {}) {
  const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));

  // The engine's Lua sources (vendor/engine), one module map.
  execFileSync(process.execPath, ["tools/lua-bundle.mjs"], {
    stdio: quiet ? "ignore" : "inherit",
  });
  const luaFile = "build/lua-sources.json";

  await fs.rm("dist", { recursive: true, force: true });
  await fs.cp("public", "dist", { recursive: true });
  await fs.mkdir("dist/assets", { recursive: true });

  // The client. wasmoon's Node-only branches import Node modules it never
  // reaches in a browser; they stay external.
  const result = await build({
    entryPoints: { main: "src/main.js" },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    minify: true,
    sourcemap: "linked",
    legalComments: "linked",
    external: ["url", "module", "fs", "path", "node:*"],
    outdir: "dist/assets",
    entryNames: "[name]-[hash]",
    assetNames: "[name]-[hash]",
    metafile: true,
    logLevel: quiet ? "silent" : "warning",
  });
  const assets = {};
  for (const [file, meta] of Object.entries(result.metafile.outputs)) {
    const url = `/${path.relative("dist", file).split(path.sep).join("/")}`;
    if (meta.entryPoint && file.endsWith(".js")) assets.main = url;
    else if (file.endsWith(".css")) assets.css = url;
  }
  if (!assets.main) throw new Error("esbuild wrote no client entry");

  const commit = process.env.GITHUB_SHA || git("rev-parse", "HEAD") || null;
  const engine = engineVersion();
  const release = makeRelease({ version: pkg.version, web: commit, engine });
  const config = {
    version: pkg.version,
    commit,
    roomsUrl: await roomsUrl(production),
    wasmUrl: await hashedAsset("node_modules/wasmoon/dist/glue.wasm", "glue"),
    luaUrl: await hashedAsset(luaFile, "lua-sources"),
    engine,
    release,
    sounds: "/sounds/",
  };

  for (const page of PAGES) {
    const file = path.join("dist", page.file);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      page.render({ tinylytics: production, config, assets }),
    );
  }

  const indexed = PAGES.filter((page) => !page.noindex);
  await fs.writeFile(
    "dist/sitemap.xml",
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexed
      .map(
        (page) =>
          `  <url>\n    <loc>${ORIGIN}${page.path}</loc>\n    <lastmod>${lastCommit(page.sources)}</lastmod>\n  </url>`,
      )
      .join("\n")}\n</urlset>\n`,
  );
  await fs.writeFile(
    "dist/robots.txt",
    `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`,
  );
  await fs.writeFile(
    "dist/llms.txt",
    `# ${SITE_TITLE}

> Kubb, the lawn game of wooden blocks and batons, played in the browser: the Playdate game Kubb: Throwing Wood running on the web. ${GAME_READY ? "Practice, or play the computer. Starting a pitch and sending the link so friends join on their own screens is coming next." : "The game is still being built: the pages are up, the pitch is not playable yet."}

## Pages

- [Home](${ORIGIN}/): start a pitch (a link of its own at /p/<code>), play the computer, or practice.
- [How to play](${ORIGIN}/rules/): the rules of Kubb in five short cards, and how to throw on the web by dragging round a dial.
- [Practice](${ORIGIN}/practice/): the practice pitch.

A pitch at /p/<code> is one group's game, reached by its link; those pages are not indexed.

## Related

- [Kubb: Throwing Wood for the Playdate](https://playdate.thingelstad.xyz/throwing-wood/): the game this is the web version of.
`,
  );
  await fs.writeFile(
    "dist/revision.json",
    JSON.stringify({
      version: pkg.version,
      commit: config.commit,
      production,
      builtAt: new Date().toISOString(),
    }) + "\n",
  );
  await fs.writeFile("dist/version.json", JSON.stringify(release) + "\n");
  if (!quiet)
    console.log(
      `Built ${PAGES.length} pages${production ? " (deploy build)" : ""}; rooms ${config.roomsUrl ?? "not deployed"}; Lua ${config.luaUrl ?? "not bundled yet"}`,
    );
  return { config, assets };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildSite();
