// The game client's entry (docs/CLIENT.md). The game pages (/practice/ and
// /p/<code>) load it as a module: it shows the title while wasmoon and the
// Lua load, then routes:
//
//   /practice/         the open practice pitch
//   /settings/         the device's settings, from the web game's page
//   /p/<code>?solo=1   a match against the computer on this pitch
//   /p/<code>?watch=1  the computer against itself, match after match
//   /p/<code>?observe=1  a shared pitch watched without a seat (docs/OBSERVER.md)
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
import { openSettingsPage } from "./ui/settings.js";
import { showHowto, shouldShowHowto } from "./ui/howto.js";
import { h, button } from "./ui/dom.js";
import { startPitch, tune as pitchTune } from "./net/pitch.js";
import { WatchView } from "./ui/watch-view.js";
import { openReport } from "./ui/report.js";
import { Share } from "./ui/share.js";
import { shareable } from "./net/share.js";
import { openSheet } from "./ui/sheet.js";
import { recordMatch } from "./net/record.js";
import { clientLabel, LOCATION } from "./net/sync.js";
import {
  MATCH_OPTIONS,
  OPTION_DEFAULTS,
  useOlderEngine,
  useRoomEngine,
} from "./net/lobby.js";
import { watchFreshness } from "./net/freshness.js";
import { showUpdate } from "./ui/update.js";
import { startEmbed, embedCode } from "./embed/embed.js";
import { sceneFromQuery, sceneId, takesScene } from "./render/scenes.js";

const config = readConfig();
const ui = document.getElementById("ui");
const canvas = document.getElementById("pitch");
const params = new URLSearchParams(location.search);
const watching = params.get("watch") === "1";
// /p/<code>?observe=1: watch a shared pitch without taking a seat (docs/OBSERVER.md)
const observing = params.get("observe") === "1";
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
    apiUrl: apiUrl(),
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

// /settings/: the device's settings (src/ui/settings.js) from the web game's page,
// the same rows as MENU's. No engine, no game: nothing to load but this card.
function bootSettings() {
  loading.remove();
  openSettingsPage(ui, { home });
  if (testing) window.__kubb = { config };
  document.body.dataset.ready = "1";
}

async function boot() {
  if (config.mode === "embed") return bootEmbed();
  if (config.mode === "settings") return bootSettings();
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
  // ?scene=night (neon, day) on practice, solo and watch, over the saved Scene;
  // never on a shared pitch, whose scene is the host's (src/render/scenes.js)
  const asked = mode !== "pitch" ? sceneFromQuery(location.search) : null;
  let pitch = null;
  // Feedback goes to the api: none in this build, no SEND FEEDBACK.
  const report = apiUrl()
    ? () =>
        openReport(ui, {
          game,
          mode,
          config,
          pitch,
          url: apiUrl(),
        })
    : null;
  // a shared pitch's finished match is read from its own engine (docs/ENGINES.md)
  const sheet = () =>
    pitch?.openSheet ? pitch.openSheet() : openSheet(ui, { game });
  // A solo or watch match, when it ends, goes to the api to be kept
  // (src/net/record.js); a shared pitch's server records it.
  const record = () =>
    apiUrl()
      ? recordMatch({ game, mode, config, url: apiUrl() })
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
    // the practice pitch's Scene (the solo card has its own row)
    scene:
      mode === "practice"
        ? (s) => {
            prefs.set("practiceScene", s);
            game.practiceScene(s);
          }
        : null,
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
      // a shared pitch's timings (the host's absence, an observer's step back)
      pitchTune,
      report,
      sheet,
      freshness,
      recorded: [],
    };
  }
  loading.remove();

  if (mode === "practice") {
    startPractice(game, cards, asked);
  } else if (mode === "solo" || mode === "watch") {
    const env = {
      sheet,
      // the test hook keeps each send's outcome
      record: () => {
        const sent = record();
        if (testing) window.__kubb.recorded.push(sent);
      },
    };
    if (mode === "solo") startSolo(game, cards, { ...env, menu, asked });
    else startWatch(game, cards, { ...env, menu, asked });
  } else {
    pitch = startPitch({
      game,
      cards,
      ui,
      code,
      home,
      pitchUrl: pitchUrl(),
      apiUrl: apiUrl(),
      sheet: () => openSheet(ui, { game }),
      menu,
      engines,
      observe: observing,
    });
    if (testing) window.__kubb.pitch = pitch;
  }
  game.start();
  document.body.dataset.ready = "1";
  if (shouldShowHowto() && !params.has("nohowto") && !watching && !observing)
    howto();
}

// ---------- practice ----------

// The scene the engine takes on this page's newest engine (0.9 on), as an option for
// newPractice and newMatch: none on an older one, which draws the day.
const sceneOpt = (id) =>
  takesScene({ OPTION_DEFAULTS }) ? { scene: sceneId(id) } : {};

function startPractice(game, cards, asked) {
  game.newPractice({
    surface: prefs.get("practiceSurface", "grass"),
    ...sceneOpt(asked ?? prefs.get("practiceScene", "day")),
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

function startSolo(game, cards, { sheet, record, menu, asked }) {
  game.seat = { sides: ["A"], cpu: true };
  game.localSide = "A";
  // MAKE A HIGHLIGHT REEL on the winner card: the match is shared (with the name typed
  // on the share card) only when that card's SHARE is pressed (src/ui/share.js). Not
  // while watching the computer against itself (docs/REEL.md), nor in practice.
  let share = null;
  const options = () =>
    cards.options((o) => play(o), {
      home,
      menu: () => menu.open(),
      // and your name, this device's too: asked here only while none is kept
      name: game.playerName,
      setName: (t) => game.setPlayerName(t),
      onName: (f) => game.onPlayerName(f),
      // the Scene row: ?scene= over the saved one; the pitch behind shows the pick
      scene: asked,
      onScene: (id) => game.showScene(id),
    });
  const play = (o) => {
    share?.destroy();
    share = null;
    game.showScene(null); // the match's own view carries it now
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
      ...sceneOpt(o.scene),
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
        apiUrl() && shareable({ trail: game.trail, need })
          ? new Share({ root: ui, game, url: apiUrl() })
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
function startWatch(game, cards, { sheet, record, menu, asked }) {
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
      // the solo card's Scene, or the address's
      ...sceneOpt(asked ?? o.scene),
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

// The view while watching: the wide view (the default) or the thrower's, and the
// free camera in the wide view (src/ui/watch-view.js, docs/OBSERVER.md).
function watchView(game, menu) {
  new WatchView({ game, ui, menu }).on();
}

// ---------- a shared pitch ----------

// The pitch server's address and the api's: the build's, or, only when testing
// (127.0.0.1, localhost or ?test=1), ?pitchserver= and ?api= overrides so a test (or
// `npm run dev`) can run its own (tools/pitch-dev.mjs).
function pitchUrl() {
  const o = params.get("pitchserver");
  if (testing && o && /^wss?:\/\//.test(o)) return o;
  return config.pitchUrl;
}

function apiUrl() {
  const o = params.get("api");
  if (testing && o && /^https?:\/\//.test(o)) return o;
  return config.apiUrl;
}

boot().catch(fail);
