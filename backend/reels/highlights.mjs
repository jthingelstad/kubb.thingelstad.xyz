// The highlights of one match: which throws make the reel, in what order, with what
// caption and for how long. Pure: it takes the facts backend/reels/scan.mjs reads from the
// engine's recordings (the result, the timeline's touches and bursts, the pieces
// standing before and after) and knows no engine, canvas or file. Its numbers are all
// in `tune`; tests/reel/highlights.test.mjs pins its choices.
//
//   const edit = pickHighlights({ throws, end, teams })
//   edit.moments: [{ i, kind, score, caption, shots, seconds, ... }] in match order,
//   the end of the match last; edit.seconds the reel's length with its cards.
//
// A moment's shots say which reel camera (backend/reels/cameras.mjs) films which part of
// the throw's recording and at what rate: rate 1 is the throw's own time, 0.3 a third
// of it (slow motion: more simulated frames per second of the reel, never fewer).

export const tune = {
  // the reel
  minMoments: 4,
  maxMoments: 6,
  minSeconds: 25,
  maxSeconds: 40,
  titleSeconds: 2.6,
  endSeconds: 3.6,
  // scores: what makes a throw worth showing
  score: {
    kingWin: 100, // the winning king shot: always, and last
    kingEarly: 90, // a king toppled too early: the match lost, last
    perKubb: 3, // every kubb down
    multi: 30, // a baton that takes two or more kubbs
    multiEach: 14, // and each kubb past the second
    long: 24, // a base kubb down from long range
    longEach: 4, // and each metre past longFrom
    inkastKnock: 16, // a kubb thrown in that knocks another
    inkastToppled: 12, // and topples it
    clearField: 14, // the last field kubb in a half cleared
    clearPressure: 10, // with the team's last baton or the one before it
    nearMiss: 6, // a baton that touched a kubb that stayed up
    setsUp: 14, // a near miss right before a moment of this team's
    late: 0.25, // per turn: later throws count a little more
    opening: 8, // the match's first throw (a dull match's reel opens with it)
    group: 24, // kubbs thrown in that stand in a tight group of three or more
    groupEach: 7, // and each kubb in the group past the third
    groupPays: 14, // the same team's baton then takes two or more of the group
    punished: 24, // a kubb thrown in out twice: the other team places it
  },
  // drills (kubbs thrown in): a tight group is kubbs standing, once raised, each
  // within groupLink of another and all within groupSpan of each other
  groupLink: 0.4, // m, centre to centre (a lying kubb is 15 cm long)
  groupSpan: 0.9, // m, the group's widest two kubbs
  groupMin: 3, // kubbs in a group, at least two of them thrown in that turn
  drillShare: 3, // at most one moment in this many is a drill (and at least one may be)
  drillSlowBefore: 0.25, // s before the kubb first touches the ground: slow from here
  drillSlowRate: 0.5, // the landing and the roll, half speed
  drillHold: 1.4, // s on the kubbs as they stand once raised (or the punishment kubb)
  longFrom: 7, // m: a base kubb down from at least this far is a long hit
  minScore: 20, // below this a throw only fills a dull match's reel
  repeatKind: 0.55, // each moment already of the same kind multiplies the score by this
  minGap: 4, // throws between two moments (a near miss and its hit excepted)
  // shots, in the throw's own seconds and rates
  lead: 0.45, // s the reel holds the release before the baton goes
  slowRate: 0.28, // slow motion through the impact
  slowBefore: 0.22, // s of throw before the first hit the slow motion starts
  slowAfter: 0.75, // s of throw after it ends
  twoAnglesFrom: 40, // a moment scored this or more is shown twice: the arc, then close
  beat: 1.1, // s the reel holds on what fell
  bigBeat: 1.6, // the end of the match
};

const WORDS = ["no", "one", "two", "three", "four", "five", "six"];
const word = (n) => WORDS[n] ?? String(n);
const plural = (n, one, many) => `${word(n)} ${n === 1 ? one : many}`;

const isMiss = (t) => !t.down && /miss/i.test(t.ruling || t.flag || "");
const kingDown = (t) => (t.toppled || []).includes("king");
// the half the thrower aims at
const targetHalf = (side) => (side === "A" ? "B" : "A");

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// The kubbs of one half in groups: each within `link` of another in its group.
export function groupsOf(kubbs, link = tune.groupLink) {
  const lab = kubbs.map((_, i) => i);
  const root = (i) => (lab[i] === i ? i : (lab[i] = root(lab[i])));
  for (let i = 0; i < kubbs.length; i++)
    for (let j = i + 1; j < kubbs.length; j++)
      if (dist(kubbs[i], kubbs[j]) <= link) lab[root(i)] = root(j);
  const out = new Map();
  kubbs.forEach((k, i) => {
    const r = root(i);
    if (!out.has(r)) out.set(r, []);
    out.get(r).push(k);
  });
  return [...out.values()];
}

