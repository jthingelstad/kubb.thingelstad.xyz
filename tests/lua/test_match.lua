-- Matches through the session: the computer on both sides to a winner,
-- raising and punishment by hand, snapshot -> restore -> continue.
import "web/session"
import "web/json"
import "core/autothrow"
local session, json, throw, autothrow = tw.web.session, tw.web.json, tw.web.throw, tw.autothrow

local START = { year = 2026, month = 11, day = 15, hour = 10, min = 0 }

local function teams(na, nb)
	local A, B = { "Alex", "Kim", "Max", "Nell", "Otto", "Pia" }, { "Sam", "Lee", "Dana", "Rae", "Sol", "Tam" }
	local ta, tb = { name = "North", players = {} }, { name = "South", players = {} }
	for i = 1, na do ta.players[i] = { name = A[i] } end
	for i = 1, nb do tb.players[i] = { name = B[i] } end
	return { A = ta, B = tb }
end
_G.matchTeams = teams

-- Run frames until the computer's throw leaves; returns the frame's output.
local function cpuThrow(s)
	for _ = 1, 600 do
		local o = s:frame { dt = 1 / 60 }
		if o.action then return o end
	end
	error("the computer did not throw")
end
_G.cpuThrow = cpuThrow

-- A scripted human throw: the computer's choice for this set-up (its own rng,
-- scatter `scale`), thrown as a human action.
local function scriptedAction(s, r, scale)
	local ts = s.ts
	local a = autothrow.choose(s.setup, r, scale)
	throw.showAim(ts, a)
	local L, how = throw.cpuLaunch(ts, a)
	ts.playerX, ts.playerY = a.x, a.y
	return json.decode(json.encode(s:throwAction(L, how, { back = a.swing.back, stop = a.swing.releaseAngle,
		verdicts = L })))
end
_G.scriptedAction = scriptedAction

