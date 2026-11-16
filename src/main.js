// The game client's entry (docs/CLIENT.md). The game pages (/practice/ and
// /p/<code>) load it as a module: it shows the title while wasmoon and the
// Lua load, then routes:
//
//   /practice/         the open practice pitch
//   /p/<code>?solo=1   a match against the computer on this pitch
//   /p/<code>?watch=1  the computer against itself, match after match
//   /p/<code>          a shared pitch: the lobby, then a match with friends
//                      on the link (src/net/pitch.js, docs/MULTIPLAYER.md),
//                      driving the same Game through its seam
import { readConfig, pitchCode } from "./site/config.js";
import { Engine } from "./engine/index.js";
import { Game } from "./game/game.js";
import { Sound } from "./game/sound.js";
import { prefs } from "./game/prefs.js";
import { Cards, SOLO_DEFAULTS } from "./ui/cards.js";
import { Menu } from "./ui/menu.js";
import { showHowto, shouldShowHowto } from "./ui/howto.js";
import { h, button } from "./ui/dom.js";
import { startPitch } from "./net/pitch.js";

const config = readConfig();
const ui = document.getElementById("ui");
const canvas = document.getElementById("pitch");
const params = new URLSearchParams(location.search);
const watching = params.get("watch") === "1";
const testing =
  params.get("test") === "1" ||
  location.hostname === "127.0.0.1" ||
  location.hostname === "localhost";

const loading = h(
  "div.loading",
  { "data-test": "loading", role: "status" },
  h("h1.display.loading-title", "Kubb", h("span", "Throwing Wood")),
  h("p.loading-text", "Setting out the pitch..."),
);
ui.append(loading);

function fail(err) {
  console.error(err);
  loading.remove();
  const box = h(
    "div.card.error",
    { role: "alert", "data-test": "error" },
    h("h2.display", "The pitch did not load"),
    h(
      "p",
      "Something went wrong starting the game in this browser. Reload the page to try again.",
    ),
    h("p.detail", String(err && err.message ? err.message : err)),
    h(
      "div.row",
      button("RELOAD", () => location.reload(), "go"),
      h("a.btn", { href: "/" }, "HOME"),
    ),
  );
  ui.append(h("div.scrim", box));
}

const home = () => {
  location.href = "/";
};

async function boot() {
  if (!config.luaUrl) throw new Error("this build has no Lua sources");
  const [engine] = await Promise.all([
    Engine.create({ sources: config.luaUrl, wasmUrl: config.wasmUrl }),
    document.fonts?.load('900 40px "Londrina Solid"').catch(() => null),
  ]);
  const sound = new Sound(config.sounds || "/sounds/");
  const cards = new Cards(ui);
  const game = new Game({ engine, canvas, ui, sound, cards });
  game.onError = fail;
  const howto = (onDone) => showHowto(ui, game, onDone);
  const menu = new Menu(ui, {
    game,
    sound,
    howto: () => howto(),
    home,
    resign: () => game.resign(game.localSide || "A"),
    surface: (s) => {
      prefs.set("practiceSurface", s);
      game.practiceDo(() => game.engine.setSurface(s));
    },
  });
  const code = pitchCode();

  if (testing) {
    window.__kubb = {
      engine,
      game,
      sound,
      cards,
      menu,
      config,
      pitch: null,
      watchTune,
    };
  }
  loading.remove();

  if (config.mode === "practice" || !code) {
    startPractice(game, cards);
  } else if (params.get("solo") === "1") {
    startSolo(game, cards);
  } else if (watching) {
    startWatch(game, cards);
  } else {
    const pitch = startPitch({
      game,
      cards,
      ui,
      code,
      home,
      roomsUrl: roomsUrl(),
    });
    if (testing) window.__kubb.pitch = pitch;
  }
  game.start();
  document.body.dataset.ready = "1";
  if (shouldShowHowto() && !params.has("nohowto") && !watching) howto();
}

// ---------- practice ----------

