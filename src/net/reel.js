// A finished pitch's highlight reel, as the browser asks for it and shows it (docs/REEL.md
// "What a player sees", docs/ROOMS.md section 12, docs/CLIENT.md "Highlight reels"). This
// file is the part with no DOM: the request, what the page already knows on load, and the
// card's states as a pure reducer, so tests/net/reel-client.test.mjs can walk every
// answer. The card itself is src/ui/reel.js.
//
// It knows a pitch code and nothing else of the page: a match against the computer, once
// it can be shared, gets a code and then goes through here unchanged.
//
//   let s = reelStart(known);                     // known: reelFromPage(...) or null
//   s = reelStep(s, { type: "press" });           // MAKE A HIGHLIGHT REEL
//   s = reelStep(s, { type: "kept", kept, match }); // the kept replay is this match?
//   s = reelStep(s, { type: "answer", answer });  // what { t: "reel" } said
//   s = reelStep(s, { type: "error", code });     // what went wrong asking
//   reelView(s)  // { label, title, line, text, bar, video, retry, ask }
//
// Asking is starting: the first `reel` request for a kept replay starts its render
// (backend/rooms/core.mjs `reel`). So the page never sends one on load. It knows a reel
// is done only from the pitch page's own `og:video` tag, which the pages function writes
// when the reel item is done beside this match's own kept replay (reelFromPage).
import { ask } from "./ask.js";

export const reelTune = {
  pollMs: 5000, // ask again this often while it renders and the card is open
  keptTries: 4, // a just-ended match's keep may still be on its way: look this often
  keptWaitMs: 2500, // between those looks
  retries: 1, // TRY AGAIN after a failure that asking again can mend
};

// The words of the card, the same on the web and the iPhone (docs/REEL.md "What a player
// sees" is the contract).
export const REEL_WORDS = Object.freeze({
  make: "MAKE A HIGHLIGHT REEL",
  making: "MAKING YOUR REEL",
  watch: "WATCH THE REEL",
  title: "Highlight reel", // the card's title in every state
  wait: "About a minute. You can keep watching.",
  failed: "The reel could not be made.",
  notThisTime: "The reel could not be made. Not this time.",
  offline: "No connection.",
  why: {
    engine:
      "This match was played on another version of the game, so it cannot have a reel.",
    empty: "There are no highlights to show in this match.",
    busy: "Reels are busy today.",
    unavailable: "Reels cannot be made right now.",
    replay: "This match has no replay, so it cannot have a reel.",
    "too-many": "Too many reels asked for at once. Try again later.",
    moved: "This pitch has moved on to a newer match.",
  },
});

// The files a player saves: throwing-wood-<code>-tall.mp4 and -wide.mp4.
export const reelFileName = (code, format) =>
  `throwing-wood-${code}-${format}.mp4`;

// A reel's files as the reel function writes them (backend/reels/tag.mjs reelPaths).
const REEL_PATH =
  /^\/reels\/([2-9a-hjkmnp-z]{8,24})\/([0-9]{1,9})-r[0-9]{1,4}-[0-9]{1,4}\.[0-9]{1,4}\/(tall|wide)\.mp4$/;

// A site path of this pitch's reel: { v, format } or null.
export function reelPath(path, code) {
  const m = REEL_PATH.exec(typeof path === "string" ? path : "");
  return m && m[1] === code ? { v: Number(m[2]), format: m[3] } : null;
}

// What the pitch page says of its reel on load: the pages function's og:video (the wide
// file, at the site's origin) when the reel is done. { v, tall, wide } or null. `origins`
// are those the tag may name (the site's, and this page's own).
export function reelFromPage(content, code, origins = []) {
  if (typeof content !== "string" || !content) return null;
  let path = content;
  for (const o of origins) {
    if (o && content.startsWith(`${o}/`)) {
      path = content.slice(o.length);
      break;
    }
  }
  const p = reelPath(path, code);
  if (!p || p.format !== "wide") return null;
  return { v: p.v, wide: path, tall: path.replace(/wide\.mp4$/, "tall.mp4") };
}

