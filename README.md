# irl-dungeon

4Dungeon in the real world: every ~100 m cell is a dungeon that grows over time. One key a day opens one locked door; everything else is free to explore.

**Status: foundation plus a first screen.** The page shows a cell's floor (empty rooms) on 4Dungeon's screen with its minimap, and you can turn and walk through open doors. Unlocking, the day's key and the ledger entries for it aren't built yet. What exists underneath is cookie players, save codes, passkeys, and a chained, tamper-evident ledger. See `DESIGN.md` for what is settled and what is open.

Live at **https://irl.88x31.app** (a custom domain on the `irl-dungeon` Worker).

## Run it

```
npm test                  # 123 tests (Node 22+, built-in SQLite standing in for D1)
npx wrangler d1 create irl-dungeon-db     # paste the id into wrangler.jsonc
npx wrangler d1 execute irl-dungeon-db --local --file=schema.sql
npx wrangler dev
```

## What's here

- `src/ledger.js`: the hash chain (`seal`, `verifyChain`).
- `src/worker.js`: the API, and serves `public/`.
- `public/floor.js`: 4Dungeon's floor generator and minimap, trimmed (empty rooms). In `public/` because the page and the Worker both use it.
- `public/screen.js`, `public/walk.js`, `public/index.html`: 4Dungeon's 80-column screen, trimmed to what this game has; turning and walking; the page. Press L to use the browser's location, or open it with `?cell=<H3 id at resolution 10>`, e.g. `/?cell=8a2a1072b59ffff`.
- `public/account.js`: the SAVE panel (save codes and passkeys), inside the 3D view; press S. `test/e2e/save.py` checks it in a real browser against the real Worker (run by hand; needs python3 playwright).
- `public/place.js`, `public/vendor/`: position to cell id (the coordinates are dropped at once), and Uber's h3-js (Apache-2.0).
- `src/saves.js`, `src/passkeys.js`: save codes and passkeys, copied from dawn-baton.
- `schema.sql`: the database tables.
- `test/`: tests that try to break the rules (see `CLAUDE.md`).
- `public/fonts/`: VT323 and its license (SIL Open Font License).
