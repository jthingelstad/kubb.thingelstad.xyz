// Who acts in a shared match (docs/DESIGN.md 4.3, docs/MULTIPLAYER.md "Who acts"):
// the engine's rules (vendor/engine/pitch/seats.lua), thin wrappers over `pitch.<name>`.
//
// ctx = {
//   players:   { A: [{ id, name }], B: [...] }   the match's players (doc.match.players)
//   cpu:       "A" | "B" | null                  the computer's side
//   host:      memberId                          the room's host now
//   connected: [memberId, ...]                   the members connected now
// }
//
// The render loop asks mayAct and shownActor every frame (game.mayAct, the HUD's
// line), and the controller's clock five times a second: each answer is kept until
// the need, the ctx object or the member changes, so the bridge is crossed only when
// one does. The Pitch keeps one ctx object while nothing in it changes (Pitch.ctx).
import { roomCall } from "./room-engine.js";

function kept(fn) {
  let last = null;
  return (...keys) => {
    if (
      last &&
      last.keys.length === keys.length &&
      last.keys.every((k, i) => k === keys[i])
    )
      return last.value;
    const value = fn(...keys);
    last = { keys, value };
    return value;
  };
}

export const teamIds = (ctx, side) => roomCall("teamIds", { ctx, side });

// The members who may act for `need` now (an array; [] for nobody).
export const actorsFor = kept((need, ctx) =>
  roomCall("actorsFor", { need, ctx }),
);

// May member `me` act for `need`? Never for the computer's throw.
export const mayAct = kept((need, ctx, me) =>
  roomCall("mayAct", { need, ctx, me }),
);

// The member shown as the one acting (the first who may), "cpu", or null.
export const shownActor = kept((need, ctx) =>
  roomCall("shownActor", { need, ctx }),
);

// The engine's control for this browser (engine.setControl): { sides, cpu }, and
// (engine 1.4) given a throw to go's need, `togo`: the sides whose baton this browser
// throws. Any other need, or none, is left out.
export const controlFor = kept((ctx, me, need = null) =>
  roomCall(
    "controlFor",
    need?.kind === "togo" ? { ctx, me, need } : { ctx, me },
  ),
);

export const sameControl = (a, b) =>
  a === b ? !!a : roomCall("sameControl", { a, b });

// The side member `me` plays for in this match, or null (watching).
export const playingSide = kept((ctx, me) =>
  roomCall("playingSide", { ctx, me }),
);

// The next host when the host has gone: the earliest-joined connected member.
// members: the room's list in joined order (a new array on every change).
export const nextHost = kept((members, host) =>
  roomCall("nextHost", { members, host }),
);
