# irl-dungeon: working notes

## This repo

4Dungeon in the real world: every ~100 m cell is a dungeon that grows over time. One key a day opens one locked door; everything else is free to explore. Live at irl.88x31.app. `DESIGN.md` is the design. When the Worker is connected to this repo, a push becomes a release, so treat a push to `main` as one. The version is `VERSION` in `public/screen.js`; don't trust the status line in `README.md`.

**Scope**
- **Stay in scope.** This is 4Dungeon in the real world. No breath, no demons, no combat, and nothing else that wasn't asked for. If something is unclear, ask, or write it under "Open questions" in `DESIGN.md`.
- Don't invent features, and don't leave placeholder or fake data on screen. Every line on screen must show something real (no filler stats), and every menu item must work.

**Privacy and the ledger**
- **Privacy.** The server only ever sees H3 cell IDs. The browser drops the coordinates before anything is sent (`public/place.js` turns a position into a cell id and returns only that). Never store or log GPS.
- **The ledger is a hash chain.** Write to it only through `src/ledger.js` (`seal`, or `chainInserts` inside the same D1 batch as the change it records), so an action is saved if and only if it is on the ledger. Records never hold names, coordinates or exact times. Who did it goes in `player_id`, which is never published. Don't weaken `prev_hash UNIQUE`.

**Shared services**
- **Save codes and passkeys are the shared Accounts service** (dungeon-items `ACCOUNTS.md`, bound here as `ACCOUNTS`). This game only keeps its own players and cookie. `src/saves.js` still has the token, session and rate-limit helpers (copied from dawn-baton), and `save_codes`/`passkeys` in `schema.sql` are legacy: old codes move to the account when their player is next seen.
- **Items come from the shared item table** (repo okayline/dungeon-items, D1 `items-db`, bound here as `ITEMS`, read only: `src/items.js`). A find stores the item's id, which never changes. This game never writes to `items-db` directly: items are added from the dungeon-items repo, and a find's copy number comes from the shared copy registry (`REGISTRY` service binding to the dungeon-items Worker, `src/copies.js`).

**Code copied from 4Dungeon**
- `public/floor.js` is trimmed from `daily-dungeon/floor.js`: the wing and door code is unchanged, but room contents and screen drawing are removed (rooms are empty for now). A fix to the wing or door code goes in both repos.
- `public/screen.js` is trimmed from `daily-dungeon/screen.js`: the frame, header, 3D view and width check are 4Dungeon's code; the panels and menu are this game's.
- Search rules are copied from 4Dungeon (`src/search.js`, the MISSES and NOISES lines in `public/play.js`) without breath, heat, demons and the moon. Dealing is `src/deal.js`: a shuffled deck of one rarity per room-day, so two players never get the same kind in a room on a day.
- clutch-feed-tilt keeps a byte-for-byte copy of `public/floor.js`, so a change there has to be copied over whole.

**Dependencies.** The only outside code is `public/vendor/h3-js.es.js` (Apache-2.0, copied in with the owner's OK; see `public/vendor/README.txt`). Don't edit it.

**Database changes** need a file in `migrations/`, `schema.sql` updated to match, and the live database migrated *before* the push that needs it.

**Testing and releases**
- `npm test` must pass before any commit, plus one quick check of whatever changed. Don't run big batteries, repeated or parallel simulations, or "break the rule on purpose" experiments unless asked. Work out expected values independently (`node:crypto`, hand-built bytes, raw SQL), not from the code under test. A new rule gets one test.
- Every release bumps `VERSION` in `public/screen.js` and adds a `CHANGELOG.md` entry (a test checks they match). `CHANGELOG.md` here stays short and in players' words. The changelog starts with the first release. Also add the detailed dev entry (decisions, code, findings, tests, open questions) to `irl-dungeon/changelog-v0.1.md` in the dungeon-notes repo.
