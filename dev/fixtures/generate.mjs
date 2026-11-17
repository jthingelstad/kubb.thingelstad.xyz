// Generates the renderer's gallery fixtures (dev/fixtures/*.json) from real
// runs of the engine's core (vendor/engine/core) under Node with wasmoon: matches
// played by core/autothrow with core/world physics, cameras from
// tw.camera (aim, shoulder, impact), poses from tw.world bodies mid-throw.
// Everything is in the thrower's view frame, as the session hands it to JS.
//
//   node dev/fixtures/generate.mjs
//
// Same seeds, same files.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import { loadCore, JSON_LUA, runJSON } from "./core.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const lua = await loadCore([
  "core/match",
  "core/world",
  "core/autothrow",
  "core/flight",
  "core/raising",
  "core/frame",
  "core/pitch",
  "core/swing",
  "core/throwplan",
]);
await lua.doString(JSON_LUA);

await lua.doString(`
local camera, match, world, autothrow, flight = tw.camera, tw.match, tw.world, tw.autothrow, tw.flight
local raising, frame, pitch, swing, plan = tw.raising, tw.frame, tw.pitch, tw.swing, tw.plan

local function cam(c)
  local o = {}
  for _, k in ipairs({ "px","py","pz","fx","fy","fz","rx","ry","rz","ux","uy","uz","f","cx","cy","lx","ly","lz" }) do o[k] = c[k] end
  return o
end

local function teamOf(b)
  if b.kind ~= "kubb" then return nil end
  local c = b.id:sub(1, 1)
  if c == "a" then return "A" elseif c == "b" then return "B" end
  return nil
end

local function items(w)
  local out = {}
  for i = 1, w.n do
    local b = w.bodies[i]
    out[#out + 1] = { id = b.id, kind = b.kind, x = b.x, y = b.y, z = b.z,
      qw = b.qw, qx = b.qx, qy = b.qy, qz = b.qz, toppled = b.toppled or false, team = teamOf(b) }
  end
  return out
end

-- the plan's clean arc from the hand to the ground: { {x, y, z}, ... }
local function arcOf(px, py, swivel, loft, speed, n)
  local dx, dy = camera.aimDir(swivel)
  local l = math.rad(loft)
  local vx, vy, vz = dx * math.cos(l) * speed, dy * math.cos(l) * speed, math.sin(l) * speed
  local _, _, T = flight.predict(px, py, swivel, loft, speed)
  local g, h = flight.tune.g, flight.tune.handHeight
  local out = {}
  n = n or 32
  for i = 2, n do
    local t = T * i / n
    out[#out + 1] = { px + vx * t, py + vy * t, h + vz * t - 0.5 * g * t * t }
  end
  return out
end

local function targetsOf(s)
  local pos, out = {}, {}
  for _, p in ipairs(s.pieces) do pos[p.id] = p end
  for _, id in ipairs(s.targets or {}) do
    local p = pos[id]
    if p then out[#out + 1] = { x = p.x, y = p.y } end
  end
  return out
end

local function dialOf(sol)
  return { powerLo = sol.powerLo, powerHi = sol.powerHi, releaseLo = sol.releaseLo, releaseHi = sol.releaseHi,
    deadDeg = swing.tune.startBackDeg, overDeg = 150, back = sol.back, release = sol.release }
end

local function aimCam(s, a)
  local sol = a.plan
  local c = camera.new()
  camera.aim(c, a.x, a.y, sol.swivel, targetsOf(s), 0, camera.lookDistAt(a.x, a.y, sol.tx, sol.ty))
  camera.fitNear(c, sol.tx, sol.ty - 0.25)
  return c
end

local function shoulderCam(s, a, arc)
  local sol = a.plan
  local xs, ys, zs = {}, {}, {}
  for i, p in ipairs(arc) do xs[i], ys[i], zs[i] = p[1], p[2], p[3] end
  local n = #arc
  for i = 0, 7 do
    local t = i / 8 * 2 * math.pi
    n = n + 1
    xs[n], ys[n], zs[n] = sol.tx + 0.25 * math.cos(t), sol.ty + 0.25 * math.sin(t), 0
  end
  local c = camera.new()
  camera.shoulder(c, a.x, a.y, sol.swivel, s.lineY, n, xs, ys, zs, math.floor(#arc / 4))
  return c
end

local function newMatch(surface, opening)
  return match.new { start = { year = 2026, month = 11, day = 20, hour = 9, min = 0 }, first = "A",
    surface = surface or "Grass", opening = opening,
    teams = { A = { name = "A", players = { { name = "Al" }, { name = "Ann" } } },
              B = { name = "B", players = { { name = "Bo" }, { name = "Bea" } } } } }
end

-- Play a match by autothrow (scale 1: with mistakes); before every throw,
-- ask want(m, s, a, need) whether to stop there. want sees the engine's
-- need before match.setup settles it (raise, punish) with s = nil.
function playUntil(seed, surface, want, maxThrows)
  local m = newMatch(surface)
  local r = autothrow.rng(seed)
  for i = 1, (maxThrows or 400) do
    if match.over(m) then return nil end
    local n = m.game:need()
    if n.kind == "raise" or n.kind == "punish" then
      if want(m, nil, nil, n) then return m, nil, nil, n end
    end
    local s = match.setup(m)
    if not s then return nil end
    local a = autothrow.choose(s, r, 1)
    if want(m, s, a, nil) then return m, s, a, nil end
    local w = world.new { surface = s.surface, pieces = match.worldPieces(s) }
    autothrow.launch(w, s, a)
    world.run(w)
    match.resolve(m, world.result(w), not a.legal)
  end
  return nil
end

local function worldFor(s) return world.new { surface = s.surface, pieces = match.worldPieces(s) } end

-- An aim fixture (first person or the plan view) for setup s, throw a.
function aimFixture(s, a, view)
  local sol = a.plan
  local w = worldFor(s)
  local arc = arcOf(a.x, a.y, sol.swivel, sol.loft, sol.speed)
  local c = view == "plan" and shoulderCam(s, a, arc) or aimCam(s, a)
  return { camera = cam(c), scene = { surface = s.surface, items = items(w), advantageY = s.advY,
      marker = { x = sol.tx, y = sol.ty, r = 0.25 }, arc = arc, thrower = { x = a.x, y = a.y } },
    dial = dialOf(sol), label = s.label,
    minimap = { thrower = { x = a.x, y = a.y }, aim = { x = sol.tx, y = sol.ty }, marker = { x = sol.tx, y = sol.ty, r = 0.25 },
      advantageY = s.advY } }
end

-- An impact fixture: the throw (clean when scale is 0) run until 'after'
-- seconds past its first hit, through the impact camera round the struck
-- point. Returns nil when it hits nothing.
function impactFixture(s, a, after, orbit, open)
  local w = worldFor(s)
  autothrow.launch(w, s, a)
  local limit = 6
  while w.time < limit do
    world.step(w)
    if w.firstHit and w.time >= w.firstHit.t + after then break end
  end
  if not w.firstHit then return nil end
  local h = w.firstHit
  local dx, dy = camera.aimDir(a.swivel)
  local c = camera.new()
  camera.impact(c, h.x, h.y, dx, dy, nil, orbit or 0, open or 0)
  local toppled = {}
  for i = 1, w.n do local b = w.bodies[i]; if b.toppled and b.kind ~= "baton" then toppled[#toppled + 1] = b.id end end
  return { camera = cam(c), scene = { surface = s.surface, items = items(w), advantageY = s.advY },
    hit = { x = h.x, y = h.y, z = h.z, with = h.with, t = h.t, now = w.time }, toppled = toppled,
    minimap = { thrower = { x = a.x, y = a.y }, advantageY = s.advY }, label = s.label }
end

-- The raise view (scenes/settle): behind and above the lying kubb in the
-- defender's view frame, its footprints on the ground.
function raiseFixture(m, n)
  local side = n.side
  local g = m.game
  local pieces = tw.outcome.pieces(g, side)
  local w = world.new { surface = match.surfaceName(g), pieces = pieces }
  local p = frame.pose(side, n.pose)
  local d = n.decision
  local fps = {}
  for i, e in ipairs(d.ends or {}) do
    local q = frame.pose(side, e.pose)
    fps[#fps + 1] = { x = q.x, y = q.y, angle = q.angle, allowed = (e.inBounds and not e.obstructedBy) and true or false }
  end
  if d.choices and d.choices[1] then
    local q = frame.pose(side, d.choices[1].pose)
    local hit = false
    for _, f in ipairs(fps) do
      if math.abs(f.x - q.x) < 1e-6 and math.abs(f.y - q.y) < 1e-6 then f.chosen = true; f.allowed = true; hit = true end
    end
    if not hit then fps[#fps + 1] = { x = q.x, y = q.y, angle = q.angle, chosen = true, allowed = true } end
  end
  local c = camera.new()
  camera.lookAt(c, p.x + 0.35, p.y - 1.5, 1.05, p.x, p.y + 0.1, 0)
  c.f, c.cx, c.cy = 520, 200, 112
  return { camera = cam(c), scene = { surface = match.surfaceName(g), items = items(w), footprints = fps },
    kubb = n.kubb, mode = d.mode, side = side }
end

-- The punishment view: the defender's half from above (in its view frame,
-- y 0..4), keep-out circles a baton length round the stakes and the king,
-- the engine's own spot as the cursor and a refused one by the king.
function punishFixture(m, n)
  local side = n.side
  local g = m.game
  local pieces = tw.outcome.pieces(g, side)
  local w = world.new { surface = match.surfaceName(g), pieces = pieces }
  local ctx = g:context(g.defender, n.kubb)
  local spot = raising.autoPunishment(ctx)
  local keep = {}
  for _, st in ipairs(pitch.stakes) do
    local x, y = frame.point(side, st.x, st.y)
    if y <= 4.01 then keep[#keep + 1] = { x = x, y = y, r = pitch.batonLength } end
  end
  local kx, ky = frame.point(side, g.king.pose.x, g.king.pose.y)
  keep[#keep + 1] = { x = kx, y = ky, r = pitch.batonLength }
  local fps = {}
  if spot then
    local q = frame.pose(side, spot)
    fps[#fps + 1] = { x = q.x, y = q.y, angle = q.angle or 0, chosen = true, allowed = true }
  end
  local bad = { x = kx + 0.18, y = ky - 0.2, standing = true, angle = 0 }
  local why = raising.punishmentCheck(frame.pose(side, bad), ctx)
  fps[#fps + 1] = { x = bad.x, y = bad.y, angle = 0, allowed = false, why = why and tostring(why) or nil }
  local c = camera.new()
  camera.lookAt(c, 0, -0.9, 6.2, 0, 2.1, 0)
  c.f, c.cx, c.cy = 300, 200, 120
  return { camera = cam(c), scene = { surface = match.surfaceName(g), items = items(w), keepOut = keep, footprints = fps },
    kubb = n.kubb, side = side }
end

-- for the snippets below
_G.autothrow = tw.autothrow
-- the first seed whose match asks for a punishment kubb (found by searching from 1)
PUNISH_FROM = 110
`);

