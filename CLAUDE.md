# Working notes for irl-dungeon

- **Push only when the user says to.** Build and commit locally as asked. (When the Worker is connected to this repo, a push becomes a release.)
- **Stay in scope.** This is 4Dungeon in the real world (see `DESIGN.md`). No breath, no demons, no combat, and nothing else that wasn't asked for. If something is unclear, ask, or write it under "Open questions" in `DESIGN.md`. Don't invent features, and don't leave placeholder or fake data on screen.
- **Tests must try to break the rules.** `npm test` must pass before any commit. Work out expected values independently (`node:crypto`, hand-built bytes, raw SQL); never ask the code under test for its own answer. A new rule gets a test, and the test must fail when the rule is removed (try it: break the rule on purpose and watch the test fail). Passing tests are not proof by themselves.
- **The ledger is a hash chain.** Write to it only through `src/ledger.js` (`seal`, or `chainInserts` inside the same D1 batch as the change it records), so an action is saved if and only if it is on the ledger. Records never hold names, coordinates or exact times. Who did it goes in `player_id`, which is never published. Don't weaken `prev_hash UNIQUE`.
- **Privacy.** The server only ever sees H3 cell IDs. The browser drops the coordinates before anything is sent. Never store or log GPS.
- **Database changes** need a file in `migrations/`, `schema.sql` updated to match, and the live database migrated *before* the push that needs it.
- **No new dependencies** without asking. There are none today.
- **`src/saves.js` and `src/passkeys.js` are copies** from dawn-baton (which got them from scoundrel.exe and the 88x31 cLuB). Keep them identical apart from names, and put a fix in every repo that has them.
- Times in changelogs are Hawaii time (HST). The changelog starts with the first release.
- **`public/floor.js` is trimmed from** `daily-dungeon/floor.js` (43cebc2): the wing and door code is unchanged, but room contents and screen drawing are removed (rooms are empty for now). A fix to the wing or door code goes in both repos.
- **`public/screen.js` is trimmed from** `daily-dungeon/screen.js` (43cebc2): the frame, header, 3D view and width check are 4Dungeon's code; the panels and menu are this game's. Every line on screen must show something real (no filler stats), and every menu item must work.
