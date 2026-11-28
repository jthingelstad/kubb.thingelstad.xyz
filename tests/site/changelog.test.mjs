// /changelog/ (src/site/changelog.mjs over src/site/changelog.json): the entries are
// well formed and newest first, the newest web, engine and Playdate entries are what
// the site ships, and nothing public is said that the site rules forbid.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  CHANGELOG,
  CHANGELOG_PAGES,
  PARTS,
  byDay,
  entryId,
  entryMeta,
  entryTitle,
  longDay,
  playingNow,
} from "../../src/site/changelog.mjs";
import { PAGES } from "../../src/site/pages.mjs";
import { playdateBuildVersion } from "../../src/site/landing.mjs";

const read = (p) =>
  JSON.parse(fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8"));
const VERSION = /^\d+\.\d+\.\d+$/;

test("every entry is well formed", () => {
  assert.ok(CHANGELOG.length > 0);
  const keys = new Set([
    "part",
    "version",
    "date",
    "notes",
    "engine",
    "channel",
    "build",
    "throws",
  ]);
  for (const e of CHANGELOG) {
    const at = `${e.part} ${e.version}`;
    for (const k of Object.keys(e)) assert.ok(keys.has(k), `${at}: ${k}`);
    assert.ok(PARTS[e.part], `${at}: part`);
    assert.match(e.date, /^2\d\d\d-\d\d-\d\d$/, at);
    assert.ok(!Number.isNaN(Date.parse(e.date)), at);
    // the notation counts 1, 2; the iPhone's early betas were 0.1 to 0.6
    if (e.part === "notation") assert.match(e.version, /^\d+$/, at);
    else if (e.part === "iphone")
      assert.match(e.version, /^\d+\.\d+(\.\d+)?$/, at);
    else assert.match(e.version, VERSION, at);
    if (e.engine != null) assert.match(e.engine, VERSION, at);
    if (e.part === "iphone")
      assert.ok(["app-store", "beta"].includes(e.channel), `${at}: channel`);
    else assert.equal(e.channel, undefined, at);
    if (e.part === "engine")
      assert.ok(
        ["changed", "same", "first"].includes(e.throws),
        `${at}: throws`,
      );
    else assert.equal(e.throws, undefined, at);
    if (e.build != null) assert.ok(Number.isInteger(e.build), at);
    assert.ok(Array.isArray(e.notes), at);
    assert.ok(
      e.notes.length >= 1 && e.notes.length <= 4,
      `${at}: 1 to 4 notes`,
    );
    for (const n of e.notes) {
      assert.equal(typeof n, "string", at);
      assert.match(n, /^[A-Z0-9"“‘(]/, `${at}: starts a sentence: ${n}`);
      assert.match(n, /[.!?”"]$/, `${at}: ends a sentence: ${n}`);
      assert.ok(n.length <= 240, `${at}: short: ${n}`);
    }
  }
});

test("newest first, one entry a part, version and channel", () => {
  for (let i = 1; i < CHANGELOG.length; i++)
    assert.ok(
      CHANGELOG[i - 1].date >= CHANGELOG[i].date,
      `${entryTitle(CHANGELOG[i])} is newer than the entry above it`,
    );
  const ids = CHANGELOG.map(entryId);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  // within a part, versions only go down the page
  const cmp = (a, b) => {
    const x = a.split(".").map(Number);
    const y = b.split(".").map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++)
      if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  };
  for (const part of Object.keys(PARTS)) {
    const own = CHANGELOG.filter((e) => e.part === part);
    for (let i = 1; i < own.length; i++)
      assert.ok(
        cmp(own[i - 1].version, own[i].version) >= 0,
        `${part}: ${own[i].version} after ${own[i - 1].version}`,
      );
  }
});

test("the newest entries are what the site ships", () => {
  const newest = (part) => CHANGELOG.find((e) => e.part === part);
  const pkg = read("package.json");
  const engine = read("vendor/engine.json");
  // a pull request that raises package.json's version adds the web's entry
  assert.equal(newest("web").version, pkg.version, "web: package.json");
  assert.equal(
    newest("web").engine,
    engine.tag.replace(/^v/, ""),
    "web's engine",
  );
  assert.equal(
    newest("engine").version,
    engine.tag.replace(/^v/, ""),
    "engine: vendor/engine.json's tag",
  );
  assert.equal(
    newest("playdate").version,
    playdateBuildVersion(),
    "playdate: the /playdate/ download",
  );
});

test("public words: no promises, no addresses, no catalog listing", () => {
  const text = JSON.stringify(CHANGELOG);
  assert.ok(!/@/.test(text), "no email address");
  assert.ok(!/—/.test(text), "no em dash");
  assert.ok(!/catalog/i.test(text), "never a Playdate Catalog listing");
  assert.ok(
    !/coming soon|will be|(?<!as )soon\b(?! as)/i.test(text),
    "nothing promised",
  );
  assert.ok(!/\/Users\/|999153317627/.test(text), "no home path or account");
  for (const word of ["seamless", "robust", "enhanced", "under the hood"])
    assert.ok(!text.toLowerCase().includes(word), word);
});

test("the page: playing now, the filter, every entry by day", () => {
  assert.ok(PAGES.some((p) => p.path === "/changelog/"));
  const html = CHANGELOG_PAGES[0].render({});
  assert.match(html, /<h1 class="display">What’s new<\/h1>/);
  for (const e of CHANGELOG)
    assert.ok(html.includes(`id="${entryId(e)}"`), entryId(e));
  for (const d of byDay())
    assert.ok(html.includes(`>${longDay(d.date)}</h2>`), d.date);
  // the filter is hidden until its script shows it; the script is a file, not inline
  assert.match(html, /<div class="chips" data-filter hidden>/);
  assert.match(html, /<script src="\/js\/changelog.js" defer><\/script>/);
  // playing now names the newest of each part, and links to its entry
  const now = playingNow();
  assert.deepEqual(
    now.map((n) => n.part),
    Object.keys(PARTS).filter((p) => CHANGELOG.some((e) => e.part === p)),
  );
  for (const { lines } of now)
    for (const { e } of lines)
      assert.ok(html.includes(`href="#${entryId(e)}"`));
});

test("titles, anchors and the small line", () => {
  assert.equal(longDay("2026-11-27"), "27 November 2026");
  const beta = {
    part: "iphone",
    version: "1.1.0",
    channel: "beta",
    build: 294,
    engine: "1.4.1",
  };
  assert.equal(entryId(beta), "iphone-1.1.0-beta");
  assert.equal(entryTitle(beta), "iPhone 1.1.0 beta");
  assert.equal(entryMeta(beta), "In TestFlight, build 294, engine 1.4.1.");
  const eng = { part: "engine", version: "1.4.1", throws: "same" };
  assert.equal(entryMeta(eng), "Every throw lands as before.");
  assert.equal(
    entryMeta({ part: "web", version: "1.5.3", engine: "1.4.1" }),
    "Engine 1.4.1.",
  );
  // the App Store's version and a newer beta both show; an older beta does not
  const store = {
    part: "iphone",
    version: "1.0.0",
    channel: "app-store",
    date: "2026-11-24",
    notes: ["A."],
  };
  const newer = { ...beta, date: "2026-11-26", notes: ["A."] };
  const older = {
    ...beta,
    version: "0.9.0",
    date: "2026-11-20",
    notes: ["A."],
  };
  assert.equal(
    playingNow([newer, store]).find((n) => n.part === "iphone").lines.length,
    2,
  );
  assert.equal(
    playingNow([store, older]).find((n) => n.part === "iphone").lines.length,
    1,
  );
});
