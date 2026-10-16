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
- **Admin and test mode.** A player with `admin = 1` (the owner, set by hand) gets a TEST MODE switch in SAVE. While it's on: no daily key limit, no travel check, doors kept in `test_unlocks` (only that admin's test floors read them), and nothing recorded (no completions, first finds, signatures, ledger entries, and the real last place doesn't move). The screen shows `[TEST MODE]`. Switching it off returns the real game exactly as it was, and takes the admin back to the cell they switched it on in (`test_from`, kept on the server, so it works across reloads and devices). A wing walked in test mode can still be found first, for real, by anyone.
- **Moderation by request, not buttons.** Players can't type anything (names come from lists), so there is little to moderate. The rare cases are handled by the owner asking: taking a name off a find, and voiding a cheated first find. A voided wing **opens up** again, so the next honest player can be first; the void is sealed on the ledger (it can't be edited). Not built yet: done when first needed.
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
8. **Item pools and deck size.** Start with 4Dungeon's items (12 common, 12 uncommon, 12 rare, 4 moon; mythic reserved) plus the 88x31 commons and uncommons: that is plenty. How big a room-day's deck is, and what happens when it runs out. Any new items written for this game should follow `voice-guide.md` in dungeon-notes.
9. **Which real-world signals do what.** Which moon phases offer a MOON room, what a SUN room is and when it is offered, how the season and time of day shift drops, and what a "golden hour" find is.
10. **First finder of an item kind in a place.** Whether that goes on the ledger, and what it attaches to (as with wings).
11. **Where a button's picture comes from.** Linking straight to 88x31's `/api/img` (works today, no hotlink protection, depends on 88x31 being up) or keeping a copy.
12. **Putting a found button into the 88x31 collection.** Needs accounts linked across the games (passkeys are per address and each game has its own players) and 88x31 granting the copy. Not planned yet.
13. **Keeping, using and trading.** Whether finds are a collection you keep, and how trading would work. Stand-ins for 4Dungeon's bay, forge, vault and altar.
14. **Archive-tier buttons.** 375 of the 411 common buttons are archive tier: other people's art, found in the wild, shown as found and credited. 88x31 already shows them publicly. Whether irl-dungeon offers them too (with the same credit) or only the 52 original-tier commons and uncommons.

## Rooms and items (a plan: nothing here is built yet)

Written Oct 15 2026 (HST) from a design conversation with the owner. Rooms are empty today. This is what they will hold. Anything marked *open* is not decided.