// Written as Prettier would format them, so the repository's format check
// passes on freshly generated fixtures.
async function writeJSON(file, text) {
  const out = path.join(here, file);
  const options = (await prettier.resolveConfig(out)) || {};
  fs.writeFileSync(
    out,
    await prettier.format(text, { ...options, filepath: out }),
  );
}

const fixtures = [];
async function add(name, title, notes, code) {
  const t0 = performance.now();
  const f = await runJSON(lua, code);
  if (!f) throw new Error(`fixture ${name}: the core gave nothing`);
  f.name = name;
  f.title = title;
  f.notes = notes;
  fixtures.push(f);
  await writeJSON(
    name + ".json",
    JSON.stringify(f, (k, v) =>
      typeof v === "number" ? +v.toPrecision(12) : v,
    ),
  );
  console.log(`${name}: ${(performance.now() - t0).toFixed(0)} ms`);
}

// 1. The first throw of a match: first person at the far baseline, then the
// plan view of the same throw.
const first = `local m, s, a = playUntil(3, "Grass", function(m, s, a) return s ~= nil end)`;
await add(
  "aim-first-person",
  "First person at the far baseline",
  "match.setup, autothrow.choose, camera.aim + fitNear",
  `${first}
  return json.encode(aimFixture(s, a))`,
);
await add(
  "aim-plan-view",
  "The plan view (B held)",
  "camera.shoulder over the arc and the circle",
  `${first}
  return json.encode(aimFixture(s, a, "plan"))`,
);

