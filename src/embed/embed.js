// The embed, /e/<code> (docs/CLIENT.md "The embed"; Jamie, 2026-11-16: "I would like
// an embed option that allows me to put a Kubb game played as an embed on another
// website"): a pitch's match in another site's frame, to watch and nothing else.
//
//   a finished match with its replay   the replay player (src/replay/player.js) in
//                                      the wide view, the score sheet closed, no
//                                      sound; it plays while at least half of it is
//                                      in view and holds when scrolled away
//   a match in play                    a card: "Match in progress", watch it on the
//                                      site (watching joins the room, which an embed
//                                      must not do)
//   waiting, no match, no replay       a quiet card and the link to the pitch
//
// Always a small "Kubb: Throwing Wood ↗" link to /p/<code>, in a new tab. Nothing
// here sends anything but the one read of the kept replay (src/replay/fetch.js):
// no room joined, no report, no record, no analytics.
//
// The pitch's state comes from the page itself: the pages function writes it in as
// a JSON block (backend/pages/pitch.mjs embedState). A page without one (the
// static page, when the function is away) still plays a kept replay.
import { h } from "../ui/dom.js";
import { ReplayPlayer } from "../replay/player.js";
import { fetchReplay } from "../replay/fetch.js";
import { isReplay } from "../net/lobby.js";

export const embedTune = {
  visible: 0.5, // the share of the frame in view for the replay to play
};

// /e/<code>, or null. The same pattern as infra/viewer-request.js.
export function embedCode(pathname = location.pathname) {
  const match = pathname.match(/^\/e\/([2-9a-hjkmnp-z]{8,24})\/?$/);
  return match ? match[1] : null;
}

// The state block the pages function writes, or null.
export function readPitch(doc = document) {
  const block = doc.getElementById("kubb-pitch");
  if (!block) return null;
  try {
    const s = JSON.parse(block.textContent);
    return s && typeof s === "object" ? s : null;
  } catch {
    return null;
  }
}

// makeGame() -> Promise<Game>: the engine and the Game, made only when there is a
// replay to play (a card needs neither).
export async function startEmbed({
  ui,
  code,
  roomsUrl,
  makeGame,
  fetch = fetchReplay,
}) {
  document.body.dataset.mode = "embed";
  const pitchUrl = code ? `/p/${code}` : "/";
  ui.append(
    h(
      "a.embed-link",
      {
        href: pitchUrl,
        target: "_blank",
        rel: "noopener",
        "data-test": "embed-link",
      },
      "Kubb: Throwing Wood ↗",
    ),
  );
  const s = readPitch();
  const quiet = (title, line = null, kind = "quiet") => {
    const card = h(
      "div.card.embed-quiet",
      { "data-test": "embed-card", "data-state": kind },
      h("h2.display", title),
      line ? h("p", line) : null,
      h(
        "p",
        h(
          "a.btn.go",
          { href: pitchUrl, target: "_blank", rel: "noopener" },
          kind === "playing"
            ? "WATCH ON KUBB.THINGELSTAD.XYZ"
            : "OPEN THE PITCH",
        ),
      ),
    );
    ui.append(h("div.scrim.embed-scrim", card));
    document.body.dataset.embed = kind;
    return { state: kind };
  };

  if (!code) return quiet("No match here");
  if (s?.state === "playing")
    return quiet(
      "Match in progress",
      s.teams ? `${s.teams.A} vs ${s.teams.B}, turn ${s.turn}` : null,
      "playing",
    );
  // a rematch's lobby: the pitch is waiting, whatever the last match left kept
  if (s?.state === "waiting")
    return quiet("Waiting for players", null, "waiting");
  // checked once the engine is here (the check is the engine's): fetched first, so a
  // pitch with nothing kept never loads it
  const fetched = roomsUrl
    ? await fetch({ url: roomsUrl, code, check: null })
    : null;
  // a finished match plays only its own replay: a rematch that could not be kept
  // leaves the one before it in the room (src/net/pitch.js lookForKept)
  const m = s?.state === "over" ? s.match : null;
  const data =
    fetched && m && (fetched.n !== m.n || fetched.hash !== m.hash)
      ? null
      : fetched;
  if (!data) {
    if (s?.state === "over" && s.final) return quiet(s.final, null, "over");
    return quiet("No match here", null, "none");
  }

  const game = await makeGame();
  if (!isReplay(data)) {
    game.stop?.();
    if (s?.state === "over" && s.final) return quiet(s.final, null, "over");
    return quiet("No match here", null, "none");
  }
  const player = new ReplayPlayer({ game, root: ui, data, embedded: true });
  player.start();
  // still until it is seen: the observer says at once whether it is
  player.hold(true);
  const watch = new IntersectionObserver(
    (entries) => {
      const e = entries[entries.length - 1];
      player.hold(
        !(e.isIntersecting && e.intersectionRatio >= embedTune.visible - 0.01),
      );
    },
    { threshold: [0, embedTune.visible, 1] },
  );
  watch.observe(document.documentElement);
  document.body.dataset.embed = "replay";
  return { state: "replay", game, player, watch };
}
