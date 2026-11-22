// The minimap (render/hud.lua hud.minimap and hud.wind): the pitch from
// above in the thrower's view frame, the far baseline at the top.
//
// drawMinimap(ctx, rect, st) draws in rect (CSS px, the ctx's current
// transform). st:
//   items       render items { id, kind, x, y, toppled, team } (stakes ignored)
//   thrower     { x, y }: where the thrower stands
//   aim         { x, y }: the aim line's end (the plan's landing), or null
//   marker      { x, y, r }: the target circle, or null
//   advantageY  the advantage line, or null
//   wind        { x, y, text }: m/s in the view frame (y up the pitch), or null
//   baton       { x, y }: the baton in flight, or null
//   land        { x, y }: where the last throw landed, or null
//   surface     'grass' | 'sand' | 'snow'
import { UI, TEAM, AIM, HUD, FONT, groundOf } from "./palette.js";

// The plaque is a plate like the tray's (the 1.0 design, "Minimap"): a 3 px
// ink line, round corners of 6 px and a 3 px ink shadow. The teams are told
// apart by shape as well as colour (the design's "Teams"): Team A's kubbs are
// circles, Team B's squares.
export const tune = {
  pad: 0.06, // of the plaque's width: paper round the pitch
  frame: 3, // px, the ink line (a plate's)
  shadow: 3, // px, the hard ink shadow (a plate's)
  radius: 6, // px, the corners (a control's)
  label: 0.15, // the wind label's height, of the plaque's width
};

// The pitch's box in rect: { x, y, w, h, s } with s px per metre, and the
// mapping to it. The plaque hangs from rect's top (under the wind's label
// when there is one), so a minimap under the header stays put whatever its
// width leaves of rect's height.
export function minimapGeometry(rect, withLabel = true) {
  const labelH = withLabel ? rect.width * tune.label * 1.25 : 0;
  const s = Math.min(
    (rect.width - 2 * tune.frame - tune.shadow) / (5 * (1 + 2 * tune.pad)),
    (rect.height - labelH - 2 * tune.frame - tune.shadow) / (8 + 10 * tune.pad),
  );
  const pw = 5 * s,
    ph = 8 * s;
  const pad = 5 * s * tune.pad;
  const x = rect.x + (rect.width - tune.shadow - pw) / 2;
  const y = rect.y + labelH + tune.frame + pad;
  return { x, y, w: pw, h: ph, s, pad };
}

export function toMap(g, x, y) {
  return [g.x + (x + 2.5) * g.s, g.y + (8 - y) * g.s];
}

