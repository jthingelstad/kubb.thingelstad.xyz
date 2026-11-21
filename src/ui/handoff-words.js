// The hand-off card's bases line for a watcher: a browser with no side in the match
// (an observer, a member who watches instead, watching the computer). The engine's
// `baseText` ("YOUR BASE 4", "THEIRS 5"; core/cards.lua, not edited here) speaks to
// the team the card goes to, so a watcher gets each team by name with its standing
// base kubbs from the card's `base` ({ from's, to's }): "NORTH BASE 5", "SOUTH BASE 4".
// The far team first, as the card's map beside it draws the pitch in the receiving
// team's view frame (it throws from the foot). Pure, so it is tested alone.

export function watcherBases(c, need = null) {
  if (!c || !Array.isArray(c.base) || c.base.length < 2) return [];
  const to = c.to === "B" ? "B" : "A";
  const from = c.from || (to === "A" ? "B" : "A");
  const name = (side, own) =>
    String(need?.teams?.[side] || own || `Team ${side}`).toUpperCase();
  return [
    `${name(from, c.fromName)} BASE ${c.base[0]}`,
    `${name(to, c.toName)} BASE ${c.base[1]}`,
  ];
}