const spanOf = (g) => {
  let m = 0;
  for (const a of g) for (const b of g) m = Math.max(m, dist(a, b));
  return m;
};

// Each turn's drilling (the kubbs one team threw in, ruled and raised): the throw
// that finished a tight group, keyed by the throw's index. A group is groupMin or more
// kubbs standing close once raised, at least two of them thrown in that turn; its beat
// is the last kubb thrown in that is part of it. `pays` is the index of the same team's
// baton, before the next drilling, that took two or more of the group.
export function drillGroups(throws) {
  const out = new Map();
  const runs = new Map();
  for (const t of throws)
    if (t.how === "drill" && t.settled) {
      const k = `${t.settled.at}`;
      if (!runs.has(k)) runs.set(k, []);
      runs.get(k).push(t);
    }
  for (const run of runs.values()) {
    const thrown = new Set(run.map((t) => t.kubb));
    const groups = groupsOf(run[0].settled.kubbs)
      .filter(
        (g) =>
          g.length >= tune.groupMin &&
          spanOf(g) <= tune.groupSpan &&
          g.filter((k) => thrown.has(k.id)).length >= 2,
      )
      .sort((a, b) => b.length - a.length);
    const g = groups[0];
    if (!g) continue;
    const ids = new Set(g.map((k) => k.id));
    const beat = [...run].reverse().find((t) => ids.has(t.kubb) && !t.punished);
    if (!beat) continue;
    const at = run[0].settled.at;
    const side = beat.side;
    let pays = null;
    for (const t of throws) {
      if (t.i < at || t.side !== side) continue;
      if (t.how === "drill") break;
      if ((t.toppled || []).filter((id) => ids.has(id)).length >= 2) {
        pays = t.i;
        break;
      }
    }
    const c = {
      x: g.reduce((s, k) => s + k.x, 0) / g.length,
      y: g.reduce((s, k) => s + k.y, 0) / g.length,
    };
    out.set(beat.i, {
      size: g.length,
      thrown: new Set(run.filter((t) => !t.punished).map((t) => t.kubb)).size,
      mine: g.filter((k) => thrown.has(k.id)).length,
      ids: [...ids],
      at,
      pays,
      focus: { ...c, r: Math.max(...g.map((k) => dist(k, c))) },
    });
  }
  return out;
}

// How far behind its own baseline a team's thrower stands from a point: the
// punishment kubb's place told as a non-player sees it.
function whereText(p, side) {
  if (!p) return "";
  const fromThrower = side === "A" ? p.y : 8 - p.y;
  if (fromThrower >= 7.5) return " at the back";
  if (fromThrower <= 4.6) return " by the middle line";
  return "";
}

