// Watching a raise (the owner, 2026-11-22: "When you hit auto to raise kubbs you should
// watch the computer raise them."): every raise the player does not make by hand is shown
// on the raise view, each kubb tipped up onto the end it stands on with the same tip the
// hand's drag draws (src/game/raise-touch.js tiltItem), one after another. Pure: the
// clips, their pace and the pieces at a moment; src/game/game.js plays them ("lift"
// phase) and never holds the engine for them: the action has been applied, and sent,
// before its clip starts.
//
// Two sources of clips:
// - a `raise` action applied to a raise need the player did not make by hand (AUTO,
//   AUTO ALL, REST OF GAME, MENU's Raising: Automatic, and any raise another browser
//   sent: a shared pitch's other player, or a replay): `actionClip(need, action)`;
// - the kubbs the engine raised itself between two throws (a match started with Raising:
//   Automatic, the computer's own raises, watching the computer): the next throw's
//   `settled.raised` says so, and `settledClips(before, after, ...)` finds them by
//   comparing the pitch at the end of the last throw with the pitch at the next.
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

const other = (side) => (side === "A" ? "B" : "A");

// An item turned half about (0, 4), from one side's view frame to the other's: the
// point (x, y) to (-x, 8 - y) and the pose turned 180 degrees about z.
export function turnItem(it) {
  const w = it.qw ?? 1,
    x = it.qx ?? 0,
    y = it.qy ?? 0,
    z = it.qz ?? 0;
  return { ...it, x: -it.x, y: 8 - it.y, qw: -z, qx: -y, qy: x, qz: w };
}

// A renderer item's long axis on the ground, as an angle (radians), and whether it
// stands (its long axis near upright).
function lieOf(it) {
  const qw = it.qw ?? 1,
    qx = it.qx ?? 0,
    qy = it.qy ?? 0,
    qz = it.qz ?? 0;
  const ax = 2 * (qx * qz + qw * qy),
    ay = 2 * (qy * qz - qw * qx),
    az = 1 - 2 * (qx * qx + qy * qy);
  return { angle: Math.atan2(ay, ax), up: Math.abs(az) > 0.7 };
}

const isKubb = (it) => it && it.kind === "kubb";
const lying = (it) => isKubb(it) && (it.toppled || !lieOf(it).up);
const standing = (it) => isKubb(it) && !it.toppled && lieOf(it).up;

// The kubbs the engine raised between two throws, as clips on the raise view, in the
// raiser's frame. before: the pieces at the end of the last throw, in frame `fromSide`;
// after: the pieces of the next throw's view, in frame `toSide`; raiser: the side that
// raised them (the side that does not throw next). A kubb is raised when it lay before
// and stands after; one that stands farther than a metre from where it lay (a
// punishment kubb placed) is not tipped, it is stood up at the end. [] when none.
export function settledClips(
  before,
  after,
  { fromSide, toSide, raiser, reduced = false } = {},
) {
  if (!before?.length || !after?.length) return [];
  const into = (items, side) =>
    side === raiser ? items : items.map((it) => turnItem(it));
  const b = new Map(into(before, fromSide).map((it) => [it.id, it]));
  const a = into(after, toSide);
  const raised = a.filter((it) => {
    const was = b.get(it.id);
    return (
      standing(it) && lying(was) && Math.hypot(it.x - was.x, it.y - was.y) < 1
    );
  });
  const ids = new Set(raised.map((it) => it.id));
  // the pieces as they will stand, the raised ones lying as they were until their turn
  const clips = raised.map((it, k) => {
    const was = b.get(it.id);
    const lie = lieOf(was);
    const need = {
      kind: "raise",
      side: raiser,
      kubb: it.id,
      pose: { x: was.x, y: was.y, standing: false, angle: lie.angle },
      ends: [{ which: 1, ok: true, pose: { x: it.x, y: it.y } }],
      choices: [],
      others: [],
    };
    // a standing kubb's turn about the upright (poseItem's qz(angle))
    const yaw = 2 * Math.atan2(it.qz ?? 0, it.qw ?? 1);
    const final = { x: it.x, y: it.y, standing: true, angle: yaw };
    const items = (u) =>
      a.map((q) => {
        if (q.id === it.id) return liftKubb(need, 0, final, u, { reduced });
        if (!ids.has(q.id)) return q;
        const j = raised.findIndex((r) => r.id === q.id);
        return j < k ? q : b.get(q.id);
      });
    return {
      need,
      i: 0,
      final,
      footprints: [
        { x: it.x, y: it.y, angle: final.angle, chosen: true, allowed: true },
      ],
      items,
    };
  });
  return clips;
}

export { other as otherSide };
