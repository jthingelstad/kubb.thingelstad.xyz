// The room's logic is the engine's (src/net/room-engine.js): a test that calls
// src/net/lobby.js, seats.js, sync.js or the replay check imports this first, which
// loads the vendored engine under wasmoon and hands it to them, as src/main.js does.
import { Engine } from "../../src/engine/index.js";
import { useRoomEngine } from "../../src/net/lobby.js";
import { bundleLua } from "../../tools/lua-bundle.mjs";

export const engine = await Engine.create({ sources: bundleLua() });
useRoomEngine(engine);
