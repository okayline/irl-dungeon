# irl-dungeon: design

4Dungeon in the real world. Every place on Earth is a cell; every cell is a dungeon that grows over time. 4Dungeon is the core game and the model: when this document is silent, do what 4Dungeon does.

Status: **v0.03** (players, save codes, passkeys, the chained ledger, `public/floor.js`, and the page: 4Dungeon's screen and minimap on an empty-rooms floor, turn and walk only; the day's key, unlocking a door and first finders of a wing, played from the page through `public/play.js`).

## Settled

**The world.**
- A cell is an H3 hexagon at resolution 10, about 100 m across.
- The server only ever sees cell IDs. The browser drops the coordinates.
- **No location prompt needed.** The game never requires the browser's location (many people block it, and asking is a bit invasive). Instead:
  - **A rough start from the server.** `GET /api/here` takes the approximate position Cloudflare puts on every request (from the IP, often off by kilometres), turns it into the ~1 km area around it (H3 resolution 7) and answers only the 100 m cell at that area's centre. Nothing is stored. The owner is fine with the server inferring roughly where a player is this way.
  - **Walking between cells.** In a cell's start room, a wall is the way out: stepping into it moves you to the next cell that way (N, E, S or W: the touching hex closest to that bearing). That is how a player gets from the rough guess to their street.
  - **The browser's location (L)** stays as an optional shortcut where the browser allows it. `?cell=<id>` still works.
- **The travel check** (`src/travel.js`): location can't be proven, so the server checks that a player's claims make sense together. It keeps each player's last credited cell and when they claimed it (`places`, one row per player, never published). A cell is credited if reaching it was possible at 150 km/h plus 2 km of slack. A claim that wasn't can still be walked, but earns nothing (no unlock, no first find) until enough time has passed. Movement is never restricted otherwise.

**Rules, from 4Dungeon.**
- A wing is three or four spaces (a room, a passage, a dead end, sometimes a second room), joined by open doors. Wings hang locked doors.
- The player's **key** opens one locked door a day. Only unlocking costs the key.
- Everything else is free: walking, searching, and any open cell or open doorway, anywhere, any number of them in a day. Open doors stay walkable.
- A long walk gives you more places to choose from, not more doors opened. Which cell to spend the day's key in is the daily decision.
- No breath, no demons, no combat.

