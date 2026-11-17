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
//   luaUrl:   "/assets/lua-sources-<hash>.json", the engine's Lua
//             (tools/lua-bundle.mjs)
//   engine:   "0.2.0", the vendored kubb-engine's version
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
  return JSON.parse(block.textContent);
}

// The pitch's code from the address: /p/<code>, or null on /practice/.
export function pitchCode(pathname = location.pathname) {
  // The same pattern as infra/viewer-request.js.
  const match = pathname.match(/^\/p\/([2-9a-hjkmnp-z]{8,24})\/?$/);
  return match ? match[1] : null;
}
