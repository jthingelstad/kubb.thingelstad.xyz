// The pitch server's log lines (backend/pitch-server/src/log.mjs): what is written, when,
// and at which level. The deployed Workers set LOG; `wrangler dev` and the tests do not.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LOG_EVENTS, say, short } from "../../backend/pitch-server/src/log.mjs";

function sink() {
  const lines = [];
  const at = (level) => (line) => lines.push({ level, line });
  return { lines, log: at("log"), warn: at("warn"), error: at("error") };
}

test("a failure is always written; the rest only when LOG is on", () => {
  const quiet = sink();
  for (const event of Object.keys(LOG_EVENTS))
    say({}, event, { pitch: "abcdefgh23" }, quiet);
  assert.deepEqual(
    quiet.lines.map((l) => [l.level, l.line.event]),
    [
      ["warn", "push-failed"],
      ["warn", "listing-failed"],
      ["error", "alarm-failed"],
    ],
  );
  const loud = sink();
  for (const event of Object.keys(LOG_EVENTS))
    say({ LOG: "1" }, event, { pitch: "abcdefgh23" }, loud);
  assert.equal(loud.lines.length, Object.keys(LOG_EVENTS).length);
  assert.deepEqual(loud.lines[0], {
    level: "log",
    line: { event: "join", pitch: "abcdefgh23" },
  });
});

test("a line is one object, and an event that is not on the list is no line", () => {
  const out = sink();
  assert.equal(say({ LOG: "1" }, "made-up", { a: 1 }, out), false);
  assert.equal(
    say(
      { LOG: "1" },
      "push-failed",
      {
        pitch: "abcdefgh23",
        k: "act:1:4",
        topic: "act",
        status: 503,
        tries: 1,
      },
      out,
    ),
    true,
  );
  assert.deepEqual(out.lines, [
    {
      level: "warn",
      line: {
        event: "push-failed",
        pitch: "abcdefgh23",
        k: "act:1:4",
        topic: "act",
        status: 503,
        tries: 1,
      },
    },
  ]);
  assert.equal(short(new Error("x".repeat(500))).length, 200);
  assert.equal(short(null), "");
});
