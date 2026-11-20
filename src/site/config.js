// The game's runtime settings, as the build wrote them into the page.
//
//   import { readConfig } from "../site/config.js";
//   const config = readConfig();
//
// {
//   version:  "0.1.0",            package.json's version
//   commit:   "abc123..." | null, the commit the build was made from
//   mode:     "pitch" | "practice",
//   roomsUrl: "wss://throwingwood.com/ws" | "ws://127.0.0.1:8788" | null,
//             null while the rooms are not deployed
//   wasmUrl:  "/assets/glue-<hash>.wasm",        wasmoon's Lua VM
//   luaUrl:   "/assets/lua-sources-<hash>.json", the newest engine's Lua
//             (tools/lua-bundle.mjs)
//   engine:   "0.2.0", the newest vendored kubb-engine's version
//   engines:  { "0.2": { version: "0.2.0", luaUrl }, "0.1": { ... } }, every
//             engine the site carries by major.minor (docs/ENGINES.md), the newest
//             among them; a page built before there was a set has only luaUrl and
//             engine, and readConfig gives it the set of one
//   release:  { version: "0.1.0", web, engine, text }, the release this
//             page is (src/site/release.js); /version.json is the deployed one
//   sounds:   "/sounds/",         knock-1.wav to knock-9.wav
// }
//
// The page carries them as a JSON data block (no inline script: the site's
// Content-Security-Policy allows none).
export function readConfig(doc = document) {
  const block = doc.getElementById("kubb-config");
  if (!block) throw new Error("This page has no kubb-config block");
  return withEngines(JSON.parse(block.textContent));
}

const majorMinor = (version) =>
  typeof version === "string" ? version.split(".").slice(0, 2).join(".") : null;

// The config with its engines map, made from luaUrl and engine when it has none.
export function withEngines(config) {
  if (config.engines && typeof config.engines === "object") return config;
  const mm = majorMinor(config.engine);
  const engines =
    mm && config.luaUrl
      ? { [mm]: { version: config.engine, luaUrl: config.luaUrl } }
      : {};
  return { ...config, engines };
}

// The name of the Lua bundle an engine version was loaded from (records and reports
// name the build that played), or null.
export function luaFor(config = {}, version) {
  const mm =
    typeof version === "string"
      ? version.split(".").slice(0, 2).join(".")
      : null;
  const url = (mm && config.engines?.[mm]?.luaUrl) || config.luaUrl;
  return url ? String(url).split("/").pop() : null;
}

// The pitch's code from the address: /p/<code>, or null on /practice/.
export function pitchCode(pathname = location.pathname) {
  // The same pattern as infra/viewer-request.js.
  const match = pathname.match(/^\/p\/([2-9a-hjkmnp-z]{8,24})\/?$/);
  return match ? match[1] : null;
}
