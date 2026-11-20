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
//   /e/<code>          the embed: the pitch's replay, read only, in another
//                      site's frame (src/embed/embed.js)
import { swipeEnabled } from "../public/js/throw-mode.js";
import { readConfig, pitchCode } from "./site/config.js";
import { Engine } from "./engine/index.js";
import { makeRegistry } from "./engine/registry.js";
import { Game } from "./game/game.js";
import { Sound } from "./game/sound.js";
import { prefs } from "./game/prefs.js";
import { Cards, soloSaved } from "./ui/cards.js";
import { Menu } from "./ui/menu.js";
import { showHowto, shouldShowHowto } from "./ui/howto.js";
import { h, button } from "./ui/dom.js";
import { startPitch } from "./net/pitch.js";
import { openReport } from "./ui/report.js";
import { Share } from "./ui/share.js";
import { shareable } from "./net/share.js";
import { openSheet } from "./ui/sheet.js";
import { recordMatch } from "./net/record.js";
import { clientLabel, LOCATION } from "./net/sync.js";
import { MATCH_OPTIONS, useOlderEngine, useRoomEngine } from "./net/lobby.js";
import { watchFreshness } from "./net/freshness.js";
import { showUpdate } from "./ui/update.js";
import { startEmbed, embedCode } from "./embed/embed.js";
import { sceneFromQuery } from "./render/scenes.js";

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
      h("a.btn", { href: "/web/" }, "HOME"),
    ),
  );
  ui.append(h("div.scrim", box));
}

const home = () => {
  location.href = "/web/";
};

// Every engine the site carries, each made the first time it is asked for
// (docs/ENGINES.md). The page plays on the newest.
const engines = makeRegistry({
  engines: config.engines,
  newest: config.engine,
  create: ({ luaUrl }) =>
    Engine.create({
      sources: luaUrl,
      wasmUrl: config.wasmUrl,
      client: clientLabel(config.version),
      location: LOCATION,
    }),
});
// the room's logic (a shared pitch's document, seats, staying in step) is the
// engine's too: src/net/lobby.js, seats.js and sync.js call it, on the newest
// unless a call names another
engines.onLoad((engine, mm) =>
  mm === engines.newest ? useRoomEngine(engine) : useOlderEngine(engine),
);

async function makeEngine() {
  if (!engines.newest) throw new Error("this build has no Lua sources");
  const [engine] = await Promise.all([
    engines.loadEngine(engines.newest),
    document.fonts?.load('900 40px "Londrina Solid"').catch(() => null),
  ]);
  return engine;
}

// The embed: no menu, no sound, no how-to, nothing sent; the engine only when
// there is a replay to play.
async function bootEmbed() {
  const made = await startEmbed({
    ui,
    code: embedCode(),
    roomsUrl: roomsUrl(),
    engines,
    makeGame: async () => {
      const engine = await makeEngine();
      const cards = new Cards(ui);
      const game = new Game({ engine, canvas, ui, sound: null, cards });
      game.onError = fail;
      game.start();
      return game;
    },
  });
  loading.remove();
  if (testing) window.__kubb = { config, engines, embed: made };
  document.body.dataset.ready = "1";
}

