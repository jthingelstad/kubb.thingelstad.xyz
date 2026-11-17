-- The aim and the dial (lua/web/throw through lua/web/session).
import "web/session"
import "web/json"
local session, json = tw.web.session, tw.web.json

-- A dial sweep as the pointer gives it: from `from` to `to` degrees at
-- `dps` degrees a second, one frame of 1/60 s each; returns the frames' args.
local function sweep(from, to, dps)
	local out, dt = {}, 1 / 60
	local step = dps * dt * ((to > from) and 1 or -1)
	local a = from
	while (step > 0 and a < to) or (step < 0 and a > to) do
		a = a + step
		if (step > 0 and a > to) or (step < 0 and a < to) then a = to end
		out[#out + 1] = a
	end
	return out
end

-- Feed arm angles, one frame each; returns the first event and the frame's output.
local function feed(s, arms, stopOnEvent)
	for _, a in ipairs(arms) do
		local o = s:frame { dt = 1 / 60, arm = a }
		if o.event and stopOnEvent ~= false then return o.event, o end
	end
	return nil
end
_G.dialSweep, _G.dialFeed = sweep, feed

test("practice aim defaults", function()
	local s = session.new { mode = "practice" }
	local ts = s.ts
	expect.eq(ts.projectile, "baton")
	expect.eq(ts.markerOnId, "b3", "the circle on the nearest far base kubb")
	expect.near(ts.markerX, 0, 1e-9)
	expect.near(ts.markerY, 8, 1e-9)
	expect.eq(ts.markerKind, "base")
	expect.eq(ts.release, tw.plan.arcFor("base"))
	expect.near(ts.playerY, 0, 1e-9, "stands on the line")
	expect.truthy(ts.sol.speed > 0, "a plan")
	local v = s:view()
	expect.eq(v.need.kind, "throw")
	expect.eq(#v.items, 11 + 6, "ten base kubbs, the king and six stakes")
	expect.truthy(v.aim.arc and #v.aim.arc > 10, "the arc")
	expect.eq(v.dial.phase, "idle")
	expect.eq(v.dial.prompt, "WIND BACK")
	expect.near(v.dial.powerLo, ts.sol.powerLo, 1e-12)
	-- the JSON round trip of the view
	local back = json.decode(json.encode(v))
	expect.eq(back.need.kind, "throw")
end)

test("the aim arc ends at the target kubb's face, at its aim height", function()
	local s = session.new { mode = "practice" }
	local ts = s.ts
	expect.eq(ts.markerOnId, "b3")
	local sol = ts.sol
	local zAim = tw.plan.aimZFor("kubb")
	expect.near(sol.aimZ, zAim, 1e-12, "the plan aims through the kubb at mid-height")
	-- the clean flight (with the air's drag) carries to the kubb's centre at that height
	local R = tw.flight.carry(sol.speed, math.rad(sol.loft), tw.flight.tune.handHeight - zAim,
		tw.flight.tune.dragK.baton)
	expect.near(R, 8 - ts.playerY, 0.005, "carries to the kubb")
	local pts = tw.web.throw.arcPoints(ts)
	local last = pts[#pts]
	local face = 8 - tw.body.kinds.kubb.hx
	expect.near(last[1], 0, 1e-6, "across")
	expect.near(last[2], face, 1e-6, "ends at the near face")
	expect.truthy(last[3] >= zAim - 1e-6 and last[3] < zAim + 0.03, "at the aim height: " .. last[3])
end)

test("an arc onto an empty spot ends on the ground", function()
	local s = session.new { mode = "practice" }
	s:setTarget(0.5, 6.0)
	local ts = s.ts
	expect.eq(ts.sol.aimZ, 0)
	local pts = tw.web.throw.arcPoints(ts)
	local last = pts[#pts]
	expect.near(last[1], 0.5, 1e-6, "across")
	expect.near(last[2], 6.0, 1e-6, "out")
	expect.near(last[3], 0, 1e-6, "on the ground")
end)

test("setTarget snaps and stays put; setStance holds the line", function()
	local s = session.new { mode = "practice" }
	s:setTarget(1.1, 7.9, true)
	expect.eq(s.ts.markerOnId, "b4")
	s:setTarget(0.5, 6.0)
	expect.eq(s.ts.markerOnId, nil)
	expect.truthy(s.ts.markerSet)
	expect.near(s.ts.markerX, 0.5, 1e-12)
	s:setStance(9, -9)
	expect.near(s.ts.playerX, 2.5, 1e-12)
	expect.near(s.ts.playerY, -3.0, 1e-12)
	s:setStance(0, 1)
	expect.near(s.ts.playerY, 0, 1e-12, "no step over the line")
	s:stepArc(1)
	expect.eq(s.ts.release, tw.plan.arcFor("base") + tw.plan.tune.arcStepDeg)
	s:stepSide(1)
	expect.eq(s.ts.tilt, tw.plan.tune.tiltStepDeg)
end)

test("a scripted dial sweep releases with the planned power and release", function()
	local s = session.new { mode = "practice" }
	local sol = s.ts.sol
	local back = (sol.powerLo + sol.powerHi) / 2
	local arms = { 0, -5 }
	for _, a in ipairs(sweep(-5, -back, 400)) do arms[#arms + 1] = a end
	-- the flick, quick and even, stopping at the plan's release angle
	for _, a in ipairs(sweep(-back, sol.release, 2400)) do arms[#arms + 1] = a end
	for _ = 1, 6 do arms[#arms + 1] = sol.release end
	local ev, o = feed(s, arms)
	expect.eq(ev, "release")
	expect.truthy(o.action and o.recording, "an action and its recording")
	local sw = o.action.swing
	expect.near(sw.back, back, 1.0, "the backswing")
	expect.near(sw.stop, sol.release, 2 * 2400 / 60, "the release angle")
	expect.eq(o.action.verdicts.powerV, 0, "power ON")
	expect.eq(o.action.verdicts.releaseV, 0, "release ON")
	expect.truthy(o.recording.frames > 30)
	expect.eq(o.dial.lastBack, sw.back)
end)

test("a let-down throws nothing", function()
	local s = session.new { mode = "practice" }
	local arms = { 0 }
	for _, a in ipairs(sweep(0, -90, 300)) do arms[#arms + 1] = a end
	for _, a in ipairs(sweep(-90, 0, 120)) do arms[#arms + 1] = a end
	local ev, o = feed(s, arms)
	expect.eq(ev, "letdown")
	expect.eq(o.action, nil)
	expect.eq(s.throws, 0)
	-- and letting go while winding is a let-down too
	local arms2 = { 0 }
	for _, a in ipairs(sweep(0, -90, 300)) do arms2[#arms2 + 1] = a end
	feed(s, arms2)
	local o2 = s:frame { dt = 1 / 60 }
	expect.eq(o2.event, "letdown")
	expect.eq(s.throws, 0)
end)

test("pointer-up while swinging forward is the release", function()
	local s = session.new { mode = "practice" }
	local sol = s.ts.sol
	local arms = { 0, -5 }
	for _, a in ipairs(sweep(-5, -sol.back, 400)) do arms[#arms + 1] = a end
	for _, a in ipairs(sweep(-sol.back, sol.release, 2400)) do arms[#arms + 1] = a end
	local ev = feed(s, arms)
	expect.eq(ev, nil, "still swinging at the release angle")
	expect.eq(s.ts.swing.phase, "swinging")
	local o = s:frame { dt = 1 / 60, arm = nil }
	expect.eq(o.event, "release")
	expect.truthy(o.recording)
	expect.near(o.action.swing.stop, sol.release, 1e-9, "released where the pointer let go")
end)

test("a press in the dead zone arms at once (web)", function()
	local s = session.new { mode = "practice" }
	local o = s:frame { dt = 1 / 60, arm = -10 }
	expect.truthy(s.ts.armed, "armed by the press")
	-- a press far behind does not arm
	local s2 = session.new { mode = "practice" }
	s2:frame { dt = 1 / 60, arm = -100 }
	expect.eq(s2.ts.armed, false)
	expect.eq(s2:frame({ dt = 1 / 60, arm = -110 }).dial.prompt, "CRANK DOWN")
end)

test("json keeps negative zero, so a snapshot comes back to the same text", function()
	local t = { a = -0.0, b = 0.0, c = 3, d = 2.5, e = -1.0 }
	local text = json.encode(t)
	local back = json.decode(text)
	expect.eq(json.encode(back), text)
	expect.eq(1 / back.a, -math.huge)
	expect.eq(math.type(back.c), "integer")
	expect.eq(math.type(back.e), "float")
end)
