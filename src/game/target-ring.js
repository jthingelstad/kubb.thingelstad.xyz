// The target's ring as it is drawn on the screen (render/world.js drawMarker: the ground
// circle of the marker's radius, cast through the aim camera). A press on or near it is
// always the aim: a tap puts the circle there and a drag moves it, never the throw (the
// owner, 2026-11-27, of the iPhone app on an iPad: "On iPad I'm trying to move the drill
// target and when I tap it is activating the throw instead. I can't find a tap target to
// move the drill location."). Only the meter's own knob and the clock's ring come before
// it (Game.down); the linear meter's body, its throw zone and the clock's outer reach give
// way to it. And while the ring's centre is in the upright throw zone, the zone is only the
// meter's half of the width (`zoneNarrows`), so a drag on the other half moves the aim.
// The iPhone app's rule and numbers (TargetRing.swift, MeterLayout.start / after /
// zoneNarrows in ThrowMeter.swift).
export const tune = {
  margin: 10, // px round the drawn ring that a press still counts as on it
  least: 44, // px: the touch target is never less than this across, however small the ring
  points: 48, // the outline's points, as world.js draws it
};

// The ring on the screen: { center: { x, y }, outline: [{ x, y }] } in CSS px, or null
// where none is drawn. marker: the aim's marker ({ x, y, r, shown }); project(x, y, z):
// a world point to [sx, sy] on the screen, or null (behind the camera).
export function targetRing(marker, project) {
  if (!marker || marker.shown === false || !(marker.r > 0) || !project)
    return null;
  const c = project(marker.x, marker.y, 0);
  if (!c) return null;
  const outline = [];
  for (let i = 0; i < tune.points; i++) {
    const a = (i / tune.points) * Math.PI * 2;
    const p = project(
      marker.x + marker.r * Math.cos(a),
      marker.y + marker.r * Math.sin(a),
      0,
    );
    if (p) outline.push({ x: p[0], y: p[1] });
  }
  if (outline.length < 3) return null;
  return { center: { x: c[0], y: c[1] }, outline };
}

// Is the press on the ring: within half of `least` of its centre, inside its drawn shape,
// or within `margin` of its line?
export function onRing(ring, x, y) {
  if (!ring) return false;
  const { center: c, outline: o } = ring;
  if (Math.hypot(x - c.x, y - c.y) <= tune.least / 2) return true;
  if (!o || o.length < 3) return false;
  let inside = false;
  for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
    const a = o[i],
      b = o[j];
    if (
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  if (inside) return true;
  for (let i = 0, j = o.length - 1; i < o.length; j = i++)
    if (segment(x, y, o[j], o[i]) <= tune.margin) return true;
  return false;
}

function segment(x, y, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t =
    len > 0
      ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len))
      : 0;
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

// Does the upright throw zone narrow to the meter's half of the width? Only for the
// linear meter on a tall canvas while the ring's centre is in the zone (zoneFrom of the
// height or lower). A wide canvas's zone, for a finger, is that half already.
export function zoneNarrows(L, ring, zoneFrom = 0.6) {
  if (!L || L.meter !== "linear" || !L.tall || !ring) return false;
  return ring.center.y >= L.H * zoneFrom;
}