test("the computer against the computer, to a winner, with the game file", function()
	local s = session.new { mode = "match", cpu = "both", seed = 7, teams = teams(2, 3), start = START,
		wind = "light", maxTurns = 40 }
	local throws, sizes = 0, { max = 0, sum = 0, n = 0 }
	while s:need().kind ~= "over" do
		local n = s:need()
		expect.eq(n.kind, "throw")
		expect.eq(n.cpu, true)
		local o = cpuThrow(s)
		expect.eq(o.action.scripted, true)
		throws = throws + 1
		local size = #s:snapshot()
		sizes.max, sizes.sum, sizes.n = math.max(sizes.max, size), sizes.sum + size, sizes.n + 1
	end
	local n = s:need()
	expect.truthy(n.winner.winner == "A" or n.winner.winner == "B")
	expect.truthy(#n.how > 0)
	expect.truthy(n.file.text:find("North") and n.file.text:find("South"), "the game file names the teams")
	expect.truthy(n.file.name:match("%.txt$"))
	print(string.format("      %d throws, %d turns, %s; snapshot mean %d max %d bytes", throws, n.turn, n.how,
		sizes.sum // sizes.n, sizes.max))
end)

test("raising and punishment by hand", function()
	local s = session.new { mode = "match", seed = 11, teams = teams(1, 1), start = START, raising = "hand" }
	local r = autothrow.rng(99)
	local raised, placed, refused, settleCard = 0, 0, 0, 0
	local guard = 0
	while s:need().kind ~= "over" and guard < 600 and (raised < 2 or placed < 1) do
		guard = guard + 1
		local n = s:need()
		if n.card and n.card.kind == "settle" then settleCard = settleCard + 1 end
		if n.kind == "throw" then
			-- wild tosses, to earn a punishment kubb: four times a baton's mistakes, whatever
			-- the computer's own drill is scaled to (autothrow.tune.drillScale)
			s:apply(scriptedAction(s, r, (n.setup.kind == "toss") and 4 / autothrow.tune.drillScale or 1))
		elseif n.kind == "raise" then
			expect.truthy(#n.choices >= 1)
			expect.truthy(n.default >= 1 and n.default <= #n.choices)
			for _, e in ipairs(n.ends) do
				if not e.ok then expect.truthy(e.why == "THAT END IS OUT" or e.why == "THAT END IS BLOCKED") end
			end
			local o = s:apply { type = "raise", choice = #n.choices }
			expect.eq(o.ok, true)
			raised = raised + 1
		elseif n.kind == "punish" then
			expect.truthy(#n.keepOut >= 1)
			-- the king's keep-out circle refuses a spot
			local king
			for _, k in ipairs(n.keepOut) do if k.kind == "king" then king = k end end
			local c = s:checkPunish(king.x, king.y - 0.1)
			expect.eq(c.ok, false)
			expect.eq(c.label, "TOO NEAR THE KING")
			local bad = s:apply { type = "punish", x = king.x, y = king.y - 0.1 }
			expect.eq(bad.ok, false)
			refused = refused + 1
			local good = s:checkPunish(n.cursor.x, n.cursor.y)
			expect.eq(good.ok, true)
			local o = s:apply { type = "punish", x = n.cursor.x, y = n.cursor.y }
			expect.eq(o.ok, true)
			placed = placed + 1
		end
	end
	expect.truthy(raised >= 2, "raised by hand: " .. raised)
	expect.truthy(placed >= 1, "placed by hand: " .. placed)
	expect.truthy(settleCard >= 1, "the settle card in pass and play")
	print(string.format("      %d raised, %d placed, %d refused by hand", raised, placed, refused))
end)

-- Play `s` on with the computer's throws until `k` more actions have run or the
-- match is over; returns the hashes after each.
local function playOn(s, k)
	local hashes = {}
	for _ = 1, k do
		if s:need().kind == "over" then break end
		cpuThrow(s)
		hashes[#hashes + 1] = s:hash()
	end
	return hashes
end

test("snapshot -> restore -> continue is the same game as straight through", function()
	local opts = { mode = "match", cpu = "both", seed = 23, teams = teams(3, 1), start = START, wind = "strong",
		opening = "six" }
	local a = session.new(opts)
	-- before the first throw too (the aim memory's numbers keep their type)
	local first = a:snapshot()
	expect.eq(session.restore(first):snapshot(), first, "a restore before the first throw is the same text")
	playOn(a, 9)
	local snap = a:snapshot()
	local b = session.restore(snap)
	expect.eq(b:snapshot(), snap, "the restored snapshot is the same text")
	local ha = playOn(a, 40)
	local hb = playOn(b, 40)
	expect.eq(#ha, #hb)
	for i = 1, #ha do expect.eq(hb[i], ha[i], "hash after throw " .. i) end
	-- and the recording of the last throw is the same
	expect.eq(json.encode(b.recording), json.encode(a.recording))
end)

test("a resign waits for the team's own turn", function()
	local s = session.new { mode = "match", cpu = "both", seed = 3, start = START }
	cpuThrow(s)
	local side = s:need().side
	local other = side == "A" and "B" or "A"
	s:apply { type = "resign", side = other }
	expect.eq(s:need().kind, "throw")
	expect.eq(s:need().resignPending, other)
	local guard = 0
	while s:need().kind ~= "over" and guard < 20 do cpuThrow(s); guard = guard + 1 end
	local n = s:need()
	expect.eq(n.kind, "over")
	expect.eq(n.winner.winner, side)
	expect.truthy(n.how:find("resigned"))
end)

test("a change of thrower survives snapshot -> restore", function()
	local s = session.new { mode = "match", seed = 5, teams = teams(3, 1), start = START }
	local n = s:need()
	expect.truthy(n.candidates and #n.candidates > 1, "candidates for a team of three")
	local pick
	for _, c in ipairs(n.candidates) do if c.id ~= s.setup.thrower.id then pick = c.id end end
	expect.eq(s:apply({ type = "thrower", id = pick }).ok, true)
	expect.eq(s.setup.thrower.id, pick)
	local snap = s:snapshot()
	local r = session.restore(snap)
	expect.eq(r:snapshot(), snap)
	expect.eq(r.setup.thrower.id, pick, "the restored throw keeps the new thrower")
end)
