// /changelog/, "What's new" (the owner, 2026-11-27: "I'd actually like a changelog
// for all aspects of the project."): every version people got of the web game, the
// iPhone and iPad app, the Playdate game, the Kubb Engine and Planet Kubb Notation,
// newest first, a day at a time. The words are in src/site/changelog.json, one entry a
// release:
//
//   { part, version, date, notes, engine?, channel?, build?, throws? }
//
//   part     one of PARTS' keys
//   date     YYYY-MM-DD, the day it reached people, US Central
//   notes    one to four sentences, the biggest first, in player words
//   engine   the newest Kubb Engine it ran (web, iPhone, Playdate)
//   channel  the iPhone's "app-store" or "beta" (outside testers on TestFlight)
//   build    the iPhone's or the Playdate's build number
//   throws   the engine's "changed" (it moved a golden hash), "same" (every throw
//            lands as before, opt-in features included) or "first" (0.2.0)
//
// Only what shipped: an iPhone version is here once outside testers or the App Store
// have it, a Playdate one once it is tagged, and nothing waiting on a review
// (Pitchside 1.0.0 is in App Review: it goes in on the day the store has it). A pull
// request that raises package.json's version adds the web's entry; tests/site/
// changelog.test.mjs holds the newest web, engine and Playdate entries to what the
// site ships. AGENTS.md "What's new".
import fs from "node:fs";
import { esc, page } from "./layout.mjs";
import { SITE_TITLE } from "./site.mjs";

export const CHANGELOG = JSON.parse(
  fs.readFileSync(new URL("./changelog.json", import.meta.url), "utf8"),
);

// The parts, in the order the filter and "Playing now" show them. `href` is where
// a reader gets that part.
export const PARTS = {
  web: { name: "Web", href: "/#play" },
  iphone: { name: "iPhone and iPad", short: "iPhone", href: "/ios/" },
  playdate: { name: "Playdate", href: "/playdate/" },
  engine: { name: "Kubb Engine", short: "Engine", href: "/engine/" },
  notation: {
    name: "Planet Kubb Notation",
    short: "Notation",
    href: "/engine/#notation",
  },
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
// "27 November 2026", as the privacy page writes its date.
export function longDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// An entry's anchor: web-1.5.3, iphone-1.1.0-beta, engine-1.4.1.
export function entryId(e) {
  return [e.part, e.version, e.channel === "beta" ? "beta" : null]
    .filter(Boolean)
    .join("-");
}

// "Web 1.5.3", "iPhone 1.1.0 beta", "Engine 1.4.1", "Notation 2".
export function entryTitle(e) {
  const p = PARTS[e.part];
  return `${p.short ?? p.name} ${e.version}${e.channel === "beta" ? " beta" : ""}`;
}

// The small line under the title: where it went and what it runs on.
export function entryMeta(e) {
  const bits = [];
  if (e.part === "iphone")
    bits.push(e.channel === "beta" ? "In TestFlight" : "On the App Store");
  if (e.build != null) bits.push(`build ${e.build}`);
  if (e.engine) bits.push(`engine ${e.engine}`);
  if (e.part === "engine")
    bits.push(
      {
        same: "Every throw lands as before",
        changed: "New throws: a match keeps the engine it started on",
        first: "The first one",
      }[e.throws],
    );
  if (!bits.length) return "";
  const line = bits.join(", ");
  return line[0].toUpperCase() + line.slice(1) + ".";
}

// The newest of each part people have, for "Playing now": the web, the App Store's
// iPhone version and a newer beta beside it, the Playdate download, the engine and
// the notation.
export function playingNow(entries = CHANGELOG) {
  const first = (f) => entries.find(f);
  const now = [];
  for (const part of Object.keys(PARTS)) {
    if (part === "iphone") {
      const store = first((e) => e.part === part && e.channel === "app-store");
      const beta = first((e) => e.part === part && e.channel === "beta");
      const lines = [];
      if (store)
        lines.push({ e: store, text: `${store.version} on the App Store` });
      if (beta && (!store || beta.date >= store.date))
        lines.push({ e: beta, text: `${beta.version} in TestFlight` });
      if (lines.length) now.push({ part, lines });
      continue;
    }
    const e = first((x) => x.part === part);
    if (!e) continue;
    const text = e.engine ? `${e.version} (${e.engine})` : e.version;
    now.push({ part, lines: [{ e, text }] });
  }
  return now;
}

// Entries grouped by day, newest day first, in the order the file gives them.
export function byDay(entries = CHANGELOG) {
  const days = [];
  for (const e of entries) {
    const last = days[days.length - 1];
    if (last && last.date === e.date) last.entries.push(e);
    else days.push({ date: e.date, entries: [e] });
  }
  return days;
}

function entry(e) {
  const meta = entryMeta(e);
  return `<article class="change" id="${esc(entryId(e))}" data-part="${esc(e.part)}">
      <h3 class="change__title"><span class="change__part change__part--${esc(e.part)}">${esc(PARTS[e.part].short ?? PARTS[e.part].name)}</span> ${esc(e.version)}${e.channel === "beta" ? ' <span class="change__beta">beta</span>' : ""}</h3>
      ${meta ? `<p class="change__meta">${esc(meta)}</p>` : ""}
      <ul>${e.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
    </article>`;
}

function changelog({ tinylytics, config = {} }) {
  const now = playingNow()
    .map(
      ({ part, lines }) => `<li class="now__part">
      <a href="${PARTS[part].href}"><span class="label">${esc(PARTS[part].name)}</span></a>
      ${lines.map(({ e, text }) => `<a class="now__version" href="#${esc(entryId(e))}">${esc(text)}</a>`).join("")}
    </li>`,
    )
    .join("\n    ");
  const filter = Object.entries(PARTS)
    .map(
      ([key, p]) =>
        `<button type="button" class="chip" data-part="${key}" aria-pressed="false">${esc(p.short ?? p.name)}</button>`,
    )
    .join("");
  const days = byDay()
    .map(
      (
        d,
      ) => `<section class="frame change-day" data-day="${d.date}" aria-labelledby="d-${d.date}">
    <h2 class="display" id="d-${d.date}">${longDay(d.date)}</h2>
    ${d.entries.map(entry).join("\n    ")}
  </section>`,
    )
    .join("\n");
  const body = `<section class="frame intro">
  <h1 class="display">What’s new</h1>
  <p class="lede">Every version of Kubb: Throwing Wood, newest first. The web game, the iPhone and iPad app and the Playdate game all throw wood with the same Kubb Engine, so a new engine shows up here too.</p>
</section>
<section class="frame" aria-labelledby="now">
  <h2 class="display" id="now">Playing now</h2>
  <ul class="now">
    ${now}
  </ul>
  <div class="chips" data-filter hidden><span class="label">Show</span><button type="button" class="chip" data-part="" aria-pressed="true">Everything</button>${filter}</div>
</section>
${days}`;
  return page({
    path: "/changelog/",
    title: `What’s new · ${SITE_TITLE}`,
    description:
      "Every version of Kubb: Throwing Wood, newest first: the web game, the iPhone and iPad app, the Playdate game and the Kubb Engine they share.",
    body,
    tinylytics,
    release: config.release?.text,
    scripts: ["/js/changelog.js"],
  });
}

export const CHANGELOG_PAGES = [
  {
    path: "/changelog/",
    file: "changelog/index.html",
    render: changelog,
    sources: ["src/site"],
  },
];
