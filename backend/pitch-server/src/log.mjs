// The pitch server's own log lines: one object a line, so Workers Logs indexes every
// field (README.md "Operate"). `event` names what happened; the rest are small facts
// about it. A line may name the pitch's code and a push's key. It never carries a name,
// a member id, a frame or anything a player sent.
//
// The lines that say something went wrong are always written. The rest (who came and
// went, a pitch wiped, a connection refused) are written only when the Worker's LOG is
// "1", which the deployed Workers set and `wrangler dev` and the tests do not.
//
// Nothing is logged on the relay path (a frame in, frames out): a line there would cost
// every throw, and the api's `push` lines already count the actions.
export const LOG_EVENTS = Object.freeze({
  join: "log", // a socket opened on a pitch: { pitch, sockets }
  leave: "log", // a socket closed: { pitch, sockets }
  wipe: "log", // a pitch was wiped, idle or by the dev op: { pitch }
  refused: "log", // the Worker refused a connection: { status, why }
  "push-recovered": "log", // a push got through after failing: { pitch, k, topic, tries }
  "push-failed": "warn", // a push was not taken: { pitch, k, topic, status, tries }
  "listing-failed": "warn", // the open games list did not take a report: { pitch, message }
  "alarm-failed": "error", // the alarm could not be set or cleared: { pitch, message }
});

export function say(env, event, fields = {}, out = console) {
  const level = LOG_EVENTS[event];
  if (!level) return false;
  if (level === "log" && env?.LOG !== "1") return false;
  out[level]({ event, ...fields });
  return true;
}

// An error's message, short enough for a line.
export const short = (err) => String(err?.message ?? err ?? "").slice(0, 200);
