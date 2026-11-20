// The newsletter sign-up, written once: big near the end of /, small at the
// foot of /web/, /ios/, /playdate/ and /engine/ (NEWSLETTER_PAGES). Not on the
// game pages, /rules/, /privacy/ or /love/.
//
// A plain form that posts to Buttondown (NEWSLETTER_ACTION in src/site/site.mjs)
// and lands on Buttondown's own page in the same tab. No script: it works with
// JavaScript off, and the site keeps and counts nothing about a sign-up. The
// CSP's form-action allows that one origin (src/site/csp.mjs). /privacy/ says
// where the address goes.
import { esc } from "./layout.mjs";
import { NEWSLETTER_ACTION, NEWSLETTER_REFER } from "./site.mjs";

export const NEWSLETTER_PAGES = [
  "/",
  "/web/",
  "/ios/",
  "/playdate/",
  "/engine/",
];

const LEDE = {
  big: "Sign up and we’ll tell you when there is something new to throw. No spam. Just kubb.",
  small: "Sign up and we’ll tell you when there is something new to throw.",
};

export function signup({ size = "small" } = {}) {
  const big = size === "big";
  return `<section class="frame news${big ? " news--big" : ""}" aria-labelledby="news" data-test="newsletter">
  <div class="news__inner">
    <h2 class="display" id="news">News from the pitch</h2>
    <p class="news__lede">${esc(LEDE[big ? "big" : "small"])}</p>
    <form class="news__form" action="${esc(NEWSLETTER_ACTION)}" method="post">
      <label class="label" for="news-email">Your email</label>
      <div class="news__row">
        <input class="news__input" id="news-email" type="email" name="email" autocomplete="email" required spellcheck="false" autocapitalize="off">
        <button class="button" type="submit">Sign me up</button>
      </div>
    </form>
    <p class="news__small">Every email has a link to stop them. <a href="/privacy/#newsletter">Where your address goes</a>.</p>
    <p class="news__small"><a href="${esc(NEWSLETTER_REFER)}" rel="noopener">Powered by Buttondown.</a></p>
  </div>
</section>`;
}
