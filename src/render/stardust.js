// Stardust (the night scene, src/render/night.js): particles in the world,
// driven only by what the engine already hands the renderer for a throw
// (the recording's projectile and timeline, and each shown frame's poses).
// No engine calls, nothing fed back: a look only.
//
//   const fx = new Stardust(config)   config: night.js DUST (counts, colours)
//   fx.watch(recording)               a throw starts playing
//   fx.observe(items, t)              a playback frame at shown time t: emit
//                                     and step by the shown time since the last
//   fx.tick(dt)                       step without a throw (aiming, the rest)
//   fx.clear()                        drop everything (a skipped throw)
//   fx.draw(ctx, cam, kx)             in the frame's transform, additive
//
// What makes dust: a trail behind the thrown baton or kubb (by distance
// travelled, so the frame rate does not change it); a kubb that spins sheds
// dust off its two ends along their own motion, more with more spin (a drill
// most); a puff where two pieces first meet, sized by the contact's strength
// (baton on kubb biggest, kubb on kubb smaller), a small one where the baton
// first lands and where a thrown kubb bounces; and when the king falls, a
// ring of gold along the ground, a fountain and a flash.
//
// The pool is fixed (struct of arrays, `cap` particles): nothing is
// allocated per frame, and a full pool drops new dust rather than old.
import { drawGlow } from "./glow.js";

const KIND = { trail: 0, spin: 1, puff: 2, king: 3, ground: 4 };

