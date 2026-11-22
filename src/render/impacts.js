// Where a piece meets the ground hard (the engine's ground impacts, its docs/SESSION.md
// "Ground impacts", since 0.14; the game asks for them with setImpacts): a scene draws
// something at each, timed by the throw's own clock. Techno rings (the owner,
// 2026-11-21: "when something hits the floor it should give a visual ring on
// impact"); Beach puffs sand and Minnesota sprays snow.
//
//   const fx = new Impacts({ style, reduced, colors })
//   fx.watch(rec)          a throw starts playing: its timeline.impacts
//   fx.observe(items, t)   a playback frame at shown time t (slow motion included):
//                          every impact whose t is reached starts, and the live
//                          ones age by the shown time gone by
//   fx.tick(dt)            after the throw: they age by real time
//   fx.draw(ctx, cam, kx)  in drawWorld's frame
//
// A ring is a circle on the ground growing from its spot, sized by how fast the piece
// came down (`speed`, m/s) and fading as it grows. With prefers-reduced-motion it does
// not grow: a ring at its middle size fades out where it struck. A puff is a small
// cartoon cloud of the ground's colour, inked, that swells, rises a little and
// shrinks away; reduced, it only shrinks where it struck. Nothing here is in a snapshot, an action or a hash.
import { project, projectPoly } from "./camera.js";

export const tune = {
  ringLife: 0.75, // s of the throw's clock
  ringFrom: 0.06, // m, its radius at the strike
  ringBase: 0.22, // m, its last radius: base + perSpeed * speed, at most ringMax
  ringPerSpeed: 0.17,
  ringMax: 0.95,
  ringReduced: 0.45, // its share of the last radius, held still, with reduced motion
  ringCore: 1.4, // CSS px, the ring's line
  ringNear: 2.2, // m: a ring nearer the camera than this is not drawn
  ringGlow: [
    [7, 0.16],
    [3.5, 0.3],
  ], // CSS px wide, alpha: its bloom
  puffLife: 0.55,
  puffFrom: 1.4, // m/s: a softer strike raises nothing
  puffSize: 0.045, // m, a disc's radius at its fullest (times the strike's weight)
  puffRise: 0.12, // m it rises over its life
  puffMaxPx: 11, // CSS px, a disc's largest radius on the screen
  max: 40, // live at once
};

// The ring's colour for a piece: its side's light, the king's own, else the baton's.
function colorOf(imp, colors) {
  if (imp.with === "king") return colors.king;
  if (typeof imp.id === "string" && /^a\d/.test(imp.id)) return colors.A;
  if (typeof imp.id === "string" && /^b\d/.test(imp.id)) return colors.B;
  return colors.baton;
}

const ease = (u) => 1 - (1 - u) * (1 - u);

