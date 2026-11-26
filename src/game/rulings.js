// The result flag over the pitch after a throw (hud.js `.flag`), from the
// recording's result (the engine's docs/SESSION.md "The recording"): its `flag`, as it
// comes, except where a Kid match's ruling (engine 0.15, its docs/notes/kid-mode.md)
// says what happened better. A Kid match has no punishments and no losing throws, so
// the flag never says one. Since engine 0.17.0 a king knocked down early and stood back
// up (the ruling's `kingUp`) is the engine's own flag ("KING BACK UP", or the kubbs it
// felled, "1 DOWN"): read as it comes, never rebuilt here. A kubb out twice is placed by
// the engine ("OUT TWICE: PLACED", `placed`: a thrown kubb's result has no flag of its
// own), and a helicopter counts (`helicopterCounts`): its flag is what it knocked down
// ("1 DOWN", "MISS"), never "HELICOPTER", which in the standard game means a throw that
// does not count.

// A thrown kubb's rulings (the engine's core/match: an inkast's throw, its rethrows,
// what was out twice, a kubb landing on another, a rescue): the engine's flag is
// empty for every kubb thrown in (session/throw.lua, drilling), so the ruling's own
// short words are the flag: OUT FOR NOW, IN FOR NOW, IN, ALL IN, OUT: THROW AGAIN,
// OUT TWICE: PUNISHMENT (or the Kid match's OUT TWICE: PLACED), 2 PUNISHMENT KUBBS, ON A
// KUBB: LOWERED, RESCUE, and an own-half hit's. QA, 2026-11-22: a kubb thrown out
// said nothing at all.
export const KUBB_CODES = [
  "outForNow",
  "inForNow",
  "in",
  "rethrow",
  "punish",
  "placed",
  "lowered",
  "rescue",
  "ownHalf",
  "ownHalfOut",
];

export function rulingCodes(result) {
  const r = result?.ruling;
  if (!r) return [];
  const parts = Array.isArray(r.parts) ? r.parts.map((p) => p?.code) : [];
  return parts.length ? parts : r.code ? [r.code] : [];
}

export function flagFor(result) {
  if (!result) return null;
  const codes = rulingCodes(result);
  const short = result.ruling?.short || null;
  if (codes.includes("placed") && short) return short;
  if (codes.includes("helicopterCounts"))
    return result.flag === "HELICOPTER" ? short || null : result.flag;
  if (result.flag == null && short && codes.some((c) => KUBB_CODES.includes(c)))
    return short;
  return result.flag ?? null;
}

// The throw to go's verdict (engine 1.4.0, recording.result `togo`): who goes first,
// or throw again, as the flag; how near each baton came to the king as the line under
// it. A baton that knocks the king down loses the throw to go (the engine's core/togo).
// `teams` is the need's { A, B } names.
export function togoWords(r, teams = {}) {
  const name = (s) => teams?.[s] || `Team ${s}`;
  let flag;
  if (r.how === "again")
    flag =
      r.why === "tie"
        ? "A TIE: THROW AGAIN"
        : r.why === "both king"
          ? "BOTH HIT THE KING: THROW AGAIN"
          : "THROW AGAIN";
  else flag = `${name(r.first).toUpperCase()} GOES FIRST`;
  const one = (s) => {
    const x = r[s] || {};
    if (x.toppled) return `${name(s)} hit the king`;
    if (typeof x.mm === "number")
      return `${name(s)} ${(x.mm / 1000).toFixed(2)} m`;
    return name(s);
  };
  return { flag, rest: `${one("A")} · ${one("B")}` };
}