function startPractice(game, cards) {
  game.newPractice({
    surface: prefs.get("practiceSurface", "grass"),
  });
  const tray = h(
    "div.tray",
    { "data-test": "tray" },
    button("DRILL", () => toggleDrill(), "small", {
      "aria-pressed": "false",
      "data-test": "drill",
    }),
    button("RESET", () => game.practiceDo(() => game.engine.reset()), "small", {
      "data-test": "reset",
    }),
  );
  const drillBtn = tray.firstChild;
  const toggleDrill = () => {
    const on = !(game.need && game.need.drill);
    game.practiceDo(() => game.engine.setDrill(on));
    drillBtn.setAttribute("aria-pressed", String(!!game.need?.drill));
    drillBtn.textContent = game.need?.drill ? "BATONS" : "DRILL";
  };
  document.getElementById("ui").append(tray);
  cards.root.dataset.mode = "practice";
}

// ---------- a match against the computer ----------

function startSolo(game, cards) {
  game.seat = { sides: ["A"], cpu: true };
  game.localSide = "A";
  const options = () =>
    cards.options((o) => play(o), {
      home,
    });
  const play = (o) => {
    game.setLevel(o.level);
    const now = new Date();
    game.newMatch({
      seed: Math.floor(Math.random() * 2 ** 31),
      teams: {
        A: { name: o.name, players: [{ name: o.name, level: o.level }] },
        B: {
          name: "Computer",
          players: [{ name: "Computer", level: o.level }],
        },
      },
      cpu: "B",
      first: "A",
      opening: o.opening,
      raising: o.raising,
      wind: o.wind,
      surface: o.surface,
      set: o.set,
      start: {
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        day: now.getDate(),
        hour: now.getHours(),
        min: now.getMinutes(),
      },
    });
  };
  game.onNeed = (need) => {
    cards.tick(game);
    if (need.kind === "over") {
      cards.winner(need, {
        rematch: () => options(),
        home,
      });
    }
  };
  // a pitch behind the options card
  game.newPractice({ surface: prefs.get("solo", {}).surface || "grass" });
  options();
}

// ---------- the computer against itself ----------

export const watchTune = {
  nextMs: 10000, // the winner card stays up this long before the next match
  maxTurns: 60, // a safety net: matches end in 5 to 30 turns
};

// Nobody touches it. The computer throws for both teams and raises and places
// its own punishment kubbs (the session shows no cards for a computer's
// side). When a match ends the winner card stays up for watchTune.nextMs and
// the next match starts by itself, the other team throwing first; STOP on
// the card holds it there. The options are the solo card's, as last saved.
// The Game runs unattended: a timer steps it while the tab is hidden.
function startWatch(game, cards) {
  game.seat = { sides: [], cpu: true };
  game.localSide = null;
  game.unattended = true;
  let first = "A";
  let timer = null;
  const play = () => {
    clearTimeout(timer);
    timer = null;
    cards.close();
    const o = { ...SOLO_DEFAULTS, ...prefs.get("solo", {}) };
    const now = new Date();
    const team = (name) => ({ name, players: [{ name, level: o.level }] });
    game.newMatch({
      seed: Math.floor(Math.random() * 2 ** 31),
      teams: { A: team("North"), B: team("South") },
      cpu: "both",
      first,
      opening: o.opening,
      raising: "auto",
      wind: o.wind,
      surface: o.surface,
      set: o.set,
      maxTurns: watchTune.maxTurns,
      start: {
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        day: now.getDate(),
        hour: now.getHours(),
        min: now.getMinutes(),
      },
    });
    first = first === "A" ? "B" : "A";
  };
  game.onNeed = (need) => {
    cards.tick(game);
    if (need.kind !== "over") return;
    cards.winner(need, {
      rematch: play,
      again: "NEXT MATCH",
      note: `The next match starts in ${Math.round(watchTune.nextMs / 1000)} seconds.`,
      stop: () => {
        clearTimeout(timer);
        timer = null;
      },
      home,
    });
    timer = setTimeout(play, watchTune.nextMs);
  };
  play();
}

// ---------- a shared pitch ----------

// The room server's address: the build's, or, only when testing (127.0.0.1,
// localhost or ?test=1), a ?rooms= override so a test can run its own.
function roomsUrl() {
  const o = params.get("rooms");
  if (testing && o && /^wss?:\/\//.test(o)) return o;
  return config.roomsUrl;
}

boot().catch(fail);
