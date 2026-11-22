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
| touch      | 44 px, 48 on a touchscreen | every control but the plan's plates (next stage)       |
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
  Inter 700 16) and MENU (2 px line, no shadow); 6 px between them. Wide: at most
  max(44vw, 260 px). Tall: the width the minimap leaves, 8 px short of it. 78 px tall with
  a mouse, 82 px to a finger (`layout.js` `railBox` 92 with the 10 px over it).

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

## Words

| Where          | Words                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| header line    | `Turn 4 · baton 2 of 6`, `· 2 field kubbs`, `· at the king`; practice `Batons · 5 base kubbs`, `Kubbs · target 2.3 m` (shown in capitals)                                                              |
| header numbers | spoken `Kubbs standing: Mighty Maple 5, Computer 5` (field and base kubbs in each half)                                                                                                                |
| scene names    | `SCENE_NAMES` in `src/render/scenes.js`: Day, Night, Neon (Park, Camping, Techno is the owner's to decide)                                                                                             |
| menu           | SETTINGS, SCORE SHEET, HOW TO THROW, FEEDBACK, Raising (By hand, Automatic), BACK TO THE MATCH, BACK TO THE PITCH, RESIGN, HOME                                                                        |
| settings       | Settings, DONE                                                                                                                                                                                         |
| winner         | REMATCH, WATCH REPLAY, SCORE SHEET, SHARE, HOME                                                                                                                                                        |
| share card     | Share this match, COPY LINK, Copied the link., Could not copy. The link is shown to copy., MAKE A HIGHLIGHT REEL, EMBED, BACK                                                                          |
| name row       | SHUFFLE; stepper labels Previous first word, Next first word, First word (and second, third)                                                                                                           |
| welcome        | `WELCOME_WORDS` in `src/ui/welcome.js`                                                                                                                                                                 |
| lobby          | You are, WATCH INSTEAD, HOME, START                                                                                                                                                                    |
| link preview   | `<host> is waiting for players · Kubb: Throwing Wood`; card `CHEERFUL CEDAR` over `IS WAITING FOR PLAYERS`; `IN PLAY · TURN 7 · TAP TO WATCH`; `<WINNER> WON · 9 TURNS · TAP TO WATCH` (with a replay) |
