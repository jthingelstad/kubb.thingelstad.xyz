-- The wide view (lua/web/wide.lua): the whole pitch in the box on every
-- screen shape, one camera for the whole match, and the pitch in the world
-- frame whichever team throws.
import "web/api"
import "web/wide"
import "web/json"
import "core/camera"
import "core/frame"
import "core/pitch"
local api, wide, json, camera, frame = tw.web.api, tw.web.wide, tw.web.json, tw.camera, tw.frame

local function call(method, a)
	local r = json.decode(api.call(method, a and json.encode(a) or nil))
	assert(not r.error, r.error)
	return r
end

-- The box a W x H window gives (src/game/game.js wideBox: the frame as the
-- window shows it, by the scale rule, less the HUD's margins).
local function boxFor(W, H)
	local k = math.min(W / 400, H / 240)
	local ox, oy = (W - 400 * k) / 2, (H - 240 * k) / 2
	local tall = H > W * 1.05
	local top = tall and 132 or 70
	return {
		left = (16 - ox) / k, right = (W - 16 - ox) / k,
		top = (top - oy) / k, bottom = (H - 16 - oy) / k,
	}
end
_G.wideBoxFor = boxFor

local SMALLEST = {}
_G.wideSmallest = SMALLEST

local SCREENS = { { 1440, 900 }, { 1920, 1080 }, { 1280, 768 }, { 2560, 1080 }, { 390, 844 }, { 844, 390 }, { 768, 1024 } }

local function inside(c, box, x, y, z, what)
	local sx, sy = camera.project(c, x, y, z)
	expect.truthy(sx, what .. " in front of the camera")
	expect.truthy(sx >= box.left - 1e-6 and sx <= box.right + 1e-6, string.format("%s across: %.1f in %.1f..%.1f",
		what, sx, box.left, box.right))
	expect.truthy(sy >= box.top - 1e-6 and sy <= box.bottom + 1e-6, string.format("%s down: %.1f in %.1f..%.1f",
		what, sy, box.top, box.bottom))
	return sx, sy
end

test("the whole pitch fills the box on every screen shape", function()
	local L, hx = tw.pitch.length, tw.pitch.halfWidth
	for _, wh in ipairs(SCREENS) do
		local box = boxFor(wh[1], wh[2])
		local c = wide.camera(box)
		local what = wh[1] .. "x" .. wh[2]
		expect.eq(c.kind, (wh[2] > wh[1] * 1.05) and "end" or "side", what .. " framing")
		local xs, ys = {}, {}
		for _, x in ipairs { -hx, hx } do
			for _, y in ipairs { 0, L } do
				local sx, sy = inside(c, box, x, y, 0, what .. " corner")
				xs[#xs + 1], ys[#ys + 1] = sx, sy
				inside(c, box, x, y, 0.15, what .. " corner kubb")
			end
		end
		for i, st in ipairs(tw.pitch.stakes) do inside(c, box, st.x, st.y, 0.15, what .. " stake " .. i) end
		inside(c, box, 0, L / 2, 0.3, what .. " king")
		-- and it fills it: the pitch spans most of the box one way or the other
		local spanX = (math.max(table.unpack(xs)) - math.min(table.unpack(xs))) / (box.right - box.left)
		local spanY = (math.max(table.unpack(ys)) - math.min(table.unpack(ys))) / (box.bottom - box.top)
		expect.truthy(math.max(spanX, spanY) > 0.7, string.format("%s fills: %.2f x %.2f", what, spanX, spanY))
		-- the smallest base kubb's height (the client's test for a readable view)
		local k = math.min(wh[1] / 400, wh[2] / 240)
		local px = wide.smallest(c) * k
		if wh[1] >= 1280 then
			expect.truthy(px >= 10, string.format("%s: smallest base kubb %.1f px", what, px))
		end
		SMALLEST[what] = px
	end
end)

test("a phone held upright is too small for it; a phone on its side is not", function()
	-- src/game/game.js tune.wideMinPx (6 CSS px)
	expect.truthy(SMALLEST["390x844"] < 6, "upright phone " .. SMALLEST["390x844"])
	expect.truthy(SMALLEST["844x390"] >= 6, "phone on its side " .. SMALLEST["844x390"])
end)

test("the side view: Team A's baseline on the left, Team B's on the right, level", function()
	local box = boxFor(1440, 900)
	local c = wide.camera(box)
	local ax = camera.project(c, 0, 0, 0)
	local bx = camera.project(c, 0, 8, 0)
	expect.truthy(ax < bx, "A left of B")
	local _, y1 = camera.project(c, -2.5, 0, 0)
	local _, y2 = camera.project(c, -2.5, 8, 0)
	expect.near(y1, y2, 1e-6, "the far sideline is level")
end)

test("one view for the whole match: the pitch never turns between teams", function()
	call("new", { mode = "match", cpu = "both", seed = 11, maxTurns = 30,
		start = { year = 2026, month = 11, day = 16, hour = 9, min = 0 } })
	local box = boxFor(1440, 900)
	local w = call("setWide", { box = box })
	expect.eq(w.kind, "side")
	local cam0 = json.encode(w.camera)
	local seen = { A = 0, B = 0 }
	local throws = 0
	local rested, moved = nil, 0
	local function sameCam(c, what) expect.eq(json.encode(c), cam0, what .. ": the same camera") end
	local function stakesFixed(items, what)
		for _, it in ipairs(items) do
			if it.kind == "stake" then
				local i = tonumber(it.id:match("%d+"))
				local st = tw.pitch.stakes[i]
				-- the stakes map onto each other under the turn, so check by place: every
				-- stake stands on one of the six spots
				local ok = false
				for _, p in ipairs(tw.pitch.stakes) do
					if math.abs(p.x - it.x) < 1e-6 and math.abs(p.y - it.y) < 1e-6 then ok = true end
				end
				expect.truthy(ok and st, what .. " stake on its spot")
			end
		end
	end
	local function onPitchInside(items, what)
		for _, it in ipairs(items) do
			if math.abs(it.x) <= 2.6 and it.y >= -0.6 and it.y <= 8.6 and it.z < 2 then
				inside(w.camera, box, it.x, it.y, it.z, what .. " " .. it.id)
			end
		end
	end
	while throws < 60 do
		local v = call("view")
		if v.need.kind ~= "throw" then break end
		local side = v.need.side
		seen[side] = seen[side] + 1
		sameCam(v.camera, "aim " .. side)
		stakesFixed(v.items, "aim " .. side)
		onPitchInside(v.items, "aim " .. side)
		-- the thrower stands at their own baseline in the world frame
		local th = v.aim.thrower
		if side == "A" then expect.truthy(th.y < 4, "A throws from y = 0 end") else
			expect.truthy(th.y > 4, "B throws from the y = 8 end") end
		-- what stood still through the last throw stands on the same spot now,
		-- though that throw was shown in the other team's frame (not the stakes:
		-- they are named by their spot in the frame, and look the same)
		for _, it in ipairs(v.items) do
			local was = rested and rested[it.id]
			if was and not it.toppled and it.kind ~= "baton" and it.kind ~= "stake" then
				expect.near(it.x, was.x, 1e-3, it.id .. " x after the change of thrower")
				expect.near(it.y, was.y, 1e-3, it.id .. " y after the change of thrower")
				moved = moved + 1
			end
		end
		local o
		for _ = 1, 900 do
			o = call("frame", { dt = 1 / 30 })
			if o.camera then sameCam(o.camera, "frame " .. side) end
			if o.action then break end
		end
		expect.truthy(o.action, "the computer threw")
		throws = throws + 1
		-- the throw plays from the thrower's end, in the same view
		local s0 = call("showAt", { t = 0 })
		sameCam(s0.camera, "playback " .. side)
		local pid = o.recording.projectile and o.recording.projectile.id
		for _, it in ipairs(s0.items) do
			if it.id == pid then
				if side == "A" then expect.truthy(it.y < 4, "A's throw leaves from y = 0") else
					expect.truthy(it.y > 4, "B's throw leaves from y = 8") end
			end
		end
		for _, b in ipairs(o.recording.timeline.bursts or {}) do
			if b.anchor then inside(w.camera, box, b.anchor.x, b.anchor.y, b.anchor.z or 0, "burst") end
		end
		local mid = call("showAt", { t = (o.recording.duration or 1) / 2 })
		sameCam(mid.camera, "mid-flight " .. side)
		stakesFixed(mid.items, "mid-flight " .. side)
		local done = call("showAt", { t = 1e9 })
		onPitchInside(done.items, "after " .. side)
		rested = {}
		for _, it in ipairs(done.items) do
			if not it.toppled and it.kind ~= "baton" then rested[it.id] = { x = it.x, y = it.y } end
		end
		if seen.A >= 3 and seen.B >= 3 then break end
	end
	expect.truthy(seen.A >= 1 and seen.B >= 1, "both teams threw")
	expect.truthy(moved > 20, "standing pieces compared across throws: " .. moved)
	-- off: the thrower's cameras again
	call("setWide", {})
	local v = call("view")
	expect.truthy(json.encode(v.camera) ~= cam0, "the thrower's camera when the wide view is off")
	expect.eq(v.wide, nil)
end)

test("un-turning is the frame's half turn, and A's frame is left alone", function()
	local it = { id = "b1", kind = "kubb", x = 1.2, y = 0.5, z = 0.07, qw = 1, qx = 0, qy = 0, qz = 0 }
	local o = wide.items("B", { it })[1]
	expect.near(o.x, -1.2, 1e-12)
	expect.near(o.y, 7.5, 1e-12)
	expect.eq(it.x, 1.2, "the session's own table is not changed")
	local a = wide.items("A", { it })[1]
	expect.eq(a.x, 1.2)
	local aim = wide.aim("B", { advY = 2, thrower = { x = 0.5, y = 0 }, marker = { x = 0, y = 7, r = 0.25 } })
	expect.near(aim.advY, 6, 1e-12)
	expect.near(aim.thrower.y, 8, 1e-12)
	expect.near(aim.marker.y, 1, 1e-12)
	expect.near(aim.marker.r, 0.25, 1e-12)
end)
