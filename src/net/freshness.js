// Is the copy of the game in this tab the one deployed now? (docs/CLIENT.md
// "Version and freshness".) Fetches /version.json, never from a cache, when
// the page becomes visible again and every 10 minutes while it is visible,
// and calls onStale once when the deployed web commit is not the one this
// page was built from. It never reloads anything itself: a match may be on.
import { isStale } from "../site/release.js";

export const freshnessTune = {
  everyMs: 10 * 60 * 1000, // while the page stays open and visible
  minGapMs: 60 * 1000, // a tab flicked back and forth asks at most this often
  url: "/version.json",
};

export function watchFreshness({
  release,
  onStale,
  doc = document,
  fetchImpl = (...a) => fetch(...a),
  now = () => Date.now(),
  every = (fn, ms) => setInterval(fn, ms),
  tune = freshnessTune,
}) {
  if (!release?.web) return { check: async () => false, stop() {} };
  let last = now(); // the page was just loaded: it is the current one
  let busy = false;
  let done = false;
  const check = async (force = false) => {
    if (done || busy || (!force && now() - last < tune.minGapMs)) return false;
    busy = true;
    last = now();
    try {
      const res = await fetchImpl(tune.url, { cache: "no-store" });
      if (!res.ok) return false;
      const deployed = await res.json();
      if (!isStale(release, deployed)) return false;
      done = true;
      onStale(deployed);
      return true;
    } catch {
      return false; // offline, or a deploy in flight: ask again later
    } finally {
      busy = false;
    }
  };
  const visible = () => doc.visibilityState !== "hidden";
  const onVisibility = () => {
    if (visible()) check();
  };
  doc.addEventListener("visibilitychange", onVisibility);
  const timer = every(() => {
    if (visible()) check(true);
  }, tune.everyMs);
  return {
    check,
    stop() {
      done = true;
      doc.removeEventListener("visibilitychange", onVisibility);
      clearInterval(timer);
    },
  };
}
