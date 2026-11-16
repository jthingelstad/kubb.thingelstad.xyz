// The knocks and the king's chord (playdate-kubb AGENTS.md "Knocks"): nine
// recorded takes of a baton on a kubb, played through Web Audio at each
// piece's first touch. A random take, never the last one and, when it can,
// not one still sounding, at a rate of 1 +- rateSpread, so knocks that come
// together overlap as different takes. The king gets a short C-G chord.
//
// Browsers start audio only after a gesture: unlock() on the first pointer
// down. Muted is remembered (prefs "muted").
import { prefs } from "./prefs.js";

export const tune = {
  takes: 9,
  volume: 0.8,
  rateSpread: 0.06,
  takeLength: 0.36, // s, a take's length (for "still sounding")
  kingVolume: 0.18,
};

// Which take to play: random, not `last`, not one of `busy` when there is a
// free one. rnd() in [0, 1).
export function pickTake(n, last, busy = new Set(), rnd = Math.random) {
  const all = [];
  for (let i = 0; i < n; i++) if (i !== last) all.push(i);
  const free = all.filter((i) => !busy.has(i));
  const pool = free.length ? free : all.length ? all : [0];
  return pool[Math.floor(rnd() * pool.length) % pool.length];
}

export class Sound {
  constructor(base = "/sounds/") {
    this.base = base;
    this.ctx = null;
    this.buffers = [];
    this.last = -1;
    this.busy = new Map(); // take -> time it ends
    this.muted = !!prefs.get("muted", false);
    this.loading = null;
  }

  // On the first pointer down: make the context and fetch the takes.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return;
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    this.loading = Promise.all(
      Array.from({ length: tune.takes }, (_, i) =>
        fetch(`${this.base}knock-${i + 1}.wav`)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
          .then((b) => this.ctx.decodeAudioData(b))
          .then((buf) => (this.buffers[i] = buf))
          .catch(() => null),
      ),
    );
  }

  setMuted(on) {
    this.muted = !!on;
    prefs.set("muted", this.muted);
  }

  knock(gain = 1) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const busy = new Set();
    for (const [i, end] of this.busy) if (end > now) busy.add(i);
    const take = pickTake(tune.takes, this.last, busy);
    const buf = this.buffers[take];
    if (!buf) return;
    this.last = take;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * tune.rateSpread;
    const g = ctx.createGain();
    g.gain.value = tune.volume * gain;
    src.connect(g).connect(ctx.destination);
    src.start(now);
    this.busy.set(take, now + tune.takeLength / src.playbackRate.value);
  }

  // The king's chord: C and G, a quick strike and a short ring.
  king() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    for (const [freq, delay] of [
      [523.25, 0],
      [783.99, 0.07],
      [1046.5, 0.14],
    ]) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = freq;
      const g = ctx.createGain();
      const t0 = now + delay;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(tune.kingVolume, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.7);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.75);
    }
  }
}
