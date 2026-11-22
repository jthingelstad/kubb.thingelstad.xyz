// The Web Worker the Tournament's neighbours run in (src/engine/neighbours-host.js says
// the messages; the page side is src/game/neighbours.js). Built by esbuild as its own
// hashed module under /assets/ (tools/build.mjs), so the site's CSP lets it in by
// worker-src 'self', and it compiles wasmoon's VM under the same 'wasm-unsafe-eval'.
import { neighboursHost } from "./neighbours-host.js";

const handle = neighboursHost();
self.onmessage = async (e) => {
  self.postMessage(await handle(e.data));
};