// How a throw scores, what kind of moment it is and its caption.
export function rateThrow(t, ctx = {}) {
  const S = tune.score;
  const team = t.team || `Team ${t.side}`;
  const down = (t.toppled || []).filter((id) => id !== "king").length;
  const out = { kind: "hit", score: 0, caption: null };
  if (kingDown(t)) {
    const won = t.over && ctx.end?.winner === t.side;
    if (won)
      return {
        kind: "king",
        score: S.kingWin,
        caption: `${team} takes the king`,
      };
    return {
      kind: "kingEarly",
      score: S.kingEarly,
      caption: `${team} hits the king too early`,
    };
  }
  out.score = down * S.perKubb + (t.turn || 0) * S.late;
  if (t.how === "drill" && t.punished) {
    const other =
      ctx.teams?.[targetHalf(t.side)] ?? `Team ${targetHalf(t.side)}`;
    out.kind = "punished";
    out.score += S.punished;
    const where = whereText(t.placed, t.side);
    out.caption = where
      ? `${team}'s kubb is out twice: ${other} puts it${where}`
      : `${team}'s kubb is out twice: ${other} places it`;
    return out;
  }
  const group = ctx.groups?.get(t.i);
  if (t.how === "drill" && group) {
    out.kind = "group";
    out.score +=
      S.group +
      (group.size - tune.groupMin) * S.groupEach +
      (group.pays != null ? S.groupPays : 0);
    out.caption =
      group.thrown >= 5 && group.thrown > group.size
        ? `${team} throws ${word(group.thrown)} kubbs in, ${word(group.size)} close together`
        : group.mine === group.size
          ? `${team} lands ${word(group.size)} kubbs close together`
          : `${team} lands its kubbs in a group of ${word(group.size)}`;
    return out;
  }
  if (t.how === "drill") {
    const knocked = (t.touches || []).filter((x) => x.kind === "kubb");
    if (knocked.length) {
      out.kind = "inkast";
      out.score += S.inkastKnock + (t.down > 0 ? S.inkastToppled : 0);
      out.caption =
        t.down > 0
          ? `${team}'s kubb knocks another down`
          : `${team}'s kubb lands against another`;
    } else {
      out.kind = "drill";
      out.caption = `${team} throws a kubb in`;
    }
    return out;
  }
  if (down >= 2) {
    out.kind = "multi";
    out.score += S.multi + (down - 2) * S.multiEach;
    out.caption = `${team}: ${word(down)} kubbs with one baton`;
  } else if (
    down === 1 &&
    /base/i.test(t.ruling) &&
    (t.distance ?? 0) >= tune.longFrom
  ) {
    out.kind = "long";
    out.score += S.long + Math.max(0, t.distance - tune.longFrom) * S.longEach;
    out.caption = `${team}: a base kubb from ${Math.round(t.distance)} metres`;
  } else if (down === 1) {
    out.caption = /base/i.test(t.ruling)
      ? `${team} takes a base kubb`
      : `${team} takes a field kubb`;
  }
  const half = targetHalf(t.side);
  if (
    down > 0 &&
    t.before?.[half]?.field > 0 &&
    t.after?.[half]?.field === 0 &&
    /field/i.test(t.ruling)
  ) {
    const left = t.of != null && t.n != null ? t.of - t.n : null;
    const pressure = left != null && left <= 1;
    out.score += S.clearField + (pressure ? S.clearPressure : 0);
    if (out.kind === "hit") {
      out.kind = "clear";
      out.caption = pressure
        ? `${team} clears the field with ${left === 0 ? "the last baton" : "a baton to spare"}`
        : `${team} clears the field`;
    }
  }
  if (!down && (t.touches || []).some((x) => x.kind === "kubb")) {
    out.kind = "nearMiss";
    out.score += S.nearMiss;
    out.caption = `${team}: a touch, and it stays up`;
  } else if (isMiss(t)) {
    out.kind = "miss";
    out.caption = `${team} misses`;
  }
  if (t.i === 0) {
    out.score += S.opening;
    out.caption = `${team} opens the match`;
    if (out.kind === "miss") out.kind = "opening";
  }
  return out;
}

// The shots of one moment: which camera, which part of the recording, how fast.
// A drill (a kubb thrown in) is about where it lands among the others: the throw at
// its own pace, the landing and the roll slowed and close on the group (or where it
// went out), then a hold on the kubbs as they stand once raised (or on the
// punishment kubb where the other team stood it). focus: { x, y, r } in the world.
export function drillShots(t, { focus = null, settled = null } = {}) {
  const d = t.duration;
  const land = Math.min(d, t.landT ?? d * 0.55);
  const s0 = Math.max(0, land - tune.drillSlowBefore);
  const s1 = Math.min(d, land + 1.6);
  const shots = [
    { cam: "release", t0: 0, t1: 0, hold: tune.lead },
    { cam: "arc", t0: 0, t1: s0, rate: 1 },
    { cam: "group", t0: s0, t1: s1, rate: tune.drillSlowRate, focus },
  ];
  if (settled)
    shots.push({
      cam: "settled",
      t0: d,
      t1: d,
      hold: tune.drillHold,
      focus: settled.focus,
      at: settled.at,
    });
  else shots.push({ cam: "group", t0: d, t1: d, hold: tune.beat, focus });
  return shots;
}

