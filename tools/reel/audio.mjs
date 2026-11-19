// The reel's sound, made offline: the game's own sounds (src/game/sound.js) at the
// reel's times. A knock is one of the nine recorded takes in public/sounds/ (22.05 kHz
// mono), never the last one, at a rate of 1 +- 0.06; the king gets the game's short
// C-G-C chord of triangle waves. Mixed into 16-bit PCM in plain JavaScript: no browser,
// no Web Audio. Deterministic: the takes and rates come from a seeded generator.
//
//   const wav = mixReel(events, seconds)   events: [{ t, kind: "knock"|"king", gain }]
import fs from "node:fs";
import { tune as soundTune, pickTake } from "../../src/game/sound.js";

export const RATE = 44100;

function readWav(file) {
  const b = fs.readFileSync(file);
  let p = 12;
  let fmt = null;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === "fmt ")
      fmt = {
        channels: b.readUInt16LE(p + 10),
        rate: b.readUInt32LE(p + 12),
        bits: b.readUInt16LE(p + 22),
      };
    if (id === "data") {
      if (!fmt || fmt.bits !== 16) throw new Error(`${file}: 16-bit PCM only`);
      const n = size / 2 / fmt.channels;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++)
        out[i] = b.readInt16LE(p + 8 + i * 2 * fmt.channels) / 32768;
      return { rate: fmt.rate, data: out };
    }
    p += 8 + size + (size & 1);
  }
  throw new Error(`${file}: no data`);
}

let takes = null;
function loadTakes(dir = "public/sounds") {
  takes ??= Array.from({ length: soundTune.takes }, (_, i) =>
    readWav(`${dir}/knock-${i + 1}.wav`),
  );
  return takes;
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function mixReel(events, seconds, { seed = 7, dir } = {}) {
  const n = Math.ceil(seconds * RATE);
  const mix = new Float32Array(n);
  const T = loadTakes(dir);
  const rnd = rng(seed);
  let last = -1;
  for (const e of events) {
    const at = Math.round(e.t * RATE);
    if (e.kind === "knock") {
      const k = pickTake(T.length, last, new Set(), rnd);
      last = k;
      const take = T[k];
      const rate = 1 + (rnd() * 2 - 1) * soundTune.rateSpread;
      const step = (take.rate / RATE) * rate;
      const g = soundTune.volume * (e.gain ?? 1);
      for (
        let i = 0, src = 0;
        src < take.data.length - 1 && at + i < n;
        i++, src += step
      ) {
        const j = Math.floor(src);
        const f = src - j;
        mix[at + i] += g * (take.data[j] * (1 - f) + take.data[j + 1] * f);
      }
    } else if (e.kind === "king") {
      for (const [freq, delay] of [
        [523.25, 0],
        [783.99, 0.07],
        [1046.5, 0.14],
      ]) {
        const t0 = at + Math.round(delay * RATE);
        const len = Math.round(0.75 * RATE);
        for (let i = 0; i < len && t0 + i < n; i++) {
          const t = i / RATE;
          const env =
            t < 0.012
              ? (t / 0.012) * soundTune.kingVolume
              : soundTune.kingVolume *
                Math.pow(0.001 / soundTune.kingVolume, (t - 0.012) / 0.688);
          const ph = (t * freq) % 1;
          const tri = 4 * Math.abs(ph - 0.5) - 1;
          mix[t0 + i] += env * tri;
        }
      }
    }
  }
  // a soft limit, then 16-bit PCM in a WAV
  const out = Buffer.alloc(44 + n * 2);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + n * 2, 4);
  out.write("WAVEfmt ", 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(RATE, 24);
  out.writeUInt32LE(RATE * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.tanh(mix[i] * 1.1);
    out.writeInt16LE(Math.round(v * 32000), 44 + i * 2);
  }
  return out;
}
