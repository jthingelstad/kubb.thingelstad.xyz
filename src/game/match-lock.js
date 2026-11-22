// A lock on a match against the computer while a tab plays it (the Web Locks API, one
// origin's tabs): another tab never offers it for RESUME, nor sends its record, while it
// is live here. A tab that closes lets its locks go. Without the API (an old browser)
// nothing is held and nothing is ever found held: one tab works as before.
const NAME = (id) => `kubb:solo:${id}`;

// Hold the lock on `id` until the returned function is called (or the tab closes).
export function holdMatch(id, locks = globalThis.navigator?.locks) {
  if (!id || !locks?.request) return () => {};
  let release;
  const held = new Promise((r) => (release = r));
  locks
    .request(NAME(id), { mode: "exclusive", ifAvailable: true }, (lock) =>
      lock ? held : null,
    )
    .catch(() => {});
  return () => release();
}

// Is `id` held by a tab (this one or another)?
export async function matchHeld(id, locks = globalThis.navigator?.locks) {
  if (!id || !locks?.query) return false;
  try {
    const { held = [] } = await locks.query();
    return held.some((l) => l.name === NAME(id));
  } catch {
    return false;
  }
}
