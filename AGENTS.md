# AGENTS.md: kubb.thingelstad.xyz

`CLAUDE.md` is a symlink to this file. Domain rules are in [`../AGENTS.md`](../AGENTS.md);
AWS and secret rules one level above that.

Kubb: Throwing Wood on the web: the Playdate game's own Lua core running in the browser,
with multiplayer on a link. The design is `docs/DESIGN.md`; read it first. The Playdate
game is the sibling checkout `../../playdate-kubb` (private; its `docs/DESIGN.md` and
`AGENTS.md` are the reference for how the game plays).

## Rules

- **`vendor/core/` is never edited.** It is `playdate-kubb/source/core` byte for byte
  (`npm run vendor:sync`, `npm run vendor:check`). Change the game's behaviour on the web
  by setting the core's `tune` tables from `lua/web/`, or fix it in playdate-kubb and
  sync. Never write in the playdate-kubb checkout from here.
- **Manage the repository as if it were public** (the Playdate game's rule): no email
  addresses, device serials, home-directory paths or secrets in files or commits. Write
  the AWS account as `<account>` in Markdown.
- **Game logic in Lua, tested on the desktop** (`/opt/homebrew/opt/lua@5.4/bin/lua5.4`);
  JavaScript draws, listens and talks to the network. JS and Lua exchange JSON strings in
  a few coarse calls a frame.
- **The thrower's view frame everywhere** (core/frame): JS never flips the pitch.
- Dev servers bind to 127.0.0.1 and are stopped when the work is done.
- No italics on sans-serif type. Type and tokens come from `../shared/`.
