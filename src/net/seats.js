// Who acts in a shared match (docs/DESIGN.md 4.3, docs/MULTIPLAYER.md).
// Pure: tested in tests/net/seats.test.mjs.
//
// ctx = {
//   players:   { A: [{ id, name }], B: [...] }   the match's players (doc.match.players)
//   cpu:       "A" | "B" | null                  the computer's side
//   host:      memberId                          the room's host now
//   connected: Set of member ids connected now
// }
//
// - A throw is for the member whose player the engine names
//   (need.setup.thrower.key). If they are not connected, the first connected
//   member of that team in throwing order takes it (it is still that
//   player's throw on the sheet); failing that, the host.
// - A raise or a punishment kubb is for any connected member of the defending
//   team (need.side), else the host. The room's compare-and-set settles two
//   at once: the loser adopts the winner's snapshot.
// - The computer's throws are the host's browser's (cpu: true), and only its.

const isConnected = (ctx, id) => !!id && ctx.connected.has(id);

export function teamIds(ctx, side) {
  return (ctx.players?.[side] || []).map((p) => p.id);
}

// The members who may act for `need` now (an array; [] for nobody).
export function actorsFor(need, ctx) {
  if (!need || need.kind === "over" || need.practice) return [];
  const side = need.side;
  if (need.kind === "throw") {
    if (need.cpu || side === ctx.cpu) return ctx.host ? [ctx.host] : [];
    const owner = need.setup?.thrower?.key;
    if (isConnected(ctx, owner)) return [owner];
    const mate = teamIds(ctx, side).find((id) => isConnected(ctx, id));
    if (mate) return [mate];
    return ctx.host ? [ctx.host] : [];
  }
  if (need.kind === "raise" || need.kind === "punish") {
    const mates = teamIds(ctx, side).filter((id) => isConnected(ctx, id));
    if (mates.length) return mates;
    return ctx.host ? [ctx.host] : [];
  }
  return [];
}

// May member `me` act for `need`? Never for the computer's throw: the
// engine throws it by itself in the browser with control.cpu.
export function mayAct(need, ctx, me) {
  if (!need || need.cpu) return false;
  return actorsFor(need, ctx).includes(me);
}

// The member shown as the one acting (the first who may), or "cpu".
export function shownActor(need, ctx) {
  if (!need) return null;
  if (need.kind === "throw" && (need.cpu || need.side === ctx.cpu))
    return "cpu";
  return actorsFor(need, ctx)[0] || null;
}

// The engine's control for this browser (engine.setControl): the human
// sides it may ever act for (its own team's, and every human side when it
// is the host, who stands in for anyone), and the computer when it is the
// host. mayAct() above decides throw by throw; this only lets the engine
// accept the input.
export function controlFor(ctx, me) {
  const sides = [];
  for (const s of ["A", "B"]) {
    if (s === ctx.cpu) continue;
    if (me === ctx.host || teamIds(ctx, s).includes(me)) sides.push(s);
  }
  return { sides, cpu: me === ctx.host };
}

export function sameControl(a, b) {
  return (
    !!a &&
    !!b &&
    a.cpu === b.cpu &&
    a.sides.length === b.sides.length &&
    a.sides.every((s, i) => s === b.sides[i])
  );
}

// The team member `me` plays for in this match, or null (watching).
export function playingSide(ctx, me) {
  for (const s of ["A", "B"]) if (teamIds(ctx, s).includes(me)) return s;
  return null;
}

// The next host when the host has gone: the room lets only the
// earliest-joined connected member claim (docs/ROOMS.md 2.4), so that is who
// tries. members: the room's list in joined order.
export function nextHost(members, host) {
  const h = members.find((m) => m.id === host);
  if (h && h.connected) return null;
  const next = members.find((m) => m.connected && m.id !== host);
  return next ? next.id : null;
}
