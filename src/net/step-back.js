// When an observer first in line for host steps back (leaves and joins again, last in
// line; src/net/pitch.js stepBack, docs/OBSERVER.md). Pure, so the rule is tested alone.
//
// The first step back is at once. While nobody takes host the wait between them doubles
// from tune.stepBackMs to tune.stepBackMaxMs, so two observers on an abandoned pitch do
// not take turns rejoining for as long as their tabs stay open. It starts again from
// the first when a host is connected, or when a member this browser has never seen
// connects: that one may be a player, and it should not wait behind an observer for
// minutes. Observers keep their member id when they rejoin, so their own step backs
// never look like an arrival. Nothing new on the wire.

export function stepBackDelay(steps, tune) {
  if (steps <= 0) return 0;
  return Math.min(tune.stepBackMs * 2 ** (steps - 1), tune.stepBackMaxMs);
}

export class StepBack {
  constructor(tune) {
    this.tune = tune; // read at each call, so a test's tune applies
    this.steps = 0; // step backs since a host was last here or someone new came
    this.last = 0;
    this.seen = new Set();
  }

  // The member ids connected now. True when one of them is new (not on the first look).
  see(ids) {
    const first = this.seen.size === 0;
    let fresh = false;
    for (const id of ids) {
      if (this.seen.has(id)) continue;
      this.seen.add(id);
      if (!first) fresh = true;
    }
    if (fresh) this.reset();
    return fresh;
  }

  // A host is connected: the next time it is gone, start from the first wait.
  reset() {
    this.steps = 0;
  }

  // How long from now until a step back is allowed (0: now).
  waitAt(now) {
    if (this.steps === 0) return 0;
    return Math.max(0, this.last + stepBackDelay(this.steps, this.tune) - now);
  }

  due(now) {
    return this.waitAt(now) === 0;
  }

  took(now) {
    this.steps += 1;
    this.last = now;
  }
}
