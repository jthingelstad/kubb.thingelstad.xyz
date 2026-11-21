# Observer mode

Jamie asked for it: "I want to allow an observer to view open games that people are
playing. This would be the same concept for watching a computer v computer game. But
this way you can watch any game that is open. In observer mode you should be able to fly
around and position your view wherever you want to be."

This note is the web's behaviour, written so the iPhone app can do the same. Nothing here
needs an engine change or a room server change.

## Who watches

- **An observer** opens `/p/<code>?observe=1`: WATCH on a row of the open games list
  (`public/js/open-games.js`), beside JOIN. It joins the room as a member, so the lobby's
  "Watching" line names it (the name this browser last typed, else "Someone"), and the
  open games count ("2 of 12 on the pitch") counts it, as it counts anyone on the pitch.
- **A watcher** is any member with no side in the match: an observer, someone who chose
  WATCH INSTEAD, someone who arrived mid-match, or a browser whose engine may not play
  the match.
- **Watching the computer** (`/p/<code>?watch=1`) and **a replay** (not the embed) watch
  the same way.

Every watcher gets the watcher's view: the wide view by default, the free camera in it,
THROWER'S VIEW / WIDE VIEW, MENU's View and the V key. Players keep the view they had:
the thrower's view, no free camera.

## What an observer can and cannot do

An observer:

- gets in step at once, mid-match or not: the room's document carries the match's
  snapshot, and it adopts it (the same late join every member has), then plays each
  action as it comes;
- may never act: its seat has no side and no computer, `mayAct` is always false, and it
  commits nothing to the document; the pages hold `onAction` shut too;
- never writes the room's options on arrival, even on a new room;
- never becomes host (the host runs the computer and keeps the open listing). When the
  host has gone and the observer is first in line, it leaves and joins again, last in
  line (`Room.rejoin`, only when someone else is connected), and the next member claims
  as before. A race is harmless: the room server decides who is first, and the observer
  looks again on its next tick. While nobody takes host (only observers left on an
  abandoned pitch) it backs off: the first step back at once, then 20 s, 40 s, 80 s,
  doubling to 5 minutes (`src/net/step-back.js`). It starts from the first again when a
  host is connected, or when a member it has never seen connects, so a player who
  arrives is not kept behind an observer. Observers keep their member id when they
  rejoin, so their own step backs never count as an arrival. Nothing new on the wire;
- has no SHOUT;
- sees the hand-off card with the teams' names, not the engine's "YOUR BASE 5 · THEIRS 4"
  (`baseText`, which speaks to the team the card goes to): "NORTH BASE 4", "SOUTH BASE
  5", the far team first as the card's map draws it, "they throw 6 batons", and WATCH,
  closing by itself. The same for every browser with no side (a member who watches
  instead, watching the computer); players' cards are as before
  (`src/ui/handoff-words.js`);
- may ask the room to keep a finished match's replay, as every browser that watched the
  end does (it is not an action);
- between matches sees its own card instead of the lobby: who is on each team, who is
  watching, WATCH THE LAST MATCH when there is one, JOIN THIS PITCH (the same link
  without `?observe=1`, the lobby) and HOME. No name box, no team buttons, no options, no
  START;
- at a pitch nobody is on (its join made the room) hears "No game here" and leaves at
  once, so the room keeps no member.

## The free camera

On while a watcher sees the wide view and no card is over the pitch.

| Input | What it does                                                                                                                                                            |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mouse | Drag: turn round the pitch and raise or lower the eye. Right drag, middle drag or Shift + drag: move over the pitch. Wheel (and a trackpad's pinch): closer or farther. |
| Touch | One finger: turn and raise or lower. Two fingers: pinch for closer or farther, twist to turn, slide to move.                                                            |
| Keys  | Arrows: turn (left, right) and raise or lower (up, down). W A S D: move. + and -: closer, farther. 0 or Home: back to the first view.                                   |

- **The first view is the wide view, exactly.** Until the first move the engine's wide
  camera is drawn untouched. RESET VIEW (low on the left, shown once the view has moved)
  eases back over 0.45 s, at once with Reduce Motion, and hands the engine's camera back.
  A hint ("Drag to look around. Scroll to zoom.", "Pinch to zoom." on touch) shows until
  the first move or 8 s.
- **How it is made.** An orbit round a point on the pitch: where the eye stands round it
  (yaw), how high it looks down (pitch), how far (distance), and the point itself
  (`src/render/freecam.js`). The camera is the core camera's kind, made with the same
  `lookAt` arithmetic as `core/camera.lua` (a test holds them equal), so the renderer,
  the scenes and the bursts draw through it as through any camera. The lens (focal
  length and centre) stays the wide camera's: closer is the eye moving, not a longer
  lens.
- **Limits.** The eye 2.5 to 24 m from the point (the wide view's own is 9 to 16 m); the
  pitch 4 to 86 degrees below the eye's level; the eye never under 0.35 m (a low view
  close in is lifted); the point within the pitch and a margin round it (x -4 to 4 m,
  y -2.5 to 10.5 m), inside the night scene's clearing. `freeTune` holds the numbers.
- **What it cannot do, and why.**
  - No roll: the horizon stays level. The core camera keeps its right vector level.
  - Not straight down: 86 degrees at most, for the same reason (straight down has no
    level right).
  - No longer lens (a telephoto zoom): the lens is the wide camera's, fitted to the
    window, so a turned phone or a resized window keeps the pitch the size the window
    gives it. The orbit chosen is kept through a resize.
  - Not on the thrower's view: that camera follows each throw (the engine's aim, flight
    and impact cameras), and a moved camera there would fight it. THROWER'S VIEW is the
    way to see a throw from the thrower.
  - Not in the embed: the embed sits in another site's page, where a wheel must scroll
    that page.
  - Not stored: each watch starts at the first view.
- **Scenes.** Day, Night and Neon draw from any view: the scenes take whatever camera
  the pitch is drawn through (`src/render/scenes.js`).
- **A phone held upright.** A watcher gets the wide view down to a smallest base kubb of
  2 CSS px (`tune.observeMinPx`; it was 6, and still is for `tune.wideMinPx`), so an
  upright phone sees the whole pitch from behind Team A's baseline and can move in with
  two fingers. A phone on its side was already wide.

## The iPhone port

- Same rules: an observer is a member with no seat, never acts, never writes the document
  (no options on arrival, no commits), never claims host and steps back (leave, then join
  again) when first in line with another member connected, with the same back-off
  (at once, then 20 s doubling to 5 minutes; again from the first when a host is
  connected or a member never seen before connects). Keep the member id across the
  rejoin. No room server change is needed: `leave` then `join` puts a member last.
- Same view: start at the engine's wide camera untouched; orbit with the limits above;
  lens unchanged; RESET VIEW eases 0.45 s, or at once with Reduce Motion. The gestures
  map one to one: one finger turns, two fingers pinch, twist and slide.
- Same honesty: the observer shows in the lobby's Watching line and in the open games
  count. Nothing new goes on the wire, in a record, a replay or a reel.
