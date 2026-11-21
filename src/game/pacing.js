// The match's pace between actions, in one place (an open call for the owner, see
// docs/MULTIPLAYER.md "Pace"): how long the pitch rests after a throw lands before play
// goes on, and how long a kubb lies before an automatic raise stands it. Shown only:
// the match itself is the same at any pace. Online, every browser and the iPhone app
// wait the same, so a watcher's picture keeps up with the thrower's.
export const pacing = {
  restAfterThrow: 0.8, // s, Game tune.holdAfter (watching the computer rests longer)
  autoRaiseWait: 0.7, // s, auto-raise tune.wait, for each kubb
};
