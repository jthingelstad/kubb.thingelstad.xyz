// Watching a raise (the owner, 2026-11-22: "When you hit auto to raise kubbs you should
// watch the computer raise them."): every raise the player does not make by hand is shown
// on the raise view, each kubb tipped up onto the end it stands on with the same tip the
// hand's drag draws (src/game/raise-touch.js tiltItem), one after another. Pure: the
// clips, their pace and the pieces at a moment; src/game/game.js plays them ("lift"
// phase) and never holds the engine for them: the action has been applied, and sent,
// before its clip starts.
//
// Clips play from a raise need's own poses, which the engine gives in the frame the raise
// view draws in (JavaScript never turns the pitch):
// - a `raise` action applied to a raise need the player did not make by hand (AUTO,
//   AUTO ALL, REST OF GAME, MENU's Raising: Automatic, and any raise another browser
//   sent: a shared pitch's other player, or a replay): `actionClip(need, action)`.
// - The kubbs the engine raises itself between two throws (a match started with Raising:
//   Automatic, the computer's own raises, watching the computer) come with no need and
//   no action: `settledClips(settled)` is their seam, and returns none until the engine
//   hands out what it raised (engine 0.16.0's `setup.settled` on the throw need: each
//   kubb's id, the end chosen, and its lying and standing poses in the raise view's
//   frame). Until then those raises are shown as before: the kubbs stand at once.
//
//   const pace = liftPace(of);          // { lead, beat, tip } s for a raise of `of` kubbs
//   const clip = actionClip(need, a);   // { need, i, final, items(u) } or null
//   clip.items(u)                        // the pieces at u (0 to 1) of the clip
import { poseItem, settleItems } from "./scenes.js";
import { tiltItem } from "./raise-touch.js";

export const tune = {
  lead: 0.4, // s the first kubb lies on the raise view before it tips
  beat: 0.5, // s a kubb, at most: its tip and a moment standing
  total: 4, // s a whole raise takes at most, the lead included
  minBeat: 0.18, // s a kubb, at least, however many there are
  tipOf: 0.7, // of a beat the tip takes; the rest it stands
  displaced: 0.3, // m: a kubb that stands farther than this from its footprint (a
  // crowded raise's search moved it) slides there after its tip
  catchUp: 2, // a clip runs this much faster for each action waiting behind it
};

// The pace for a raise of `of` kubbs: half a second a kubb, quicker when there are
// many, so the lead and every kubb take tune.total at most.
export function liftPace(of = 1) {
  const n = Math.max(1, of | 0);
  const beat = Math.max(
    tune.minBeat,
    Math.min(tune.beat, (tune.total - tune.lead) / n),
  );
  return { lead: tune.lead, beat, tip: beat * tune.tipOf };
}

// The tip's ease: slow off the ground, quicker at the top, as a hand lifts it.
const ease = (u) => u * u * (3 - 2 * u);

// The kubb of a raise need at u of its clip: lying, tipped part way onto end i, then
// standing where the engine put it (`final`, a pose { x, y, standing, angle }).
// reduced: no tipping, lying for the first half and standing for the second.
export function liftKubb(need, i, final, u, { reduced = false } = {}) {
  const lying = poseItem(need.kubb, "kubb", need.pose);
  const standing = poseItem(need.kubb, "kubb", { ...final, standing: true });
  if (reduced) return u < 0.5 ? lying : standing;
  if (u <= 0) return lying;
  if (u >= 1) return standing;
  if (u < tune.tipOf) return tiltItem(need, i, ease(u / tune.tipOf));
  // standing: on the footprint it tipped onto, sliding to where the engine put it
  // when that is elsewhere (a crowded raise)
  const top = tiltItem(need, i, 1);
  const k = ease(Math.min(1, (u - tune.tipOf) / ((1 - tune.tipOf) / 2)));
  return {
    ...standing,
    x: top.x + (standing.x - top.x) * k,
    y: top.y + (standing.y - top.y) * k,
  };
}

// The end a raise action stands the kubb on, and where: { i, final } (i an index into
// need.ends), or null when the need is not a two-ended raise. The action's `choice`
// (1-based into need.choices), else the engine's own (need.default).
export function raiseEnd(need, action) {
  if (!need || need.kind !== "raise" || !need.pose) return null;
  const choices = need.choices || [];
  const c = choices[(action?.choice ?? need.default ?? 1) - 1] || choices[0];
  if (!c?.pose) return null;
  let i = (need.ends || []).findIndex((e) => e.which === c.which);
  if (i < 0) i = 0;
  return { i, final: { ...c.pose, standing: true } };
}

// The clip of a raise action applied to `need` (the raise as it stood before).
export function actionClip(need, action, opts = {}) {
  const end = raiseEnd(need, action);
  if (!end) return null;
  const { i, final } = end;
  const ends = need.ends || [];
  const hasEnds = ends.length === 2;
  // a kubb with no footprints (standing already, or one end only) tips toward where
  // it stands
  const tipNeed = hasEnds ? need : { ...need, ends: [{ pose: final }] };
  const ti = hasEnds ? i : 0;
  return {
    need,
    i: ti,
    final,
    footprints: hasEnds
      ? ends.map((e, k) => ({
          x: e.pose.x,
          y: e.pose.y,
          angle: e.pose.angle,
          chosen: k === i,
          allowed: e.ok !== false,
        }))
      : [],
    items(u) {
      const items = settleItems(need, null);
      items.push(liftKubb(tipNeed, ti, final, u, opts));
      return items;
    },
  };
}

// ---------- the engine's own raises, between two throws ----------

// The clips of the kubbs the engine raised itself before a throw, from that throw need's
// `setup.settled` (`n.setup.settled`). Engine 0.15.1 never fills it (core/match keeps the
// count on the match, not the setup), so this returns [] and those raises stand at once,
// as before web 0.17.0. Engine 0.16.0 is to fill it with, for each kubb raised, its id,
// the end chosen and its lying and standing poses in the frame the raise view draws in;
// a clip is then made from those poses alone, as actionClip makes one from a need.
export function settledClips(settled) {
  void settled;
  return [];
}
