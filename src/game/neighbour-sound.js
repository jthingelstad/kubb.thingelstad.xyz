// The Tournament's other pitches heard (the owner, 2026-11-22: "We should hear the sounds
// from the other pitches."): the game's own knocks (src/game/sound.js), quiet and far, cued
// from each neighbour's recording (src/game/neighbours.js): a knock when a kubb topples
// (its body's `toppleT`), a softer, lower one when the thrown piece lands (the first
// frame of its poses on the ground after it flew), and a louder one when a king goes
// down. Pure but for the playing, which is Sound.distant's.
//
// Loudness falls with the distance between the player's pitch and the neighbour's
// (gainFor): the pitch beside is clearly heard, never as loud as the player's own throw,
// and the far row is faint. Left or right from where the pitch lies across the view
// (panFor). Never more than tune.voices at once (Sound.distant drops the faintest).
// Silent with the Sound setting off, in a hidden tab, under a card or while paused,
// under reduced motion (no neighbours run there) and in the embed (no sound), and
// never within tune.ownGap of the player's own knock (Game.neighbourSounds).
export const tune = {
  // the knock's gain at 8 m (the pitch beside), against the player's own 0.72
  // (sound.js volume 0.8 x 0.9): about 10 dB under it
  near: 0.22,
  nearM: 8, // m between pitch origins where `near` holds
  fall: 1.5, // the gain falls as (nearM / d) ^ fall: 12 m 0.12, 14.4 m 0.09, 24 m 0.04
  floor: 0.02, // under this a cue is not played at all
  king: 1.5, // a king going down, of a kubb's knock
  land: 0.55, // the thrown piece landing, of a kubb's knock
  landRate: 0.72, // played lower (a thud on grass, not wood on wood)
  rate: 0.9, // every neighbour knock a little lower than the player's (farther)
  pan: 0.8, // the most a pitch is put to one side
  voices: 3, // neighbour knocks sounding at once, at most
  ownGap: 0.5, // s around the player's own knock with no neighbour sound
  stale: 0.3, // s: a cue this late when it reaches the page is dropped, not played
  landZ: 0.06, // m: the thrown piece's centre this low is on the ground
  flewZ: 0.2, // m: ... once it has been this high
};

// The cues of one neighbour throw's recording, in seconds after its release, in time
// order: [{ t, kind: "hit" | "king" | "land" }].
export function cuesOf(rec) {
  if (!rec?.bodies) return [];
  const out = [];
  const pid = rec.projectile?.id;
  const k = rec.poseScale || 1000;
  for (const b of rec.bodies) {
    if (b.id === pid) {
      // the first frame on the ground after it flew
      let flew = false;
      for (let j = 0; j < b.frames; j++) {
        const z = b.poses[j * 7 + 2] / k;
        if (z > tune.flewZ) flew = true;
        else if (flew && z <= tune.landZ) {
          out.push({ t: (b.start + j) * rec.frameDt, kind: "land" });
          break;
        }
      }
    } else if (b.toppleT !== undefined && b.toppleT !== null)
      out.push({ t: b.toppleT, kind: b.kind === "king" ? "king" : "hit" });
  }
  return out.sort((a, b) => a.t - b.t);
}

// A cue's gain for a pitch whose origin is `d` m from the player's, or 0 (not played).
export function gainFor(d, kind = "hit") {
  const g =
    tune.near *
    Math.min(1, (tune.nearM / Math.max(1, d)) ** tune.fall) *
    (kind === "king" ? tune.king : kind === "land" ? tune.land : 1);
  return g < tune.floor ? 0 : g;
}

// The left-right balance of a point (x, y) on the ground (the drawn frame) seen by a
// camera: -tune.pan (left) to tune.pan (right), from where it lies across the view.
export function panFor(cam, x, y) {
  if (!cam) return 0;
  const dx = x - cam.px,
    dy = y - cam.py;
  const l = Math.hypot(dx, dy);
  if (l < 1e-6) return 0;
  const across = (dx * cam.rx + dy * cam.ry) / l;
  return Math.max(-tune.pan, Math.min(tune.pan, across));
}

// The playback rate for a cue.
export function rateFor(kind) {
  return kind === "land" ? tune.landRate : tune.rate;
}

// Which voices to keep when a new one would make more than `max`: the faintest goes,
// the new one among them. voices: [{ gain }]; returns { play: bool, stop: voice | null }.
export function capVoices(voices, gain, max = tune.voices) {
  if (voices.length < max) return { play: true, stop: null };
  let low = voices[0];
  for (const v of voices) if (v.gain < low.gain) low = v;
  if (gain <= low.gain) return { play: false, stop: null };
  return { play: true, stop: low };
}
