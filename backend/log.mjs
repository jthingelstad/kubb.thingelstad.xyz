// One log line from a function, as an object: { event, ... }.
//
// A Lambda function whose log format is JSON keeps an object passed to console as
// fields of its own (`message.event`, `message.route`), which is what the dashboards'
// queries read; the runtime says which format it has in AWS_LAMBDA_LOG_FORMAT. Anywhere
// else (plain text logs, a terminal) the line is the object as one line of JSON, as it
// always was. An error line goes out at the error level.
export function logLine(entry) {
  const out =
    entry?.event === "error" || entry?.step === "error"
      ? console.error
      : console.log;
  out(
    process.env.AWS_LAMBDA_LOG_FORMAT === "JSON"
      ? entry
      : JSON.stringify(entry),
  );
}
