-- Replays (lua/web/replay.lua): a recorded match played again from its options and its
-- log reproduces every hash and the result; BACK and REWIND land where they should; a
-- replay belongs to nobody and refuses every action from outside.
import "web/session"
import "web/json"
import "web/replay"
import "web/api"
import "core/autothrow"
local session, json, replay, autothrow = tw.web.session, tw.web.json, tw.web.replay, tw.autothrow

local START = { year = 2026, month = 11, day = 16, hour = 9, min = 30 }

local function copy(v)
	if type(v) ~= "table" then return v end
	local out = {}
	for k, x in pairs(v) do out[k] = copy(x) end
	return out
end

-- Play a match as browsers on a pitch do and keep what the pitch's document keeps: the
-- options, the hash at the start, and each action (through JSON, as it travels) with
-- the hash after it. Throws are scripted human throws; raising and punishment by hand.
local function record(seed, maxTurns)
	local setup = { seed = seed, teams = matchTeams(1, 2), start = START, raising = "hand", wind = "light",
		maxTurns = maxTurns or 12 }
	local o = copy(setup)
	o.mode = "match"
	local s = session.new(o)
	local h0 = s:hash()
	local log = {}
	local r = autothrow.rng(500 + seed)
	local guard = 0
	while s:need().kind ~= "over" do
		guard = guard + 1
		assert(guard < 2000, "the match ends")
		local n = s:need()
		local a
		if n.kind == "throw" then
			a = scriptedAction(s, r, (n.setup.kind == "toss") and 4 / autothrow.tune.drillScale or 1)
		elseif n.kind == "raise" then
			a = { type = "raise", choice = #n.choices }
		elseif n.kind == "punish" then
			a = { type = "punish", x = n.cursor.x, y = n.cursor.y }
		end
		a = json.decode(json.encode(a))
		local out = s:apply(a)
		assert(out.ok ~= false, "the recorded action is taken")
		log[#log + 1] = { a = a, h = s:hash() }
	end
	return { setup = setup, h0 = h0, log = log }, s
end

-- The data as it reaches the engine from JavaScript: through JSON.
local function travelled(d)
	return json.decode(json.encode(d))
end

local function kinds(log)
	local k = {}
	for _, e in ipairs(log) do k[e.a.type] = (k[e.a.type] or 0) + 1 end
	return k
end

test("a replay reproduces every hash and the result", function()
	local d, played = record(4)
	local k = kinds(d.log)
	expect.truthy((k.throw or 0) > 5, "throws in the log")
	local r = replay.new(travelled(d))
	expect.eq(r.differs, false, "the start is the same")
	expect.eq(r.total, #d.log)
	expect.eq(r.throws, k.throw)
	local i = 0
	while not r:done() do
		local out = r:step()
		i = i + 1
		expect.eq(out.ok, true, "action " .. i .. " taken")
		expect.eq(r.s:hash(), d.log[i].h, "hash after action " .. i)
		if out.action.type == "throw" then expect.truthy(out.recording, "a throw plays back") end
	end
	expect.eq(r.differs, false)
	expect.eq(r.s:snapshot(), played:snapshot(), "the same match at the end")
	local a, b = r.s:need(), played:need()
	expect.eq(a.kind, "over")
	expect.eq(a.winner.winner, b.winner.winner)
	expect.eq(a.how, b.how)
	expect.eq(r:info().thrown, k.throw)
	expect.eq(r:info().done, true)
	print(string.format("      %d actions (%d throws, %d raises, %d placed), %d turns", #d.log, k.throw,
		k.raise or 0, k.punish or 0, a.turn))
end)

test("a replay can set out from the match's first snapshot instead of its options", function()
	local d, played = record(5)
	local o = copy(d.setup)
	o.mode = "match"
	local r = replay.new(travelled { start = session.new(o):snapshot(), h0 = d.h0, log = d.log })
	expect.eq(r.differs, false, "the start is the same")
	local i = 0
	while not r:done() do
		r:step()
		i = i + 1
		expect.eq(r.s:hash(), d.log[i].h, "hash after action " .. i)
	end
	expect.eq(r.differs, false)
	expect.eq(r.s:snapshot(), played:snapshot())
	r:rewind()
	expect.eq(r.i, 0)
	expect.eq(r.s:hash(), d.h0, "rewind goes to that snapshot")
end)

test("a hash that disagrees marks the replay and it plays on", function()
	local d = record(6)
	local t = travelled(d)
	t.log[3].h = "00000000"
	local r = replay.new(t)
	for _ = 1, 2 do r:step() end
	expect.eq(r.differs, false)
	r:step()
	expect.eq(r.differs, true, "the third disagrees")
	while not r:done() do r:step() end
	expect.eq(r.s:need().kind, "over", "it went on to the end")
	-- an action the engine refuses is passed over
	local t2 = travelled(d)
	table.insert(t2.log, 2, { a = { type = "raise" }, h = "x" })
	local r2 = replay.new(t2)
	r2:step()
	local out = r2:step()
	expect.eq(out.ok, false, "a raise with no kubb to raise is refused")
	expect.eq(r2.differs, true)
	expect.eq(r2.i, 2, "and passed over")
end)

test("back goes to the start of the previous turn; rewind to the start", function()
	local d = record(4)
	local r = replay.new(travelled(d))
	-- the snapshot and the throw count at every action, played straight through
	local at = { [0] = { snap = r.s:snapshot(), thrown = 0, turn = r:turn() } }
	while not r:done() do
		r:step()
		at[r.i] = { snap = r.s:snapshot(), thrown = r.thrown, turn = r:turn() }
	end
	-- the first action of each turn
	local starts = { 0 }
	for i = 1, r.total do
		if at[i].turn ~= at[starts[#starts]].turn then starts[#starts + 1] = i end
	end
	expect.truthy(#starts >= 4, "several turns: " .. #starts)
	-- from the middle of turn k (one action past its start), back lands on turn k-1's start
	local k = 3
	local r2 = replay.new(travelled(d))
	while r2.i < starts[k] + 1 do r2:step() end
	r2:back()
	expect.eq(r2.i, starts[k - 1], "back from inside a turn")
	expect.eq(r2.s:snapshot(), at[starts[k - 1]].snap, "the very state played straight through")
	expect.eq(r2.thrown, at[starts[k - 1]].thrown)
	-- at a turn's start: the turn before that
	r2:back()
	expect.eq(r2.i, starts[k - 2])
	-- and on from there is the same match
	while r2.i < starts[k] + 3 do r2:step() end
	expect.eq(r2.s:snapshot(), at[r2.i].snap, "forward again after back")
	expect.eq(r2.differs, false)
	-- in the first turn: the start
	local r3 = replay.new(travelled(d))
	r3:step()
	r3:back()
	expect.eq(r3.i, 0)
	expect.eq(r3.s:snapshot(), at[0].snap)
	-- rewind from the end
	while not r2:done() do r2:step() end
	r2:rewind()
	expect.eq(r2.i, 0)
	expect.eq(r2.thrown, 0)
	expect.eq(r2.s:snapshot(), at[0].snap)
end)

test("a replay belongs to nobody: every action from outside is refused", function()
	local d = record(4)
	local function call(method, arg)
		return json.decode(kubbCall(method, arg and json.encode(arg) or ""))
	end
	local v = call("replayLoad", travelled(d))
	expect.eq(v.replay.i, 0)
	expect.eq(v.replay.total, #d.log)
	expect.eq(v.need["local"], false, "nobody here throws")
	-- the first action, as anyone might try to take it
	local refused = call("apply", d.log[1].a)
	expect.truthy(refused.error and refused.error:find("read only"), "apply is refused")
	local c = call("setControl", { sides = { "A", "B" }, cpu = true })
	expect.truthy(c.error and c.error:find("read only"), "taking a side is refused")
	-- frames run the aim but never throw: not even the computer's
	for _ = 1, 400 do
		local o = call("frame", { dt = 1 / 20 })
		expect.eq(o.action, nil, "no action from a frame")
	end
	local info = call("replayInfo")
	expect.eq(info.i, 0, "nothing moved")
	-- the replay's own step does
	local s = call("replayStep")
	expect.eq(s.ok, true)
	expect.eq(s.replay.i, 1)
	expect.eq(call("hash").hash, d.log[1].h)
	local b = call("replayBack")
	expect.eq(b.replay.i, 0)
	-- a new match ends the replay: acting is allowed again
	call("new", { mode = "match", seed = 1, start = START })
	local ok = call("apply", { type = "resign", side = "A" })
	expect.eq(ok.error, nil)
	expect.truthy(call("replayInfo").error, "no replay loaded")
end)

test("a computer's throw in a replay waits at the release for the log", function()
	local s = session.new { mode = "match", cpu = "both", seed = 9, teams = matchTeams(1, 1), start = START,
		raising = "auto" }
	local h0 = s:hash()
	local log = {}
	for _ = 1, 3 do
		local o = cpuThrow(s)
		log[#log + 1] = { a = o.action, h = s:hash() }
	end
	local d = { setup = { cpu = "both", seed = 9, teams = matchTeams(1, 1), start = START, raising = "auto" },
		h0 = h0, log = log }
	json.decode(kubbCall("replayLoad", json.encode(d)))
	local held = false
	for _ = 1, 400 do
		json.decode(kubbCall("frame", json.encode { dt = 1 / 20 }))
		if json.decode(kubbCall("replayInfo", "")).held then held = true; break end
	end
	expect.truthy(held, "the computer's swing ends held at the release")
	for i = 1, 3 do
		local r = json.decode(kubbCall("replayStep", ""))
		expect.eq(r.ok, true)
		expect.eq(json.decode(kubbCall("hash", "")).hash, log[i].h, "the computer's throw " .. i)
	end
end)
