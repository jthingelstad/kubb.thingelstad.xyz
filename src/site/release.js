// Which release a page is: the game's version and build (the Playdate's
// pdxinfo, carried in vendor/core/version.lua), the web commit the build was
// made from and the playdate-kubb commit the core was vendored at. The build
// writes it into the page's config (config.release) and into /version.json;
// the client compares the two to tell a player their copy is out of date
// (src/net/freshness.js). Pure: the build (Node) and the client both use it.
//
// { version: "0.9.5", build: 6, web: "<40 hex>" | null, core: "<40 hex>" | null,
//   text: "0.9.5 (6) · web a2659b7 · core cca8012" }

export const shortSha = (sha) =>
  typeof sha === "string" && sha ? sha.slice(0, 7) : "dev";

export function releaseText({ version, build, web, core }) {
  return `${version} (${build}) · web ${shortSha(web)} · core ${shortSha(core)}`;
}

// The version and build from core/version.lua's two constants.
export function parseCoreVersion(lua) {
  const version = lua.match(/local VERSION <const> = "(\d+\.\d+\.\d+)"/)?.[1];
  const build = lua.match(/local BUILD <const> = (\d+)/)?.[1];
  if (!version || !build)
    throw new Error("core/version.lua has no VERSION and BUILD");
  return { version, build: Number(build) };
}

export function makeRelease({ version, build, web, core }) {
  const release = { version, build, web: web || null, core: core || null };
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