export class Impacts {
  // style: "ring" or "puff"; colors: { A, B, king, baton } for rings, { puff: [...] }
  // for puffs
  constructor({ style = "ring", reduced = false, colors = {} } = {}) {
    this.style = style;
    this.reduced = reduced;
    this.colors = colors;
    this.list = [];
    this.next = 0;
    this.live = [];
    this.lastT = null;
  }
  clear() {
    this.list = [];
    this.next = 0;
    this.live = [];
    this.lastT = null;
  }
  watch(rec) {
    const tl = rec?.timeline || {};
    this.list = (tl.impacts || [])
      .filter((i) => Number.isFinite(i?.t))
      .slice()
      .sort((a, b) => a.t - b.t);
    this.next = 0;
    this.live = [];
    this.lastT = null;
  }
  observe(items, t) {
    const dt = this.lastT == null ? 0 : t - this.lastT;
    this.lastT = t;
    if (dt > 0) this.age(dt);
    while (this.next < this.list.length && this.list[this.next].t <= t) {
      const imp = this.list[this.next++];
      if (this.style === "puff" && !((imp.speed ?? 0) >= tune.puffFrom))
        continue;
      if (this.live.length >= tune.max) this.live.shift();
      this.live.push({ imp, age: Math.max(0, t - imp.t) });
    }
  }
  tick(dt) {
    if (dt > 0) this.age(dt);
  }
  age(dt) {
    const life = this.style === "ring" ? tune.ringLife : tune.puffLife;
    for (const l of this.live) l.age += dt;
    this.live = this.live.filter((l) => l.age < life);
  }
  // The rings' radii now, for tests: [{ id, t, r, alpha }].
  state() {
    return this.live.map((l) => ({
      id: l.imp.id,
      t: l.imp.t,
      ...this.ringAt(l),
    }));
  }
  ringAt(l) {
    const u = Math.min(1, l.age / tune.ringLife);
    const last = Math.min(
      tune.ringMax,
      tune.ringBase + tune.ringPerSpeed * (l.imp.speed ?? 1),
    );
    const r = this.reduced
      ? last * tune.ringReduced
      : tune.ringFrom + (last - tune.ringFrom) * ease(u);
    return { r, alpha: (1 - u) * (1 - u * 0.3) };
  }
  draw(ctx, cam, kx) {
    if (!this.live.length) return;
    if (this.style === "ring") this.drawRings(ctx, cam, kx);
    else this.drawPuffs(ctx, cam, kx);
  }
  drawRings(ctx, cam, kx) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineJoin = "round";
    for (const l of this.live) {
      const { r, alpha } = this.ringAt(l);
      // a strike right under the camera (the impact camera's close shots) would ring
      // across the whole screen: those are left out
      const c = project(cam, l.imp.x, l.imp.y, 0);
      if (!c || c[2] < tune.ringNear) continue;
      const n = 40;
      const xs = [],
        ys = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        xs.push(l.imp.x + r * Math.cos(a));
        ys.push(l.imp.y + r * Math.sin(a));
      }
      const p = projectPoly(cam, xs, ys, null, n);
      if (p.length < 6) continue;
      const color = colorOf(l.imp, this.colors);
      ctx.strokeStyle = color;
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
        ctx.closePath();
      };
      for (const [w, a] of tune.ringGlow) {
        ctx.globalAlpha = a * alpha;
        ctx.lineWidth = w / kx;
        path();
        ctx.stroke();
      }
      ctx.globalAlpha = alpha;
      ctx.lineWidth = tune.ringCore / kx;
      path();
      ctx.stroke();
    }
    ctx.restore();
  }
  // A puff: a small cartoon cloud of three discs of the ground's colour with the ink
  // line, swelling a little and rising, then shrinking away (no tint over the
  // pitch: the flat style has none).
  drawPuffs(ctx, cam, kx) {
    const cols = this.colors.puff || ["#e8cf98"];
    const ink = this.colors.ink || "#16130f";
    ctx.save();
    ctx.lineJoin = "round";
    for (const l of this.live) {
      const u = Math.min(1, l.age / tune.puffLife);
      const k = Math.min(1.5, 0.55 + (l.imp.speed ?? 1) * 0.28);
      // swell to the middle of its life, then shrink to nothing
      const grow = this.reduced
        ? 1 - u
        : u < 0.4
          ? 0.6 + ease(u / 0.4) * 0.6
          : 1.2 * (1 - ease((u - 0.4) / 0.6));
      if (grow <= 0.02) continue;
      const rise = this.reduced ? 0 : tune.puffRise * ease(u) * k;
      const discs = [];
      for (let j = 0; j < 3; j++) {
        const ox = (j - 1) * tune.puffSize * 1.1 * k;
        const p = project(
          cam,
          l.imp.x + ox,
          l.imp.y,
          tune.puffSize * k * (j === 1 ? 1.3 : 0.9) + rise,
        );
        if (!p) continue;
        // never larger than puffMaxPx on the screen: a strike under a close camera
        // stays a small cloud
        const rr =
          Math.min(tune.puffMaxPx / kx, (tune.puffSize * k * cam.f) / p[2]) *
          grow *
          (j === 1 ? 1.25 : 0.9);
        discs.push([p[0], p[1], rr, cols[j % cols.length]]);
      }
      if (!discs.length) continue;
      const w = Math.max(0.8, Math.min(2.2, discs[0][2] * kx * 0.12)) / kx;
      ctx.strokeStyle = ink;
      ctx.lineWidth = w * 2;
      ctx.beginPath();
      for (const [x, y, r] of discs) {
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx.stroke();
      for (const [x, y, r, c] of discs) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
