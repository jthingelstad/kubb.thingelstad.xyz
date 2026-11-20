// The engines this page can run, one per major.minor the site carries
// (docs/ENGINES.md): the page config's `engines` map (src/site/config.js), each
// loaded the first time it is asked for and kept, one wasmoon Lua state apiece.
// Play is always on the newest; looking back at a match (a replay, its score sheet)
// asks for the match's own engine.
//
//   const engines = makeRegistry({ engines: config.engines, newest: config.engine,
//                                  create: (entry, mm) => Engine.create({ ... }) });
//   engines.newest            "0.7", the newest major.minor
//   engines.carried()         ["0.7", "0.6"], newest first
//   engines.has("0.6")        true when the site carries it
//   await engines.loadEngine("0.6")   that engine, made once
//   engines.loaded("0.6")     that engine if already made, else null
//   engines.onLoad(fn)        fn(engine, mm) for each engine as it is made
//   engines.pick("0.6")       the major.minor a match of 0.6 is looked back at with:
//                             its own when carried, else the newest
//
// engineFor(engines, mm, fallback) is the engine to look back at a match of mm with,
// at once when it is already made (always so while the site carries one engine),
// else a promise of it; `fallback` (the Game's engine) when there is no registry.
export const majorMinor = (version) =>
  typeof version === "string" && /^\d+\.\d+/.test(version)
    ? version.split(".").slice(0, 2).join(".")
    : null;

// "0.10" after "0.9".
export function compareMinor(a, b) {
  const [am, an] = a.split(".").map(Number);
  const [bm, bn] = b.split(".").map(Number);
  return am - bm || an - bn;
}

export function makeRegistry({ engines = {}, newest, create }) {
  const list = Object.keys(engines)
    .filter((mm) => majorMinor(mm) === mm)
    .sort(compareMinor)
    .reverse();
  // The newest is the page's engine; a map that lacks it has its own highest.
  const named = majorMinor(newest);
  const top = named && engines[named] ? named : (list[0] ?? null);
  const made = new Map(); // mm -> Promise<engine>
  const ready = new Map(); // mm -> engine
  const listeners = [];

  function loadEngine(mm = top) {
    if (!engines[mm])
      return Promise.reject(new Error(`this site carries no engine ${mm}`));
    let p = made.get(mm);
    if (!p) {
      p = Promise.resolve()
        .then(() => create(engines[mm], mm))
        .then((engine) => {
          const got = majorMinor(engine.version);
          if (got && got !== mm)
            throw new Error(`the ${mm} bundle is engine ${engine.version}`);
          ready.set(mm, engine);
          for (const fn of listeners) fn(engine, mm);
          return engine;
        });
      // A failed load may be tried again.
      p.catch(() => made.delete(mm));
      made.set(mm, p);
    }
    return p;
  }

  return {
    newest: top,
    carried: () => [...list],
    has: (mm) => Boolean(mm && engines[mm]),
    version: (mm) => engines[mm]?.version ?? null,
    loadEngine,
    loaded: (mm = top) => ready.get(mm) ?? null,
    pick: (mm) => {
      const want = majorMinor(mm);
      return want && engines[want] ? want : top;
    },
    onLoad(fn) {
      listeners.push(fn);
      for (const [mm, engine] of ready) fn(engine, mm);
    },
  };
}

export function engineFor(engines, mm, fallback = null) {
  if (!engines?.newest) return fallback;
  const use = engines.pick(mm);
  return engines.loaded(use) ?? engines.loadEngine(use);
}

// Run fn with the engine for mm: at once when it is ready, after it loads otherwise.
// Returns fn's result, or a promise of it.
export function withEngineFor(engines, mm, fallback, fn) {
  const e = engineFor(engines, mm, fallback);
  return typeof e?.then === "function" ? e.then(fn) : fn(e);
}
