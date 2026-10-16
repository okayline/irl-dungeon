# irl-dungeon

4Dungeon in the real world: every ~100 m cell is a dungeon that grows over time. One key a day opens one locked door; everything else is free to explore.

**Status: foundation only.** The game isn't built yet. What exists is cookie players, save codes, passkeys, and a chained, tamper-evident ledger. See `DESIGN.md` for what is settled and what is open.

## Run it

```
npm test                  # 66 tests (Node 22+, built-in SQLite standing in for D1)
npx wrangler d1 create irl-dungeon-db     # paste the id into wrangler.jsonc
npx wrangler d1 execute irl-dungeon-db --local --file=schema.sql
npx wrangler dev
```

## What's here

- `src/ledger.js`: the hash chain (`seal`, `verifyChain`).
- `src/worker.js`: the API, and serves `public/`.
- `src/floor.js`: 4Dungeon's floor generator (copy).
- `src/saves.js`, `src/passkeys.js`: save codes and passkeys, copied from dawn-baton.
- `schema.sql`: the database tables.
- `test/`: tests that try to break the rules (see `CLAUDE.md`).
- `public/fonts/`: VT323 and its license (SIL Open Font License).