// 2. The impact: the same opening throw thrown clean, just after its hit,
// the camera part way round its half circle.
await add(
  "impact",
  "Impact: kubbs mid-fall and the baton",
  "a clean throw (scale 0) stepped 0.22 s past world.firstHit; camera.impact orbit 0.5",
  `${first}
  local a0 = autothrow.choose(s, autothrow.rng(1), 0)
  return json.encode(impactFixture(s, a0, 0.22, 0.5, 0.25))`,
);

// 3. A crowded field-kubb turn with debris on the pitch.
await add(
  "field-turn",
  "A field-kubb turn with debris",
  "the first baton with 3+ field kubbs standing and 2+ debris pieces",
  `
  local m, s, a = playUntil(5, "Grass", function(m, s, a)
    if not s or s.kind ~= "baton" or s.kingShot then return false end
    local field = 0
    for _, p in ipairs(s.pieces) do if p.role == "field" then field = field + 1 end end
    return field >= 3 and #(s.debris or {}) >= 2
  end)
  local f = aimFixture(s, a)
  f.minimap.items = f.scene.items
  return json.encode(f)`,
);
await add(
  "field-impact",
  "Field kubbs struck, with debris",
  "the same throw thrown clean, 0.3 s past the hit",
  `
  local m, s, a = playUntil(5, "Grass", function(m, s, a)
    if not s or s.kind ~= "baton" or s.kingShot then return false end
    local field = 0
    for _, p in ipairs(s.pieces) do if p.role == "field" then field = field + 1 end end
    return field >= 3 and #(s.debris or {}) >= 2
  end)
  local a0 = autothrow.choose(s, autothrow.rng(2), 0)
  return json.encode(impactFixture(s, a0, 0.3, 0.35, 0.2))`,
);

