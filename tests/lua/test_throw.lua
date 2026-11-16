-- Practice throws, whole: the plan's clean swing, the recording, the
-- playback camera, the drill.
import "web/session"
import "web/json"
local session, json, throw = tw.web.session, tw.web.json, tw.web.throw

-- The plan's clean swing (throw.CLEAN on the plan's backswing and release),
-- thrown through the session's own action path.
local function cleanThrow(s)
	local ts = s.ts
	local r = {}
	for k, v in pairs(throw.CLEAN) do r[k] = v end
	r.back, r.releaseAngle = ts.sol.back, ts.sol.release
	-- the plan's clean throw: no nerves, unless the test asked for them
	if ts.nerves == nil then ts.nerves = false end
	local L, how = throw.playerLaunch(ts, r)
	local a = json.decode(json.encode(s:throwAction(L, how, { back = r.back, stop = r.releaseAngle, verdicts = L })))
	return s:apply(a), a
end
_G.cleanThrow = cleanThrow

test("a practice hit on a base kubb with the plan's clean swing", function()
	local s = session.new { mode = "practice" }
	local target = s.ts.markerOnId
	local out = cleanThrow(s)
	local rec = out.recording
	expect.eq(rec.result.legal, true)
	expect.truthy(rec.result.down >= 1, "a kubb down")
	expect.eq(rec.result.flag, rec.result.down .. " DOWN")
	local hit = false
	for _, id in ipairs(rec.result.toppled) do if id == target then hit = true end end
	expect.truthy(hit, "the target kubb is down")
	expect.eq(rec.timeline.firstHit.with, target)
	expect.truthy(rec.timeline.slow.from < rec.timeline.firstHit.t)
	expect.truthy(#rec.timeline.touches >= 1)
	expect.eq(rec.timeline.bursts[1].kind, "clean")
	expect.eq(rec.timeline.bursts[1].id, target)
	expect.eq(rec.result.verdicts.power, "ON")
	expect.eq(rec.result.verdicts.steady, "STEADY")
	-- the recording: every moved body from its first moving frame
	local baton
	for _, b in ipairs(rec.bodies) do if b.thrown then baton = b end end
	expect.truthy(baton, "the baton's track")
	expect.eq(baton.start, 0)
	local text = json.encode(rec)
	local back = json.decode(text)
	expect.eq(#back.bodies[1].poses, back.bodies[1].frames * 7)
	expect.near(rec.duration, rec.frames / 60, 1e-9)
	-- playback: the camera at a few times, the pieces where they are
	local p0 = s:showAt(0)
	local p1 = s:showAt(rec.timeline.firstHit.t + 0.5)
	local pe = s:showAt(rec.duration)
	expect.truthy(p0.camera.f > 0 and p1.camera.f > 0)
	expect.eq(pe.done, true)
	expect.near(p0.speed, 1, 1e-9)
	expect.near(s:showAt(rec.timeline.firstHit.t).speed, 0.3, 1e-9, "slow motion at the hit")
	expect.eq(p1.burst, "clean")
	-- the pitch after the throw: the target lies, the circle moved on to another kubb
	local v = s:view()
	local lying = false
	for _, it in ipairs(v.items) do if it.id == target and it.toppled then lying = true end end
	expect.truthy(lying)
	expect.truthy(s.ts.markerOnId ~= target, "the circle goes to a standing kubb")
	print(string.format("      recording %d frames, %d bodies, %d bytes", rec.frames, #rec.bodies, #text))
end)

test("a drill rests near its circle", function()
	local s = session.new { mode = "practice", drill = true }
	expect.eq(s.ts.projectile, "kubb")
	s:setTarget(0.8, 5.0)
	local out = cleanThrow(s)
	local rec = out.recording
	expect.eq(rec.projectile.how, "drill")
	expect.truthy(rec.result.restCm, "a rest distance")
	-- a clean drill runs on (playdate-kubb #121: mean 0.5 m from the circle on grass,
	-- the tail past 3 m); this one lands in the tail at 2.6 m
	expect.truthy(rec.result.restCm < 300, "within 3 m, got " .. tostring(rec.result.restCm))
	expect.eq(rec.result.flag, nil)
	expect.truthy(rec.result.restText:match(" AWAY$"))
	-- the drilled kubb is a piece of the pitch now, and the circle stays put
	local found = false
	for _, it in ipairs(s.ts.items) do if it.drilled then found = true end end
	expect.truthy(found)
	expect.near(s.ts.markerX, 0.8, 1e-9)
	print(string.format("      drill rest %d cm", rec.result.restCm))
end)

test("all base kubbs down stands the pitch up again", function()
	local s = session.new { mode = "practice" }
	for _, it in ipairs(s.ts.items) do
		if it.base and it.id ~= "b3" then it.toppled = true end
	end
	cleanThrow(s)
	local down = 0
	for _, it in ipairs(s.ts.items) do if it.base and it.toppled then down = down + 1 end end
	expect.eq(down, 0, "stood up after the last base kubb fell")
end)

test("the nerves: a clean swing goes off its line, the same way every time, and the verdict says which way", function()
	local function one()
		local s = session.new { mode = "practice" }
		s.ts.nerves = true
		local out, a = cleanThrow(s)
		return out.recording, a
	end
	local rec, a = one()
	local v = rec.result.verdicts
	expect.truthy(a.verdicts.sideV == -1 or a.verdicts.sideV == 0 or a.verdicts.sideV == 1, "the action carries sideV")
	expect.eq(v.sideV, a.verdicts.sideV)
	local words = { [-1] = "PULLED LEFT", [0] = "STRAIGHT", [1] = "PULLED RIGHT" }
	expect.eq(v.side, words[v.sideV])
	-- seeded by the swing and the plan: the same swing draws the same nerves
	local rec2, a2 = one()
	expect.eq(a2.launch.swivel, a.launch.swivel)
	expect.eq(a2.launch.speed, a.launch.speed)
	-- and they moved the launch off the plan's own
	local s0 = session.new { mode = "practice" }
	local _, a0 = cleanThrow(s0)
	expect.truthy(a0.launch.swivel ~= a.launch.swivel or a0.launch.speed ~= a.launch.speed, "the nerves moved the launch")
end)

test("a throw recorded before the nerves replays with no sideways verdict", function()
	local s = session.new { mode = "practice" }
	local _, a = cleanThrow(s)
	a.verdicts.sideV = nil
	local s2 = session.new { mode = "practice" }
	local out = s2:apply(a)
	expect.eq(out.recording.result.verdicts.side, nil)
	expect.eq(out.recording.result.verdicts.power, "ON")
end)
