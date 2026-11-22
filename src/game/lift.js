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
//   Automatic, the computer's own raises, watching the computer) and the punishment
//   kubbs it places come with no need and no action: engine 0.16.0 hands them out on the
//   next throw need (`setup.settled`: each kubb's id, the end chosen, and its lying and
//   standing poses in the raise view's frame; since 0.17.0 also `others` and `king`, the
//   surroundings as the raise by hand has them), and `settledClips(settled)` makes their
//   clips, in its order, at the same pace and tip. After a restore there is none (the
//   kubbs already stand).
//
//   const pace = liftPace(of);          // { lead, beat, tip } s for a raise of `of` kubbs
//   const clip = actionClip(need, a);   // { need, i, final, items(u) } or null
//   const clips = settledClips(n.setup.settled);                // the engine's own
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

// The clips of the kubbs the engine raised and placed itself before a throw (engine
// 0.16.0's `setup.settled` on that throw need: the computer's raises, a match with
// Raising: Automatic, a punishment kubb it placed), in the order done: each raised kubb
// tipped from its `lying` pose onto its end (`which`, 1 the +axis end as core/raising
// has it) and standing where the engine stood it (`standing`); a punishment kubb tipped
// up where it was placed (`pose`). The poses are the raiser's view frame, the frame the
// raise view draws in (the world frame in the wide view, each entry `frame: "world"`):
// they are drawn as given, never compared with the pitch or turned.
//
// Since engine 0.17.0 each entry carries its surroundings, `others` ({ id, pose }, every
// other piece as it stood when that kubb was raised, the list's own kubbs among them:
// those done standing, those to come lying) and `king`, in the entry's own frame, as
// raiseInfo gives them for a raise by hand (punishInfo's for a punishment kubb): an entry
// is drawn as the raise-by-hand view draws its need, the kubb from `lying` to `standing`
// with `others` and `king` round it, entry by entry. Nothing is taken from the throw
// need's items, compared or turned.
//
// around (an entry without `others` only: none on engine 0.17): the other pieces to draw
// with it, in that same frame, and the list's other kubbs lying before their turn and
// standing after it.
export function settledClips(settled, { around = [], reduced = false } = {}) {
  const list = Array.isArray(settled?.list) ? settled.list : [];
  const done = list
    .map((e) => {
      if (e?.kind === "raise" && e.lying && e.standing)
        return {
          e,
          lying: { ...e.lying, standing: false },
          final: { ...e.standing, standing: true },
          i: e.which === 2 ? 1 : 0,
        };
      if (e?.kind === "punish" && e.pose)
        return {
          e,
          lying: { ...e.pose, standing: false },
          final: { ...e.pose, standing: true },
          i: 0,
          placed: true,
        };
      return null;
    })
    .filter(Boolean);
  if (!done.length) return [];
  const ids = new Set(done.map((d) => d.e.id));
  const rest = (around || []).filter((it) => it && !ids.has(it.id));
  return done.map((d, k) => {
    // a need of the raise view's shape: the kubb lying, no footprints (tiltItem tips
    // it toward its end along its own axis)
    const need = {
      kind: "raise",
      side: d.e.side,
      kubb: d.e.id,
      pose: d.lying,
      ends: [],
      settled: true,
    };
    return {
      need,
      i: d.i,
      final: d.final,
      footprints: [],
      items(u) {
        const kubb = liftKubb(need, d.i, d.final, u, { reduced });
        if (Array.isArray(d.e.others)) {
          // the entry's own surroundings, as given (engine 0.17.0)
          const items = d.e.others
            .filter((o) => o?.pose && o.id !== d.e.id)
            .map((o) => poseItem(o.id, "kubb", o.pose));
          if (d.e.king) items.push(poseItem("king", "king", d.e.king));
          items.push(kubb);
          return items;
        }
        const items = rest.slice();
        for (let j = 0; j < done.length; j++) {
          if (j === k) continue;
          const o = done[j];
          if (j < k) items.push(poseItem(o.e.id, "kubb", o.final));
          // a punishment kubb is not on the pitch before it is placed
          else if (!o.placed) items.push(poseItem(o.e.id, "kubb", o.lying));
        }
        items.push(kubb);
        return items;
      },
    };
  });
}
