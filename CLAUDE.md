# Working notes for irl-dungeon

## Rules for every repo

- **Push only when the user says to.** Build and commit locally as asked.
- **Ask before adding anything that wasn't asked for** (a button, a screen, a message, a page, a feature), even a small one. The owner would rather be asked than remove it later.
- **Keep testing quick: 2-3 mins at most. Don't test for edge cases.**
- **No new dependencies** without asking.
- Times in changelogs are Hawaii time (HST).


- **Push only when the user says to.** Build and commit locally as asked. (When the Worker is connected to this repo, a push becomes a release.)
- **Ask before adding anything that wasn't asked for** (a button, a screen, a message, a page, a feature), even a small one. The owner would rather be asked than remove it later.
- **Stay in scope.** This is 4Dungeon in the real world (see `DESIGN.md`). No breath, no demons, no combat, and nothing else that wasn't asked for. If something is unclear, ask, or write it under "Open questions" in `DESIGN.md`. Don't invent features, and don't leave placeholder or fake data on screen.
- **Keep testing quick: 2-3 minutes in total, at most.** `npm test` must pass before any commit, plus one quick check of whatever changed. Don't run big batteries, repeated or parallel simulations, or "break the rule on purpose" experiments unless asked; if a check would take longer than that, say so and ask first. Work out expected values independently (`node:crypto`, hand-built bytes, raw SQL), not from the code under test. A new rule gets one test.
- **The ledger is a hash chain.** Write to it only through `src/ledger.js` (`seal`, or `chainInserts` inside the same D1 batch as the change it records), so an action is saved if and only if it is on the ledger. Records never hold names, coordinates or exact times. Who did it goes in `player_id`, which is never published. Don't weaken `prev_hash UNIQUE`.
- **Privacy.** The server only ever sees H3 cell IDs. The browser drops the coordinates before anything is sent (`public/place.js` turns a position into a cell id and returns only that). Never store or log GPS.
- **Database changes** need a file in `migrations/`, `schema.sql` updated to match, and the live database migrated *before* the push that needs it.
- **No new dependencies** without asking. The only outside code is `public/vendor/h3-js.es.js` (Apache-2.0, copied in with the owner's OK; see `public/vendor/README.txt`). Don't edit it.
- **Save codes and passkeys are the shared Accounts service** (dungeon-items `ACCOUNTS.md`, bound here as `ACCOUNTS`). This game only keeps its own players and cookie; `src/saves.js` still has the token, session and rate-limit helpers (copied from dawn-baton), and `save_codes`/`passkeys` in `schema.sql` are legacy: old codes move to the account when their player is next seen. Deploy dungeon-items (with migration 003 run) first.
- Times in changelogs are Hawaii time (HST). The changelog starts with the first release. Every release bumps `VERSION` in `public/screen.js` and adds a `CHANGELOG.md` entry (a test checks they match). Also add the detailed dev entry to `irl-dungeon/changelog-v0.1.md` in the dungeon-notes repo (decisions, code, findings, tests, open questions); `CHANGELOG.md` here stays short and in players' words.
- **`public/floor.js` is trimmed from** `daily-dungeon/floor.js` (43cebc2): the wing and door code is unchanged, but room contents and screen drawing are removed (rooms are empty for now). A fix to the wing or door code goes in both repos.
- **`public/screen.js` is trimmed from** `daily-dungeon/screen.js` (43cebc2): the frame, header, 3D view and width check are 4Dungeon's code; the panels and menu are this game's. Every line on screen must show something real (no filler stats), and every menu item must work.
- **Items come from the shared item table** (repo okayline/dungeon-items, D1 `items-db`, bound here as `ITEMS`, read only: `src/items.js`). A find stores the item's id, which never changes. This game never writes to `items-db` directly: items are added from the dungeon-items repo, and a find's copy number comes from the shared copy registry (`REGISTRY` service binding to the dungeon-items Worker, `src/copies.js`).
- **Search rules are copied from 4Dungeon** (`src/search.js`, the MISSES and NOISES lines in `public/play.js`) without breath, heat, demons and the moon. Dealing is `src/deal.js`: a shuffled deck of one rarity per room-day, so two players never get the same kind in a room on a day.

## Working rules

The same seventeen rules are in every Dungeons repo and in the project instructions. "ryan" is the owner.

**Honesty (never broken)**
1. Never lie. State as fact only what you opened, read or ran this turn. Everything else gets "Not checked" in the same sentence, or isn't said.
2. Don't infer from the surface. READMEs, titles, file names, comments, timestamps, summaries and earlier replies are leads to check, not facts.
3. Quote it or don't claim it. Don't describe how code, a table, a page or a ledger works, or say something exists or is missing, until you have opened it in this conversation. Give file and line, quoted.
4. Opinions are labelled "my opinion". Hedges like "should work" or "probably" are labelled "not checked".
5. Every answer about code or data ends with "Opened:" (files and lines read this turn) and "Not checked:". If "Opened:" would be empty, open the files before answering.
6. Check first, then reply once. No "I'll look into it" message followed by an answer from memory.
7. If you were wrong, the first sentence says what you said, what is true, and the source.
8. Never say something was done, pushed or fixed unless you saw it succeed. Say what ran and what didn't, and report failures plainly.

**Searching**
9. Search before saying "no": project chat and threads, all eight repos, and the live state. List what was and wasn't searched. Say "I couldn't find it", never "that isn't true", and never "everything". Treat ryan's memory as true until a search disproves it.
10. Before recommending anything new, search the code for whether it already exists, and say what you found.

**Design and proposals**
11. Give honest design answers, including "this isn't worth building". Give one recommendation. Mention "do nothing" only if it is actually the best option. Never tell ryan to play or playtest the game.
12. Before proposing, name the goal it serves (4Dungeon: design doc section 15), what it adds, takes away and touches, what it replaces or lets us delete, what already exists, and how it would most likely fail. No goal means no proposal. Propose the smallest version first.

**Building**
13. Build, push, change tables or scheduled tasks, or add a dependency only when ryan asks. Don't touch anything not asked for, and list extras for approval.
14. Delete, don't park: no new flags or "off for now" code. Fix a shared problem once, in the shared place.
15. Each changelog line says what was removed as well as what was added.

**Working with ryan**
16. Silence means "not now": no nagging, and raise each item at most once.
17. Disagree before building, not after. A bare "ok" to a long answer is not approval of everything in it.
