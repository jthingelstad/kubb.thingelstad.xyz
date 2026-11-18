import { INK, PAPER, WOOD } from "./palette.js";

// The handle and power band share one travel scale. A full draw fits on screen.
export function strokeGeometry(box) {
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height * 0.25,
    travel: Math.min(150, box.height * 0.59),
  };
}

export function drawStroke(ctx, box, dial, contact) {
  const { x, y, travel } = strokeGeometry(box);
  const width = Math.min(156, box.width);
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.fillRect(-width / 2, -30, width, travel + 43);
  ctx.strokeRect(-width / 2, -30, width, travel + 43);
  ctx.font = "bold 13px system-ui";
  ctx.textAlign = "center";
  ctx.fillStyle = INK;
  const atBand = contact && dial.back >= dial.powerLo;
  ctx.fillText(atBand ? "Push through ↑" : "Pull to band ↓", 0, -11);
  ctx.fillRect(-1, 0, 2, travel);
  const lo = ((dial.powerLo ?? 0) / 180) * travel;
  const hi = ((dial.powerHi ?? 0) / 180) * travel;
  ctx.fillStyle = "#efb438";
  ctx.fillRect(-width * 0.42, lo, width * 0.84, Math.max(3, hi - lo));
  ctx.fillStyle = INK;
  ctx.fillRect(-width * 0.42, -1, width * 0.84, 2);
  const tolerance = travel * 0.08;
  ctx.fillRect(-tolerance, -3, 2 * tolerance, 6);
  const dx = contact
    ? Math.max(-width / 2 + 15, Math.min(width / 2 - 15, contact.dx))
    : 0;
  const dy = contact ? Math.max(-5, Math.min(travel, contact.dy)) : 0;
  ctx.fillStyle = WOOD.light;
  ctx.fillRect(dx - 17, dy - 5, 34, 10);
  ctx.strokeRect(dx - 17, dy - 5, 34, 10);
  ctx.restore();
}