async function boot() {
  if (config.mode === "embed") return bootEmbed();
  const engine = await makeEngine();
  const sound = new Sound(config.sounds || "/sounds/");
  const cards = new Cards(ui);
  const game = new Game({ engine, canvas, ui, sound, cards, swipeEnabled });
  game.onError = fail;
  const howto = (onDone) => showHowto(ui, game, onDone);
  const code = pitchCode();
  const mode =
    config.mode === "practice" || !code
      ? "practice"
      : params.get("solo") === "1"
        ? "solo"
        : watching
          ? "watch"
          : "pitch";
  // The night scene, a prototype (src/render/scenes.js): by the address only,
  // and only where nobody else shares the pitch. In no menu; never saved, sent
  // or recorded.
  if (mode !== "pitch") {
    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    const look = sceneFromQuery(location.search, { reduced });
    if (look) game.useLook(look);
  }
  let pitch = null;
  // Feedback goes to the room server: none in this build, no SEND FEEDBACK.
  const report = roomsUrl()
    ? () =>
        openReport(ui, {
          game,
          mode,
          config,
          pitch,
          url: roomsUrl(),
        })
    : null;
  // a shared pitch's finished match is read from its own engine (docs/ENGINES.md)
  const sheet = () =>
    pitch?.openSheet ? pitch.openSheet() : openSheet(ui, { game });
  // A solo or watch match, when it ends, goes to the room server to be kept
  // (src/net/record.js); a shared pitch's room records itself.
  const record = () =>
    roomsUrl()
      ? recordMatch({ game, mode, config, url: roomsUrl() })
      : Promise.resolve(false);
  const menu = new Menu(ui, {
    game,
    sound,
    howto: () => howto(),
    home,
    resign: () => game.resign(game.localSide || "A"),
    surface: (s) => {
      prefs.set("practiceSurface", s);
      game.practiceDo(() => game.engine.setSurface(s), {
        type: "surface",
        surface: s,
      });
    },
    sheet,
    report,
    // watching: WIDE VIEW or THROWER'S VIEW (startWatch sets it)
    view: null,
    // the release label at the foot of the menu, "0.2.0 (0.8.1)", and its detail
    // ("Also plays 0.7.4") when the page carries an older engine
    release: config.release?.text
      ? { text: config.release.text, detail: config.release.detail ?? null }
      : null,
  });

  // A new deploy while this tab is open: say so, never reload on our own. On a
  // shared pitch the button waits for the match to end (src/ui/update.js).
  const canReload = () =>
    mode !== "pitch" ||
    !(game.mode === "match" && game.need && game.need.kind !== "over");
  const freshness = watchFreshness({
    release: config.release,
    onStale: () => showUpdate(ui, { canReload }),
  });

  if (testing) {
    window.__kubb = {
      engine,
      engines,
      game,
      sound,
      cards,
      menu,
      config,
      pitch: null,
      watchTune,
      report,
      sheet,
      freshness,
      recorded: [],
    };
  }
  loading.remove();

  if (mode === "practice") {
    startPractice(game, cards);
  } else if (mode === "solo" || mode === "watch") {
    const env = {
      sheet,
      // the test hook keeps each send's outcome
      record: () => {
        const sent = record();
        if (testing) window.__kubb.recorded.push(sent);
      },
    };
    if (mode === "solo") startSolo(game, cards, { ...env, menu });
    else startWatch(game, cards, { ...env, menu });
  } else {
    pitch = startPitch({
      game,
      cards,
      ui,
      code,
      home,
      roomsUrl: roomsUrl(),
      sheet: () => openSheet(ui, { game }),
      menu,
      engines,
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
  // What practice throws: BATONS or KUBBS, both shown, the one in use
  // pressed. It was one DRILL button labelled with the mode it switched to
  // (BATONS while drilling), a Playdate menu toggle; the rail says the same
  // word as the pressed button.
  const pick = (kubbs) => {
    if (!!game.need?.drill !== kubbs)
      game.practiceDo(() => game.engine.setDrill(kubbs), {
        type: "drill",
        on: kubbs,
      });
    mark();
  };
  const batons = button("BATONS", () => pick(false), "small", {
    "aria-pressed": "true",
    "data-test": "batons",
  });
  const kubbs = button("KUBBS", () => pick(true), "small", {
    "aria-pressed": "false",
    "aria-label": "Kubbs (drilling)",
    "data-test": "drill",
  });
  const mark = () => {
    const on = !!game.need?.drill;
    batons.setAttribute("aria-pressed", String(!on));
    kubbs.setAttribute("aria-pressed", String(on));
  };
  const tray = h(
    "div.tray",
    { "data-test": "tray" },
    h("div.tray-pair", { role: "group", "aria-label": "Throw" }, batons, kubbs),
    button(
      "RESET",
      () => {
        game.practiceDo(() => game.engine.reset(), { type: "reset" });
        mark();
      },
      "small",
      { "data-test": "reset" },
    ),
  );
  document.getElementById("ui").append(tray);
  game.setHeader("practice");
  cards.root.dataset.mode = "practice";
}

// ---------- a match against the computer ----------

// The computer's level is a match option since engine 0.9 (`computer`, recorded in
// the match's setup); the computer's player entry names it too, which is how an
// older engine is told.
const takesComputer = () => MATCH_OPTIONS.some(([k]) => k === "computer");

function startSolo(game, cards, { sheet, record, menu }) {
  game.seat = { sides: ["A"], cpu: true };
  game.localSide = "A";
  // MAKE A HIGHLIGHT REEL on the winner card: the match is shared (with the name typed
  // on the share card) only when that card's SHARE is pressed (src/ui/share.js). Not
  // while watching the computer against itself (docs/REEL.md), nor in practice.
  let share = null;
  const options = () =>
    cards.options((o) => play(o), {
      home,
      // the level you throw at is this device's (MENU), not the card's
      level: game.level,
      onLevel: (f) => game.onLevel(f),
      menu: () => menu.open(),
    });
  const play = (o) => {
    share?.destroy();
    share = null;
    const now = new Date();
    game.newMatch({
      seed: Math.floor(Math.random() * 2 ** 31),
      teams: {
        A: { name: o.name, players: [{ name: o.name, level: game.level }] },
        B: {
          name: "Computer",
          players: [{ name: "Computer", level: o.computer }],
        },
      },
      cpu: "B",
      ...(takesComputer() ? { computer: o.computer } : {}),
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
      record();
      share?.destroy();
      share =
        roomsUrl() && shareable({ trail: game.trail, need })
          ? new Share({ root: ui, game, url: roomsUrl() })
          : null;
      if (testing && window.__kubb) window.__kubb.share = share;
      cards.winner(need, {
        rematch: () => options(),
        sheet,
        home,
        reel: share,
      });
    }
  };
  // a pitch behind the options card
  game.newPractice({ surface: prefs.get("solo", {}).surface || "grass" });
  options();
}

// ---------- the computer against itself ----------

export const watchTune = {
  nextMs: 20000, // the winner card stays up this long before the next match
  // The pace (Jamie, 2026-11-16: "slow it down. Think more like Zen
  // screensaver ... more natural player like pauses"): seconds, each a range
  // drawn from evenly. Shown only; a hidden tab plays at the match's pace.
  zen: {
    before: [1.5, 4], // the thrower stands before every throw
    turn: [4, 7], // more when the other team steps up
    change: [2, 4], // more between the kubbs and the batons
    holdAfter: 2.4, // the pitch rests after a throw (a match: 0.8)
  },
  maxTurns: 60, // a safety net: matches end in 5 to 30 turns
};

// Nobody touches it. The computer throws for both teams and raises and places
// its own punishment kubbs (the session shows no cards for a computer's
// side). When a match ends the winner card stays up for watchTune.nextMs and
// the next match starts by itself, the other team throwing first; STOP on
// the card holds it there. The options are the solo card's, as last saved.
// The Game runs unattended: a timer steps it while the tab is hidden. Each
// match is sent to be recorded once, when it ends, hidden tab or not.
function startWatch(game, cards, { sheet, record, menu }) {
  game.seat = { sides: [], cpu: true };
  game.localSide = null;
  game.unattended = true;
  game.zen = watchTune.zen;
  watchView(game, menu);
  let first = "A";
  let timer = null;
  const play = () => {
    clearTimeout(timer);
    timer = null;
    cards.close();
    const o = soloSaved();
    const now = new Date();
    const team = (name) => ({ name, players: [{ name, level: o.computer }] });
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
    record();
    cards.winner(need, {
      rematch: play,
      again: "NEXT MATCH",
      sheet,
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

// The view while watching (Jamie, 2026-11-16: "It'd be fun to actually do
// more with the camera on the web version because we could zoom out. We have
// a lot more screen. We could see a lot more."): the wide view, the whole
// pitch from the sideline (the default), or the thrower's view, the cameras
// a match is played with. A button by the menu, MENU's View, and the V key;
// remembered as the "watchView" pref. The button names the view it switches
// to, as DRILL / BATONS does on the practice pitch. A window too small for
// the wide view (a phone held upright) shows the thrower's view whatever is
// chosen, and the button is hidden there (MENU's View still says what is
// chosen, for when the window grows).
export const VIEWS = { wide: "WIDE VIEW", thrower: "THROWER'S VIEW" };

function watchView(game, menu) {
  const chosen = () =>
    prefs.get("watchView", "wide") === "thrower" ? "thrower" : "wide";
  const choose = (v) => {
    prefs.set("watchView", v);
    game.setWide(v === "wide");
  };
  const toggle = () => choose(chosen() === "wide" ? "thrower" : "wide");
  const btn = button(VIEWS.thrower, toggle, "small", {
    "data-test": "view",
    title: "Switch the view (V)",
  });
  const tray = h("div.tray.view-tray", btn);
  ui.append(tray);
  game.setHeader("watch");
  game.onWide = () => {
    const label = game.wide ? VIEWS.thrower : VIEWS.wide;
    if (btn.textContent !== label) btn.textContent = label;
    tray.hidden = chosen() === "wide" && !game.wide;
  };
  menu.hooks.view = { get: chosen, set: choose };
  window.addEventListener("keydown", (e) => {
    if (e.code !== "KeyV" || e.repeat || game.modal) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    toggle();
  });
  game.setWide(chosen() === "wide");
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