function mulberry(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Stardust {
  constructor(cfg) {
    this.cfg = cfg;
    const cap = (this.cap = cfg.cap);
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.z = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.vz = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.col = new Uint8Array(cap);
    this.kind = new Uint8Array(cap);
    this.n = 0;
    this.rng = mulberry(7);
    // the throw being watched
    this.pid = null;
    this.pkind = null;
    this.contacts = [];
    this.ci = 0;
    this.kingT = null;
    this.kingDone = false;
    this.landT = null;
    this.landS = 0;
    this.lastT = null;
    // the projectile's last pose: centre, its two ends, vertical speed
    this.prev = new Float64Array(9);
    this.prevVz = 0;
    this.hasPrev = false;
    this.spinAcc = 0;
    this.trailAcc = 0;
    this.bounced = 0;
    // the king's flash: where, and its age (s), or -1
    this.flash = new Float64Array(3);
    this.flashAge = -1;
    this.flashScale = 1; // a hit's flash (cfg.hitFlash) is smaller than the king's
    this.byId = new Map();
    this.peak = 0; // most particles alive at once since the last clear
  }

  clear() {
    this.n = 0;
    this.flashAge = -1;
    this.pid = null;
    this.contacts = [];
    this.hasPrev = false;
  }

  watch(rec) {
    const tl = rec?.timeline || {};
    this.pid = rec?.projectile?.id ?? null;
    this.pkind = rec?.projectile?.kind ?? null;
    this.contacts = (tl.contacts || []).slice().sort((a, b) => a.t - b.t);
    this.ci = 0;
    const king = (tl.bursts || []).find((b) => b.kind === "king");
    this.kingT = king ? king.start : null;
    this.kingDone = false;
    this.landT = tl.batonLanding ? tl.batonLanding.t : null;
    this.landS = tl.batonLanding ? tl.batonLanding.strength || 0 : 0;
    this.lastT = null;
    this.hasPrev = false;
    this.spinAcc = 0;
    this.trailAcc = 0;
    this.bounced = 0;
    this.rng = mulberry(Math.round((rec?.duration || 1) * 1000) + 13);
  }

  spawn(x, y, z, vx, vy, vz, life, size, col, kind) {
    const i = this.n;
    if (i >= this.cap) return;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
    this.col[i] = col;
    this.kind[i] = kind;
    this.n = i + 1;
    if (this.n > this.peak) this.peak = this.n;
  }

  // A burst of n particles at (x, y, z): speeds round `speed`, lifted by
  // `up`, flattened toward the ground by `flat` (0 a sphere, 1 a disc).
  puff(x, y, z, n, speed, up, flat, life, size, kind, cols) {
    const r = this.rng;
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2;
      const e = (r() * 2 - 1) * (1 - flat);
      const c = Math.sqrt(1 - e * e);
      const s = speed * (0.35 + r() * 0.9);
      this.spawn(
        x,
        y,
        z,
        Math.cos(a) * c * s,
        Math.sin(a) * c * s,
        e * s + up * (0.4 + r()),
        life * (0.6 + r() * 0.7),
        size * (0.6 + r() * 0.8),
        cols[(r() * cols.length) | 0],
        kind,
      );
    }
  }

  observe(items, t) {
    const cfg = this.cfg;
    const dt = this.lastT == null ? 0 : t - this.lastT;
    this.lastT = t;
    const byId = this.byId;
    byId.clear();
    for (const it of items) byId.set(it.id, it);
    const r = this.rng;
    const D = cfg.dust; // colour indices 0..3 of the scene's dust
    // the projectile: its trail and, for a kubb, the dust off its spin
    const p = this.pid != null ? byId.get(this.pid) : null;
    if (p) {
      const hz = this.pkind === "baton" ? 0.15 : 0.075;
      // its long axis (local z) in the world
      const qw = p.qw ?? 1,
        qx = p.qx ?? 0,
        qy = p.qy ?? 0,
        qz = p.qz ?? 0;
      const ax = 2 * (qx * qz + qw * qy),
        ay = 2 * (qy * qz - qw * qx),
        az = 1 - 2 * (qx * qx + qy * qy);
      const e1x = p.x + ax * hz,
        e1y = p.y + ay * hz,
        e1z = p.z + az * hz;
      const e2x = p.x - ax * hz,
        e2y = p.y - ay * hz,
        e2z = p.z - az * hz;
      const P = this.prev;
      if (this.hasPrev && dt > 1e-4 && dt < 0.25) {
        const vx = (p.x - P[0]) / dt,
          vy = (p.y - P[1]) / dt,
          vz = (p.z - P[2]) / dt;
        const speed = Math.hypot(vx, vy, vz);
        const dist = speed * dt;
        // the trail, by distance travelled while it moves fast
        if (speed > cfg.trailFrom && cfg.trailEvery > 0) {
          this.trailAcc += dist / cfg.trailEvery;
          let m = Math.min(cfg.trailMax, this.trailAcc | 0);
          this.trailAcc -= this.trailAcc | 0;
          for (let k = 0; k < m; k++) {
            const u = (k + r()) / Math.max(1, m);
            this.spawn(
              P[0] + (p.x - P[0]) * u + (r() - 0.5) * 0.03,
              P[1] + (p.y - P[1]) * u + (r() - 0.5) * 0.03,
              P[2] + (p.z - P[2]) * u + (r() - 0.5) * 0.03,
              vx * 0.04 + (r() - 0.5) * 0.25,
              vy * 0.04 + (r() - 0.5) * 0.25,
              vz * 0.04 + (r() - 0.5) * 0.2,
              cfg.trailLife * (0.6 + r() * 0.6),
              cfg.trailSize * (0.6 + r() * 0.8),
              D[(r() * 4) | 0],
              KIND.trail,
            );
          }
        }
        // a kubb's spin: each end's motion less the centre's is its turn
        if (this.pkind === "kubb" && cfg.spinRate > 0) {
          const t1x = (e1x - P[3]) / dt - vx,
            t1y = (e1y - P[4]) / dt - vy,
            t1z = (e1z - P[5]) / dt - vz;
          const t2x = (e2x - P[6]) / dt - vx,
            t2y = (e2y - P[7]) / dt - vy,
            t2z = (e2z - P[8]) / dt - vz;
          const tang =
            (Math.hypot(t1x, t1y, t1z) + Math.hypot(t2x, t2y, t2z)) / 2;
          const omega = tang / hz; // rad/s
          if (omega > cfg.spinFrom && p.z > 0.04) {
            this.spinAcc += omega * cfg.spinRate * dt;
            const m = Math.min(cfg.spinMax, this.spinAcc | 0);
            this.spinAcc -= this.spinAcc | 0;
            for (let k = 0; k < m; k++) {
              const end = k & 1;
              const ex = end ? e2x : e1x,
                ey = end ? e2y : e1y,
                ez = end ? e2z : e1z;
              const tx = end ? t2x : t1x,
                ty = end ? t2y : t1y,
                tz = end ? t2z : t1z;
              const fling = 0.55 + r() * 0.5;
              this.spawn(
                ex,
                ey,
                ez,
                vx * 0.3 + tx * fling + (r() - 0.5) * 0.3,
                vy * 0.3 + ty * fling + (r() - 0.5) * 0.3,
                vz * 0.3 + tz * fling + (r() - 0.5) * 0.3,
                cfg.spinLife * (0.6 + r() * 0.7),
                cfg.spinSize * (0.6 + r() * 0.8),
                D[(r() * 4) | 0],
                KIND.spin,
              );
            }
          }
          // a thrown kubb that strikes the ground: falling fast, now not
          if (
            this.bounced < 3 &&
            this.prevVz < -1.2 &&
            vz > this.prevVz + 1.2 &&
            p.z < 0.14
          ) {
            this.bounced++;
            this.puff(
              p.x,
              p.y,
              0.02,
              cfg.groundCount + Math.round(-this.prevVz * 2),
              0.6,
              0.25,
              0.75,
              cfg.puffLife * 0.8,
              cfg.puffSize * 0.8,
              KIND.ground,
              D,
            );
          }
        }
        this.prevVz = vz;
      }
      P[0] = p.x;
      P[1] = p.y;
      P[2] = p.z;
      P[3] = e1x;
      P[4] = e1y;
      P[5] = e1z;
      P[6] = e2x;
      P[7] = e2y;
      P[8] = e2z;
      this.hasPrev = true;
    }
    // the contacts, once each as the picture reaches them
    while (this.ci < this.contacts.length && this.contacts[this.ci].t <= t) {
      const c = this.contacts[this.ci++];
      const a = byId.get(c.idA),
        b = byId.get(c.idB);
      if (!a || !b) continue;
      const s = Math.max(0, Math.min(1, c.strength || 0));
      const baton = c.a === "baton" || c.b === "baton";
      const king = c.a === "king" || c.b === "king";
      if (c.a === "stake" || c.b === "stake") continue;
      const n = baton
        ? cfg.hitCount + Math.round(cfg.hitExtra * s)
        : cfg.knockCount + Math.round(cfg.knockExtra * s);
      if (n <= 0) continue;
      this.puff(
        (a.x + b.x) / 2,
        (a.y + b.y) / 2,
        Math.max(0.03, (a.z + b.z) / 2),
        n,
        (baton ? 1.1 : 0.7) * (0.6 + s),
        0.25,
        0.15,
        cfg.puffLife,
        cfg.puffSize * (baton ? 1 : 0.8),
        KIND.puff,
        king ? cfg.king : D,
      );
      // a scene may flash where the baton hits (the neon)
      if (baton && cfg.hitFlash && this.flashAge < 0) {
        this.flash[0] = (a.x + b.x) / 2;
        this.flash[1] = (a.y + b.y) / 2;
        this.flash[2] = Math.max(0.05, (a.z + b.z) / 2);
        this.flashAge = 0;
        this.flashScale = cfg.hitFlash * (0.6 + 0.4 * s);
        this.flashColor = cfg.hitFlashColor || cfg.flashColor;
      }
    }
    // the baton's first landing on the ground
    if (this.landT != null && this.landT <= t) {
      this.landT = null;
      if (p && cfg.groundCount > 0)
        this.puff(
          p.x,
          p.y,
          0.02,
          cfg.groundCount + Math.round(8 * this.landS),
          0.5,
          0.2,
          0.8,
          cfg.puffLife * 0.7,
          cfg.puffSize * 0.7,
          KIND.ground,
          D,
        );
    }
    // the king falls: a ring of gold on the ground, a fountain, a flash
    if (this.kingT != null && !this.kingDone && t >= this.kingT) {
      this.kingDone = true;
      let k = null;
      for (const it of items) if (it.kind === "king") k = it;
      if (k) {
        const ring = cfg.kingRing;
        for (let i = 0; i < ring; i++) {
          const a = (i / ring) * Math.PI * 2 + r() * 0.2;
          const s = 1.5 + r() * 0.9;
          this.spawn(
            k.x,
            k.y,
            0.03,
            Math.cos(a) * s,
            Math.sin(a) * s,
            0.15 + r() * 0.3,
            cfg.kingLife * (0.7 + r() * 0.5),
            cfg.puffSize * 1.1,
            cfg.king[(r() * 4) | 0],
            KIND.king,
          );
        }
        this.puff(
          k.x,
          k.y,
          Math.max(0.05, k.z),
          cfg.kingFountain,
          0.55,
          2.6,
          0,
          cfg.kingLife,
          cfg.puffSize * 1.2,
          KIND.king,
          cfg.king,
        );
        this.flash[0] = k.x;
        this.flash[1] = k.y;
        this.flash[2] = Math.max(0.1, k.z);
        this.flashAge = 0;
        this.flashScale = 1;
        this.flashColor = cfg.flashColor;
      }
    }
    this.tick(Math.max(0, Math.min(0.1, dt)));
  }

  tick(dt) {
    if (!(dt > 0)) return;
    const g = this.cfg.gravity,
      drag = Math.exp(-this.cfg.drag * dt);
    if (this.flashAge >= 0) {
      this.flashAge += dt;
      if (this.flashAge > this.cfg.flashFor) this.flashAge = -1;
    }
    let i = 0;
    while (i < this.n) {
      const age = (this.age[i] += dt);
      if (age >= this.life[i]) {
        // swap in the last one
        const j = --this.n;
        this.x[i] = this.x[j];
        this.y[i] = this.y[j];
        this.z[i] = this.z[j];
        this.vx[i] = this.vx[j];
        this.vy[i] = this.vy[j];
        this.vz[i] = this.vz[j];
        this.age[i] = this.age[j];
        this.life[i] = this.life[j];
        this.size[i] = this.size[j];
        this.col[i] = this.col[j];
        this.kind[i] = this.kind[j];
        continue;
      }
      this.vx[i] *= drag;
      this.vy[i] *= drag;
      this.vz[i] = this.vz[i] * drag - g * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      let z = this.z[i] + this.vz[i] * dt;
      if (z < 0.005) {
        z = 0.005;
        this.vz[i] *= -0.25;
      }
      this.z[i] = z;
      i++;
    }
  }

  // In the frame's transform (frame px), after the pieces. Additive, so it
  // brightens what is under it and never hides it.
  draw(ctx, cam, kx) {
    if (!this.n && this.flashAge < 0) return;
    const cols = this.cfg.colors;
    const { px, py, pz, fx, fy, fz, rx, ry, rz, ux, uy, uz, f, cx, cy } = cam;
    const minR = 0.7 / kx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    if (this.flashAge >= 0) {
      const X = this.flash[0] - px,
        Y = this.flash[1] - py,
        Z = this.flash[2] - pz;
      const d = X * fx + Y * fy + Z * fz;
      if (d > 0.05) {
        const s = f / d;
        const u = this.flashAge / this.cfg.flashFor;
        const rad = this.cfg.flashSize * this.flashScale * (0.5 + u) * s;
        drawGlow(
          ctx,
          cx + s * (X * rx + Y * ry + Z * rz),
          cy - s * (X * ux + Y * uy + Z * uz),
          rad,
          rad,
          this.flashColor || this.cfg.flashColor,
          this.cfg.flashAlpha * (1 - u) * (1 - u),
        );
      }
    }
    for (let i = 0; i < this.n; i++) {
      const X = this.x[i] - px,
        Y = this.y[i] - py,
        Z = this.z[i] - pz;
      const d = X * fx + Y * fy + Z * fz;
      if (d < 0.05) continue;
      const s = f / d;
      const sx = cx + s * (X * rx + Y * ry + Z * rz),
        sy = cy - s * (X * ux + Y * uy + Z * uz);
      const u = this.age[i] / this.life[i];
      // in fast, out slow; a twinkle on the way out
      const a =
        (u < 0.08 ? u / 0.08 : (1 - u) * (1 - u)) *
        (0.75 + 0.25 * Math.sin(i * 1.7 + this.age[i] * 25));
      const rad = Math.max(minR, this.size[i] * s);
      drawGlow(ctx, sx, sy, rad, rad, cols[this.col[i]], a, true);
    }
    ctx.restore();
  }
}
