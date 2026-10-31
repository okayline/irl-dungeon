# irl-dungeon: working notes

## This repo

4Dungeon in the real world: every ~100 m cell is a dungeon that grows over time. One key a day opens one locked door; everything else is free to explore. Live at irl.88x31.app. `DESIGN.md` is the design. When the Worker is connected to this repo, a push becomes a release, so treat a push to `main` as one. The `README.md` still says "Status: v0.21"; the real version is `VERSION` in `public/screen.js`.

**Scope**
- **Stay in scope.** This is 4Dungeon in the real world. No breath, no demons, no combat, and nothing else that wasn't asked for. If something is unclear, ask, or write it under "Open questions" in `DESIGN.md`.
- Don't invent features, and don't leave placeholder or fake data on screen. Every line on screen must show something real (no filler stats), and every menu item must work.

**Privacy and the ledger**
- **Privacy.** The server only ever sees H3 cell IDs. The browser drops the coordinates before anything is sent (`public/place.js` turns a position into a cell id and returns only that). Never store or log GPS.
- **The ledger is a hash chain.** Write to it only through `src/ledger.js` (`seal`, or `chainInserts` inside the same D1 batch as the change it records), so an action is saved if and only if it is on the ledger. Records never hold names, coordinates or exact times. Who did it goes in `player_id`, which is never published. Don't weaken `prev_hash UNIQUE`.

**Shared services**
- **Save codes and passkeys are the shared Accounts service** (dungeon-items `ACCOUNTS.md`, bound here as `ACCOUNTS`). This game only keeps its own players and cookie. `src/saves.js` still has the token, session and rate-limit helpers (copied from dawn-baton), and `save_codes`/`passkeys` in `schema.sql` are legacy: old codes move to the account when their player is next seen. Deploy dungeon-items (with migration 003 run) first.
- **Items come from the shared item table** (repo okayline/dungeon-items, D1 `items-db`, bound here as `ITEMS`, read only: `src/items.js`). A find stores the item's id, which never changes. This game never writes to `items-db` directly: items are added from the dungeon-items repo, and a find's copy number comes from the shared copy registry (`REGISTRY` service binding to the dungeon-items Worker, `src/copies.js`).

**Code copied from 4Dungeon**
- `public/floor.js` is trimmed from `daily-dungeon/floor.js` (43cebc2): the wing and door code is unchanged, but room contents and screen drawing are removed (rooms are empty for now). A fix to the wing or door code goes in both repos.
- `public/screen.js` is trimmed from `daily-dungeon/screen.js` (43cebc2): the frame, header, 3D view and width check are 4Dungeon's code; the panels and menu are this game's.
- Search rules are copied from 4Dungeon (`src/search.js`, the MISSES and NOISES lines in `public/play.js`) without breath, heat, demons and the moon. Dealing is `src/deal.js`: a shuffled deck of one rarity per room-day, so two players never get the same kind in a room on a day.
- clutch-feed-tilt keeps a byte-for-byte copy of `public/floor.js`, so a change there has to be copied over whole.

**Dependencies.** The only outside code is `public/vendor/h3-js.es.js` (Apache-2.0, copied in with the owner's OK; see `public/vendor/README.txt`). Don't edit it.

**Database changes** need a file in `migrations/`, `schema.sql` updated to match, and the live database migrated *before* the push that needs it.

**Testing and releases**
- `npm test` must pass before any commit, plus one quick check of whatever changed. Don't run big batteries, repeated or parallel simulations, or "break the rule on purpose" experiments unless asked. Work out expected values independently (`node:crypto`, hand-built bytes, raw SQL), not from the code under test. A new rule gets one test.
- Every release bumps `VERSION` in `public/screen.js` and adds a `CHANGELOG.md` entry (a test checks they match). `CHANGELOG.md` here stays short and in players' words. The changelog starts with the first release. Also add the detailed dev entry (decisions, code, findings, tests, open questions) to `irl-dungeon/changelog-v0.1.md` in the dungeon-notes repo.

<!-- BEGIN SHARED RULES v8 (2026-10-31). One copy of this block is in every Dungeons repo's CLAUDE.md. The source is dungeon-notes/SHARED-RULES.md. Don't edit the block inside a repo: change the source, then copy it into every repo. -->
## Working rules (shared by every repo)

"kura" is the owner. "4Dungeon" is the repo `daily-dungeon`. Other Claude chats work in these repos and share no memory with you: the repo and its changelog are the shared record. A repo section above beats a rule below, except rules 1 to 4.

**Honesty (never broken)**
1. Never lie. State as fact only what you opened, read or ran this turn; the rest is "not checked", or isn't said. Label opinions "my opinion". "Should work" and "probably" count as not checked.
2. Answers about code or data end with "Not checked:".
3. Check first, then reply once. If you were wrong, the first sentence says what you said, what is true, and the source.
4. Never say something was done, pushed or fixed unless you saw it succeed. Report failures plainly.

**Searching**
5. Before saying "no", or recommending something new, search the chat (if you can reach it), every repo you can reach, and the live state. Say what you searched and what you found. Say "I couldn't find it", never "that isn't true". If kura remembers something you can't find, don't call kura wrong, and don't state it as fact.

**Design**
6. Give honest answers, including "this isn't worth building". Give one recommendation. Never tell kura to playtest the game.
7. Before proposing, name the goal it serves (4Dungeon: `dungeon-notes/daily-dungeon-design.md`, section 15) and how it would most likely fail. No goal, no proposal. Propose the smallest version first.

**Building**
8. Commit locally as asked. Push only when kura says to. "Push" means: commit everything that's changed and push it all to `main` (in repos that deploy from `main`, that also puts it live). Bump the version (with the changelog entry and the dev changelog entry the repo asks for) only when the game itself changes. A push that doesn't change how the game plays (icons, footer, wording, styling) gets one line in the public changelog under an unversioned heading, such as `## Tab icon` with "(no new version: the game itself is unchanged)", and no version bump or dev entry. This rule beats a repo section that says every push is a release.
9. Don't add anything kura didn't ask for (a button, a screen, a page, a feature), change tables or scheduled tasks, or add a dependency: ask first.
10. Delete, don't park: no new flags or "off for now" code. Fix a shared problem once, in the shared place. Prefer changing what exists to adding a file. Each changelog line says what was removed as well as what was added.
11. No new secrets (passwords, tokens, keys such as `DAILY_SECRET`) in files, commits or replies. If you find one already committed, tell kura, and don't repeat it.

**Working with kura**
12. Don't act without kura's explicit permission. A question gets an answer, not an action: "Can you remove that rule?" is a request; "What happens if we remove that rule?" is a question. If you can't tell which, answer, then ask "want me to do it?" and wait. Reading and searching to find the answer is fine.
13. Disagree before building, not after. Silence means "not now": raise each item once.

**Defaults**
- Testing takes 2 to 3 minutes in total, with no edge cases. A repo's required check (such as `npm test`) counts toward that. Need more? Ask first.
- Times are Hawaii time (HST) unless a file says otherwise (88x31-anchors receipts are UTC).
- Some repos get automated commits: fetch before you push.
<!-- END SHARED RULES v8 -->
