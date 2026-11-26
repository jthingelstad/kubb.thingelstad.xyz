// HOLLER on a shared pitch (docs/MULTIPLAYER.md "Being there"):
// the button under the rail, its panel and the hollers drawn as they come in. The
// phrases and emoji are the fixed list in src/net/hollers.json; nothing else is ever
// drawn. One tap opens the panel, one tap sends and closes it. The panel shows the
// twelve emoji and one group of phrases at a time (CHEERS, GROANS, BANTER, CALLS as
// a segmented bar), and stands where it covers neither the tray (ARC, TILT, STAND)
// nor the meter (`hollerPlace`); where there is less room it scrolls inside itself.
import { h, button } from "./dom.js";
import { HOLLER_GROUPS, HOLLER_EMOJI } from "../net/hollers.js";
import { clockShapes } from "../game/layout.js";
import { linearGeometry, tabRect } from "../render/linear.js";

export const hollerTune = {
  gap: 8, // px between the panel and what it keeps clear of
  edge: 8, // px from the screen's safe edge
  wideW: 440, // px: a panel this wide puts the emoji beside the phrases
  wideFrom: 420, // px of room it needs for that
  narrowW: 320, // px: the stacked panel at most
  minW: 220, // px: never narrower
  tightW: 300, // px: a panel narrower than this puts its four tabs two by two
  minH: 140, // px: a place with less height than this is a last resort
};

const meets = (a, x, y, w, hh) =>
  a.x < x + w && x < a.x + a.width && a.y < y + hh && y < a.y + a.height;

// Where the panel goes: { x, y, width, height, wide } in the layout's px, `height`
// being the most it may take (it scrolls past that). `anchor` is the HOLLER button's
// box; `keep` the boxes it must not cover. Pure: tests/ui/holler.test.mjs.
export function hollerPlace({ W, H, safe = {}, anchor, keep = [] }) {
  const t = hollerTune;
  const s = { top: 0, right: 0, bottom: 0, left: 0, ...safe };
  const left = s.left + t.edge;
  const right = W - s.right - t.edge;
  const floor = H - s.bottom - t.edge;
  const y = anchor.y + anchor.height + 6;
  const xs = new Set([anchor.x]);
  for (const k of keep) xs.add(k.x + k.width + t.gap);
  let best = null;
  for (const x0 of xs) {
    const x = Math.max(left, x0);
    if (right - x < t.minW) continue;
    // the room to the right at the panel's top band
    let rx = right;
    for (const k of keep)
      if (meets(k, x, y, rx - x, t.minH) && k.x >= x)
        rx = Math.min(rx, k.x - t.gap);
    if (keep.some((k) => k.x < x && meets(k, x, y, 1, t.minH))) continue;
    const width = Math.min(rx - x, t.wideW);
    if (width < t.minW) continue;
    // and down, as far as nothing under the band
    let bottom = floor;
    for (const k of keep)
      if (k.x < x + width && x < k.x + k.width && k.y + k.height > y)
        bottom = Math.min(bottom, k.y - t.gap);
    const height = bottom - y;
    if (height <= 0) continue;
    const wide = width >= t.wideFrom;
    const w = wide ? width : Math.min(width, t.narrowW);
    const score =
      Math.min(height, wide ? 230 : 330) * Math.min(w, 330) -
      Math.abs(x - anchor.x);
    if (!best || score > best.score)
      best = { x, y, width: w, height, wide, score };
  }
  if (!best) {
    // nowhere clear: the stacked panel under the button, scrolling
    const x = Math.max(left, Math.min(anchor.x, right - t.narrowW));
    best = {
      x,
      y,
      width: Math.min(t.narrowW, right - x),
      height: floor - y,
      wide: false,
    };
  }
  delete best.score;
  return best;
}

// The boxes a layout's panel keeps clear of: the tray's three closed plates (an open
// plate closes at the press that opens the panel, as at any press outside it) and the
// meter with its prompt.
export function hollerKeep(L) {
  if (!L) return [];
  const out = [];
  const tr = L.tray;
  if (tr)
    out.push({
      x: tr.x,
      y: tr.y,
      width: tr.width + 3,
      height: tr.foot - tr.y,
    });
  if (L.dial) out.push(L.dial);
  if (L.meter === "clock" && L.dial) {
    const { circle: c, prompt } = clockShapes(L);
    out.push({ x: c.cx - c.r, y: c.cy - c.r, width: 2 * c.r, height: 2 * c.r });
    out.push(prompt);
  } else if (L.meter === "linear" && L.dial) {
    out.push(tabRect(linearGeometry(L.dial, L.meterSide)));
  }
  return out;
}