export function drawMinimap(ctx, rect, st) {
  const g = minimapGeometry(rect, !!(st.wind && st.wind.text));
  const G =
    HUD.mapGround?.[st.surface] || HUD.mapGround?.grass || groundOf(st.surface);
  const { s, pad } = g;
  const lw = Math.max(1, s * 0.12);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // the plaque: rough round the pitch, a plate's ink line, corners and shadow
  const fx = g.x - pad - tune.frame,
    fy = g.y - pad - tune.frame,
    fw = g.w + 2 * (pad + tune.frame),
    fh = g.h + 2 * (pad + tune.frame);
  const rr = tune.radius;
  ctx.fillStyle = UI.ink;
  ctx.beginPath();
  ctx.roundRect(fx + tune.shadow, fy + tune.shadow, fw, fh, rr);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(fx, fy, fw, fh, rr);
  ctx.fill();
  ctx.fillStyle = G.rough;
  ctx.beginPath();
  ctx.roundRect(
    fx + tune.frame,
    fy + tune.frame,
    fw - 2 * tune.frame,
    fh - 2 * tune.frame,
    Math.max(1, rr - tune.frame),
  );
  ctx.fill();
  ctx.fillStyle = G.pitch;
  ctx.fillRect(g.x, g.y, g.w, g.h);

  // the lines
  ctx.strokeStyle = G.line;
  ctx.lineWidth = lw;
  ctx.strokeRect(g.x, g.y, g.w, g.h);
  ctx.setLineDash([s * 0.24, s * 0.16]);
  ctx.beginPath();
  ctx.moveTo(g.x, g.y + g.h / 2);
  ctx.lineTo(g.x + g.w, g.y + g.h / 2);
  ctx.stroke();
  if (st.advantageY != null) {
    const [, ay] = toMap(g, 0, st.advantageY);
    ctx.setLineDash([s * 0.1, s * 0.1]);
    ctx.beginPath();
    ctx.moveTo(g.x, ay);
    ctx.lineTo(g.x + g.w, ay);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // the target circle
  if (st.marker) {
    const [mx, my] = toMap(g, st.marker.x, st.marker.y);
    ctx.fillStyle = "rgba(255, 246, 200, 0.35)";
    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.arc(mx, my, Math.max(3, st.marker.r * s), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // the pieces: standing solid (the king bigger, a team's kubbs in its
  // colour), fallen ones hollow, lying batons a short stroke
  for (const p of st.items || []) {
    if (p.kind === "stake") continue;
    const y = Math.min(7.85, Math.max(0.15, p.y));
    const [x, yy] = toMap(g, Math.min(2.6, Math.max(-2.6, p.x)), y);
    if (p.kind === "baton") {
      ctx.fillStyle = UI.ink;
      ctx.fillRect(x - s * 0.15, yy - s * 0.04, s * 0.3, Math.max(1, s * 0.08));
      continue;
    }
    const king = p.kind === "king";
    const r = Math.max(king ? 3 : 2.2, s * (king ? 0.17 : 0.12));
    const fill = king
      ? UI.paper
      : p.team && TEAM[p.team]
        ? TEAM[p.team].fill
        : UI.paper;
    // a thin edge, so the team's colour still shows on a small plaque
    ctx.lineWidth = Math.max(1, Math.min(lw, r * 0.4));
    ctx.strokeStyle = UI.ink;
    if (p.toppled) {
      ctx.fillStyle = "rgba(22, 19, 15, 0.25)";
      ctx.fillRect(x - r * 1.4, yy - r * 0.7, r * 2.8, r * 1.4);
      ctx.strokeRect(x - r * 1.4, yy - r * 0.7, r * 2.8, r * 1.4);
    } else if (!king && p.team === "A") {
      // Team A: a circle, as large as Team B's square reads
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x, yy, r * 1.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = fill;
      ctx.fillRect(x - r, yy - r, 2 * r, 2 * r);
      ctx.strokeRect(x - r, yy - r, 2 * r, 2 * r);
      if (king) {
        // a crown's points on top
        ctx.fillStyle = UI.ink;
        ctx.beginPath();
        ctx.moveTo(x - r, yy - r);
        ctx.lineTo(x - r, yy - r * 1.9);
        ctx.lineTo(x - r * 0.5, yy - r * 1.35);
        ctx.lineTo(x, yy - r * 1.9);
        ctx.lineTo(x + r * 0.5, yy - r * 1.35);
        ctx.lineTo(x + r, yy - r * 1.9);
        ctx.lineTo(x + r, yy - r);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // the aim line and the thrower
  const t = st.thrower;
  if (t) {
    const [px, py] = toMap(g, t.x, t.y);
    if (st.aim) {
      // clipped to the plaque's inside
      const [ax, ay] = toMap(g, st.aim.x, st.aim.y);
      ctx.save();
      ctx.beginPath();
      ctx.rect(
        fx + tune.frame,
        fy + tune.frame,
        fw - 2 * tune.frame,
        fh - 2 * tune.frame,
      );
      ctx.clip();
      ctx.strokeStyle = UI.ink;
      ctx.lineWidth = lw * 2.4;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(ax, ay);
      ctx.stroke();
      ctx.strokeStyle = AIM.marker;
      ctx.lineWidth = lw;
      ctx.stroke();
      ctx.restore();
    }
    const a = s * 0.22;
    const ty = Math.min(py, fy + fh - tune.frame - a * 1.6);
    ctx.fillStyle = AIM.thrower;
    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(px, ty - a);
    ctx.lineTo(px + a, ty + a * 0.9);
    ctx.lineTo(px - a, ty + a * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  if (st.land) {
    const [lx, ly] = toMap(g, st.land.x, st.land.y);
    const c = s * 0.16;
    ctx.strokeStyle = UI.ink;
    ctx.lineWidth = lw * 1.4;
    ctx.beginPath();
    ctx.moveTo(lx - c, ly - c);
    ctx.lineTo(lx + c, ly + c);
    ctx.moveTo(lx - c, ly + c);
    ctx.lineTo(lx + c, ly - c);
    ctx.stroke();
  }
  if (st.baton) {
    const [bx, by] = toMap(
      g,
      Math.min(2.6, Math.max(-2.6, st.baton.x)),
      Math.min(8.1, Math.max(-0.1, st.baton.y)),
    );
    ctx.fillStyle = UI.ink;
    ctx.beginPath();
    ctx.arc(bx, by, s * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }

  // the wind: an arrow across the middle and its speed above the plaque
  if (st.wind) {
    const sp = Math.hypot(st.wind.x, st.wind.y);
    if (sp > 0.01) {
      const cx = g.x + g.w / 2,
        cy = g.y + g.h / 2;
      const L = Math.min(g.w * 0.9, g.w * (0.3 + 0.1 * sp));
      const ux = st.wind.x / sp,
        uy = -st.wind.y / sp;
      const hx = cx + (ux * L) / 2,
        hy = cy + (uy * L) / 2;
      const qx = cx - (ux * L) / 2,
        qy = cy - (uy * L) / 2;
      const hw = s * 0.22,
        hl = s * 0.38;
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(qx, qy);
        ctx.lineTo(hx - ux * hl * 0.6, hy - uy * hl * 0.6);
      };
      ctx.strokeStyle = UI.ink;
      ctx.lineWidth = lw * 2.6;
      path();
      ctx.stroke();
      ctx.strokeStyle = HUD.wind;
      ctx.lineWidth = lw * 1.2;
      path();
      ctx.stroke();
      ctx.fillStyle = HUD.wind;
      ctx.strokeStyle = UI.ink;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(hx + ux * hl * 0.3, hy + uy * hl * 0.3);
      ctx.lineTo(hx - ux * hl - uy * hw, hy - uy * hl + ux * hw);
      ctx.lineTo(hx - ux * hl + uy * hw, hy - uy * hl - ux * hw);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    if (st.wind.text) {
      const h = rect.width * tune.label;
      ctx.font = `700 ${Math.round(h * 0.62)}px ${FONT.label}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const w = Math.min(
        rect.width,
        ctx.measureText(st.wind.text).width + h * 0.8,
      );
      const x = fx + fw / 2 - w / 2,
        y = fy - h - h * 0.25;
      ctx.fillStyle = UI.ink;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = UI.paper;
      ctx.fillText(st.wind.text, x + w / 2, y + h / 2 + 0.5);
    }
  }
  ctx.restore();
  return g;
}
