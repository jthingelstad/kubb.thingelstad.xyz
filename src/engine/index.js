// The game engine for JavaScript (docs/ENGINE.md): kubb-engine (vendor/engine/,
// its core and session) in wasmoon's Lua 5.4, behind a few coarse calls that
// take and return plain objects. Browser and Node; no DOM.
//
//   import { Engine } from "../engine/index.js";
//   const engine = await Engine.create({ sources, wasmUrl, client: "web 0.1.0" });
//   const view = engine.newPractice({ surface: "grass" });
//   const out = engine.frame({ dt, arm, plan, move, walk });
//
// sources: the module map tools/lua-bundle.mjs writes ({ "core/world":
// "<lua>", "session/api": "<lua>", ... }), or a URL to fetch it from.
// wasmUrl: wasmoon's glue.wasm (the browser; Node finds it in node_modules
// when it is left out). Before anything else the engine is given its tune
// (the pointer's, the web's dial) and, when `client` is set, the label its
// game files carry ("web <package version>"; the engine's own otherwise).
// engine.version is the engine's version (version.lua), sent with records.
import { LuaFactory } from "wasmoon";

// The import shim (the Playdate's `import`): runs a module once, from the
// sources map. The session's one door is kubbCall (session/api.lua).
const BOOT = `
local imported = {}
function import(name)
  name = name:gsub("%.lua$", "")
  if imported[name] then return nil end
  imported[name] = true
  local s = __kubbSource(name)
  if not s then error("import: no module " .. name, 2) end
  return assert(load(s, "@" .. name))()
end
import "session/api"
`;

export class EngineError extends Error {}

export class Engine {
  // Use Engine.create.
  constructor(lua, call) {
    this.lua = lua;
    this._kubbCall = call;
    this.version = null;
  }

  static async create({ sources, wasmUrl, client, tune = "pointer" } = {}) {
    if (typeof sources === "string") {
      const res = await fetch(sources);
      if (!res.ok) throw new EngineError(`lua sources: ${res.status}`);
      sources = await res.json();
    }
    if (!sources || typeof sources !== "object")
      throw new EngineError("Engine.create needs the Lua sources map");
    const factory = new LuaFactory(wasmUrl);
    const lua = await factory.createEngine();
    // undefined, not null, for a missing module: wasmoon turns it into nil
    lua.global.set("__kubbSource", (name) =>
      Object.hasOwn(sources, name) ? sources[name] : undefined,
    );
    await lua.doString(BOOT);
    const call = lua.global.get("kubbCall");
    if (typeof call !== "function")
      throw new EngineError("session/api did not load");
    const engine = new Engine(lua, call);
    // docs/SESSION.md "Starting" (vendor/engine): before the first new or restore
    engine.call("useTune", { name: tune });
    if (client) engine.call("setClient", { label: client });
    engine.version = engine.call("engineVersion").version;
    return engine;
  }

  // The raw door: method name and argument text in, result text out.
  callText(method, argText = "") {
    const text = this._kubbCall(method, argText);
    if (typeof text !== "string") throw new EngineError(`${method}: no result`);
    return text;
  }

  call(method, args) {
    const text = this.callText(
      method,
      args === undefined ? "" : JSON.stringify(args),
    );
    const out = JSON.parse(text);
    if (out && typeof out === "object" && !Array.isArray(out) && "error" in out)
      throw new EngineError(`${method}: ${out.error}`);
    return out;
  }

  // ---- sessions ----
  newPractice(opts = {}) {
    return this.call("new", { ...opts, mode: "practice" });
  }
  newMatch(opts = {}) {
    return this.call("new", { ...opts, mode: "match" });
  }
  // snapshot: the text snapshot() gave (passed through untouched).
  restore(snapshot) {
    if (typeof snapshot !== "string")
      throw new EngineError("restore takes the snapshot text");
    const out = JSON.parse(this.callText("restore", snapshot));
    if (out && "error" in out) throw new EngineError(`restore: ${out.error}`);
    return out;
  }
  // The whole match as JSON text (opaque: store and send it as it is).
  snapshot() {
    const text = this.callText("snapshot");
    if (text.startsWith('{"error":'))
      throw new EngineError(`snapshot: ${JSON.parse(text).error}`);
    return text;
  }
  hash() {
    return this.call("hash");
  }