// ---------- the card's states ----------
//
// phase:
//   idle       nothing asked here (MAKE A HIGHLIGHT REEL)
//   checking   finding the kept replay, to be sure it is this match (MAKING YOUR REEL)
//   asking     the `reel` request on its way, or rendering: ask again every pollMs
//   done       the files are there
//   refused    no reel, for a reason asking again cannot change (`why`)
//   failed     the server tried and could not (final: "Not this time")
//   error      asking went wrong in a way asking again may mend (TRY AGAIN)
//
// v: the kept replay's version once known (a reel answered for another is not this one).
// known: the page's own word that the reel is done ({ v, tall, wide }), to be checked
// against the kept replay before it is shown.

export function reelStart(known = null) {
  return {
    phase: "idle",
    v: null,
    tall: null,
    wide: null,
    why: null,
    known: known ?? null,
    keptTries: 0,
    retried: 0,
    offline: false,
    polled: false, // the server has said it renders
  };
}

const terminal = (s) =>
  s.phase === "done" || s.phase === "refused" || s.phase === "failed";

export function reelStep(s, e) {
  switch (e.type) {
    case "press":
      // Pressing again only opens the card: a reel on its way, done, or refused stays.
      if (s.phase === "idle")
        return { ...s, phase: "checking", keptTries: 0, offline: false };
      if (s.phase === "error") {
        if (s.why === "failed" && s.retried >= reelTune.retries)
          return { ...s, phase: "failed", why: "render" };
        // TRY AGAIN reads the kept replay afresh too: the room may keep a newer match
        return {
          ...s,
          phase: "checking",
          retried: s.why === "failed" ? s.retried + 1 : s.retried,
          keptTries: 0,
          offline: false,
        };
      }
      return s;

    case "kept": {
      // The room's kept replay, read without starting anything (src/replay/fetch.js):
      // it must be the match on the screen, or the reel would be another match's.
      if (s.phase !== "checking") return s;
      const k = e.kept;
      const m = e.match;
      const same =
        k &&
        Number.isInteger(k.kept) &&
        (!m ||
          (k.n === m.n &&
            (m.hash == null || k.hash == null || k.hash === m.hash)));
      if (!same) {
        // a newer match kept since: this one's reel can no longer be asked for
        if (k && m && Number.isInteger(k.n) && k.n > m.n)
          return { ...s, phase: "refused", why: "moved" };
        const tries = s.keptTries + 1;
        return tries < reelTune.keptTries
          ? { ...s, keptTries: tries }
          : { ...s, phase: "refused", why: "replay", keptTries: tries };
      }
      // The page said the reel is done: that is this match's when the versions agree.
      if (s.known && s.known.v === k.kept)
        return {
          ...s,
          phase: "done",
          v: k.kept,
          tall: s.known.tall,
          wide: s.known.wide,
        };
      return { ...s, phase: "asking", v: k.kept, known: null };
    }

    case "answer": {
      if (s.phase !== "asking") return s;
      const a = e.answer ?? {};
      const r = a.reel;
      if (!r) {
        const why = typeof a.why === "string" ? a.why : "unavailable";
        return {
          ...s,
          phase: "refused",
          why: why in REEL_WORDS.why ? why : "unavailable",
          offline: false,
        };
      }
      // the room keeps a newer match now: this answer is about that one
      if (s.v != null && Number.isInteger(a.v) && a.v !== s.v)
        return { ...s, phase: "refused", why: "moved", offline: false };
      if (
        r.state === "done" &&
        typeof r.tall === "string" &&
        typeof r.wide === "string"
      )
        return {
          ...s,
          phase: "done",
          tall: r.tall,
          wide: r.wide,
          offline: false,
        };
      if (r.state === "failed")
        return r.why === "empty"
          ? { ...s, phase: "refused", why: "empty", offline: false }
          : { ...s, phase: "failed", why: r.why ?? "render", offline: false };
      // rendering (or a state this build does not know yet): ask again. From now on
      // a lost poll is said and the next one tried: the render goes on without us.
      return { ...s, polled: true, offline: false };
    }

    case "error": {
      if (terminal(s) || s.phase === "idle") return s;
      const code = e.code ?? "error";
      if (code === "too-many")
        return { ...s, phase: "refused", why: "too-many" };
      if (code === "bad-room")
        return { ...s, phase: "refused", why: "unavailable" };
      const offline =
        code === "timeout" || code === "closed" || code === "unavailable";
      // a render on its way: a lost poll is said and the next one tried
      if (s.phase === "asking" && s.polled) return { ...s, offline };
      if (offline)
        return { ...s, phase: "error", why: "offline", offline: true };
      // the server could not read, write or start it (the error `failed`): asking
      // again really starts again, once
      return s.retried >= reelTune.retries
        ? { ...s, phase: "failed", why: "render" }
        : { ...s, phase: "error", why: "failed" };
    }

    default:
      return s;
  }
}

