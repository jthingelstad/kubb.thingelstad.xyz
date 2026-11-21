// What names a highlight reel, shared by the api function (which takes the request),
// the reel function (which renders it) and the pages function (which links it).
// Pure: no engine, no AWS. docs/REEL.md "Render once, cache for good".
//
//   reels/<code>/<v>-<tag>/tall.mp4, wide.mp4, edit.json    in the site bucket
//
// `v` is the kept replay's document version (a rematch is a new key); `tag` is the
// renderer's look and the engine major.minor it played the match on, "r1-0.7": a new
// look renders again only when asked, never in bulk.

// The reel's look: cameras, overlays, edit. Raise it when a reel would come out
// differently from the same match, so the new look gets a new key.
export const REEL_LOOK = 1;

export const REEL_TAG = /^r[0-9]{1,4}-[0-9]{1,4}\.[0-9]{1,4}$/;

// "0.7.1" -> "0.7"; anything else -> null.
export function majorMinor(version) {
  if (typeof version !== "string") return null;
  const m = /^(\d{1,4})\.(\d{1,4})(?:[.+-]|$)/.exec(version);
  return m ? `${Number(m[1])}.${Number(m[2])}` : null;
}

// The engines a renderer carries, from its REEL_ENGINES ("0.7" or "0.7,0.8"): the
// major.minors it renders. Empty when unset.
export function parseEngines(text) {
  return String(text ?? "")
    .split(",")
    .map((s) => majorMinor(s.trim()))
    .filter(Boolean);
}

export const reelTag = (engine, look = REEL_LOOK) => `r${look}-${engine}`;

// The engine major.minor a tag was rendered on.
export const tagEngine = (tag) =>
  REEL_TAG.test(tag ?? "") ? tag.slice(tag.indexOf("-") + 1) : null;

export const REEL_PREFIX = "reels/";

// The bucket keys of one reel, and the site paths they are served at.
export function reelKeys(code, v, tag) {
  const dir = `${REEL_PREFIX}${code}/${v}-${tag}/`;
  return {
    dir,
    tall: `${dir}tall.mp4`,
    wide: `${dir}wide.mp4`,
    edit: `${dir}edit.json`,
  };
}

export function reelPaths(code, v, tag) {
  const k = reelKeys(code, v, tag);
  return { tall: `/${k.tall}`, wide: `/${k.wide}`, edit: `/${k.edit}` };
}

// One render's identity on the reel item: the api function writes it, the reel
// function only updates an item that still carries it.
export const reelJob = (v, tag) => `${v}-${tag}`;

// How many times one render is tried: Lambda's first go and its one retry
// (infra/site.json, ReelsInvokeConfig MaximumRetryAttempts 1). A render still
// "rendering" after this many tries and long past its start timed out every time.
export const REEL_TRIES = 2;
