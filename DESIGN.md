# irl-dungeon: design

4Dungeon in the real world. Every place on Earth is a cell; every cell is a dungeon that grows over time. 4Dungeon is the core game and the model: when this document is silent, do what 4Dungeon does.

Status: **foundation plus a first screen** (players, save codes, passkeys, the chained ledger, `public/floor.js`, and the page: 4Dungeon's screen and minimap on an empty-rooms floor; turn and walk only).

## Settled

**The world.**
- A cell is an H3 hexagon at resolution 10, about 100 m across.
- The server only ever sees cell IDs. The browser drops the coordinates.

**Rules, from 4Dungeon.**
- A wing is three or four spaces (a room, a passage, a dead end, sometimes a second room), joined by open doors. Wings hang locked doors.
- The player's **key** opens one locked door a day. Only unlocking costs the key.
- Everything else is free: walking, searching, and any open cell or open doorway, anywhere, any number of them in a day. Open doors stay walkable.
- A long walk gives you more places to choose from, not more doors opened. Which cell to spend the day's key in is the daily decision.
- No breath, no demons, no combat.

**Personal, not shared.**
- The key and the door choice belong to the player. They make the choice.
- Shape is shared and contents are private, as in 4Dungeon.
- Community doors (a choice that changes a cell for everyone) are much later, if ever.

**Days and seasons.**
- A cell offers a fresh wing every day.
- How long a season is: **not known yet.** 4Dungeon's moon quarter (about 7.4 days) is a working assumption only.
- A cell's season layer is a 4Dungeon **floor** (`public/floor.js`); each day's wing is a wing of that floor. Keep a layer/depth index in every key so depth can be added later without a migration.
- When a season ends, its layer is **kept, never deleted**: it stays readable and walkable and its ledger entries stay. New layers build on old ones.
- Growth: layers spread **horizontally** (more wings, more spaces) for several seasons first, and only then start going **down**. Don't go down too quickly.

**The ledger.**
- Everything that matters is sealed on one SHA-256 hash chain, append-only.
- The **first finder** of a cell, a layer or a door is credited in it forever.
- The public ledger never shows who (ids stay in their own column) and never an exact time, only a date.

**No accounts.**
- A player is a cookie, with save codes and passkeys to come back. Only hashes are stored.
- The page is served by the same Worker as the API (one origin, no CORS). This replaces the old arrangement (GitHub Pages plus a separate Worker with bearer tokens). Same as scoundrel.exe and dawn-baton.

## Open questions

1. **How many seasons does a cell spread sideways before the first layer below?** Decided for now: build sideways only, keep room to go down later.
2. **Checking the time zone.** Decided: the key's day is the player's **local day** (`src/day.js`). The browser sends only its UTC offset; the server applies it to its own clock, rejects offsets outside UTC-12:00 to UTC+14:00, and never lets a player's day go backwards. So the most a lie can buy is a key a few hours early or late. Still open: cross-check the claimed offset against the time zone Cloudflare infers from the player's IP (`request.cf.timezone`, free, no table), as a soft signal only (VPNs and phones on roaming make it wrong sometimes), and/or a cell-based zone lookup (a precise table is tens of MB).
3. **Location can't be proven.** A browser can claim any cell. The stakes are cosmetic, so the defense is rate limits, not detection. Decide what, exactly, a claim can earn.
4. **What does "first finder" attach to:** the cell, the layer, the day's wing, or a door?
5. **Which way do layers go in the fiction?** 4Dungeon climbs up out of a pit; strata under a place sound like digging down.
6. **Anchoring the head.** A chain can't show that its newest entries were dropped. Publish the head hash somewhere outside the database (see `src/ledger.js`).
7. **Real-world safety.** A game that rewards visiting places can send people onto roads or private land. It needs a line in the game and in the about page.
8. **Signing.** Signing a find ties a consistent name to a trail of cells. The old version offered it; decide whether to keep it, and how to say what it reveals.
9. **Hosting address.** Live at `irl-dungeon.ddddungeon.workers.dev`. Custom domain `irl.88x31.app` added in Cloudflare on 2026-10-15 (HST). Passkeys belong to one address, so pick the one to use before anyone registers a passkey.

## `public/floor.js` (trimmed from 4Dungeon)

Trimmed from `daily-dungeon/floor.js` (43cebc2): wing layout and door/sealing code kept, module wrapper added, and all room contents (kinds, demons, items, silver, clues, locker, bonus, void, painted doors) and the minimap/heat map removed. **Rooms are empty for now.** Without kinds, the two doors of a pair differ only in where they lead. The map drawing can be copied back from 4Dungeon when there is a screen. `test/floor.test.mjs` checks 4Dungeon's rules from outside. Findings:
- A walk builds days+1 wings, not four as its header says.
- Wings are 3 spaces; about 0.03% are a 1-space fallback.
- `floor.stuck` is reachable: about 1 in 700 greedy walks on 6 to 7 day floors (the header says never in practice). Worth fixing in 4Dungeon too.
- **Open: what do rooms hold?** Empty for now.
- The server can only check an unlock if it knows the shared seed and the player's private `pseed`/`sym` (door directions are rotated per player).

## The screen

`public/screen.js` is 4Dungeon's 80-column frame with only what this game has: the moon-and-date header, the 3D view, a right panel (cell id, wing, room, the minimap), three log lines (what is here, what you just did, what is ahead) and a keys line. Party, HP/MP, silver, ichor, breath, the title, sky, fights and bag are removed. The minimap is 4Dungeon's, without its locker and stairs marks. The page finds the cell with the browser's location (press L; the browser asks first): `public/place.js` turns the position into a resolution-10 cell id with the vendored h3-js and drops the coordinates. `?cell=<id>` still works to look at any cell. The shared seed comes from `FLOOR.seedFor(cell, layer)` (FNV-1a, provisional). A locked door says it is locked: opening one needs the key, which needs the server.

The keys line also has `[S]AVE`, which opens a panel inside the 3D view (like 4Dungeon's bag): make or forget save codes (shown once), add or forget passkeys, log in with a code or a passkey, log out (the server only allows it once a way back exists).

## Outside code

`public/vendor/h3-js.es.js`: Uber's h3-js, Apache-2.0, copied in with the owner's OK on 2026-10-15 (HST), unedited, with its license beside it. Only the page loads it today; the Worker will need it (or its own check) when it validates cell ids. A cell id is still about 100 m of location, so it is shown on screen and sent to the server but never kept with a name.

## Recoverable from the old version

The old code is in git history at `7930476` (v0.08), removed in `35ea4f9`. It had a wing generator (property-checked: 60,000 wings, all deterministic, 3 or 4 spaces, reachable, with a door), the browser's geolocation-to-H3 step, a minimap, and a copy of 4Dungeon's screen frame. For the screen, start from `daily-dungeon/screen.js` and take only what the game uses.
