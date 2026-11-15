// Loads the game's own Lua core (vendor/core/) under Node with wasmoon, the
// way the browser engine does: a Lua `import` shim that runs each
// "core/<name>" once. For the renderer's fixtures and tests only.
import { LuaFactory } from "wasmoon";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const coreDir = path.join(root, "vendor/core");

export async function loadCore(modules = []) {
  const files = {};
  for (const f of fs.readdirSync(coreDir)) {
    if (f.endsWith(".lua"))
      files["core/" + f.slice(0, -4)] = fs.readFileSync(
        path.join(coreDir, f),
        "utf8",
      );
  }
  const lua = await new LuaFactory().createEngine();
  lua.global.set("__src", (name) => files[name] ?? null);
  await lua.doString(`
    local imported = {}
    function import(name)
      if imported[name] then return nil end
      imported[name] = true
      local s = __src(name)
      if not s then error("no module " .. name) end
      return assert(load(s, "@" .. name))()
    end
  `);
  for (const m of ["core/camera", ...modules])
    await lua.doString(`import "${m}"`);
  return lua;
}

// Run Lua that returns a JSON-able value through a tiny encoder (numbers,
// strings, booleans, arrays and tables). Floats are written with %.17g so
// nothing is lost.
export const JSON_LUA = `
local function enc(v)
  local t = type(v)
  if t == "number" then
    if v ~= v or v == math.huge or v == -math.huge then return "null" end
    if math.type(v) == "integer" then return tostring(v) end
    return string.format("%.17g", v)
  elseif t == "string" then return string.format("%q", v):gsub("\\\\\\n", "\\\\n")
  elseif t == "boolean" then return tostring(v)
  elseif t == "nil" then return "null"
  elseif t == "table" then
    if #v > 0 or next(v) == nil then
      local out = {}
      for i = 1, #v do out[i] = enc(v[i]) end
      return "[" .. table.concat(out, ",") .. "]"
    end
    local keys = {}
    for k in pairs(v) do keys[#keys + 1] = tostring(k) end
    table.sort(keys)
    local out = {}
    for _, k in ipairs(keys) do out[#out + 1] = string.format("%q", k) .. ":" .. enc(v[k] == nil and v[tonumber(k)] or v[k]) end
    return "{" .. table.concat(out, ",") .. "}"
  end
  return "null"
end
json = { encode = enc }
`;

export async function runJSON(lua, code) {
  const s = await lua.doString(code);
  return JSON.parse(s);
}
