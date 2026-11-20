// MAKE A HIGHLIGHT REEL (beside WATCH REPLAY and EMBED on a finished pitch's winner card
// and on the replay's bar; docs/REEL.md "What a player sees", docs/CLIENT.md "Highlight
// reels"): the button, whose words follow the reel (MAKING YOUR REEL, WATCH THE REEL),
// and the card it opens. The states and the words are src/net/reel.js; this file only
// draws them and does the asking they call for.
//
//   const reel = new Reel({ root, game, code, url, match: { n, hash }, known });
//   reel.button("small", { "data-test": "..." })   // as many as are shown; all follow
//   reel.open()                                     // what the button does
//   reel.destroy()
//
// It takes a pitch code and nothing else of the page, so a match against the computer can
// use it once it is shared and has a code. Like the score sheet and EMBED, the card is
// modal while open. It asks the server only while the card is open and the page is
// shown: every reelTune.pollMs while the reel renders, once more on coming back.
import { h, button, clear } from "./dom.js";
import { EMBED_ORIGIN } from "./embed.js";
import {
  reelFileName,
  reelRequest,
  reelStart,
  reelStep,
  reelTune,
  reelView,
} from "../net/reel.js";

// Can this browser hand a video file to the share sheet?
export function canShareVideo(name = "reel.mp4") {
  try {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.canShare === "function" &&
      typeof File === "function" &&
      navigator.canShare({
        files: [new File([""], name, { type: "video/mp4" })],
      })
    );
  } catch {
    return false;
  }
}

// The window is taller than wide: the tall reel, else the wide one.
const tallWindow = () => window.innerHeight > window.innerWidth;

export class Reel {
  // root: the element cards go in; game: the Game (modal count), or null; code: the
  // pitch; url: the rooms server; match: { n, hash } of the match shown, to be sure the
  // room's kept replay is this match (read afresh before every ask that could start a
  // render); known: the page's own word that the reel is done (reelFromPage);
  // WebSocket: for tests.
  constructor({
    root,
    game = null,
    code,
    url,
    match = null,
    known = null,
    WebSocket = null,
  }) {
    Object.assign(this, { root, game, code, url, match });
    this.ws = WebSocket ? { WebSocket } : {};
    this.state = reelStart(known);
    this.buttons = new Set();
    this.card = null; // { scrim, body, close } while open
    this.busy = false; // a request on its way
    this.timer = null;
    this.drawn = ""; // what the card shows now, so a poll that changes nothing redraws nothing
    this.onVisible = () => {
      if (!document.hidden) this.pump();
    };
    document.addEventListener("visibilitychange", this.onVisible);
  }

  get view() {
    return reelView(this.state);
  }

  // A button that opens the card and says how the reel stands.
  button(kind = "", attrs = {}) {
    const b = button(this.view.label, () => this.open(), kind, {
      "data-reel": this.state.phase,
      ...attrs,
    });
    this.buttons.add(b);
    return b;
  }

  dispatch(event) {
    const next = reelStep(this.state, event);
    if (next === this.state) return;
    this.state = next;
    const label = this.view.label;
    for (const b of this.buttons) {
      if (!b.isConnected) {
        this.buttons.delete(b);
        continue;
      }
      b.textContent = label;
      b.dataset.reel = next.phase;
    }
    this.draw();
  }

  open() {
    this.dispatch({ type: "press" });
    if (!this.card) this.show();
    this.draw();
    this.pump(true);
  }

  // ---------- asking ----------

  // Ask what the state calls for, now (now: true) or after the wait. One request at a
  // time. Asking for the reel goes on until the server has answered that it renders,
  // card or not (a press is a request, even when the card is closed at once); from
  // then on it is polling, only while the card is open and the page shown.
  pump(now = true) {
    clearTimeout(this.timer);
    this.timer = null;
    const what = this.view.ask;
    if (!what || this.busy) return;
    if (this.state.polled && (!this.card || document.hidden)) return;
    if (!now) {
      this.timer = setTimeout(
        () => this.pump(true),
        what === "kept" ? reelTune.keptWaitMs : reelTune.pollMs,
      );
      return;
    }
    this.busy = true;
    // the same question again (a keep still on its way, a render going on) waits;
    // the next one (the reel, once the kept replay is known) goes at once
    const done = () => {
      this.busy = false;
      this.pump(this.view.ask !== what);
    };
    reelRequest(this.state, this.at(), this.match).then((event) => {
      if (event) this.dispatch(event);
      done();
    });
  }

  at() {
    return { url: this.url, code: this.code, ...this.ws };
  }

  // ---------- the card ----------

