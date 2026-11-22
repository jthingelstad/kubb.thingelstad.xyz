// The pitch link's welcome (the Throwing Wood 1.0 design, "Pitch link welcome"): a
// device that has never played sees one card before the lobby: who invited them, two
// sentences on kubb, their generated name with SHUFFLE, JOIN THE GAME, and the quiet
// links JUST WATCH and HOW TO THROW. src/net/pitch.js shows it in the lobby's place
// on a pitch someone else made (the host who made the pitch goes straight to the
// lobby) and only while `firstVisit` holds.
//
//   const w = welcomeCard({ names, name, setName, host, join, watch, howto })
//   w.el            the card (Cards.show it)
//   w.setHost(t)    the host's name once the pitch says it (null: not known yet)
import { h, button } from "./dom.js";
import { youRow } from "./settings.js";

// Its words, in one place (the iPhone's welcome says the same). The two sentences
// on kubb are the landing page's own (src/site/landing.mjs, the hero's lede).
export const WELCOME_WORDS = {
  brand: "KUBB: THROWING WOOD",
  invited: (host) => `${host} invited you to a game of kubb`,
  invitedNobody: "You’re invited to a game of kubb",
  kubb: "Throw sticks of wood at blocks of wood. Knock them all over, then topple the king.",
  youWillBe: "You will be",
  join: "JOIN THE GAME",
  watch: "JUST WATCH",
  howto: "HOW TO THROW",
};

// Has this device never played? No throw of its own kept (the `throwsMade` pref the
// throw's nudge counts, src/game/game.js), in practice, a match or a pitch.
export const firstVisit = (store) => !(Number(store.get("throwsMade", 0)) > 0);

export function welcomeCard({
  names,
  name,
  setName = null,
  host = null,
  join,
  watch,
  howto = null,
}) {
  const W = WELCOME_WORDS;
  const title = h("h2.display", { "data-test": "welcome-title" });
  const you = youRow("welcome", {
    names,
    name,
    setName,
    caption: W.youWillBe,
  });
  const el = h(
    "div.card.welcome",
    {
      "data-test": "welcome",
      role: "dialog",
      "aria-labelledby": "welcome-title",
    },
    h("p.brand-chip", W.brand),
    title,
    h("p.welcome-kubb", W.kubb),
    you.el,
    button(W.join, join, "go wide", {
      "data-default": true,
      "data-test": "welcome-join",
    }),
    h(
      "div.card-foot",
      button(W.watch, watch, "quiet", { "data-test": "welcome-watch" }),
      howto
        ? button(W.howto, howto, "quiet", { "data-test": "welcome-howto" })
        : null,
    ),
  );
  title.id = "welcome-title";
  const setHost = (t) => {
    const want = t ? W.invited(t) : W.invitedNobody;
    if (title.textContent !== want) title.textContent = want;
  };
  setHost(host);
  return { el, setHost, setName: (v) => you.setName(v) };
}
