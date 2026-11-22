// Every generated name fits wherever the web draws one (the engine's docs/NAMES.md
// section 8: "Each client measures its widest name in its own font"). In a real browser
// with the game's own fonts loaded, every name the engine can make (names.all, players
// and teams) is measured in the type of: the name row's text (NAME_FIT.text), each
// word in its Settings stepper (NAME_FIT.word), the lobby's team title, and the
// header, whose name breaks between words, so its widest word must fit the narrowest
// header's name (a phone held upright, beside the two numbers and MENU). The longest
// name in characters is not the widest, so all are measured.
// Skipped with a notice when Playwright's Chromium is not installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
import { serve, open } from "./browser.mjs";
import { NAME_FIT } from "../../src/ui/name-row.js";

let available = false;
try {
  available = fs.existsSync(chromium.executablePath());
} catch {
  available = false;
}
if (!available)
  console.log(
    "# tests/game/names-fit-client.test.mjs SKIPPED: no Playwright Chromium (npx playwright install chromium)",
  );
const browserTest = available ? test : test.skip;

let env;
before(async () => {
  if (!available) return;
  env = await serve({ build: true });
});
after(async () => {
  if (env) await env.close();
});

browserTest(
  "the widest name and word, measured in the game's fonts, fit the name row, the lobby and the rail",
  async () => {
    const page = await open(env, "/settings/", "portrait", { prefs: {} });
    try {
      await page.waitForSelector("[data-test=settings-name-text]");
      const m = await page.evaluate(async () => {
        await document.fonts.ready;
        const { names } = window.__kubb;
        const all = {
          player: names.all("player"),
          team: names.all("team"),
        };
        const ui = document.getElementById("ui");
        // an element of a class, in the page, for its computed type
        const probe = (html) => {
          const box = document.createElement("div");
          box.style.position = "absolute";
          box.style.visibility = "hidden";
          box.innerHTML = html;
          ui.append(box);
          return box;
        };
        const fontOf = (el) => {
          const c = getComputedStyle(el);
          return `${c.fontWeight} ${c.fontSize} ${c.fontFamily}`;
        };
        const ctx = document.createElement("canvas").getContext("2d");
        const widest = (font, list, upper = false) => {
          ctx.font = font;
          let best = { w: 0, s: "" };
          for (const s of list) {
            const t = upper ? s.toUpperCase() : s;
            const w = ctx.measureText(t).width;
            if (w > best.w) best = { w, s: t };
          }
          return best;
        };
        const text = document.querySelector("[data-test=settings-name-text]");
        const pick = document.querySelector("[data-test=settings-name-word-0]");
        const words = new Set();
        for (const s of [...all.player, ...all.team])
          for (const w of s.split(" ")) words.add(w);
        const rail = probe(
          '<div class="hud hud-rail"><div class="rail-what">TURN 12 · BATON 6 OF 6</div><div class="rail-name">X</div><div class="rail-score"><span class="rail-n team-a">10</span><span class="rail-n team-b">10</span></div><div class="rail-menu"><button class="btn small menu-btn">MENU</button></div></div>',
        );
        const railEl = rail.firstChild;
        const railName = rail.querySelector(".rail-name");
        const rc = getComputedStyle(railEl);
        // the header's room for its name on this screen: its max width less padding,
        // border, the two numbers, MENU and the gaps between them
        const railRoom =
          parseFloat(rc.maxWidth) -
          parseFloat(rc.paddingLeft) -
          parseFloat(rc.paddingRight) -
          parseFloat(rc.borderLeftWidth) -
          parseFloat(rc.borderRightWidth) -
          rail.querySelector(".rail-score").getBoundingClientRect().width -
          rail.querySelector(".rail-menu").getBoundingClientRect().width -
          2 * parseFloat(rc.columnGap);
        const title = probe('<p class="team-title">X</p>').firstChild;
        const pc = getComputedStyle(pick);
        return {
          counts: { player: all.player.length, team: all.team.length },
          textFont: fontOf(text),
          name: widest(fontOf(text), [...all.player, ...all.team]),
          word: widest(fontOf(pick), [...words]),
          pickPad:
            parseFloat(pc.paddingLeft) +
            parseFloat(pc.paddingRight) +
            parseFloat(pc.borderLeftWidth) +
            parseFloat(pc.borderRightWidth),
          pickMin: parseFloat(pc.minWidth),
          team: widest(fontOf(title), all.team),
          railWord: widest(fontOf(railName), [...words]),
          railRoom,
          textMin: parseFloat(getComputedStyle(text).minWidth),
          rowWidth: document
            .querySelector("[data-test=settings-name]")
            .getBoundingClientRect().width,
          fontsLoaded: [...document.fonts].filter((f) => f.status === "loaded")
            .length,
        };
      });
      console.log(
        `# widest name ${JSON.stringify(m.name)}; widest word ${JSON.stringify(m.word)}; widest rail word ${JSON.stringify(m.railWord)} in ${m.railRoom} px; ${m.counts.player} player and ${m.counts.team} team names`,
      );
      assert.ok(m.counts.player > 4000 && m.counts.team > 6000);
      assert.ok(m.fontsLoaded > 0, "the game's fonts are loaded");
      // the name row's text: the widest name within NAME_FIT.text, which the row keeps
      // as its least width, and the row has that room on a phone
      assert.ok(m.name.w <= NAME_FIT.text, JSON.stringify(m.name));
      assert.equal(m.textMin, NAME_FIT.text);
      assert.ok(m.rowWidth >= NAME_FIT.text, `row ${m.rowWidth}`);
      // a stepper's word box shows its widest word with its padding
      assert.ok(m.word.w + m.pickPad <= NAME_FIT.word, JSON.stringify(m.word));
      assert.ok(m.pickMin >= m.word.w + m.pickPad, `stepper ${m.pickMin}`);
      // the lobby's team title fits a team's column on a phone
      assert.ok(m.team.w <= m.rowWidth, JSON.stringify(m.team));
      // the header breaks the name between words: each word fits the narrowest one
      assert.ok(m.railWord.w <= m.railRoom, JSON.stringify(m.railWord));
      assert.deepEqual(page.errors, []);
    } finally {
      await page.context().close();
    }
  },
);
