// Aim on the wire (docs/MULTIPLAYER.md "Aim"): the thrower's aim sent as casts at up to
// 15 a second, and the watcher's picture of it drawn about 100 ms behind, between the
// samples rather than jumping from one to the next. Pure: no sockets, no clock of its
// own, so tests/net/aim.test.mjs holds the maths. The iPhone app follows the same rules
// (its docs/ONLINE.md).
//
// The sender (AimSender): while it is this browser's throw, the engine's aimState() is
// sampled on a timer and sent when it changed, never more often than `hz`; a shout
// spends a slot too, so the two together stay under the pitch server's cast limit (16 a
// second). Each sample is { t: "aim", s: state, k, c }: `k` counts this browser's aim
// samples, `c` is its clock when taken. The release's frame, the aim as it stood just
// before the throw went, is sent with `all: true`, which the server never thins, so
// every watcher sees where the swing let go.
//
// The receiver (AimBuffer): each sample is kept with the server's `ts` (the time the
// pitch relayed it). The page's clock and the server's differ by an offset plus the
// network's delay; the smallest gap seen (arrival - ts) over recent samples stands for
// both. The aim is drawn as it was `delayMs` before the newest the network could have
// brought: render time = now - offset - delayMs, in the server's time. Between the two
// samples around it, the continuous fields go in a straight line; the rest (which phase
// the swing is in, what is set) are the earlier sample's. Never across a new throw
// (`seq`) or another sender. Past the newest sample it holds the newest.
//
// An action that ends a throw waits for its aim to play out (holdFor): the watcher sees
// the swing let go and then the throw, never the throw first. At most `holdMaxMs`.

export const aimTune = {
  hz: 15, // samples a second at most
  delayMs: 100, // how far behind the watcher draws
  offsetSamples: 40, // the clock offset is the smallest gap over this many samples
  keep: 48, // samples kept for drawing
  holdMaxMs: 250, // the longest an action waits for its aim
  staleMs: 1500, // a sender silent this long is not waited for
};

// The fields drawn in a straight line between samples; `arm` is an angle in degrees.
const LINEAR = ["x", "y", "tx", "ty", "release", "tilt", "spin", "back", "mix"];

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export class AimSender {
  constructor({ hz = aimTune.hz } = {}) {
    this.gapMs = 1000 / hz;
    this.last = -Infinity; // when a cast last went
    this.key = null; // what the last sample said
    this.k = 0;
  }

  // A cast went for something else (a shout): the slot is used.
  spend(now) {
    this.last = now;
  }

  // The sample to send now, or null (too soon, or nothing changed). `force` sends it
  // even when unchanged and too soon: the release's frame.
  sample(state, now, { force = false } = {}) {
    if (!state || typeof state !== "object") return null;
    const key = JSON.stringify(state);
    if (!force) {
      if (now - this.last < this.gapMs - 1) return null;
      if (key === this.key) return null;
    }
    this.key = key;
    this.last = now;
    this.k++;
    return { t: "aim", s: state, k: this.k, c: Math.round(now) };
  }

  // A new throw: the next sample goes whatever the last one said.
  reset() {
    this.key = null;
  }
}

// a and b's continuous fields at u (0..1) between them; the rest a's.
export function lerpAim(a, b, u) {
  if (!b || u <= 0) return a;
  if (u >= 1) return b;
  const out = { ...a };
  for (const f of LINEAR)
    if (isNum(a[f]) && isNum(b[f])) out[f] = a[f] + (b[f] - a[f]) * u;
  if (isNum(a.arm) && isNum(b.arm)) {
    // the shorter way round; a jump of half a turn or more is not drawn between
    let d = b.arm - a.arm;
    if (d > 180) d -= 360;
    else if (d < -180) d += 360;
    if (Math.abs(d) < 180) {
      let arm = a.arm + d * u;
      if (arm < 0) arm += 360;
      else if (arm >= 360) arm -= 360;
      out.arm = arm;
    }
  }
  return out;
}

export class AimBuffer {
  constructor(tune = {}) {
    this.tune = { ...aimTune, ...tune };
    this.samples = []; // { from, ts, s, k }, in ts order
    this.gaps = []; // arrival - ts, the newest offsetSamples
    this.offset = null;
    this.drawn = null; // the last state at() answered, so callers can skip a redraw
  }

  // A cast from the pitch: { from, d, ts } as the pitch client gives it, and when it
  // came (this page's Date.now()).
  push({ from, d, ts }, arrival) {
    if (!d || d.t !== "aim" || !d.s || typeof d.s !== "object") return false;
    if (!isNum(ts)) ts = arrival;
    this.gaps.push(arrival - ts);
    if (this.gaps.length > this.tune.offsetSamples) this.gaps.shift();
    this.offset = Math.min(...this.gaps);
    const last = this.samples.at(-1);
    // the same sender's older sample, late: nothing to draw from it. A lower count
    // stamped later is the sender's page reloaded (its count starts again), drawn.
    if (
      last &&
      last.from === from &&
      isNum(d.k) &&
      isNum(last.k) &&
      d.k <= last.k &&
      ts <= last.ts
    )
      return false;
    const e = { from, ts, s: d.s, k: d.k ?? null };
    // keep ts order (two senders' casts may cross)
    let i = this.samples.length;
    while (i > 0 && this.samples[i - 1].ts > ts) i--;
    this.samples.splice(i, 0, e);
    if (this.samples.length > this.tune.keep) this.samples.shift();
    return true;
  }

  // The render time for `now`, in the server's time.
  renderTime(now) {
    return now - (this.offset ?? 0) - this.tune.delayMs;
  }

  // The aim to draw at `now`, or null when there is none.
  at(now) {
    const list = this.samples;
    if (!list.length) return null;
    const t = this.renderTime(now);
    let i = list.length - 1;
    while (i > 0 && list[i].ts > t) i--;
    const a = list[i];
    const b = list[i + 1];
    let s = a.s;
    if (a.ts > t)
      s = a.s; // before the first: the first
    else if (b && b.from === a.from && b.s.seq === a.s.seq && b.ts > a.ts)
      s = lerpAim(a.s, b.s, (t - a.ts) / (b.ts - a.ts));
    this.drawn = s;
    return s;
  }

  // How long an action relayed at server time `ts` should wait so the aim before it
  // has been drawn (0 when there is no recent aim to wait for).
  holdFor(ts, now) {
    const last = this.samples.at(-1);
    if (!last || !isNum(ts) || this.offset == null) return 0;
    if (ts - last.ts > this.tune.staleMs) return 0;
    const due = ts + this.offset + this.tune.delayMs;
    return Math.max(0, Math.min(this.tune.holdMaxMs, due - now));
  }

  clear() {
    this.samples = [];
    this.drawn = null;
  }
}