### Wings and room kinds
- A wing is 3 spaces: one **room**, one **passage**, one **dead end** (4Dungeon's own wing code; checked on 300 cells). Only the room has a kind. The passage is quiet; the dead end hides a clue about the day's two locked doors (as in 4Dungeon).
- Each day the player chooses between two locked doors, and the two lead to rooms of different kinds, hinted by the door's clue ("warm air breathes along the bottom of the door" is a den). The choice is the day's decision.
- New kinds for this game: a **MOON room** and a **SUN room**, alongside 4Dungeon's **den** (a heap of things left behind). 4Dungeon's archive ("everything ever saved, take one") is an item room too and can come later.
- 4Dungeon's bay, forge, vault and altar depend on things this game cut (breath, silver, taint). They are left out until there is something for them to do.
- **The real world decides which kinds are offered and what drops:** the date and season, the time of day (the player's local time, already sent), the moon's phase (computed; the header already shows it), and the sun at the cell (sunrise, sunset, golden hour, solstices and equinoxes, computed as dawn-baton's `engine/sun.js` does). MOON rooms only under a bright moon. All of this is computed in code: no outside service. Weather would need one (as in dawn-baton), so it is **not planned** without asking.

### Items
- **Not scarce and not one-of-a-kind (yet).** Everyone can find their own copy. Each find is a **numbered copy** ("a subway token, #4821"), so every find is a distinct thing, as the cLuB's copies are.
- **Different but equal.** Two players are never offered the same kind from the same room on the same day. Each room, each day, is a **deck**: shuffled from a seed (cell, room, day), every card the same rarity, and the Nth player to search gets the Nth card. A deck can be any size (it does not have to be the whole pool): it only sets how many different players can search the same room on the same day before a kind repeats, which on a thin player base is a handful. This keeps trading meaningful (nobody holds what the other has) without making anything scarce. Trading itself is not built. *Open:* what happens when a deck runs out (a second deck, which can repeat kinds, or the room is picked clean for the day).
- This brings back 4Dungeon's "**shape is shared, contents are private**": the dungeon is the same for everyone; what you find is yours.
- **Rarities** (4Dungeon's): COMMON, UNCOMMON, RARE and MOON now. **MYTHIC** ("old-layer relics") is kept for when layers exist.
- 4Dungeon's items are mostly small, odd ruined-city objects with a one-line note ("a subway token. For a line that was never built."). Its pools: 12 common, 12 uncommon, 12 rare, 6 mythic, 4 moon. Items with game effects there (medicine that heals the party, a candle that calms the room) are used here as name and note only: no party, no heat.
- **The ledger holds scarce things only** (a first find, or a one-of-a-kind item if those ever exist). Sealing every pickup would bloat it and queue every write on one chain. Ordinary finds live in the player's own record.

### One item table for all the games (the goal)
The owner wants a single item table that every game reads, so a change in one place changes all of them.
- **A shared table in its own database** in the Cloudflare account (several Workers can use one database). One row per kind of item: a **stable id** (append-only: never reorder or delete; retire with a flag), a **source** (4Dungeon, irl-dungeon, 88x31), a rarity, a name, a note, an optional picture, a retired flag. Players' finds refer to items by id, so text edits are always safe and ids never shift.
- **Stages, each shippable on its own:**
  1. Seed the table once from 4Dungeon's `CATALOG` in `daily-dungeon/rules.js` (a script reads the file from GitHub and takes name, note and rarity; the effect code is ignored; 4Dungeon is not changed). From then on the table is the master. irl-dungeon reads it.
  2. Add **88x31 buttons** (below).
  3. **4Dungeon reads the table too** (low priority; the owner is fine with changing it). It is a static page on itch.io, so its leaderboard Worker would serve the table, with its built-in list as the fallback so the game still works offline.
- Alternative not chosen: a separate repo holding only item data, which each game syncs from.

### 88x31 buttons in irl-dungeon
- The aim: an **existing** 88x31 button appears as a find in a dungeon, instead of rolling a new one.
- It needs **88x31's public API, not its ledger**: `GET /api/designs` (the catalog) and `GET /api/img?d=N` (the GIF). The ledger is the history of who got which copy; the catalog is all that is needed to offer a button.
- Only **commons and uncommons** are offered (decided), and only **active, uncapped (`max_editions` null) buttons that a logged-out viewer can see**. Rare, prototype, ultra and special buttons are capped or hidden, and scarce in 88x31, so handing them out here would cheapen them. On the live catalog that is **427 buttons**: 411 common (375 archive tier, 36 original) and 16 uncommon (all original). 88x31's rarity names match 4Dungeon's COMMON and UNCOMMON. Removed buttons are not offered (the list leaves them out, and a snapshot must follow that).
- **What a found button shows** (all from 88x31's public API; the detail call `?id=N` has the credit): its **picture**, **name**, **type** (neon, construction, guestbook, webring, counter, divider), **tier**, and the **credit** (source title, author, source link) and **license**. Not carried over: edition numbers, foils, patterns, effects, owners, series and trade history, which belong to 88x31's own copies. irl-dungeon adds its own numbered copy and the date it was found (and the moon and time of day, if wanted). 88x31 buttons have no one-line note like 4Dungeon's items; one could be written per type ('Under construction, forever.'), *open*.
- Show **credit and license** as 88x31 does (archive-tier art is found in the wild, shown as found, credited where known, not relicensed).
- The button found here is **irl-dungeon's own item**, not a copy in the player's 88x31 collection. Putting it into their collection means one game writing into the other, accounts linked across games, and 88x31's scarcity rules covering it: a bigger project, later (see open question 12).
- 88x31 stays the master of buttons (uploads, moderation, removal). The shared table points at them by a sync from the public API, kept as a snapshot refreshed on a schedule so an 88x31 outage doesn't break dens.
- The screen is 80 columns of text and a button is a GIF, so a found button is shown in a small panel in the 3D view (like SAVE) with the picture next to its name and credit.

## `public/floor.js` (trimmed from 4Dungeon)

Trimmed from `daily-dungeon/floor.js` (43cebc2): wing layout and door/sealing code kept, module wrapper added, and all room contents (kinds, demons, items, silver, clues, locker, bonus, void, painted doors) and the minimap/heat map removed. **Rooms are empty for now.** Without kinds, the two doors of a pair differ only in where they lead. The map drawing can be copied back from 4Dungeon when there is a screen. `test/floor.test.mjs` checks 4Dungeon's rules from outside. Findings:
- A walk builds days+1 wings, not four as its header says.
- Wings are 3 spaces; about 0.03% are a 1-space fallback.
- `floor.stuck` is reachable: about 1 in 700 greedy walks on 6 to 7 day floors (the header says never in practice). Worth fixing in 4Dungeon too.
- **What do rooms hold?** Empty for now; see "Rooms and items" above for the plan.
- The server checks an unlock by rebuilding the floor from the cell's shared seed and the player's unlocked doors (`src/game.js`). Since v0.03 the private seed is the shared seed, so `sym` is the same for everyone.

## The screen

`public/screen.js` is 4Dungeon's 80-column frame with only what this game has: the moon-and-date header, the 3D view, a right panel (cell id, wing, room, the minimap), three log lines (what is here, what you just did, what is ahead) and a keys line. Party, HP/MP, silver, ichor, breath, the title, sky, fights and bag are removed. The minimap is 4Dungeon's, without its locker and stairs marks. The page starts at `?cell=<id>` if given, or else at the server's rough guess (`GET /api/here`), and the player walks out of a start room into the next cell. Pressing L uses the browser's location instead, where allowed: `public/place.js` turns the position into a resolution-10 cell id with the vendored h3-js and drops the coordinates. In a start room the ahead line says "the way out, to the next cell" for a wall. The shared seed comes from `FLOOR.seedFor(cell, layer)` (FNV-1a, provisional). A locked door says it is locked. Stepping into it asks first ("Unlock the west door? It uses today's key. Step again for yes."; any turn cancels), as 4Dungeon asks before a key is spent; a second step spends the key through the server. Arriving in a cell asks the server for the player's doors there and opens them. A wing whose rooms have all been stood in is reported once.

The keys line also has `[S]AVE`, which opens a panel inside the 3D view (like 4Dungeon's bag): make or forget save codes (shown once), add or forget passkeys, log in with a code or a passkey, log out (the server only allows it once a way back exists).

## Outside code

`public/vendor/h3-js.es.js`: Uber's h3-js, Apache-2.0, copied in with the owner's OK on 2026-10-15 (HST), unedited, with its license beside it. Only the page loads it today; the Worker will need it (or its own check) when it validates cell ids. A cell id is still about 100 m of location, so it is shown on screen and sent to the server but never kept with a name.

## Recoverable from the old version

The old code is in git history at `7930476` (v0.08), removed in `35ea4f9`. It had a wing generator (property-checked: 60,000 wings, all deterministic, 3 or 4 spaces, reachable, with a door), the browser's geolocation-to-H3 step, a minimap, and a copy of 4Dungeon's screen frame. For the screen, start from `daily-dungeon/screen.js` and take only what the game uses.
