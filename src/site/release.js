// Which release a page is: the web game's version (package.json), the web
// commit the build was made from and the kubb-engine version it vendors
// (vendor/engine). The build writes it into the page's config
// (config.release) and into /version.json; the client compares the two to
// tell a player their copy is out of date (src/net/freshness.js). Pure: the
// build (Node) and the client both use it.
//
// { version: "0.1.0", web: "<40 hex>" | null, engine: "0.2.0" | null,
//   text: "0.1.0 · web a2659b7 · engine 0.2.0" }

export const shortSha = (sha) =>
  typeof sha === "string" && sha ? sha.slice(0, 7) : "dev";

export function releaseText({ version, web, engine }) {
  return `${version} · web ${shortSha(web)} · engine ${engine || "dev"}`;
}

export function makeRelease({ version, web, engine }) {
  const release = { version, web: web || null, engine: engine || null };
  return { ...release, text: releaseText(release) };
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