// 4. A king shot: the aim, and a clean throw that topples the king.
const kingFind = `
  local found
  for seed = 1, 60 do
    local m, s, a = playUntil(seed, "Grass", function(m, s, a) return s and s.kingShot end)
    if s then
      local a0 = autothrow.choose(s, autothrow.rng(seed), 0)
      local f = impactFixture(s, a0, 0.28, 0.45, 0.2)
      if f then
        for _, id in ipairs(f.toppled) do if id == "king" then found = { s = s, a = a, f = f, seed = seed } end end
      end
    end
    if found then break end
  end`;
await add(
  "king-aim",
  "King shot: the aim",
  "the first match (by seed) whose clean king shot topples the king",
  `${kingFind}
  local f = aimFixture(found.s, found.a)
  f.seed = found.seed
  return json.encode(f)`,
);
await add(
  "king-impact",
  "King shot: the king going over",
  "the clean king shot 0.28 s past its hit; set usa for the crown",
  `${kingFind}
  found.f.scene.set = "usa"
  found.f.burst = "king"
  return json.encode(found.f)`,
);

// 5. Sand and snow: the first throw of a match on each.
for (const surface of ["Sand", "Snow"]) {
  await add(
    `surface-${surface.toLowerCase()}`,
    `${surface}: first person`,
    `a match on ${surface}`,
    `
    local m, s, a = playUntil(7, "${surface}", function(m, s, a) return s ~= nil end)
    return json.encode(aimFixture(s, a))`,
  );
}

// 6. Every kubb set up close: the opening throw at the far baseline thrown
// clean, a moment after the hit, the impact camera without the orbit.
for (const set of ["classic", "usa", "sweden", "minnesota", "wisconsin"]) {
  await add(
    `set-${set}`,
    `Kubb set: ${set}`,
    "impact camera at the far base kubbs, 0.12 s past the hit",
    `${first}
    local a0 = autothrow.choose(s, autothrow.rng(1), 0)
    local f = impactFixture(s, a0, 0.12, 0, 0)
    f.scene.set = "${set}"
    return json.encode(f)`,
  );
}

// 7. Raising and punishment, from the engine's own needs.
await add(
  "raise",
  "Raising a kubb",
  "the first raise the engine asks for; footprints from its decision",
  `
  local m, s, a, n = playUntil(4, "Grass", function(m, s, a, n) return n and n.kind == "raise" and n.decision.mode == "choice" end)
  return json.encode(raiseFixture(m, n))`,
);
await add(
  "punish",
  "Placing a punishment kubb",
  "the first punishment kubb over seeds; keep-out circles a baton length round stakes and king",
  `
  local m, s, a, n
  local found
  for seed = PUNISH_FROM, PUNISH_FROM + 200 do
    m, s, a, n = playUntil(seed, "Grass", function(m, s, a, n) return n and n.kind == "punish" end)
    if n then found = seed; break end
  end
  local f = punishFixture(m, n)
  f.seed = found
  return json.encode(f)`,
);

// The list the gallery reads.
await writeJSON(
  "index.json",
  JSON.stringify(fixtures.map((f) => ({ name: f.name, title: f.title }))),
);
console.log(`${fixtures.length} fixtures`);
lua.global.close();
