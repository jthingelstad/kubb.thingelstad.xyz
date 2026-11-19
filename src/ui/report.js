// The feedback card (MENU, SEND FEEDBACK; docs/CLIENT.md "Reports"): first a choice, "A
// throw looked wrong" (two answers, what happened and what should have happened, and the
// pieces to mark) or "Something else" (one box, anything at all; Jamie, 2026-11-19), sent
// with the game as it stood when the card opened (src/net/report.js). While it is open the game is modal, as under the menu: no
// input reaches the pitch and a throw being aimed here waits, but a throw already playing
// back, the computer's turn and an unattended match (watching the computer) go on. The
// rest of the root is inert until it closes, so a card shown under it takes no focus.
import { h, button, clear } from "./dom.js";
import {
  REPORT_LIMITS,
  captureReport,
  reportMessage,
  reportReady,
  sendReport,
} from "../net/report.js";

export const REPORT_SENTENCE =
  "This sends what you typed with this game as it stands (its options, names and throws), so the throw can be played again and tested. It is kept privately and not published.";
export const FEEDBACK_SENTENCE =
  "This sends what you typed with this game as it stands (its options, names and throws). It is kept privately and not published.";

const KINDS = [
  ["throw", "A throw looked wrong"],
  ["feedback", "Something else"],
];

const FAILURES = {
  "too-many": "Too many sent at once. Try again in a moment.",
  "too-big": "That is too long to send.",
  timeout: "The server did not answer.",
  closed: "The server could not be reached.",
  unavailable: "Feedback cannot be sent from here.",
};

// Both controls toggle the same piece. The list also reaches pieces whose
// footprints overlap on the overhead pitch.
function piecePicker(pieces, selected) {
  if (!pieces.length) return null;
  const map = h("div.report-pitch");
  const list = h("div.report-piece-list");
  const summary = h("summary", "Mark pieces");
  const xs = pieces.map((p) => p.x),
    ys = pieces.map((p) => p.y);
  const left = Math.min(0, ...ys) - 0.6,
    right = Math.max(8, ...ys) + 0.6;
  const top = Math.min(-2.5, ...xs) - 0.5,
    bottom = Math.max(2.5, ...xs) + 0.5;
  const along = (y) => ((y - left) / (right - left)) * 100 + "%";
  const across = (x) => ((x - top) / (bottom - top)) * 100 + "%";
  map.append(
    h("div.report-lines", {
      style: {
        left: along(0),
        top: across(-2.5),
        width: 800 / (right - left) + "%",
        height: 500 / (bottom - top) + "%",
      },
    }),
  );
  for (const p of pieces) {
    const number = p.id.startsWith(p.kind)
      ? p.id.slice(p.kind.length)
      : p.id.toUpperCase();
    const label = [p.kind[0].toUpperCase() + p.kind.slice(1), number]
      .filter(Boolean)
      .join(" ");
    const toggle = () => {
      if (selected.has(p.id)) selected.delete(p.id);
      else selected.add(p.id);
      for (const el of [dot, item])
        el.setAttribute("aria-pressed", String(selected.has(p.id)));
      summary.textContent = selected.size
        ? `Mark pieces (${selected.size})`
        : "Mark pieces";
    };
    const attrs = {
      type: "button",
      "aria-label": label,
      "aria-pressed": "false",
      onclick: toggle,
    };
    const dot = h(
      "button.report-dot",
      {
        ...attrs,
        title: label,
        "data-kind": p.kind,
        style: { left: along(p.y), top: across(p.x) },
      },
      p.id.toUpperCase(),
    );
    const item = h("button.report-chip", attrs, label);
    map.append(dot);
    list.append(item);
  }
  return h("details.report-picker", summary, map, list);
}