export function shotsFor(t, kind, score, extra = {}) {
  if (kind === "group" || kind === "punished") return drillShots(t, extra);
  const d = t.duration;
  const hit = t.firstHit?.t ?? null;
  const big = score >= tune.twoAnglesFrom;
  const shots = [{ cam: "release", t0: 0, t1: 0, hold: tune.lead }];
  const beat =
    kind === "king" || kind === "kingEarly" ? tune.bigBeat : tune.beat;
  if (hit == null) {
    // nothing hit: the arc and where it came down
    shots.push({ cam: "arc", t0: 0, t1: d, rate: 1 });
    shots.push({ cam: "rest", t0: d, t1: d, hold: beat * 0.7 });
    return shots;
  }
  const s0 = Math.max(0, hit - tune.slowBefore);
  const s1 = Math.min(d, hit + tune.slowAfter);
  if (big) {
    // the whole throw from the side at its own pace, then again close and slow
    shots.push({ cam: "arc", t0: 0, t1: Math.min(d, hit + 0.5), rate: 1 });
    shots.push({
      cam: kind === "king" || kind === "kingEarly" ? "king" : "impact",
      t0: s0,
      t1: s1,
      rate: tune.slowRate,
      replay: true,
    });
  } else {
    shots.push({ cam: "arc", t0: 0, t1: s0, rate: 1 });
    shots.push({ cam: "impact", t0: s0, t1: s1, rate: tune.slowRate });
  }
  if (s1 < d) shots.push({ cam: "rest", t0: s1, t1: d, rate: 1 });
  shots.push({ cam: "rest", t0: d, t1: d, hold: beat });
  return shots;
}

export function shotSeconds(shots) {
  let s = 0;
  for (const x of shots) s += x.hold ?? (x.t1 - x.t0) / x.rate;
  return s;
}

// Where a drill moment's cameras look: the group, or where the kubb went out and
// where the punishment kubb was stood.
function drillFocus(t, r, groups) {
  if (r.kind === "group") {
    const g = groups.get(t.i);
    return {
      focus: g.focus,
      settled: { at: g.at, focus: g.focus },
    };
  }
  if (r.kind === "punished") {
    const out = t.rest ? { ...t.rest, r: 0.3 } : null;
    return {
      focus: out,
      settled:
        t.placed && t.settled
          ? { at: t.settled.at, focus: { ...t.placed, r: 0.3 } }
          : null,
    };
  }
  return {};
}

function moment(t, r, groups = new Map()) {
  const extra = drillFocus(t, r, groups);
  const shots = shotsFor(t, r.kind, r.score, extra);
  return {
    drill: t.how === "drill",
    i: t.i,
    turn: t.turn,
    side: t.side,
    team: t.team,
    kind: r.kind,
    score: Math.round(r.score * 10) / 10,
    caption: r.caption,
    shots,
    seconds: Math.round(shotSeconds(shots) * 100) / 100,
    before: t.before,
    after: t.after,
  };
}

// A match with nothing to show: no throw at all (a player resigned before the first),
// or no moment picked for any other reason. Such a match gets no reel: the renderer
// throws this before it starts an encoder, and the reel job marks it failed with
// why "empty", for good.
export const REEL_EMPTY = "REEL_EMPTY";
export class NoHighlights extends Error {
  code = REEL_EMPTY;
  name = "NoHighlights";
  constructor(message = "this match has no highlights to show") {
    super(message);
  }
}

