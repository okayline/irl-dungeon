# irl-dungeon

4Dungeon in the real world: every ~100 m cell is a dungeon that grows over time. One key a day opens one locked door; everything else is free to explore.

**Status: v0.03.** The page shows a cell's floor (empty rooms) on 4Dungeon's screen with its minimap, and you can turn and walk through open doors. Everyone sees the same floor in a cell. Step into a locked door twice (it asks first) to spend the day's key on it; walk every room of a wing and the first to do so is sealed on the ledger. Your doors are kept on the server, so they come back on reload and on your other devices. A first find can be signed with a two-word name (rerollable), and cells can be saved in [S]AVE. Underneath is cookie players, save codes, passkeys, and a chained, tamper-evident ledger. See `DESIGN.md` for what is settled and what is open.

Live at **https://irl.88x31.app** (a custom domain on the `irl-dungeon` Worker).

## Run it

```
npm test                  # 161 tests (Node 22+, built-in SQLite standing in for D1)
npx wrangler d1 create irl-dungeon-db     # paste the id into wrangler.jsonc
npx wrangler d1 execute irl-dungeon-db --local --file=schema.sql
npx wrangler dev
```

## What's here

- `src/ledger.js`: the hash chain (`seal`, `verifyChain`).
- `src/worker.js`: the API, and serves `public/`.
- `public/floor.js`: 4Dungeon's floor generator and minimap, trimmed (empty rooms). In `public/` because the page and the Worker both use it.
- `public/screen.js`, `public/walk.js`, `public/index.html`: 4Dungeon's 80-column screen, trimmed to what this game has; turning and walking; the page. The page starts at the server's rough guess from the connection (no location prompt) and you walk out of a cell's start room into the next one; L uses the browser's location where it's allowed, and `?cell=<H3 id at resolution 10>` opens any cell, e.g. `/?cell=8a2a1072b59ffff`.
- `public/play.js`: the page's side of the game: opening a cell (your doors from the server), asking before the key is spent, unlocking, and reporting a wing walked in full.
- `public/account.js`: the SAVE panel (save codes and passkeys), inside the 3D view; press S. `test/e2e/save.py` checks it in a real browser against the real Worker (run by hand; needs python3 playwright).
- `public/place.js`, `public/vendor/`: position to cell id (the coordinates are dropped at once), the server's rough guess, the next cell over, and Uber's h3-js (Apache-2.0).
- `src/names.js`: the two-word names (dawn-baton's lists).
- `src/travel.js`: the travel check (claims that would need impossible travel earn nothing for a while).
- `src/saves.js`, `src/passkeys.js`: save codes and passkeys, copied from dawn-baton.
- `src/items.js`: reads the shared item table (D1 `items-db`, bound as `ITEMS`; repo okayline/dungeon-items), read only.
- `src/worker.js` also keeps `walked_rooms` (private: the rooms a player has stood in, sent in batches by the page; POST /api/rooms) and answers POST /api/area (new / entered / cleared for a cell and the six around it). `public/area.js` draws the zoomed-out AREA map from that.
- `src/copies.js`: numbers each find through the copy registry (the `Registry` entrypoint of the dungeon-items Worker, bound as `REGISTRY`). A find is saved first and numbered a moment later; one the registry couldn't number waits (`copy` empty) and is numbered on the next `/api/finds` or repeat search. Locally, `wrangler dev` needs the dungeon-items Worker running too; without it finds stay unnumbered.
- `src/search.js`, `src/deal.js`: what each room hides each day (copied from 4Dungeon's search), and the shuffled per-room-day decks that decide who gets which item.
- `public/found.js`, `public/invoke.js`: the "You found X!" window and the [I]NVOKE list.
- `schema.sql`: the database tables.
- `test/`: tests that try to break the rules (see `CLAUDE.md`).
- `public/fonts/`: VT323 and its license (SIL Open Font License).