// opts: { game, mode, config, pitch?, url, send? (for tests) }
export function openReport(root, opts) {
  const { game } = opts;
  const state = captureReport({
    game,
    mode: opts.mode,
    config: opts.config,
    pitch: opts.pitch ?? null,
  });
  const send = opts.send ?? sendReport;
  game.modal++;
  const field = (label, test) => {
    const el = h("textarea.report-text", {
      maxlength: REPORT_LIMITS.chars,
      rows: 3,
      spellcheck: "true",
      "data-test": test,
    });
    return [h("label.report-field", h("span.opt-label", label), el), el];
  };
  const [happenedRow, happened] = field("What happened?", "report-happened");
  const [shouldRow, should] = field(
    "What should have happened?",
    "report-should",
  );
  const feedback = h("textarea.report-text", {
    id: "report-feedback-text",
    maxlength: REPORT_LIMITS.feedbackChars,
    rows: 4,
    spellcheck: "true",
    "aria-describedby": "report-feedback-hint",
    "data-test": "report-text",
  });
  const feedbackRow = h(
    "div.report-field",
    h(
      "label.opt-label",
      { for: "report-feedback-text" },
      "What would you like to tell us?",
    ),
    h(
      "p.report-hint",
      { id: "report-feedback-hint" },
      "A problem, an idea, something you liked or did not. Anything.",
    ),
    feedback,
  );
  const status = h("p.report-status", {
    role: "status",
    "data-test": "report-status",
  });
  const actions = h("div.row");
  const selected = new Set();
  const picker = piecePicker(state.pickPieces, selected);
  const note = h("p.report-note");
  const throwPart = h(
    "div.report-part",
    { "data-kind": "throw" },
    picker,
    happenedRow,
    shouldRow,
  );
  const feedbackPart = h(
    "div.report-part",
    { "data-kind": "feedback" },
    feedbackRow,
  );
  // A throw to report: the throw kind first; otherwise anything else.
  let kind = state.lastThrow ? "throw" : "feedback";
  const radios = KINDS.map(([value, label]) => {
    const input = h("input.report-kind-input", {
      type: "radio",
      name: "report-kind",
      value,
      "data-test": `report-kind-${value}`,
      onchange: () => input.checked && show(value),
    });
    input.checked = value === kind;
    return [input, h("label.seg-btn.report-kind-btn", input, label)];
  });
  const kinds = h(
    "fieldset.report-kind.seg",
    h("legend.visually-hidden", "What is it about?"),
    radios.map(([, label]) => label),
  );
  const show = (k) => {
    kind = k;
    throwPart.hidden = k !== "throw";
    feedbackPart.hidden = k !== "feedback";
    note.textContent = k === "throw" ? REPORT_SENTENCE : FEEDBACK_SENTENCE;
    body.dataset.kind = k;
    status.textContent = "";
  };
  const firstField = () => (kind === "throw" ? happened : feedback);
  const typing = [happened, should, feedback];
  const body = h(
    "div.card.report",
    { "data-test": "report-card" },
    h("h2.display", "Send feedback"),
    kinds,
    throwPart,
    feedbackPart,
    note,
    status,
    actions,
  );
  show(kind);
  const scrim = h("div.scrim.report-scrim", body);
  let closed = false;
  let sending = false;
  const esc = (e) => {
    if (e.key === "Escape" && !sending) close();
  };
  function close() {
    if (closed) return;
    closed = true;
    scrim.remove();
    for (const el of quieted) el.inert = false;
    window.removeEventListener("keydown", esc);
    game.modal = Math.max(0, game.modal - 1);
  }
  const editing = () => {
    clear(actions);
    actions.append(
      button("SEND", go, "go", {
        "data-default": true,
        "data-test": "report-send",
      }),
      button("CANCEL", close, "", { "data-test": "report-cancel" }),
    );
  };
  const lock = (on) => {
    if (picker) picker.inert = on;
    kinds.disabled = on;
    for (const el of typing) el.disabled = on;
  };
  async function go() {
    const answers =
      kind === "throw"
        ? {
            kind,
            happened: happened.value,
            should: should.value,
            selected: [...selected],
          }
        : { kind, text: feedback.value };
    if (!reportReady(answers)) {
      status.textContent =
        kind === "throw"
          ? "Write what happened, or what should have happened."
          : "Write what you would like to tell us.";
      firstField().focus();
      return;
    }
    sending = true;
    lock(true);
    clear(actions);
    status.textContent = "Sending...";
    try {
      await send({
        url: opts.url,
        message: reportMessage(state, answers),
      });
      status.textContent = "Sent, thank you.";
      body.dataset.sent = "1";
      clear(actions);
      actions.append(
        button("BACK TO THE PITCH", close, "go", {
          "data-default": true,
          "data-test": "report-done",
        }),
      );
    } catch (err) {
      status.textContent = `${kind === "throw" ? "The report" : "Your feedback"} was not sent. ${FAILURES[err?.code] ?? "Try again in a moment."}`;
      lock(false);
      editing();
    } finally {
      sending = false;
    }
  }
  editing();
  root.append(scrim);
  // Everything else under the root is inert while the card is open: a card that appears
  // under it (the winner card of a watch match) can take neither focus nor a key.
  const quieted = [...root.children].filter((el) => el !== scrim && !el.inert);
  for (const el of quieted) el.inert = true;
  window.addEventListener("keydown", esc);
  requestAnimationFrame(() => firstField().focus({ preventScroll: true }));
  return { close, state };
}
