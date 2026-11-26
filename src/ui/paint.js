// The feedback card's picture of the pitch (docs/CLIENT.md "Reports"; the owner,
// 2026-11-26: "show an image of the pitch and allow the user to paint over the area
// where the issue occurred instead of selecting individual pieces"). The pitch from
// above as it stood, from the pieces the report captured (the last throw's rest when
// there is one, else the pitch now): the lines, the king, the kubbs and the batons at
// their real places and sizes, a standing piece solid with an ink ring and one lying
// down pale with a thin line. The player paints over it with a finger or the mouse, a
// translucent brush, with UNDO and CLEAR. Painting never scrolls the card (the picture
// takes its own touches); a scroll outside it scrolls the card as ever.
//
// The far baseline is at the top when the picture stands upright (a narrow card), or
// at the right when it lies (a wide one): whichever shows the pitch bigger.
import { h, button } from "./dom.js";
import {
  PAINT_LIMITS,
  footprint,
  normalizePaint,
  pictureBounds,
} from "../net/paint.js";
import { TEAM, GROUND } from "../render/palette.js";

export const paintTune = {
  brushPx: 13, // the brush's radius on the screen, before its metres are rounded
  maxH: 0.55, // of the window's height: the most the picture may stand
  minH: 190, // px: but never under this
  step: 0.35, // of the brush: a point is kept once the finger moved this far
  ink: "#16130f",
  paint: "rgba(226, 72, 61, 0.45)",
  paintSolid: "#e2483d",
  wood: "#c8955a",
  king: "#f4ecd8",
};

// The picture's mapping for a box `width` wide with at most `maxH` of height.
// { upright, scale (px a metre), w, h, toPx([x, y]), toM(px, py) }
export function pictureFit(bounds, width, maxH) {
  const across = bounds.x1 - bounds.x0;
  const along = bounds.y1 - bounds.y0;
  const up = Math.min(width / across, maxH / along);
  const side = Math.min(width / along, maxH / across);
  const upright = up >= side;
  const scale = upright ? up : side;
  const w = Math.floor((upright ? across : along) * scale);
  const hh = Math.floor((upright ? along : across) * scale);
  const toPx = upright
    ? ([x, y]) => [(x - bounds.x0) * scale, (bounds.y1 - y) * scale]
    : ([x, y]) => [(y - bounds.y0) * scale, (x - bounds.x0) * scale];
  const toM = upright
    ? (px, py) => [bounds.x0 + px / scale, bounds.y1 - py / scale]
    : (px, py) => [bounds.x0 + py / scale, bounds.y0 + px / scale];
  return { upright, scale, w, h: hh, toPx, toM };
}

