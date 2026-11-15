-- The one door from JavaScript (docs/ENGINE.md "API"): kubbCall(method,
-- argsJson) -> resultJson. One session per Lua state. Every call is
-- protected: a Lua error comes back as {"error": "..."}, which src/engine
-- throws as a JavaScript Error. snapshot returns the snapshot text itself;
-- restore takes it as its argument.
import "core/tw"
import "web/json"
import "web/session"

local json, session = tw.web.json, tw.web.session

local api = {}
local S = nil

local function need()
	assert(S, "no session: call new or restore first")
	return S
end

local M = {}

function M.new(a) S = session.new(a or {}); return S:view() end
function M.restore(text, raw) S = session.restore(raw); return S:view() end
function M.view() return need():view() end
function M.need() return need():need() end
function M.aim() local s = need(); return { aim = s:aimView(), camera = s.ts.aimCam } end
function M.frame(a) return need():frame(a or {}) end
function M.showAt(a) return need():showAt(a and a.t or 0) or json.object() end
function M.setTarget(a) return need():setTarget(a.x, a.y, a.snap) end
function M.nudgeTarget(a) return need():nudgeTarget(a.dx, a.dy) end
function M.setStance(a) return need():setStance(a and a.x, a and a.y) end
function M.stepArc(a) return need():stepArc(a and a.step) end
function M.setArc(a) return need():setArc(a.deg) end
function M.stepSide(a) return need():stepSide(a and a.step) end
function M.freshPlan() return need():freshPlan() end
function M.setLevel(a) return need():setLevel(a and a.level) end
function M.setDrill(a) return need():setDrill(a and a.on) end
function M.reset() return need():reset() end
function M.setSurface(a) return need():setSurface(a and a.surface) end
function M.setControl(a) return need():setControl(a) end
function M.aimState() return need():aimState() end
function M.showAim(a) return need():showAim(a) or json.object() end
function M.apply(a) return need():apply(a) end
function M.checkPunish(a) return need():checkPunish(a.x, a.y) end
function M.hash() local text = need():snapshot(); return { hash = session.fnv(text), bytes = #text } end
function M.recording() return need().recording or json.object() end

local function call(method, arg)
	if method == "snapshot" then return need():snapshot() end
	local f = M[method]
	if not f then error("unknown call " .. tostring(method), 0) end
	local a = nil
	if method == "restore" then return json.encode(f(nil, arg)) end
	if arg and arg ~= "" then a = json.decode(arg) end
	local r = f(a)
	if r == nil then r = json.object() end
	return json.encode(r)
end

function kubbCall(method, arg)
	local ok, r = pcall(call, method, arg)
	if ok then return r end
	return json.encode { error = tostring(r) }
end

api.call = call
tw.web.api = api