**The key is personal; the floor is shared.**
- The key and the door choice belong to the player. They make the choice.
- Everyone sees the same floor in a cell: the same shape, map and directions (since v0.03; 4Dungeon's private seed and per-player rotation were dropped). Which doors a player has unlocked is their own.
- Community doors (a choice that changes a cell for everyone) are much later, if ever.

**Days and seasons.**
- A cell offers a fresh wing every day.
- How long a season is: **not known yet.** 4Dungeon's moon quarter (about 7.4 days) is a working assumption only.
- A cell's season layer is a 4Dungeon **floor** (`public/floor.js`); each day's wing is a wing of that floor. Keep a layer/depth index in every key so depth can be added later without a migration.
- When a season ends, its layer is **kept, never deleted**: it stays readable and walkable and its ledger entries stay. New layers build on old ones.
- Growth: layers spread **horizontally** (more wings, more spaces) for several seasons first, and only then start going **down**. Don't go down too quickly.

**The ledger.**
- Everything that matters is sealed on one SHA-256 hash chain, append-only.
- The **first finder** is the first player to walk a whole wing, credited in the ledger forever (anonymous: no name or id in the entry).
- **Names and signing.** A name is two words from lists (dawn-baton's, in `src/names.js`), unique, rerollable in SAVE, and a signed find can be unsigned. A player has none until they sign a find: after a first find the game offers "Press Y to sign it" (also `[Y] SIGN IT` in the right panel while standing in that wing). Signing is sealed on the ledger as a `sign` entry (cell, layer, wing; never the name); the name is looked up when shown, so a reroll renames past signatures. The right panel shows `FIRST: <NAME>`, `FIRST: UNSIGNED` or `FIRST: YOU [Y] SIGN IT` for the wing you're in.
- **Saved cells** (up to 20) are kept on the server with the player, so they follow a save code to other devices; listed in SAVE with GO and FORGET. Private, never published. GO is subject to the travel check like any arrival.
- The public ledger never shows who (ids stay in their own column) and never an exact time, only a date.

**No accounts.**
- A player is a cookie, with save codes and passkeys to come back. Only hashes are stored.
- The address is **`irl.88x31.app`** (a custom domain on the Worker). Passkeys belong to this address.
- The page is served by the same Worker as the API (one origin, no CORS). This replaces the old arrangement (GitHub Pages plus a separate Worker with bearer tokens). Same as scoundrel.exe and dawn-baton.

## Open questions

1. **How many seasons does a cell spread sideways before the first layer below?** Decided for now: build sideways only, keep room to go down later.
2. **Checking the time zone.** Decided: the key's day is the player's **local day** (`src/day.js`). The browser sends only its UTC offset; the server applies it to its own clock, rejects offsets outside UTC-12:00 to UTC+14:00, and never lets a player's day go backwards. So the most a lie can buy is a key a few hours early or late. Still open: cross-check the claimed offset against the time zone Cloudflare infers from the player's IP (`request.cf.timezone`, free, no table), as a soft signal only (VPNs and phones on roaming make it wrong sometimes), and/or a cell-based zone lookup (a precise table is tens of MB).
3. **Location can't be proven.** A browser can claim any cell. The defense is rate limits and the travel check, not detection. Still open: whether 150 km/h is right (a flight is legitimate but waits a day or so for credit), and whether a brand-new player's first claim should count for less.
4. **Which way do layers go in the fiction?** 4Dungeon climbs up out of a pit; strata under a place sound like digging down.
5. **Anchoring the head.** A chain can't show that its newest entries were dropped. Publish the head hash somewhere outside the database (see `src/ledger.js`).
6. **Real-world safety.** A game that rewards visiting places can send people onto roads or private land. It needs a line in the game and in the about page.
7. **Signing.** Decided: optional, offered after each first find. The SAVE panel says a name is "shown on finds you sign, with their cell". A player can unsign any find they signed (`[U] UNSIGN` in the right panel while in that wing), sealed as an `unsign` entry; their name is kept for next time. Still open: a signed name plus its cells is a trail of places a person has been; whether to say that more plainly. The word lists are dawn-baton's for now (this game is lighter).

## `public/floor.js` (trimmed from 4Dungeon)

Trimmed from `daily-dungeon/floor.js` (43cebc2): wing layout and door/sealing code kept, module wrapper added, and all room contents (kinds, demons, items, silver, clues, locker, bonus, void, painted doors) and the minimap/heat map removed. **Rooms are empty for now.** Without kinds, the two doors of a pair differ only in where they lead. The map drawing can be copied back from 4Dungeon when there is a screen. `test/floor.test.mjs` checks 4Dungeon's rules from outside. Findings:
- A walk builds days+1 wings, not four as its header says.
- Wings are 3 spaces; about 0.03% are a 1-space fallback.
- `floor.stuck` is reachable: about 1 in 700 greedy walks on 6 to 7 day floors (the header says never in practice). Worth fixing in 4Dungeon too.
- **Open: what do rooms hold?** Empty for now.
- The server checks an unlock by rebuilding the floor from the cell's shared seed and the player's unlocked doors (`src/game.js`). Since v0.03 the private seed is the shared seed, so `sym` is the same for everyone.

## The screen

`public/screen.js` is 4Dungeon's 80-column frame with only what this game has: the moon-and-date header, the 3D view, a right panel (cell id, wing, room, the minimap), three log lines (what is here, what you just did, what is ahead) and a keys line. Party, HP/MP, silver, ichor, breath, the title, sky, fights and bag are removed. The minimap is 4Dungeon's, without its locker and stairs marks. The page starts at `?cell=<id>` if given, or else at the server's rough guess (`GET /api/here`), and the player walks out of a start room into the next cell. Pressing L uses the browser's location instead, where allowed: `public/place.js` turns the position into a resolution-10 cell id with the vendored h3-js and drops the coordinates. In a start room the ahead line says "the way out, to the next cell" for a wall. The shared seed comes from `FLOOR.seedFor(cell, layer)` (FNV-1a, provisional). A locked door says it is locked. Stepping into it asks first ("Unlock the west door? It uses today's key. Step again for yes."; any turn cancels), as 4Dungeon asks before a key is spent; a second step spends the key through the server. Arriving in a cell asks the server for the player's doors there and opens them. A wing whose rooms have all been stood in is reported once.

The keys line also has `[S]AVE`, which opens a panel inside the 3D view (like 4Dungeon's bag): make or forget save codes (shown once), add or forget passkeys, log in with a code or a passkey, log out (the server only allows it once a way back exists).

## Outside code

`public/vendor/h3-js.es.js`: Uber's h3-js, Apache-2.0, copied in with the owner's OK on 2026-10-15 (HST), unedited, with its license beside it. Only the page loads it today; the Worker will need it (or its own check) when it validates cell ids. A cell id is still about 100 m of location, so it is shown on screen and sent to the server but never kept with a name.

## Recoverable from the old version

The old code is in git history at `7930476` (v0.08), removed in `35ea4f9`. It had a wing generator (property-checked: 60,000 wings, all deterministic, 3 or 4 spaces, reachable, with a door), the browser's geolocation-to-H3 step, a minimap, and a copy of 4Dungeon's screen frame. For the screen, start from `daily-dungeon/screen.js` and take only what the game uses.