export class PaintPad {
  // pieces: the report's captured pieces (src/net/report.js pickPieces)
  constructor(pieces, { win = globalThis } = {}) {
    this.pieces = pieces.filter(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
    );
    this.win = win;
    this.bounds = pictureBounds(this.pieces);
    this.strokes = [];
    this.live = null;
    this.canvas = h("canvas.report-paint-canvas", {
      role: "img",
      "aria-label":
        "The pitch from above, as it stood. Paint on it with a finger or the mouse.",
      "data-test": "report-paint",
    });
    this.undoBtn = button("UNDO", () => this.undo(), "small", {
      "data-test": "report-paint-undo",
      disabled: true,
    });
    this.clearBtn = button("CLEAR", () => this.clear(), "small", {
      "data-test": "report-paint-clear",
      disabled: true,
    });
    this.full = h("p.report-paint-full", { hidden: true, role: "status" });
    this.el = h(
      "div.report-paint",
      h("p.report-hint", "If it helps, paint where it happened on the pitch."),
      h("div.report-paint-frame", this.canvas),
      h("div.report-paint-tools", this.undoBtn, this.clearBtn, this.full),
    );
    this.listen();
    this.ro =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => this.fit())
        : null;
    this.ro?.observe(this.el);
  }

  // The paint as the message carries it, or null.
  value() {
    if (!this.strokes.length || !this.fitted) return null;
    return normalizePaint({ brush: this.brush, strokes: this.strokes });
  }

  get points() {
    return this.strokes.reduce((n, s) => n + s.length, 0);
  }

  fit() {
    // the frame's ink line is 3 px each side of the canvas
    const width = Math.floor(this.el.clientWidth) - 6;
    if (width <= 0) return;
    const maxH = Math.max(
      paintTune.minH,
      (this.win.innerHeight ?? 600) * paintTune.maxH,
    );
    const f = pictureFit(this.bounds, width, maxH);
    if (
      this.fitted &&
      this.fitted.w === f.w &&
      this.fitted.h === f.h &&
      this.fitted.upright === f.upright
    )
      return;
    this.fitted = f;
    // the brush's metres are fixed by the first fit, so a resize keeps them
    this.brush ??=
      Math.round(
        Math.min(
          PAINT_LIMITS.brushMax,
          Math.max(0.1, paintTune.brushPx / f.scale),
        ) * 100,
      ) / 100;
    const dpr = Math.min(3, this.win.devicePixelRatio || 1);
    this.canvas.width = Math.round(f.w * dpr);
    this.canvas.height = Math.round(f.h * dpr);
    this.canvas.style.width = `${f.w}px`;
    this.canvas.style.height = `${f.h}px`;
    this.dpr = dpr;
    this.draw();
  }

  listen() {
    const c = this.canvas;
    const at = (e) => {
      const r = c.getBoundingClientRect();
      return this.fitted.toM(
        e.clientX - r.left - c.clientLeft,
        e.clientY - r.top - c.clientTop,
      );
    };
    c.addEventListener("pointerdown", (e) => {
      if (!this.fitted || this.live || e.button > 0) return;
      if (
        this.strokes.length >= PAINT_LIMITS.strokes ||
        this.points >= PAINT_LIMITS.points
      ) {
        this.say();
        return;
      }
      e.preventDefault();
      c.setPointerCapture?.(e.pointerId);
      this.live = { id: e.pointerId, pts: [at(e)] };
      this.strokes.push(this.live.pts);
      this.changed();
    });
    c.addEventListener("pointermove", (e) => {
      if (!this.live || e.pointerId !== this.live.id) return;
      e.preventDefault();
      const p = at(e);
      const last = this.live.pts[this.live.pts.length - 1];
      if (
        Math.hypot(p[0] - last[0], p[1] - last[1]) <
        this.brush * paintTune.step
      )
        return;
      if (this.points >= PAINT_LIMITS.points) {
        this.say();
        return;
      }
      this.live.pts.push(p);
      this.draw();
    });
    const end = (e) => {
      if (!this.live || e.pointerId !== this.live.id) return;
      this.live = null;
      this.changed();
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    // a finger on the picture paints; it never scrolls or zooms the card
    c.addEventListener("touchstart", (e) => e.preventDefault(), {
      passive: false,
    });
  }

  say() {
    this.full.hidden = false;
    this.full.textContent = "That is as much paint as one report can carry.";
  }

  changed() {
    this.canvas.dataset.strokes = String(this.strokes.length);
    this.undoBtn.disabled = !this.strokes.length;
    this.clearBtn.disabled = !this.strokes.length;
    if (
      this.strokes.length < PAINT_LIMITS.strokes &&
      this.points < PAINT_LIMITS.points
    )
      this.full.hidden = true;
    this.draw();
  }

  undo() {
    this.live = null;
    this.strokes.pop();
    this.changed();
  }

  clear() {
    this.live = null;
    this.strokes = [];
    this.changed();
  }

  set disabled(on) {
    this.el.inert = on;
    this.el.classList.toggle("is-locked", on);
  }

  draw() {
    const f = this.fitted;
    if (!f) return;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const t = paintTune;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const G = GROUND.grass;
    ctx.fillStyle = G.rough;
    ctx.fillRect(0, 0, f.w, f.h);
    // the pitch, 5 by 8, and its lines
    const poly = (pts) => {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [x, y] = f.toPx(p);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.closePath();
    };
    poly([
      [-2.5, 0],
      [2.5, 0],
      [2.5, 8],
      [-2.5, 8],
    ]);
    ctx.fillStyle = G.pitch;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const line = (a, b) => {
      ctx.beginPath();
      ctx.moveTo(...f.toPx(a));
      ctx.lineTo(...f.toPx(b));
      ctx.stroke();
    };
    line([-2.5, 4], [2.5, 4]);
    // the stakes at the corners and the centre line's ends
    ctx.fillStyle = "#ffffff";
    for (const [x, y] of [
      [-2.5, 0],
      [2.5, 0],
      [-2.5, 4],
      [2.5, 4],
      [-2.5, 8],
      [2.5, 8],
    ]) {
      const [px, py] = f.toPx([x, y]);
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // "near" and "far" so the picture reads the right way round
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "700 11px Inter, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    const label = (text, m) => {
      const [px, py] = f.toPx(m);
      ctx.save();
      ctx.translate(px, py);
      if (!f.upright) ctx.rotate(-Math.PI / 2);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    const gapOut = 12 / f.scale;
    if (this.bounds.y0 < -gapOut) label("YOUR BASELINE", [0, -gapOut]);
    if (this.bounds.y1 > 8 + gapOut) label("FAR BASELINE", [0, 8 + gapOut]);
    // the pieces: standing solid with an ink ring, lying pale with a thin line
    for (const p of this.pieces) {
      if (p.kind === "stake") continue;
      const { poly: fp, lying } = footprint(p);
      const fill =
        p.kind === "baton"
          ? t.wood
          : p.kind === "king"
            ? t.king
            : (TEAM[p.team]?.fill ?? t.wood);
      poly(fp);
      ctx.globalAlpha = lying ? 0.55 : 1;
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = t.ink;
      ctx.lineWidth = lying ? 1 : 2;
      ctx.stroke();
      if (!lying && p.kind === "king") {
        // a crown's dot, so the king is the king even at this size
        const [px, py] = f.toPx([p.x, p.y]);
        ctx.fillStyle = t.ink;
        ctx.beginPath();
        ctx.arc(px, py, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // the paint: drawn whole on a layer of its own, so a stroke over a stroke is
    // not darker
    if (this.strokes.length) {
      const layer = (this.layer ??= document.createElement("canvas"));
      layer.width = this.canvas.width;
      layer.height = this.canvas.height;
      const lc = layer.getContext("2d");
      lc.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      lc.strokeStyle = lc.fillStyle = t.paintSolid;
      lc.lineCap = lc.lineJoin = "round";
      lc.lineWidth = 2 * this.brush * f.scale;
      for (const s of this.strokes) {
        const pts = s.map((p) => f.toPx(p));
        if (pts.length === 1) {
          lc.beginPath();
          lc.arc(pts[0][0], pts[0][1], this.brush * f.scale, 0, Math.PI * 2);
          lc.fill();
          continue;
        }
        lc.beginPath();
        pts.forEach(([x, y], i) => (i ? lc.lineTo(x, y) : lc.moveTo(x, y)));
        lc.stroke();
      }
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.45;
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
    }
  }

  destroy() {
    this.ro?.disconnect();
  }
}
