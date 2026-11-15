// The Content-Security-Policy the site is served with. The one copy that
// counts is the response headers policy in infra/site.json; this is the same
// policy for the preview server, and tests/site fails when the two differ.
//
// What the game needs beyond a static site: 'wasm-unsafe-eval' to compile
// the Lua VM (WebAssembly), the rooms WebSocket (through this hostname at
// /ws, or the API's own address as the fallback), blob: for sounds and
// workers the client may make, and Tinylytics. No inline scripts: pages
// carry their settings as a JSON data block, which is not script.
export const PRODUCTION_CONNECT = [
  "'self'",
  "wss://kubb.thingelstad.xyz",
  "wss://*.execute-api.us-east-1.amazonaws.com",
  "https://tinylytics.app",
];

export function contentSecurityPolicy(connect = PRODUCTION_CONNECT) {
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' https://tinylytics.app",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://avatars.micro.blog https://tinylytics.app",
    "font-src 'self'",
    `connect-src ${connect.join(" ")}`,
    "media-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