// The HOLLER button and its panel. opts: { ui, layout: () => L, send(item), root }.
export class HollerBar {
  constructor({ ui, layout, send }) {
    this.ui = ui;
    this.layout = layout;
    this.send = send;
    this.group = HOLLER_GROUPS[0].id;
    this.toggle = button("HOLLER", () => this.flip(), "small", {
      "aria-expanded": "false",
      "aria-controls": "holler-panel",
      "data-test": "shout",
    });
    this.bar = h("div.shout-bar", { hidden: true }, this.toggle);
    this.tabs = h("div.seg.holler-tabs", {
      role: "group",
      "aria-label": "Phrases",
    });
    this.phrases = h("div.holler-phrases");
    const emoji = h(
      "div.holler-emoji",
      { role: "group", "aria-label": "Emoji" },
      HOLLER_EMOJI.map((e) =>
        h(
          "button.holler-btn.holler-e",
          {
            type: "button",
            "data-shout-e": e,
            "aria-label": `Holler ${e}`,
            onclick: () => this.pick({ emoji: e }),
          },
          e,
        ),
      ),
    );
    for (const g of HOLLER_GROUPS)
      this.tabs.append(
        h(
          "button.seg-btn.holler-tab",
          {
            type: "button",
            "data-group": g.id,
            "aria-pressed": String(g.id === this.group),
            onclick: () => this.show(g.id),
          },
          g.name.toUpperCase(),
        ),
      );
    this.panel = h(
      "div.holler-panel",
      {
        id: "holler-panel",
        role: "group",
        "aria-label": "Holler",
        hidden: true,
        "data-test": "holler-panel",
        onkeydown: (e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            this.close(true);
          }
        },
      },
      h("div.holler-words", this.tabs, this.phrases),
      emoji,
    );
    this.show(this.group);
    // a press anywhere else closes it (the press still does what it does)
    this.outside = (e) => {
      if (this.panel.hidden) return;
      if (this.panel.contains(e.target) || this.toggle.contains(e.target))
        return;
      this.close(false);
    };
    document.addEventListener("pointerdown", this.outside, true);
    this.reflow = () => !this.panel.hidden && this.place();
    window.addEventListener("resize", this.reflow);
  }

  get open() {
    return !this.panel.hidden;
  }

  show(id) {
    this.group = id;
    for (const b of this.tabs.children)
      b.setAttribute("aria-pressed", String(b.dataset.group === id));
    const g = HOLLER_GROUPS.find((x) => x.id === id) ?? HOLLER_GROUPS[0];
    this.phrases.replaceChildren(
      ...g.phrases.map((w) =>
        h(
          "button.holler-btn.holler-w",
          {
            type: "button",
            "data-shout": w,
            "data-group": g.id,
            onclick: () => this.pick({ phrase: w }),
          },
          w,
        ),
      ),
    );
    this.phrases.dataset.group = g.id;
    this.panel.dataset.group = g.id;
  }

  flip() {
    if (this.open) this.close(true);
    else this.openPanel();
  }

  openPanel() {
    this.panel.hidden = false;
    this.toggle.setAttribute("aria-expanded", "true");
    this.place();
    this.panel.querySelector(".holler-tab[aria-pressed=true]")?.focus({
      preventScroll: true,
    });
  }

  close(refocus) {
    if (!this.open) return;
    this.panel.hidden = true;
    this.toggle.setAttribute("aria-expanded", "false");
    if (refocus && this.toggle.isConnected && !this.bar.hidden)
      this.toggle.focus({ preventScroll: true });
  }

  hide(on) {
    this.bar.hidden = on;
    if (on) this.close(false);
  }

  pick(item) {
    this.close(true);
    this.send(item);
  }

  place() {
    const L = this.layout();
    const root = this.ui.getBoundingClientRect();
    const a = this.toggle.getBoundingClientRect();
    const W = L?.W ?? root.width;
    const H = L?.H ?? root.height;
    const at = hollerPlace({
      W,
      H,
      safe: L?.safe,
      anchor: {
        x: a.left - root.left,
        y: a.top - root.top,
        width: a.width,
        height: a.height,
      },
      keep: hollerKeep(L),
    });
    this.panel.classList.toggle("wide", at.wide);
    this.panel.classList.toggle("tight", at.width < hollerTune.tightW);
    Object.assign(this.panel.style, {
      left: `${Math.round(at.x)}px`,
      top: `${Math.round(at.y)}px`,
      width: `${Math.round(at.width)}px`,
      maxHeight: `${Math.max(96, Math.round(at.height))}px`,
    });
    return at;
  }

  destroy() {
    document.removeEventListener("pointerdown", this.outside, true);
    window.removeEventListener("resize", this.reflow);
  }
}
