# irl-dungeon: design

4Dungeon in the real world. Every place on Earth is a cell; every cell is a dungeon that grows over time. 4Dungeon is the core game and the model: when this document is silent, do what 4Dungeon does.

Status: **foundation only** (players, save codes, passkeys, the chained ledger). No game yet.

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
- A season is a moon quarter, the same clock as 4Dungeon.
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

1. **How many seasons does a cell spread sideways before the first layer below?**
2. **What is "today" for the key?** UTC day (simple, same for everyone) or the player's local day (like 4Dungeon's rollover). The server can't know a player's time zone.
3. **Location can't be proven.** A browser can claim any cell. The stakes are cosmetic, so the defense is rate limits, not detection. Decide what, exactly, a claim can earn.
4. **What does "first finder" attach to:** the cell, the layer, the day's wing, or a door?
5. **Which way do layers go in the fiction?** 4Dungeon climbs up out of a pit; strata under a place sound like digging down.
6. **Anchoring the head.** A chain can't show that its newest entries were dropped. Publish the head hash somewhere outside the database (see `src/ledger.js`).
7. **Real-world safety.** A game that rewards visiting places can send people onto roads or private land. It needs a line in the game and in the about page.
8. **Signing.** Signing a find ties a consistent name to a trail of cells. The old version offered it; decide whether to keep it, and how to say what it reveals.
9. **Hosting address.** A custom domain like the other games, or workers.dev for now.

## Recoverable from the old version

The old code is in git history at `7930476` (v0.08), removed in `35ea4f9`. It had a wing generator (property-checked: 60,000 wings, all deterministic, 3 or 4 spaces, reachable, with a door), the browser's geolocation-to-H3 step, a minimap, and a copy of 4Dungeon's screen frame. For the screen, start from `daily-dungeon/screen.js` and take only what the game uses.
