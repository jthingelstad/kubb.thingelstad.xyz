// How each published file is typed and cached. Pure, so tests can hold it.
import { createHash } from "node:crypto";
import path from "node:path";

export const associationKey = ".well-known/apple-app-site-association";

export function contentType(key) {
  return key === associationKey ? "application/json" : mime[path.extname(key)];
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".wav": "audio/wav",
  // Browsers refuse to stream-compile WebAssembly served as anything else.
  ".wasm": "application/wasm",
};

const PAGE = "public, max-age=0, s-maxage=60, must-revalidate";
const HASHED = "public, max-age=31536000, immutable";
// version.json says which release is deployed now (src/net/freshness.js): no
// browser or CloudFront copy (the cache policy's MinTTL is 0, so CloudFront
// keeps nothing an origin marks no-store).
const NEVER = "no-store, max-age=0";

// Published last, after every page, so no browser is told of a release whose
// pages are not up yet (tools/deploy.mjs).
export const MARKERS = ["revision.json", "version.json"];

export function cacheControl(key) {
  if (key === "version.json" || key === associationKey) return NEVER;
  // The build puts a content hash in every name under assets/.
  if (key.startsWith("assets/")) return HASHED;
  if (key.startsWith("fonts/") || key.startsWith("shared/fonts/"))
    return "public, max-age=2592000";
  if (
    [".html", ".txt", ".xml", ".css", ".js"].includes(path.extname(key)) ||
    key === "revision.json"
  )
    return PAGE;
  // Art and sounds can be remade under the same name.
  return "public, max-age=86400";
}

export function publicationOrder(files) {
  return [...files].sort(
    (a, b) =>
      Number(a.endsWith(".html")) - Number(b.endsWith(".html")) ||
      a.localeCompare(b),
  );
}

// Stored as built, never pre-compressed: CloudFront compresses per request.
export function prepareObject(key, bytes) {
  if (
    key.startsWith("/") ||
    key.split("/").includes("..") ||
    key.includes("\\")
  )
    throw new Error(`Unsafe public key: ${key}`);
  // reels/ is the reel function's (docs/REEL.md): a deploy never writes there
  if (key.startsWith("reels/"))
    throw new Error(`reels/ belongs to the reel function: ${key}`);
  const type = contentType(key);
  if (!type) throw new Error(`No MIME type for ${key}`);
  return {
    Body: bytes,
    ContentType: type,
    CacheControl: cacheControl(key),
    Metadata: { sha256: createHash("sha256").update(bytes).digest("hex") },
  };
}