  // ---- reading ----
  view() {
    return this.call("view");
  }
  // The view in the thrower's frame even in the wide view (reports).
  frameView() {
    return this.call("frameView");
  }
  need() {
    return this.call("need");
  }
  aim() {
    return this.call("aim");
  }
  recording() {
    return this.call("recording");
  }
  // The score sheet: { text, name, shown: [line, ...], done } for a match ({} in
  // practice). text is the game file in Planet Kubb Notation, positions included;
  // shown is each line without them, as the screen shows it.
  sheet() {
    return this.call("sheet");
  }

  // ---- each frame ----
  frame(input = {}) {
    const a = { dt: input.dt ?? 1 / 60 };
    if (input.arm !== undefined && input.arm !== null) a.arm = input.arm;
    if (input.touch) a.touch = input.touch;
    if (input.stroke) a.stroke = input.stroke;
    if (input.plan) a.plan = true;
    if (input.move) a.move = input.move;
    if (input.walk) a.walk = input.walk;
    return this.call("frame", a);
  }
  showAt(t) {
    return this.call("showAt", { t });
  }

  // ---- a replay (session/replay.lua) ----
  // data: { setup, h0, log: [{ a, h }] } (src/net/lobby.js replayOf), or `start` (the
  // match's first snapshot) in place of `setup` (tools/backfill-replay.mjs). Every result
  // carries `replay`: { i, total, turn, thrown, throws, differs, done }. While a
  // replay is loaded every action from outside is refused; new or restore ends it.
  replayLoad(data) {
    return this.call("replayLoad", {
      setup: data.start ? undefined : data.setup,
      start: data.start ?? undefined,
      h0: data.h0 ?? undefined,
      log: data.log,
    });
  }
  replayStep() {
    return this.call("replayStep");
  }
  replayBack() {
    return this.call("replayBack");
  }
  replayRewind() {
    return this.call("replayRewind");
  }
  // { ...info, held }: held while a computer's throw waits at its release
  replayInfo() {
    return this.call("replayInfo");
  }
  replayEnd() {
    return this.call("replayEnd");
  }

  // ---- the wide view (session/wide.lua) ----
  // box { left, top, right, bottom } in frame px turns it on: every camera
  // after this is the wide one and the pitch comes in the world frame.
  // null turns it off. Returns { camera, kind, farPx } or {}.
  setWide(box, kind) {
    return this.call("setWide", box ? { box, kind } : {});
  }

  // ---- aiming ----
  setTarget(x, y, snap = false) {
    return this.call("setTarget", { x, y, snap });
  }
  nudgeTarget(dx, dy) {
    return this.call("nudgeTarget", { dx, dy });
  }
  // setStance() with no arguments: the stance follows the target again.
  setStance(x, y) {
    return this.call("setStance", x === undefined ? {} : { x, y });
  }
  stepArc(step) {
    return this.call("stepArc", { step });
  }
  setArc(deg) {
    return this.call("setArc", { deg });
  }
  stepSide(step) {
    return this.call("stepSide", { step });
  }
  freshPlan() {
    return this.call("freshPlan");
  }
  setLevel(level) {
    return this.call("setLevel", { level });
  }

  // ---- practice ----
  setDrill(on) {
    return this.call("setDrill", { on: !!on });
  }
  reset() {
    return this.call("reset");
  }
  setSurface(surface) {
    return this.call("setSurface", { surface });
  }

  // ---- a match among browsers ----
  setControl(control) {
    return this.call("setControl", control);
  }
  aimState() {
    return this.call("aimState");
  }
  showAim(state) {
    return this.call("showAim", state);
  }
  apply(action) {
    return this.call("apply", action);
  }
  checkPunish(x, y) {
    return this.call("checkPunish", { x, y });
  }
}
