// The report card (MENU, REPORT A THROW; docs/CLIENT.md "Reports"): two answers, what
// happened and what should have happened, sent with the game as it stood when the card
// opened (src/net/report.js). While it is open the game is modal, as under the menu: no
// input reaches the pitch and a throw being aimed here waits, but a throw already playing
// back, the computer's turn and an unattended match (watching the computer) go on.
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

const FAILURES = {
  "too-many": "Too many reports at once. Try again in a moment.",
  "too-big": "That report is too long to send.",
  timeout: "The server did not answer.",
  closed: "The server could not be reached.",
  unavailable: "Reports cannot be sent from here.",
};

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
  const status = h("p.report-status", {
    role: "status",
    "data-test": "report-status",
  });
  const actions = h("div.row");
  const body = h(
    "div.card.report",
    { "data-test": "report-card" },
    h("h2.display", "Report a throw"),
    happenedRow,
    shouldRow,
    h("p.report-note", REPORT_SENTENCE),
    status,
    actions,
  );
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
  async function go() {
    const answers = { happened: happened.value, should: should.value };
    if (!reportReady(answers)) {
      status.textContent = "Write what happened, or what should have happened.";
      happened.focus();
      return;
    }
    sending = true;
    happened.disabled = should.disabled = true;
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
      status.textContent = `The report was not sent. ${FAILURES[err?.code] ?? "Try again in a moment."}`;
      happened.disabled = should.disabled = false;
      editing();
    } finally {
      sending = false;
    }
  }
  editing();
  root.append(scrim);
  window.addEventListener("keydown", esc);
  requestAnimationFrame(() => happened.focus({ preventScroll: true }));
  return { close, state };
}
