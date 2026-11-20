// Which release a page is: the web game's version (package.json), the web
// commit the build was made from, the newest kubb-engine it carries
// (vendor/engine) and the older ones it still plays (vendor/engines/<mm>). The
// build writes it into the page's config (config.release) and into
// /version.json; the client compares the two to tell a player their copy is out
// of date (src/net/freshness.js). Pure: the build (Node) and the client both
// use it.
//
// { version: "0.2.0", web: "<40 hex>" | null, engine: "0.8.1" | null,
//   also: ["0.7.4"], text: "0.2.0 (0.8.1)", detail: "Also plays 0.7.4" | null }
//
// `text` is the label a player sees, the same form on every app: the app's version
// with the full version of the newest engine it carries in the parentheses, and
// nothing else there. `detail` names the older engines, for where detail is shown.
// The web commit is the exact identity (freshness, reports) and is never in the label.
// None of it goes on the room wire, the rider or a kept match, replay or share: web and
// iPhone players are alike there (docs/CLIENT.md "Version and freshness").

export const shortSha = (sha) =>
  typeof sha === "string" && sha ? sha.slice(0, 7) : "dev";

export function releaseText({ version, engine }) {
  return `${version} (${engine || "dev"})`;
}

// "Also plays 0.7.4", "Also plays 0.7.4 and 0.6.2"; null with one engine.
export function alsoText(also) {
  if (!Array.isArray(also) || !also.length) return null;
  const list =
    also.length === 1
      ? also[0]
      : `${also.slice(0, -1).join(", ")} and ${also.at(-1)}`;
  return `Also plays ${list}`;
}

export function makeRelease({ version, web, engine, also = [] }) {
  const release = {
    version,
    web: web || null,
    engine: engine || null,
    also: [...also],
  };
  return {
    ...release,
    text: releaseText(release),
    detail: alsoText(release.also),
  };
}

// The deployed release is newer than the loaded one when its web commit
// differs. A build without a commit (or an unreadable answer) is never stale.
export function isStale(loaded, deployed) {
  return Boolean(
    loaded?.web &&
    deployed &&
    typeof deployed.web === "string" &&
    /^[0-9a-f]{40}$/.test(deployed.web) &&
    deployed.web !== loaded.web,
  );
}