  show() {
    const body = h("div.card.sheet.reel-card", { "data-test": "reel-card" });
    const scrim = h("div.scrim.sheet-scrim", body);
    scrim.addEventListener("pointerdown", (e) => {
      if (e.target === scrim) this.close();
    });
    const esc = (e) => {
      if (e.key === "Escape") this.close();
    };
    this.root.append(scrim);
    const quieted = [...this.root.children].filter(
      (el) => el !== scrim && !el.inert,
    );
    for (const el of quieted) el.inert = true;
    window.addEventListener("keydown", esc);
    const resize = () => this.fitVideo();
    window.addEventListener("resize", resize);
    if (this.game) this.game.modal++;
    this.card = { scrim, body, esc, resize, quieted };
    this.drawn = "";
  }

  close() {
    const c = this.card;
    if (!c) return;
    this.card = null;
    clearTimeout(this.timer);
    this.timer = null;
    c.scrim.remove();
    for (const el of c.quieted) el.inert = false;
    window.removeEventListener("keydown", c.esc);
    window.removeEventListener("resize", c.resize);
    if (this.game) this.game.modal = Math.max(0, this.game.modal - 1);
    this.video = null;
  }

  destroy() {
    this.close();
    document.removeEventListener("visibilitychange", this.onVisible);
    this.buttons.clear();
  }

  draw() {
    const c = this.card;
    if (!c) return;
    const s = this.state;
    const v = this.view;
    const key = `${s.phase}|${s.why}|${s.offline}|${v.line}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const body = clear(c.body);
    body.dataset.reel = s.phase;
    body.classList.toggle("reel-done", !!v.video);
    body.append(h("p.kicker", `PITCH ${this.code}`), h("h2.display", v.title));
    if (v.line)
      body.append(h("p.reel-line", { "data-test": "reel-line" }, v.line));
    if (v.bar)
      body.append(
        h(
          "div.reel-bar",
          {
            role: "progressbar",
            "aria-label": v.line || v.title,
            "data-test": "reel-bar",
          },
          h("span"),
        ),
      );
    if (v.text)
      body.append(h("p.reel-text", { "data-test": "reel-text" }, v.text));
    this.video = null;
    const status = h("p.sheet-status", {
      role: "status",
      "data-test": "reel-status",
    });
    const actions = [];
    if (v.video) {
      body.append(this.videoEl(v.video));
      actions.push(...this.doneActions(v.video, status));
    }
    if (v.retry)
      actions.push(
        button("TRY AGAIN", () => this.open(), "go", {
          "data-default": true,
          "data-test": "reel-retry",
        }),
      );
    actions.push(
      button("BACK", () => this.close(), actions.length ? "" : "go", {
        "data-default": !actions.length,
        "data-test": "reel-back",
      }),
    );
    body.append(status, h("div.row", actions));
    requestAnimationFrame(() =>
      body.querySelector("[data-default]")?.focus({ preventScroll: true }),
    );
  }

  // The reel playing: muted, looping, inline; tall when the window is taller than wide.
  videoEl(files) {
    const video = h("video.reel-video", {
      muted: true,
      loop: true,
      autoplay: true,
      playsinline: true,
      preload: "auto",
      "aria-label": "The highlight reel",
      "data-test": "reel-video",
    });
    video.muted = true;
    video.defaultMuted = true;
    this.video = { el: video, files, format: null };
    this.fitVideo();
    return video;
  }

  fitVideo() {
    const v = this.video;
    if (!v) return;
    const format = tallWindow() ? "tall" : "wide";
    if (format === v.format) return;
    v.format = format;
    v.el.dataset.format = format;
    v.el.src = v.files[format];
    v.el.play?.()?.catch?.(() => {});
  }

  doneActions(files, status) {
    const say = (text) => (status.textContent = text);
    const link = `${EMBED_ORIGIN}/p/${this.code}`;
    const download = (format) =>
      h(
        `a.btn${format === "tall" ? ".go" : ""}`,
        {
          href: files[format],
          download: reelFileName(this.code, format),
          "data-test": `reel-download-${format}`,
          ...(format === "tall" ? { "data-default": true } : {}),
        },
        `DOWNLOAD ${format.toUpperCase()}`,
      );
    const out = [download("tall"), download("wide")];
    const name = reelFileName(this.code, "tall");
    if (canShareVideo(name)) {
      // the tall file, fetched once the card opens so SHARE can hand it over at once
      let file = null;
      const ready = fetch(files.tall)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.status))))
        .then((blob) => (file = new File([blob], name, { type: "video/mp4" })))
        .catch(() => null);
      out.push(
        button(
          "SHARE",
          async () => {
            const f = file ?? (await ready);
            if (!f)
              return say("Could not get the video. DOWNLOAD TALL saves it.");
            try {
              await navigator.share({ files: [f] });
            } catch (error) {
              if (error?.name !== "AbortError")
                say("Could not share. DOWNLOAD TALL saves it.");
            }
          },
          "",
          { "data-test": "reel-share" },
        ),
      );
    }
    out.push(
      button(
        "COPY LINK",
        async () => {
          try {
            await navigator.clipboard.writeText(link);
            say("Copied the link.");
          } catch {
            say(`Could not copy. The link is ${link}`);
          }
        },
        "",
        { "data-test": "reel-copy" },
      ),
    );
    return out;
  }
}