// The edit list. throws: scan.mjs's facts; end: how the match ended. No throws, no
// moments: { moments: [], seconds: 0 } and no title or end card.
export function pickHighlights({ throws, end = null, teams = null }) {
  const groups = drillGroups(throws);
  const ctx = { end, teams, groups };
  const rated = throws.map((t) => ({ t, r: rateThrow(t, ctx) }));
  if (!rated.length) return { moments: [], seconds: 0, end, teams };
  // the end of the match: the throw that ended it, or (a match that ran out of turns
  // or was resigned) the last throw that took something down
  const last = rated[rated.length - 1];
  let ending = last.t.over && kingDown(last.t) ? last : null;
  if (!ending) {
    const hits = rated.filter((x) => x.t.down > 0);
    ending = hits[hits.length - 1] ?? last;
  }
  const chosen = [ending];
  const budget = tune.maxSeconds - tune.titleSeconds - tune.endSeconds;
  const secs = (x) =>
    shotSeconds(
      shotsFor(x.t, x.r.kind, x.r.score, drillFocus(x.t, x.r, groups)),
    );
  const length = () => chosen.reduce((s, x) => s + secs(x), 0);
  const fits = (x) => length() + secs(x) <= budget;
  // a drill that made a group and the same team's baton that took two or more of
  // it are one beat: they may stand next to each other
  const paired = (a, b) =>
    groups.get(a.t.i)?.pays === b.t.i || groups.get(b.t.i)?.pays === a.t.i;
  const far = (x) =>
    chosen.every((c) => Math.abs(c.t.i - x.t.i) >= tune.minGap || paired(c, x));
  // nothing after the end (a resigned match ends on its last hit)
  const before = (x) => x.t.i < ending.t.i;
  // drills: at most one moment in drillShare, but one may always go in; one a turn
  const isDrill = (x) => x.t.how === "drill";
  const drillRoom = (x) => {
    if (!isDrill(x)) return true;
    const drills = chosen.filter(isDrill);
    if (drills.some((c) => c.t.settled && c.t.settled.at === x.t.settled?.at))
      return false;
    const cap = Math.max(1, Math.floor((chosen.length + 1) / tune.drillShare));
    return drills.length + 1 <= cap;
  };
  const ok = (x) =>
    x && !chosen.includes(x) && before(x) && far(x) && fits(x) && drillRoom(x);
  const worth = (x) => {
    const same = chosen.filter((c) => c.r.kind === x.r.kind).length;
    return x.r.score * tune.repeatKind ** same;
  };
  const best = (list) =>
    list.sort((a, b) => worth(b) - worth(a) || a.t.i - b.t.i)[0];
  // the best drill that clears the bar goes in next, so batons never crowd it out
  const drill = best(
    rated.filter((x) => isDrill(x) && x.r.score >= tune.minScore && ok(x)),
  );
  if (drill) {
    chosen.push(drill);
    // with the baton that took two or more of its group: one beat, drill then baton
    const pays = groups.get(drill.t.i)?.pays;
    const baton = pays != null ? rated.find((x) => x.t.i === pays) : null;
    if (baton && ok(baton)) chosen.push(baton);
  }
  // the best of the rest, each time scored against what is already in
  for (;;) {
    if (chosen.length >= tune.maxMoments) break;
    const open = rated.filter((x) => x.r.score >= tune.minScore && ok(x));
    if (!open.length) break;
    chosen.push(best(open));
  }
  // a dull match: the opening throw, then the best hits left
  const fill = [
    rated[0],
    ...rated
      .filter((x) => x.t.down > 0)
      .sort((a, b) => b.r.score - a.r.score || a.t.i - b.t.i),
  ];
  for (const x of fill) {
    if (chosen.length >= tune.minMoments) break;
    if (!ok(x)) continue;
    chosen.push(x);
  }
  // a near miss right before one of the team's moments sets it up
  for (const c of [...chosen]) {
    if (chosen.length >= tune.maxMoments) break;
    const prev = rated
      .slice(0, rated.indexOf(c))
      .reverse()
      .find((x) => x.t.side === c.t.side);
    if (
      prev &&
      prev.r.kind === "nearMiss" &&
      !chosen.includes(prev) &&
      c.r.score >= tune.minScore &&
      fits(prev)
    ) {
      prev.r = {
        ...prev.r,
        score: prev.r.score + tune.score.setsUp,
        caption: `${prev.t.team}: it rocks and stays up`,
      };
      chosen.push(prev);
    }
  }
  // a baton that took two or more of a group brings the drill that made the group
  for (const c of [...chosen]) {
    if (chosen.length >= tune.maxMoments) break;
    const setup = rated.find((x) => groups.get(x.t.i)?.pays === c.t.i);
    if (setup && ok(setup)) chosen.push(setup);
  }
  chosen.sort((a, b) => a.t.i - b.t.i);
  // the end last, whatever its place (a resigned match's last hit is its end)
  chosen.splice(chosen.indexOf(ending), 1);
  chosen.push(ending);
  const moments = chosen.map((x) => moment(x.t, x.r, groups));
  const reel = moments.reduce((s, m) => s + m.seconds, 0);
  // too short: stretch the beats (never the throws) toward the shortest reel
  const short = tune.minSeconds - tune.titleSeconds - tune.endSeconds - reel;
  if (short > 0) {
    const each = short / moments.length;
    for (const m of moments) {
      const beat = m.shots[m.shots.length - 1];
      beat.hold = Math.round((beat.hold + each) * 100) / 100;
      m.seconds = Math.round(shotSeconds(m.shots) * 100) / 100;
    }
  }
  const seconds =
    tune.titleSeconds +
    tune.endSeconds +
    moments.reduce((s, m) => s + m.seconds, 0);
  return {
    moments,
    seconds: Math.round(seconds * 100) / 100,
    end,
    teams,
    title: tune.titleSeconds,
    endCard: tune.endSeconds,
  };
}

// The end card's line: "South wins in 14 turns" / "South wins: North resigned".
export function resultLine(end, teams) {
  if (!end?.winner) return "The match is over";
  const w = end.winnerName || teams?.[end.winner] || `Team ${end.winner}`;
  if (/resign/i.test(end.how || "")) return `${w} wins: ${end.how}`;
  if (/early/i.test(end.text || "")) return `${w} wins: the king fell early`;
  return `${w} wins in ${end.turns} turns`;
}