// What the button and the card show for a state.
export function reelView(s) {
  const W = REEL_WORDS;
  const working = s.phase === "checking" || s.phase === "asking";
  const view = {
    label:
      s.phase === "done" || (s.known && s.phase !== "refused")
        ? W.watch
        : working
          ? W.making
          : W.make,
    title: W.title,
    line: "", // the state line under the title: MAKING YOUR REEL while it renders
    text: "",
    bar: false,
    video: null,
    retry: false,
    // what to ask the server next: "kept" (the kept replay) or "reel"
    ask: working ? (s.phase === "checking" ? "kept" : "reel") : null,
  };
  // the page said it is done: only the kept replay to check, nothing is made
  if (s.phase === "checking" && s.known) return { ...view, bar: true };
  if (working)
    return {
      ...view,
      line: W.making,
      text: s.offline ? `${W.wait} ${W.offline}` : W.wait,
      bar: true,
    };
  if (s.phase === "done")
    return {
      ...view,
      video: { tall: s.tall, wide: s.wide },
    };
  if (s.phase === "refused")
    return { ...view, text: W.why[s.why] ?? W.why.unavailable };
  if (s.phase === "failed") return { ...view, text: W.notThisTime };
  if (s.phase === "error")
    return {
      ...view,
      text: s.why === "offline" ? W.offline : W.failed,
      retry: true,
    };
  return view;
}

// ---------- the request ----------

// One `reel` message on a socket of its own (src/net/ask.js), no join. Resolves the
// answer { t: "reel", room, v, reel, why? }; rejects an AskError whose code is the
// server's (too-many, failed, bad-room) or timeout, closed, unavailable.
export function askReel({ url, code, ...rest }) {
  return ask({
    url,
    message: { t: "reel", id: 1, room: code },
    done: "reel",
    re: "reel",
    ...rest,
  });
}

// The request a state calls for (reelView's `ask`), made, as the event its answer is:
// "kept" reads the room's kept replay afresh every time, never a copy in hand, because
// a viewer can sit in an old replay while a rematch is kept and asking for the reel of
// a room that has moved on starts the newer match's render. `at`: { url, code,
// WebSocket? }; `match`: { n, hash } of the match on the screen.
export async function reelRequest(s, at, match) {
  const what = reelView(s).ask;
  try {
    if (what === "kept")
      return { type: "kept", kept: await askKept(at), match };
    // A small race stays between that read and this ask (no read-only reel ask yet,
    // docs/REEL.md open question 13): the answer's `v` is checked against the kept one.
    if (what === "reel") return { type: "answer", answer: await askReel(at) };
  } catch (error) {
    return { type: "error", code: error?.code };
  }
  return null;
}

// Which match the room keeps, read without starting anything: one `replay` message
// (docs/ROOMS.md section 10). Resolves { kept: its version, n, hash } or null when the
// room keeps none; rejects as askReel does, so no connection is not "no replay".
export async function askKept({ url, code, ...rest }) {
  const a = await ask({
    url,
    message: { t: "replay", id: 1, room: code },
    done: "replay",
    re: "replay",
    ...rest,
  });
  const r = a?.replay;
  if (!r || typeof r !== "object" || !Number.isInteger(a.v)) return null;
  return { kept: a.v, n: r.n ?? null, hash: r.hash ?? null };
}
