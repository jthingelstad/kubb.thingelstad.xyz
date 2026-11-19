// The highlights of one match: which throws make the reel, in what order, with what
// caption and for how long. Pure: it takes the facts tools/reel/scan.mjs reads from the
// engine's recordings (the result, the timeline's touches and bursts, the pieces
// standing before and after) and knows no engine, canvas or file. Its numbers are all
// in `tune`; tests/reel/highlights.test.mjs pins its choices.
//
//   const edit = pickHighlights({ throws, end, teams })
//   edit.moments: [{ i, kind, score, caption, shots, seconds, ... }] in match order,
//   the end of the match last; edit.seconds the reel's length with its cards.
//
// A moment's shots say which reel camera (tools/reel/cameras.mjs) films which part of
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
  },
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
export function shotsFor(t, kind, score) {
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

function moment(t, r) {
  const shots = shotsFor(t, r.kind, r.score);
  return {
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

// The edit list. throws: scan.mjs's facts; end: how the match ended.
export function pickHighlights({ throws, end = null, teams = null }) {
  const ctx = { end };
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
  const length = () =>
    chosen.reduce(
      (s, x) => s + shotSeconds(shotsFor(x.t, x.r.kind, x.r.score)),
      0,
    );
  const fits = (x) =>
    length() + shotSeconds(shotsFor(x.t, x.r.kind, x.r.score)) <= budget;
  const far = (x) =>
    chosen.every((c) => Math.abs(c.t.i - x.t.i) >= tune.minGap);
  const worth = (x) => {
    const same = chosen.filter((c) => c.r.kind === x.r.kind).length;
    return x.r.score * tune.repeatKind ** same;
  };
  // the best of the rest, each time scored against what is already in
  for (;;) {
    if (chosen.length >= tune.maxMoments) break;
    const open = rated.filter(
      (x) =>
        !chosen.includes(x) && far(x) && x.r.score >= tune.minScore && fits(x),
    );
    if (!open.length) break;
    open.sort((a, b) => worth(b) - worth(a) || a.t.i - b.t.i);
    chosen.push(open[0]);
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
    if (!x || chosen.includes(x) || !far(x) || !fits(x)) continue;
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
  chosen.sort((a, b) => a.t.i - b.t.i);
  // the end last, whatever its place (a resigned match's last hit is its end)
  chosen.splice(chosen.indexOf(ending), 1);
  chosen.push(ending);
  const moments = chosen.map((x) => moment(x.t, x.r));
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
