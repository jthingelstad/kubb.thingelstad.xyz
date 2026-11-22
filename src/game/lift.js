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
//   kubbs already stand). Since engine 1.0.0 each entry also has `seat`, the orientation
//   the kubb stands at in the next throw's world (up to 3 degrees off plumb in the turf),
//   and the clip ends there, so the kubb does not step when the throw begins.
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

// A seat (engine 1.0.0's `seat` on a settled entry: { qw, qx, qy, qz }, the orientation
// a kubb stands at in the next throw's world, in the entry's frame), or null.
export function seatOf(seat) {
  if (!seat || typeof seat !== "object") return null;
  const { qw, qx, qy, qz } = seat;
  return [qw, qx, qy, qz].every(Number.isFinite) ? { qw, qx, qy, qz } : null;
}

// A standing item turned k of the way (0 to 1) from plumb onto its seat (a few degrees,
// so a normalised blend is as good as a slerp), or the item itself without one.
export function seated(item, seat, k = 1) {
  if (!seat || !(k > 0)) return item;
  const s =
    item.qw * seat.qw +
      item.qx * seat.qx +
      item.qy * seat.qy +
      item.qz * seat.qz <
    0
      ? -1
      : 1;
  const t = Math.min(1, k);
  const q = ["qw", "qx", "qy", "qz"].map(
    (c) => item[c] * (1 - t) + s * seat[c] * t,
  );
  const n = Math.hypot(...q) || 1;
  const [w, x, y, z] = q.map((v) => v / n);
  // resting on its lowest edge: each local half extent times its axis's rise
  const r = SEAT_HALF;
  const up =
    Math.abs(2 * (x * z - w * y)) * r[0] +
    Math.abs(2 * (y * z + w * x)) * r[1] +
    Math.abs(1 - 2 * (x * x + y * y)) * r[2];
  return { ...item, qw: w, qx: x, qy: y, qz: z, z: up };
}
// a kubb's half extents (core/pitch's 7 by 7 by 15 cm, as scenes.js poseItem has them)
const SEAT_HALF = [0.035, 0.035, 0.075];

// The kubb of a raise need at u of its clip: lying, tipped part way onto end i, then
// standing where the engine put it (`final`, a pose { x, y, standing, angle }), and, given
// its `seat` (engine 1.0.0), settling onto it as it slides home.
// reduced: no tipping, lying for the first half and standing for the second.
export function liftKubb(
  need,
  i,
  final,
  u,
  { reduced = false, seat = null } = {},
) {
  const lying = poseItem(need.kubb, "kubb", need.pose);
  const standing = poseItem(need.kubb, "kubb", { ...final, standing: true });
  if (reduced) return u < 0.5 ? lying : seated(standing, seat);
  if (u <= 0) return lying;
  if (u >= 1) return seated(standing, seat);
  if (u < tune.tipOf) return tiltItem(need, i, ease(u / tune.tipOf));
  // standing: on the footprint it tipped onto, sliding to where the engine put it
  // when that is elsewhere (a crowded raise), and leaning into its seat
  const top = tiltItem(need, i, 1);
  const k = ease(Math.min(1, (u - tune.tipOf) / ((1 - tune.tipOf) / 2)));
  return {
    ...seated(standing, seat, k),
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
// Since engine 1.0.0 an entry's `seat` is where its clip ends (liftKubb), and a kubb an
// earlier entry raised stands at that seat among a later entry's `others` when the two
// share a frame (the same raiser), so nothing steps from one clip to the next.
//
// around: the view's pieces. Its stakes are drawn with every entry (they stand alike in
// either frame); for an entry without `others` (none since engine 0.17) the rest of it
// too, in that same frame, with the list's other kubbs lying before their turn and
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
          seat: seatOf(e.seat),
        };
      if (e?.kind === "punish" && e.pose)
        return {
          e,
          lying: { ...e.pose, standing: false },
          final: { ...e.pose, standing: true },
          i: 0,
          placed: true,
          seat: seatOf(e.seat),
        };
      return null;
    })
    .filter(Boolean);
  if (!done.length) return [];
  const ids = new Set(done.map((d) => d.e.id));
  const rest = (around || []).filter((it) => it && !ids.has(it.id));
  const stakes = rest.filter((it) => it.kind === "stake");
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
        const kubb = liftKubb(need, d.i, d.final, u, { reduced, seat: d.seat });
        // an earlier entry's kubb at its seat, where it shares this entry's frame
        const sat = (id, item) => {
          const j = done.findIndex((o) => o.e.id === id);
          return j >= 0 && j < k && done[j].e.side === d.e.side
            ? seated(item, done[j].seat)
            : item;
        };
        if (Array.isArray(d.e.others)) {
          // the entry's own surroundings, as given (engine 0.17.0), on the pitch's
          // stakes from `around`: the six stand the same in either team's frame
          // (core/pitch: x ±2.5 at y 0, 4 and 8), so they are never turned either
          const items = stakes.slice();
          for (const o of d.e.others)
            if (o?.pose && o.id !== d.e.id)
              items.push(
                o.pose.standing === false
                  ? poseItem(o.id, "kubb", o.pose)
                  : sat(o.id, poseItem(o.id, "kubb", o.pose)),
              );
          if (d.e.king) items.push(poseItem("king", "king", d.e.king));
          items.push(kubb);
          return items;
        }
        const items = rest.slice();
        for (let j = 0; j < done.length; j++) {
          if (j === k) continue;
          const o = done[j];
          if (j < k) items.push(sat(o.e.id, poseItem(o.e.id, "kubb", o.final)));
          // a punishment kubb is not on the pitch before it is placed
          else if (!o.placed) items.push(poseItem(o.e.id, "kubb", o.lying));
        }
        items.push(kubb);
        return items;
      },
    };
  });
}
