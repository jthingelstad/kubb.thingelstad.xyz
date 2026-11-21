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
// client it was built with. The deploy build differs in two ways: the pitch
// server's address is the production one (PITCH_URL in src/site/site.mjs) and
// the pages load Tinylytics (once its site id is set, and only on the
// production host).
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
import { bundleFile, carriedEngines } from "./lua-bundle.mjs";
import { associationKey } from "./delivery-plan.mjs";
import { robotsTxt } from "../src/site/robots.mjs";
import {
  API_URL,
  DEV_PITCH_URL,
  GAME_READY,
  PITCH_URL,
  NEWSLETTER_URL,
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

// The pitch server the client is given: PITCH_URL in the deploy build, the dev
// Worker in every other, and KUBB_PITCH_URL over either (npm run dev points it at
// the server on this machine, tools/dev.mjs).
export function pitchUrl(production, env = process.env) {
  if (env.KUBB_PITCH_URL) return env.KUBB_PITCH_URL;
  return production ? PITCH_URL : DEV_PITCH_URL;
}

// A file under dist/assets/, named <name>-<hash><ext>.
async function hashedAsset(from, name) {
  const bytes = await fs.readFile(from);
  const ext = path.extname(from);
  const file = `assets/${name}-${hash(bytes)}${ext}`;
  await fs.writeFile(path.join("dist", file), bytes);
  return `/${file}`;
}

// The release this build is (src/site/release.js): the label "0.8.0 (0.9.0)" is the
// app's version and the newest carried engine's; the older ones are only in its detail
// ("Also plays 0.7.4").
export function releaseOf(version, web, carried) {
  return makeRelease({
    version,
    web,
    engine: carried[0]?.version ?? null,
    also: carried.slice(1).map((e) => e.version),
  });
}

// The page config's engines map (src/site/config.js): every carried engine's bundle
// (build/lua-sources-<mm>.json) as a hashed asset, by major.minor, newest first. The
// newest keeps the asset name it always had; an older one's name carries its minor.
export async function configEngines(carried, asset) {
  const engines = {};
  for (const [i, { mm, version }] of carried.entries())
    engines[mm] = {
      version,
      luaUrl: await asset(
        bundleFile("build", mm),
        i === 0 ? "lua-sources" : `lua-sources-${mm}`,
      ),
    };
  return engines;
}

export async function writeAssociation(root, team) {
  if (!team) return;
  if (!/^[A-Z0-9]{10}$/.test(team))
    throw new Error("APPLE_TEAM_ID must be ten uppercase letters or digits");
  const file = path.join(root, associationKey);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const details = [{ appID: team + ".com.throwingwood.app", paths: ["/p/*"] }];
  await fs.writeFile(
    file,
    JSON.stringify({ applinks: { apps: [], details } }) + "\n",
  );
}

export async function buildSite({
  production = process.env.KUBB_PRODUCTION === "true",
  quiet = false,
} = {}) {
  const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));

  // Each carried engine's Lua sources (vendor/engine, vendor/engines/<mm>), one
  // module map apiece.
  execFileSync(process.execPath, ["tools/lua-bundle.mjs"], {
    stdio: quiet ? "ignore" : "inherit",
  });
  const carried = carriedEngines();

  await fs.rm("dist", { recursive: true, force: true });
  await fs.cp("public", "dist", { recursive: true });
  await fs.mkdir("dist/assets", { recursive: true });
  await writeAssociation("dist", process.env.APPLE_TEAM_ID);

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
  const engine = carried[0].version;
  const engines = await configEngines(carried, hashedAsset);
  const newest = carried[0].mm;
  const release = releaseOf(pkg.version, commit, carried);
  const config = {
    version: pkg.version,
    commit,
    pitchUrl: pitchUrl(production),
    apiUrl: API_URL,
    wasmUrl: await hashedAsset("node_modules/wasmoon/dist/glue.wasm", "glue"),
    luaUrl: engines[newest].luaUrl,
    engine,
    engines,
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
  await fs.writeFile("dist/robots.txt", robotsTxt(ORIGIN));
  await fs.writeFile(
    "dist/llms.txt",
    `# ${SITE_TITLE}

> Kubb is the lawn game where you throw sticks of wood at blocks of wood. Knock them all over, then topple the king. Kubb: Throwing Wood plays by the U.S. National Kubb Championship rules. You can play it in your browser, on iPhone and iPad (in beta on TestFlight) and on Playdate (in development). All three run one engine, the Kubb Engine. ${GAME_READY ? "On the web you can start a pitch and send the link to friends. You can also play or watch the computer, or practice." : "The game is still being built. The pages are up, but a pitch does not play yet."}

## Pages

- [Home](${ORIGIN}/): the game and the three ways to play it.
- [Play on the web](${ORIGIN}/web/): start a pitch, play or watch the computer, practice, or join an open game.
- [iPhone and iPad](${ORIGIN}/ios/): the app, in beta on TestFlight.
- [Playdate](${ORIGIN}/playdate/): the Playdate game, thrown with the crank. Still in development.
- [The Kubb Engine](${ORIGIN}/engine/): the one engine all three run, and how it was checked against real tournament games and video.
- [Kubb sites we love](${ORIGIN}/love/): USA Kubb, the Kubb World Championship, Minnesota Kubb, Planet Kubb and JP's Backyard Games.
- [How to play](${ORIGIN}/rules/): the rules of kubb in five short cards, and how to throw on the web.
- [Practice](${ORIGIN}/practice/): the practice pitch.
- [Privacy](${ORIGIN}/privacy/): what the game keeps, on the web and on iPhone.
- [Newsletter](${NEWSLETTER_URL}): news when there is something new to throw, sent by Buttondown. The sign-up form is near the end of the home page.

A pitch at /p/<code> is one group's game, reached by its link; those pages are not indexed.

## Related

- [Kubb: Throwing Wood on Jamie's Playdate games site](https://playdate.thingelstad.xyz/throwing-wood/)
- [The Kubb Engine's source](https://github.com/jthingelstad/kubb-engine)
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
      `Built ${PAGES.length} pages${production ? " (deploy build)" : ""}; pitch server ${config.pitchUrl ?? "none"}; Lua ${config.luaUrl ?? "not bundled yet"}`,
    );
  return { config, assets };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildSite();
