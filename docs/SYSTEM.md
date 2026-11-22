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
- **Scene tiles** (`src/ui/cards.js` `sceneTiles`): three in a row, 8 px apart, each the
  pitch drawn by the game at 96 by 56 (2x), its name under it in Inter 700 14 capitals;
  chosen: the name ink with paper type and the tile's 3 px shadow.
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

- **Play the computer**: the name row, a rule, Scene (three tiles), Computer level,
  Opening, Raising, Wind, Surface (until a scene decides the ground). No Kubbs row: the
  set is the scene's (the day Classic). HOME quiet at the left, START go at the right.
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
  SHAKY, a clock hand for SLOW; the on-target words as small chips after it (14 px). Upright
  the flag and chips stand left of the minimap; wide right of the header's end and short
  of a meter at the right edge, centred on the screen where that leaves room. A screen reader hears it once, the off word first
  (`verdictSpeech`).
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

## Words

| Where          | Words                                                                                                                                                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| header line    | `Turn 4 · baton 2 of 6`, `· 2 field kubbs`, `· at the king`; practice `Batons · 5 base kubbs`, `Kubbs · target 2.3 m` (shown in capitals)                                                                                                                                                                                |
| header numbers | spoken `Kubbs standing: Mighty Maple 5, Computer 5` (field and base kubbs in each half)                                                                                                                                                                                                                                  |
| scene names    | `SCENE_NAMES` in `src/render/scenes.js`: Park, Camping, Techno (ids `day`, `night`, `neon` unchanged)                                                                                                                                                                                                                    |
| menu           | SETTINGS, SCORE SHEET, HOW TO THROW, FEEDBACK, Raising (By hand, Automatic), BACK TO THE MATCH, BACK TO THE PITCH, RESIGN, HOME                                                                                                                                                                                          |
| settings       | Settings, DONE                                                                                                                                                                                                                                                                                                           |
| winner         | REMATCH, WATCH REPLAY, SCORE SHEET, SHARE, HOME                                                                                                                                                                                                                                                                          |
| share card     | Share this match, COPY LINK, Copied the link., Could not copy. The link is shown to copy., MAKE A HIGHLIGHT REEL, EMBED, BACK                                                                                                                                                                                            |
| name row       | SHUFFLE; stepper labels Previous first word, Next first word, First word (and second, third)                                                                                                                                                                                                                             |
| welcome        | `WELCOME_WORDS` in `src/ui/welcome.js`                                                                                                                                                                                                                                                                                   |
| lobby          | You are, WATCH INSTEAD, HOME, START                                                                                                                                                                                                                                                                                      |
| tray           | ARC 22°, TILT 7R, TILT 0, SPIN 1.3L, STAND; spoken Arc, 22 degrees; Tilt, 7 degrees right; Tilt, none; Stand, middle, on the line; the group Throw set-up                                                                                                                                                                |
| meter          | the distance tab `8 M`; WATCH on the thrower's team colour                                                                                                                                                                                                                                                               |
| verdict        | SHORT, LONG, LOW, HIGH, SLOW, SHAKY, PULLED LEFT, PULLED RIGHT (off, with arrows); POWER ON, ARC ON, STEADY, STRAIGHT; spoken `Short. Miss. Arc on, steady, straight.`                                                                                                                                                   |
| hand-off       | Your turn, `Lucky Larch’s turn`; `HANDOFF_LINES` in `src/ui/handoff-words.js`: `Six batons. Two field kubbs to clear first.`, `Six batons. Aim for the base kubbs.`, `Six batons. Go for the king.`, `Throw three kubbs into the other half.`, `Stand your kubbs up.`, `Place one punishment kubb.`; THROW, READY, WATCH |
| coach          | PULL BACK TO THE STRIPES, NO RUSH GOING BACK, NOW FLICK FAST AND STOP ON THE SOLID MARK, led by SLOW FLICK. FLICK FASTER.                                                                                                                                                                                                |
| stand-ins      | prompt `Wind back, 8 metres`; meter `Clock meter. Draw back to the stripes, then flick and let go on the solid mark.` (or `Linear meter`, `shown for watching only.`); minimap `Map of the pitch: Mighty Maple 5 kubbs standing, Computer 4. The target is 8 metres out.`                                                |
| link preview   | `<host> is waiting for players · Kubb: Throwing Wood`; card `CHEERFUL CEDAR` over `IS WAITING FOR PLAYERS`; `IN PLAY · TURN 7 · TAP TO WATCH`; `<WINNER> WON · 9 TURNS · TAP TO WATCH` (with a replay)                                                                                                                   |
