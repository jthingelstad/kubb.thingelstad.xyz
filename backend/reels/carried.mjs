// The engines a renderer carries, by major.minor (docs/ENGINES.md, docs/REEL.md
// "Engines"): the reel function's package holds one Lua bundle per engine the site
// carries, and a match is rendered or checked only on its own. Pure: no AWS, no files.
//
//   const lookup = carriedLookup({ carried })   carried: { "0.7": { engine, sources } }
//                                                or a function mm -> that or null
//   const lookup = carriedLookup({ engine, sources })   one engine (the tests, older
//                                                callers): the same as a set of one
//   lookup("0.7") -> { engine: "0.7.4", sources } | null
import { majorMinor } from "./tag.mjs";

export function carriedLookup({ carried, engine, sources } = {}) {
  if (typeof carried === "function") return (mm) => carried(mm) ?? null;
  if (carried && typeof carried === "object")
    return (mm) =>
      Object.prototype.hasOwnProperty.call(carried, mm) ? carried[mm] : null;
  const own = majorMinor(engine);
  return (mm) => (own && mm === own ? { engine, sources } : null);
}
