// Pure room logic for the Durable Object relay proof of concept. No Workers APIs here,
// so `node --test` can exercise it directly.

export const ROOM_CODE = /^[abcdefghjkmnpqrstuvwxyz23456789]{8,24}$/;
export const OBSERVER_CAST_MS = 100;

// What to do with an incoming act, given the room head and whether the id is stored.
//   dupSeq: the seq the id was stored at, or null when the id is new.
export function decideAct(headSeq, frame, dupSeq) {
  if (dupSeq != null) return { kind: "dup", seq: dupSeq };
  if (!Number.isInteger(frame.seq)) return { kind: "refuse", why: "bad-seq" };
  if (frame.seq !== headSeq + 1)
    return { kind: "refuse", why: "out-of-sequence" };
  return { kind: "accept", seq: frame.seq };
}

// Observers get at most one cast per sender per OBSERVER_CAST_MS, decided on arrival:
// no timers, so the object can still hibernate. The newest sample in a window is
// dropped, not delayed.
export class ObserverThinner {
  constructor(windowMs = OBSERVER_CAST_MS) {
    this.windowMs = windowMs;
    this.last = new Map();
  }
  allow(sender, now) {
    const prev = this.last.get(sender);
    if (prev !== undefined && now - prev < this.windowMs) return false;
    this.last.set(sender, now);
    return true;
  }
}

export function relayCast(m, stamp, frame) {
  return {
    t: "cast",
    m,
    s: stamp.s,
    ts: stamp.ts,
    e: stamp.e,
    st: frame.st,
    c: frame.c,
  };
}

// The relay form of an act never carries the snapshot.
export function relayAct(m, stamp, frame) {
  return {
    t: "act",
    m,
    s: stamp.s,
    ts: stamp.ts,
    e: stamp.e,
    id: frame.id,
    seq: frame.seq,
    a: frame.a,
    h: frame.h,
    st: frame.st,
  };
}
