# The 1.0 system on the web game: numbers and words

The Throwing Wood 1.0 design (the owner's review of 2026-11-21) as built on the web game's
own screens, in one place, so the iPhone app can match it number for number and word for
word (its rule that layout numbers match the web's still holds). Where each lives in the
code is named; the code is the authority when the two differ. docs/CLIENT.md "The 1.0
system" says how it works.

## Tokens

| Token      | Value                      | Where                                                  |
| ---------- | -------------------------- | ------------------------------------------------------ |
| ink        | `#16130f`                  | `public/style.css` `--ink`; canvas `INK` (palette.js)  |
| paper      | `#f7f0de`                  | cards, plain buttons                                   |
| baton      | `#fbf6ea`                  | insides: a boxed name row, tiles                       |
| field      | `#ffffff`                  | the unchosen parts of a segmented bar, steppers        |
| wood       | `#ecd09a`                  | plate title bands only                                 |
| muted      | `#5b4a2c`                  | helper text, the header's line, captions               |
| marigold   | `#f2b705`                  | the one go button a screen; Team A                     |
| violet     | `#8e44ad`                  | Team B (white type)                                    |
| line       | 3 px                       | every card and control                                 |
| chip line  | 2 px, no shadow            | chips, the header's numbers                            |
| radius     | 6 px controls, 8 px cards  |                                                        |
| shadow     | 3 px controls, 5 px cards  |                                                        |
| focus ring | 3 px ink, 2 px off         | every control; round a whole segmented bar             |
| touch      | 44 px, 48 on a touchscreen | every control; the tray's plates are 86 by 60 at least |
| dim        | ink at 45%                 | the pitch under a card (the header is not shown there) |

## Type

| Use                        | Face and size                                                                 |
| -------------------------- | ----------------------------------------------------------------------------- |
| card title (sentence case) | Londrina Solid Black, 32 to 42 px (`.card h2`)                                |
| button (capitals)          | Londrina Solid Black 20 px; small 17 px; START and a go across the card 26 px |
| a name in the name row     | Londrina Solid Black 24 px                                                    |
| the header's name          | Londrina Solid Black 20 px                                                    |
| row label, kicker          | Inter 700 14 px, capitals, 0.06em                                             |
| segment, stepper word      | Inter 700 15 px                                                               |
| body                       | Inter 15 to 17 px                                                             |
| floor                      | 14 px, everywhere in `#ui`                                                    |

## Controls

- **Buttons** (`src/ui/dom.js` `button(label, fn, kind)`): go `"go"` (marigold, last in
  its row; across the card when it is the card's main action: `"go wide"`), plain `""`,
  quiet `"quiet"` (no line, no shadow, underlined 2 px 4 px under, the full 44/48 px).
- **Segmented bar** (`src/ui/seg.js`): 3 px ink round the bar, radius 6, 2 px ink between
  parts, each part at least 52 px wide with 12 px each side; chosen ink with paper type.
  One Tab stop; arrow keys, Home and End move the choice and pick.
- **Name row** (`src/ui/name-row.js`): the name and SHUFFLE on one line, the name at least
  `NAME_FIT.text` 200 px wide; Settings only: one stepper a line, chevron buttons 48 px
  wide, the word box at least `NAME_FIT.word` 120 px, ink with paper type.
- **Scene tiles** (`src/ui/scene-tiles.js` `sceneTiles`; seven since engine 0.14): they
  wrap, centred. On a screen under 600 px wide **three a row**, 6 px apart, the row
  reaching 6 px into the card's padding on each side (a tile is a third of the card's
  inner width plus 12 px, less 12 px: 107 px wide on a 390 px phone, its name 101 px inside the line), the seventh
  centred on a row of its own; from 600 px **four a row**, 8 px apart (four and three).
  Each is the game's own postcard of the pitch in that scene (a low camera from behind
  the near baseline, eye 0.6, -5.2, 1.5 m, looking at 0, 9, 0.9 m, focal length 330 in the
  400 by 240 frame) at 96 by 56 (2x), scaled to the tile's width, on the scene's own
  ground and set; its name under it in Inter 700 14 capitals (no letter spacing; -0.01em
  on a phone, so TOURNAMENT fits), two lines where it needs them (BLACK & WHITE). At
  least 48 px tall. Chosen: the name ink with paper type and the tile's 3 px shadow. The
  solo card, the lobby (the host's) and practice's MENU.
- **Header** (`src/game/hud.js`, `public/game.css` `.hud-rail`): one plate 10 px under the
  safe top and 12 px in from the left; padding 5 px (12 px at the left); a grid of the line
  across the top, then the name, the two numbers (chips at least 32 px wide, 6 px apart,
  Inter 700 16) and MENU (2 px line, no shadow); 6 px between them. Since stage 3 its width
  is fixed for the layout (`layout.js` `headerBox`, the game sets `--rail-w`), so the
  minimap under its right end never moves: tall, the whole safe width less 12 px each side;
  wide, 40% of the width, 260 to 400 px, and where it can 24 px short of the screen's centre
  (practice: the same where its corner row leaves room, down to 218). 78 px tall with a
  mouse, 82 px to a finger (`railBox` 92 with the 10 px over it); the page measures it and
  the layout follows (`railH`).

## Screens

- **Play the computer**: the name row, a rule, Scene (seven tiles), then the engine's rows
  for the scene (`pitch.optionRows`) in this order: Surface (Black & White only: Grass,
  Sand, Snow), Computer level (Kid, Beginner, Club, Pro), Opening, Raising, Wind. No
  Kubbs row: the set is the scene's. HOME quiet at the left, START go at the right. The
  lobby's options are the same rows, the Scene as the host's tiles.
- **Menu**: SETTINGS, SCORE SHEET, HOW TO THROW, FEEDBACK as a two by two grid of plain
  buttons, 12 px apart; Raising (a match by hand); BACK TO THE MATCH go across the card
  (BACK TO THE PITCH in practice); RESIGN quiet at the left, HOME quiet at the right; the
  version under them.
- **Settings**: "Settings", "Kept on this device. The match options are on each match's
  card.", YOUR NAME with the steppers, a rule, Sound, Meter, Meter side (and their notes),
  then the version at the left and DONE go at the right.
- **Winner**: the kicker, "<name> wins", how, the stats; REMATCH go across the card;
  WATCH REPLAY and SCORE SHEET side by side; SHARE across the card; HOME quiet at the foot.
- **Share this match** (a finished pitch's SHARE): the link and COPY LINK, MAKE A
  HIGHLIGHT REEL and EMBED side by side, BACK quiet.
- **Raise and punishment panel**: the automatic choices plain at the left (AUTO, AUTO
  ALL, REST OF GAME; BY HAND, REST OF GAME), the confirming action at the right (PLACE IT
  go; END 1 and END 2 for the keyboard).
- **Welcome** (a pitch link, a device new to the game): the chip KUBB: THROWING WOOD, the
  title, the two sentences, "You will be" over the name and SHUFFLE in a baton box, JOIN
  THE GAME go across the card, JUST WATCH and HOW TO THROW quiet.
- **Lobby**: "You are" over the name and SHUFFLE in a baton box; WATCH INSTEAD quiet;
  HOME quiet at the left, START go at the right.

## Play screens (stage 3)

The aim, the meter, the verdict, the hand-off and the computer's turn (the build list's
items 5 to 10 and 13). `src/game/layout.js` (`layoutFor`, `trayAt`, `headerBox`,
`minimapBox`) has every number; `tests/game/layout.test.mjs` pins them.

- **The tray** (`src/game/tray.js`, `layout.js` `trayAt`, `game.css` `.plans`, `.plate`):
  ARC, TILT (SPIN for a kubb) and STAND, top to bottom, three plates of one size: **86 by
  60** on a phone (a screen whose short side is under 520 px, upright or turned), **104 by
  70** wider; **8 px** between them; a 3 px line, radius 6, a 3 px shadow, the baton fill.
  Each plate is its value on a wood band (Londrina Solid Black 17 px, 22 px line, a 3 px
  line under it: `ARC 22°`, `TILT 7R`, `SPIN 1.3L`, `STAND`) over a 70 by 32 picture: the
  planned arc dashed, rising with the loft; the baton leaning by the tilt (a kubb with an
  arrow round it for spin); the line from above with the ring where the thrower stands.
  The column stands **12 px** inside the safe area at the screen's edge away from the
  meter: upright the left edge (the right with Meter side, Left), wide the left edge with
  the meter at the right and the right edge with it at the left, mouse and touch alike. Its
  foot is **10 px** above the meter's box's foot; upright beside the clock it stands above
  the clock's face (6 px off it; on a touchscreen above the finger track, 1.55 radii) where
  its inner edge is, and above the prompt. Where a short screen leaves too little room
  under the header, the column comes down to 6 px over the safe bottom (never upright),
  then its plates grow shorter, never under 48 px to a finger (44 with a mouse).
- **An open plate**: a tap on a plate opens it, one at a time; it grows up from its place
  (the column's foot stays) into its control: ARC to **256** tall on a phone, **300**
  wider, its width the plate's; TILT or SPIN to **84** tall; STAND to **150** on a phone,
  **180** wider; TILT and STAND also in toward the middle to **200** on a phone, **240**
  wider, never nearer the screen's centre than **24 px**, and short of the minimap where it
  stands lower beside the column. Each grows only as far as the room under the tray's
  ceiling (the header, the minimap or a corner's plates over the column, 8 px under them)
  leaves with the other two showing; where that is under **100 px** it covers them, from
  the column's foot. ARC open is the side view, until it closes. Its band closes it; so do
  Escape (the focus goes back to the plate), a press anywhere outside the tray, and
  opening another. The keys still set arc, tilt and stance (R/F, Q/E, A/D/W/S, Shift
  peeks); the arrows on a closed plate step it.
- **The minimap** (`render/minimap.js`): a plate's look, a 3 px ink line, radius 6, a 3
  px ink shadow; it hangs from its box's top, **8 px** under the header, its right edge
  with the header's, in every layout (tall: min(78 px, 19%) wide; wide: 8.5% of the
  width, 56 to 118 px, at most 16% of the height; twice as tall less a twentieth). Team A's
  kubbs are circles, Team B's squares, as well as marigold and violet; the king a square
  with a crown.
- **The meter's marks** (`render/dial.js`, `render/linear.js`, every scene): the power band
  striped (its colour in stripes on paper, one every 7.5% of the clock's radius, half
  inked; the deep colour the same across the ring or lane), the release band solid, both
  with heavy ink end-marks (1.8 times the meter's line) at both edges; on the clock's finger
  track the power band is dashed. The overpowered zone is cross-hatched, so the stripes
  are the power band's alone.
- **The distance**: beside the prompt (WIND BACK, DRAW BACK, FLICK!) an inverted tab with
  the throw's distance to the nearest metre, `8 M` (the plan's distance, stance to
  circle): on the clock the pair centred over it, 0.3 of the plate's height apart; on the
  linear meter on the prompt tab's free end.
- **The verdict** (`hud.js` `verdictChips`, `VERDICT_ICON`): the off word first, inverted,
  Inter 900 **18 px**, radius 6, with a 14 px arrow in its own colour: down for SHORT and
  LOW, up for LONG and HIGH, left and right for PULLED LEFT and PULLED RIGHT, a wavy line for
  SHAKY, a clock hand for SLOW; the on-target words as small chips after it (14 px). A
  screen reader hears it once, the off word first (`verdictSpeech`). Since web 0.17.0 (the
  owner, 2026-11-22: "the display stays on the screen for a while keeping the player from
  being able to aim at times"):
  - **It never stops an aim.** It takes no touches (`#ui .hud` has `pointer-events:
none`: a press where it is drawn aims as if it were not there), and the first aim
    input takes it away at once (`Game.aimInput`): a press anywhere on the pitch, the
    target ring or the meter, a tray plate opened, a slider or STAND moved, an aim key.
    Untouched it stays **3.5 s** from the throw coming to rest (`game.js`
    `tune.flagFor`, 6 s before), about 2.7 s of the next aim after the pitch's 0.8 s
    rest. (Before, a stroke on the meter cut it to 0.3 s and nothing else did.)
  - **Where it stands** (`layout.js` `verdictBox`, `game.css` `.center-placed .center`):
    upright, the band under the header from the minimap's top (header foot + 8), from
    12 px inside the safe left to **8 px** short of the minimap, as tall as its chips
    wrap to (132 px at most: the flag and two rows); a tray column whose top is within
    132 px of the band's top keeps it 8 px off the column's inner edge (a short Safari
    window with its banner, 402 x 665, lifts the tray to 222 px, so the box starts at
    106); the Kid or advantage line's chip under the header moves it **34 px** down, and
    a shared pitch's status pill **50**. On a wide screen, the header's own row (its top
    with the header's, 10 px under the safe top), from 8 px past the header's end to 12
    px inside the safe right, or 8 px short of a meter at the right edge that reaches
    the row (104 px); centred on the screen where that leaves it 160 px either side of
    the middle; **44 px** lower under the status pill. Everything aimed at is below it:
    upright the thrower's view is fitted with the far baseline at 41% of the height
    ("The thrower's view upright", below), a wide screen's aim view has the far
    baseline at about 40%.
  - **Its shape**: upright a column, the flag over its chips; in a box under
    **260 px** wide (beside the tray) the compact chips: the flag 26 px, an off word
    15 px, an on-target chip 12 px (`.verdict-compact`), so the tallest verdict (three
    off words and a chip) keeps to 144 px. On a wide screen a row, the flag first and
    its chips wrapping beside it (`.verdict-row`), about 60 to 80 px tall.
  - Measured (`tests/game/feedback-client.test.mjs` sweeps these with three off words):
    402 x 665 with the clock, box 106 to 306 across, from 100 down to 198 (four on-target
    chips) or 244 (three off words), the target ring from 264; 390 x 844, 12 to 296, 100
    to 211, the ring from 338; 844 x 390, 358 to 832, 10 to 70 (91 with three off
    words), the ring from 147; 1280 x 800, 420 to 860, 10 to 74, the ring from 305. In a
    Kid match upright (the line's chip showing) the box starts at 134.
- **The thrower's view upright** (`layout.js` `worldFit`, `tune.anchorY`, `anchorAt`):
  the picture is 1.3 times the width-fit scale, panned after the target, and placed so
  the far baseline stands at **41%** of the canvas's height whoever throws from where:
  its frame y is read from each throw's aim camera (`Game.farFrameY`, `farFrameOf`, held
  to 40 to 180 frame px; 96 for a throw from the baseline). Before web 0.17.0 frame y 112
  stood at 33%, so the far baseline was at 30% (41% from a Kid match's line, the thrower
  2 m forward). What it costs below: the near half under the clock shows a little less
  of the pitch (the centre line goes from about 60% to 71% of a 665 px window); nothing
  is aimed there. On its side and on a desktop the renderer's own fit stands (the far
  baseline is already at about 40%).
- **SKIP**: a plain button of normal size (20 px, 44/48 tall): wide at the top right corner
  (moved in beside a linear meter that reaches the header row); upright the bottom corner
  away from the meter (the right beside the clock, the left beside a linear meter at the
  right).
- **The hand-off** (`src/ui/cards.js` `shortCard`, `src/ui/handoff-words.js`): a short
  card at the foot of the screen, at most 420 px wide: the title (card title type), one
  line (Inter 18 px), one go button across it (THROW; READY before a raise or punishment
  by hand; WATCH for a turn this browser only watches). No turn number, no map; the header
  shows whole over the dim. Someone else's turn on a shared pitch is the same card as a
  banner at the top, the pitch live under it.
- **The computer's turn**: no card. The header, the meter at half strength and its prompt
  as a WATCH tab on the computer's team colour (marigold with ink type, violet with paper
  type); no WATCH pill. The same for any turn this player watches.
- **The coach** (`src/game/coach.js`, `hud.js` `showCoach`): one inverted ink chip
  (radius 6, Inter 800 15 px capitals) 8 px over the prompt, the SLOW lead on its own line
  inside it; centred over the clock's prompt (moved over, not squeezed, by an open plate
  beside it; on a wide screen kept to the clock's own column, 8 px either side); beside a
  wide screen's linear meter it hangs 8 px under the tab, as before.

## The raise view

The raise screen's camera (`src/game/scenes.js` `raiseCamera`, `tune`) looks across the
lying kubb from the defender's side. Since web 0.17.0 it stands twice as far off (the
owner, 2026-11-22: "When raising kubbs the camera view is too close. We need to see
about twice as much to know how to raise them."): **2.3 m** back from the kubb across
its length and **2.1 m** up (1.15 and 1.05 before), looking at a point **0.24 m** toward
the camera from the kubb (0.12), the same lens (focal 520 on the 400 x 240 frame). The
angle down is the same, so twice the ground shows in every direction round the kubb: its
neighbours, the lines near it and often the king. A tall canvas still zooms the frame
1.8 times across (`game.js` `tune.raiseZoom`), its middle at 42% of the height; a wide
one takes the renderer's fit. The kubb is drawn half as big as before:

| window                  | kubb drawn (long x across) | touch target with the 24 px slop |
| ----------------------- | -------------------------- | -------------------------------- |
| 390 x 844 (upright)     | 45 x 29 px                 | 93 x 77 px                       |
| 402 x 665 (upright)     | 46 x 30 px                 | 94 x 78 px                       |
| 844 x 390 (on its side) | 42 x 27 px                 | 90 x 75 px                       |
| 1280 x 800              | 82 x 53 px                 | 130 x 101 px                     |

The target is the drawn kubb plus **24 px** all round (`raise-touch.js` `tune.margin`),
never under 44 px across; the drag that tips it all the way is 1.1 times its drawn
length, never under 90 px. The end numbers (17 px circles) stand **4 px** past their
footprint's outer edge on the screen (`tune.labelR0`, `labelGap`), so however small the
kubb is drawn they never sit on the footprint; a tap within 40 px of one takes that end.
On a phone on its side the panel's bar (80 px) stays under both numbers and the
punishment half's near baseline (`tests/game/layout.test.mjs`). The punishment view is
unchanged: it already shows the whole half the kubb may go in.

## Watching a raise

Since web 0.17.0 (the owner, 2026-11-22: "When you hit auto to raise kubbs you should
watch the computer raise them."), every raise the player does not make by hand is shown
on the raise view (above), each kubb tipped up onto the end it stands on with the same
tip the hand's drag draws, one after another (`src/game/lift.js`, the Game's `lift`
phase):

- **Watched now**: every raise that comes as a `raise` action with its raise need, the
  clip drawn from the need's own poses (the engine's, in the raise view's frame): AUTO,
  AUTO ALL, REST OF GAME and MENU's Raising: Automatic in a match that raises by hand
  (the page sends the actions itself); any `raise` another browser sends on a shared
  pitch (the other player's, by hand or not, or the computer's seat there); and a
  replay's raises (its log's actions, each with the need before it). A raise made by
  hand here is not shown again.
- **Waiting for the engine**: the kubbs the engine raises itself between a turn's last
  kubb thrown in and its first baton (a match started with Raising: Automatic, the
  computer's own raises against you, watching the computer). They come with no need and
  no action, so they stand at once, as before web 0.17.0. `lift.js` `settledClips` is
  their seam: it takes the throw need's `setup.settled` and returns no clips until the
  engine fills it (engine 0.16.0: each kubb raised, its id, the end chosen, and its
  lying and standing poses in the frame the raise view draws in). The page never works
  them out itself: that would mean turning the pitch in JavaScript.
- **The pace** (`lift.js` `tune`, `liftPace`; `pacing.js` `autoRaiseWait`): the first
  kubb of a turn's automatic raise lies **0.4 s** on the raise view, then each kubb takes
  a beat of **0.5 s** (its tip **70%** of the beat, eased, then it stands; a kubb a
  crowded raise moved slides to its spot in half the rest), shorter when there are many
  so the whole raise is **4 s** at most (beat = min(0.5, 3.6 / kubbs), never under
  0.18). The engine's own raises play the same way, 0.4 s first. Before web 0.17.0 each
  automatic raise stood the kubb at once after 0.7 s.
- **Skipping.** A tap anywhere or any key (not Tab or Shift) ends it at once, and the
  rest of that turn's automatic raises stand with no wait and no tip.
- **Never holding the match.** The action is applied, and sent, before its clip plays:
  the engine's actions and their order are what they were. Actions that arrive during a
  clip wait behind it as they do behind a throw's playback: a shared pitch holds its own
  queue while the phase is `lift` (`Pitch.drain`), so each action is still applied by
  the Game and checked against its committed hash when its turn comes, and each one
  waiting makes the clip run 2 times faster more (1 + 2 x waiting, `Game.backlog`), so a
  shared pitch's other browsers never fall behind. A hidden tab shows none (its steps are quiet), and the
  watching pace (zen) adds its own pause after.
- **Reduced motion**: no tip: each kubb lies for half its beat, then stands where the
  engine put it, still one at a time.
- **The engine** (0.15.1) puts `setup.settled` on the throw need for "raised and
  punishment kubbs placed before this throw", but core/match keeps it on the match, not
  the setup, so it is never filled. Engine 0.16.0 is to fill it as above; the web wires
  it into `settledClips` when it moves to that engine.

## Scenes, the Kid line, rings and the spin (engine 0.14 and 0.15)

docs/SCENES.md has the looks; these are the numbers a second client matches.

- **Black & White's tokens** (`MONO_SKIN` in `src/render/mono.js`): ink `#000000`, paper,
  field, baton, wood and the plates `#ffffff`; the go button black with white type
  (`--accent`, `--on-accent`); Team A white (circles on the minimap) and Team B black
  (squares); the meter's bands black, told apart by their shapes alone (the power band
  striped, the release band solid, the overpowered zone cross-hatched). The dim under a
  card is a 50% checker of black 2 px squares, never a grey. On the pitch every grey is
  an 8 by 8 dither pattern drawn at half a frame px a bit: grass the Playdate's tufts,
  sand a stipple, snow a sparkle; Team A's band a checker, Team B's black.
- **The Kid line** (`src/render/world.js`): dots 5 cm long, 9 cm apart, across the pitch
  at `kidY` in the line colour (drawn once, as the advantage line, where the two meet);
  a cone at each end 2.85 m from the middle, 30 cm tall, orange `#ff7a1f` with a white
  band and the ink line (Black & White: white with black). On the minimap ten dots and
  two small cones off the sidelines (`HUD.kidCone`).
- **Rings** (`src/render/impacts.js`, Techno): from 6 cm to 0.22 m + 0.17 m per m/s of
  the strike's `speed`, at most 0.95 m, over 0.75 s of the throw's clock, easing out and
  fading; a 1.4 CSS px core and two glows (7 px at 16%, 3.5 px at 30%) in the piece's
  side's light (A `#ffc94a`, B `#cf8bff`, the king `#ff5c9d`, a baton `#8fefff`); not
  drawn nearer the camera than 2.2 m. Reduced motion: held at 45% of the last radius,
  fading. **Puffs** (Beach, Minnesota): strikes from 1.4 m/s, 0.55 s, three inked discs of
  4.5 cm (times the strike's weight), never over 11 CSS px a disc.
- **The spin** (`spinAmount` in `src/render/scenes.js`): a piece's turn since the frame
  shown before, split into its twist about the long axis and its swing; drawn as a spin
  from a 30 degree twist a frame (fully at 50; a baton's twist never) or a 60 degree swing
  (fully at 100): four solid in-between poses under its own pose, which fades to 45% at
  full spin (not in Black & White).

## Words

| Where          | Words                                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| header line    | `Turn 4 · baton 2 of 6`, `· 2 field kubbs`, `· at the king`; practice `Batons · 5 base kubbs`, `Kubbs · target 2.3 m` (shown in capitals)                                                                                                                                                                                                                                    |
| header numbers | spoken `Kubbs standing: Mighty Maple 5, Computer 5` (field and base kubbs in each half)                                                                                                                                                                                                                                                                                      |
| scene names    | the engine's (its Scene row and `scenes()`; `SCENE_NAMES` in `src/render/scenes.js` holds the same): Park, Beach, Camping, Techno, Minnesota, Tournament, Black & White (ids `day`, `beach`, `night`, `neon`, `minnesota`, `tournament`, `bw`)                                                                                                                               |
| computer level | Kid, Beginner, Club, Pro (the engine's values; the row's label "Computer level")                                                                                                                                                                                                                                                                                             |
| Kid match      | hand-off kicker `Kid match · throw from the cones`, the king shot `Kid match · the king from your line`, a raise `Kid match` (`KID_LINES`); flags KING BACK UP, OUT TWICE: PLACED, and a counted helicopter's own `1 DOWN` or `MISS`; STAND `MIDDLE, ON THE KID LINE`, `Stand anywhere from behind your line up to the Kid line.`; the rail `KID LINE  2.0 M` (the engine's) |
| menu           | SETTINGS, SCORE SHEET, HOW TO THROW, FEEDBACK, Raising (By hand, Automatic), BACK TO THE MATCH, BACK TO THE PITCH, RESIGN, HOME                                                                                                                                                                                                                                              |
| settings       | Settings, DONE                                                                                                                                                                                                                                                                                                                                                               |
| winner         | REMATCH, WATCH REPLAY, SCORE SHEET, SHARE, HOME                                                                                                                                                                                                                                                                                                                              |
| share card     | Share this match, COPY LINK, Copied the link., Could not copy. The link is shown to copy., MAKE A HIGHLIGHT REEL, EMBED, BACK                                                                                                                                                                                                                                                |
| name row       | SHUFFLE; stepper labels Previous first word, Next first word, First word (and second, third)                                                                                                                                                                                                                                                                                 |
| welcome        | `WELCOME_WORDS` in `src/ui/welcome.js`                                                                                                                                                                                                                                                                                                                                       |
| lobby          | You are, WATCH INSTEAD, HOME, START                                                                                                                                                                                                                                                                                                                                          |
| tray           | ARC 22°, TILT 7R, TILT 0, SPIN 1.3L, STAND; spoken Arc, 22 degrees; Tilt, 7 degrees right; Tilt, none; Stand, middle, on the line; the group Throw set-up                                                                                                                                                                                                                    |
| meter          | the distance tab `8 M`; WATCH on the thrower's team colour                                                                                                                                                                                                                                                                                                                   |
| verdict        | SHORT, LONG, LOW, HIGH, SLOW, SHAKY, PULLED LEFT, PULLED RIGHT (off, with arrows); POWER ON, ARC ON, STEADY, STRAIGHT; spoken `Short. Miss. Arc on, steady, straight. 50 cm away.` (the rest text last, when shown)                                                                                                                                                          |
| hand-off       | Your turn, `Lucky Larch’s turn`; `HANDOFF_LINES` in `src/ui/handoff-words.js`: `Six batons. Two field kubbs to clear first.`, `Six batons. Aim for the base kubbs.`, `Six batons. Go for the king.`, `Throw three kubbs into the other half.`, `Stand your kubbs up.`, `Place one punishment kubb.`; THROW, READY, WATCH                                                     |
| coach          | PULL BACK TO THE STRIPES, NO RUSH GOING BACK, NOW FLICK FAST AND STOP ON THE SOLID MARK, led by SLOW FLICK. FLICK FASTER.                                                                                                                                                                                                                                                    |
| stand-ins      | prompt `Wind back, 8 metres`; meter `Clock meter. Draw back to the stripes, then flick and let go on the solid mark.` (or `Linear meter`, `shown for watching only.`); minimap `Map of the pitch: Mighty Maple 5 kubbs standing, Computer 4. The target is 8 metres out.`                                                                                                    |
| link preview   | `<host> is waiting for players · Kubb: Throwing Wood`; card `CHEERFUL CEDAR` over `IS WAITING FOR PLAYERS`; `IN PLAY · TURN 7 · TAP TO WATCH`; `<WINNER> WON · 9 TURNS · TAP TO WATCH` (with a replay)                                                                                                                                                                       |
