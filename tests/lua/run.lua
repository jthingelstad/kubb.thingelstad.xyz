-- Desktop test runner for lua/web over vendor/core, on plain Lua 5.4.
--   lua5.4 tests/lua/run.lua [test_file.lua ...]
-- With no arguments it runs every tests/lua/test_*.lua. Exits non-zero if
-- any test fails. No dependencies. (The Playdate repo's runner, pointed at
-- vendor/ and lua/.)

local here = arg[0]:match("^(.*)/[^/]*$") or "."
local root = here .. "/../.."

-- The import shim: `import "core/x"` runs vendor/core/x.lua once, `import
-- "web/x"` runs lua/web/x.lua once (src/engine does the same over the
-- bundled sources in the browser).
local imported = {}
function import(name)
	name = name:gsub("%.lua$", "")
	if imported[name] then return nil end
	imported[name] = true
	local path
	if name:match("^core/") then path = root .. "/vendor/" .. name .. ".lua"
	elseif name:match("^web/") then path = root .. "/lua/" .. name .. ".lua"
	else error("import \"" .. name .. "\": only core/ and web/ modules", 2) end
	local chunk, err = loadfile(path)
	if not chunk then error("import \"" .. name .. "\": " .. err, 2) end
	return chunk()
end

local tests = {}
function test(name, fn) tests[#tests + 1] = { name = name, fn = fn, file = CURRENT_FILE } end

expect = {}
function expect.eq(actual, expected, what)
	if actual ~= expected then
		error(string.format("%sexpected %s, got %s", what and (what .. ": ") or "",
			tostring(expected), tostring(actual)), 2)
	end
end
function expect.near(actual, expected, tol, what)
	tol = tol or 1e-9
	if type(actual) ~= "number" or math.abs(actual - expected) > tol then
		error(string.format("%sexpected %s +/- %g, got %s", what and (what .. ": ") or "",
			tostring(expected), tol, tostring(actual)), 2)
	end
end
function expect.truthy(v, what)
	if not v then error((what or "expected a true value") .. ", got " .. tostring(v), 2) end
end

local function listTests()
	local files = {}
	local p = io.popen('ls "' .. here .. '"')
	for f in p:lines() do
		if f:match("^test_.*%.lua$") then files[#files + 1] = here .. "/" .. f end
	end
	p:close()
	table.sort(files)
	return files
end

local files = {}
for i = 1, #arg do files[#files + 1] = arg[i] end
if #files == 0 then files = listTests() end

for _, f in ipairs(files) do
	CURRENT_FILE = f:match("[^/]*$")
	local chunk, err = loadfile(f)
	if not chunk then
		io.stderr:write("cannot load " .. f .. ": " .. err .. "\n")
		os.exit(1)
	end
	chunk()
end

local passed, failed = 0, 0
local t0 = os.clock()
for _, t in ipairs(tests) do
	local s = os.clock()
	local ok, err = xpcall(t.fn, debug.traceback)
	if ok then
		passed = passed + 1
		print(string.format("ok    %s: %s (%.2f s)", t.file, t.name, os.clock() - s))
	else
		failed = failed + 1
		print(string.format("FAIL  %s: %s\n%s", t.file, t.name, err))
	end
end
print(string.format("%d passed, %d failed (%.1f s)", passed, failed, os.clock() - t0))
if failed > 0 then os.exit(1) end
