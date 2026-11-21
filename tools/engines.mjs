// The engines this checkout carries, for the tools that look back at a match
// (games:replay, reports:replay, replay-fixture; docs/ENGINES.md): one
// wasmoon engine per major.minor in vendor/ (tools/lua-bundle.mjs carriedEngines),
// each made the first time it is asked for. The same registry as the browser's
// (src/engine/registry.js).
//
//   const engines = checkoutEngines();
//   const { engine, own } = await engineForMatch(engines, "0.7");
//       the match's own engine when the checkout carries it (own: true), else the
//       newest (own: false; a match that names no engine is the newest's)
//   await engineForMatch(engines, "0.7", { only: "0.8" })   that one, whatever the match
import { Engine } from "../src/engine/index.js";
import { makeRegistry, majorMinor } from "../src/engine/registry.js";
import { bundleLua, carriedEngines } from "./lua-bundle.mjs";

export function checkoutEngines({
  vendorDir,
  create = ({ dir }) => Engine.create({ sources: bundleLua(dir) }),
} = {}) {
  const carried = carriedEngines(vendorDir);
  return makeRegistry({
    engines: Object.fromEntries(
      carried.map(({ mm, version, dir }) => [mm, { version, dir }]),
    ),
    newest: carried[0].version,
    create,
  });
}

export async function engineForMatch(engines, version, { only = null } = {}) {
  const asked = majorMinor(version);
  if (only) {
    const mm = majorMinor(only) ?? only;
    if (!engines.has(mm))
      throw new Error(
        `this checkout carries no engine ${only} (it has ${engines.carried().join(", ")})`,
      );
    return {
      engine: await engines.loadEngine(mm),
      own: !asked || asked === mm,
    };
  }
  const mm = engines.pick(asked);
  return {
    engine: await engines.loadEngine(mm),
    own: !asked || asked === mm,
  };
}
