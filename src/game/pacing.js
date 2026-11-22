// The match's pace between actions, in one place (an open call for the owner, see
// docs/MULTIPLAYER.md "Pace"): how long the pitch rests after a throw lands before play
// goes on, and how long a kubb lies before an automatic raise stands it. Shown only:
// the match itself is the same at any pace. Online, every browser and the iPhone app
// wait the same, so a watcher's picture keeps up with the thrower's.
export const pacing = {
  restAfterThrow: 0.8, // s, Game tune.holdAfter (watching the computer rests longer)
  // s the first kubb of a turn's automatic raise lies on the raise view before it
  // tips (auto-raise tune.wait, lift.js tune.lead); 0.7 for every kubb before web
  // 0.17.0, when raises were not watched. Each kubb is then watched for its beat
  // (lift.js liftPace: 0.5 s, less when there are many, the whole raise 4 s at most).
  autoRaiseWait: 0.4,
};
