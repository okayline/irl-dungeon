# irl-dungeon

4Dungeon in the real world: every ~100 m cell is a dungeon that grows over time. One key a day opens one locked door; everything else is free to explore.

**Status: v0.03.** The page shows a cell's floor (empty rooms) on 4Dungeon's screen with its minimap, and you can turn and walk through open doors. Everyone sees the same floor in a cell. The server has the day's key, unlocking a door, and first finders of a wing (sealed on the ledger), but the page doesn't use them yet. Underneath is cookie players, save codes, passkeys, and a chained, tamper-evident ledger. See `DESIGN.md` for what is settled and what is open.

Live at **https://irl.88x31.app** (a custom domain on the `irl-dungeon` Worker).

## Run it

```
npm test                  # 133 tests (Node 22+, built-in SQLite standing in for D1)
npx wrangler d1 create irl-dungeon-db     # paste the id into wrangler.jsonc
npx wrangler d1 execute irl-dungeon-db --local --file=schema.sql
npx wrangler dev
```

## What's here

- `src/ledger.js`: the hash chain (`seal`, `verifyChain`).
- `src/worker.js`: the API, and serves `public/`.
- `public/floor.js`: 4Dungeon's floor generator and minimap, trimmed (empty rooms). In `public/` because the page and the Worker both use it.
- `public/screen.js`, `public/walk.js`, `public/index.html`: 4Dungeon's 80-column screen, trimmed to what this game has; turning and walking; the page. The page starts at the server's rough guess from the connection (no location prompt) and you walk out of a cell's start room into the next one; L uses the browser's location where it's allowed, and `?cell=<H3 id at resolution 10>` opens any cell, e.g. `/?cell=8a2a1072b59ffff`.
- `public/account.js`: the SAVE panel (save codes and passkeys), inside the 3D view; press S. `test/e2e/save.py` checks it in a real browser against the real Worker (run by hand; needs python3 playwright).
- `public/place.js`, `public/vendor/`: position to cell id (the coordinates are dropped at once), the server's rough guess, the next cell over, and Uber's h3-js (Apache-2.0).
- `src/travel.js`: the travel check (claims that would need impossible travel earn nothing for a while).
- `src/saves.js`, `src/passkeys.js`: save codes and passkeys, copied from dawn-baton.
- `schema.sql`: the database tables.
- `test/`: tests that try to break the rules (see `CLAUDE.md`).
- `public/fonts/`: VT323 and its license (SIL Open Font License).
