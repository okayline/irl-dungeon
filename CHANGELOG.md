# Changelog

Times are Hawaii time (HST). Newest first.

## v0.16 - Clear Skies - Oct 15 2026, 11:20 PM HST

- **No more fog of war.** The map shows every room of the cell that's been built, not just the ones you've walked in. Rooms you haven't been in yet are drawn too, so you can see where you're going. (What you've walked still counts for your cleared wings and the area map.)

## v0.15 - Ring - Oct 15 2026, 11:25 PM HST

- **The area map is a ring.** You're `[@]` in the middle with the six cells around you, north up. Each cell is one mark: `.` a new cell, `o` one you've stood in, `O` one whose first wing you've walked. (v0.14 drew only four cells with hallways between them; this is the picture that was asked for.)

## v0.14 - Area - Oct 15 2026, 11:12 PM HST

- **The map remembers on the server.** The rooms you've stood in are kept with your account, so the outline follows you to any device, and coming back to a cell shows where you've been.
- **Zoom the map.** Press `+` or `-` (or click the button on the map's title) to switch between the room map and an AREA map. The area map has north always up: you in the middle, and along each way out of the first room the next cell, joined by a hallway. A cell shows `[ ]` if it's new, `[.]` if you've stood in it, `[o]` if you've walked its whole first wing.

## v0.13 - Hallways - Oct 15 2026, 11:06 PM HST

- **The way out is a hallway.** In a cell's first room, every wall that leads out to the next cell now has a hallway drawn on the map out to its edge (`=` going sideways, `:` going up or down), so walking out feels like walking down a passage and not like stepping into a corner.
- **Arriving shows where you came from.** In the new cell, the hallway you came in by ends in a `*`.
- Heads up: a wall leads to the neighbouring cell that lies closest to that compass direction (within about 25 degrees), and going back the way you came returns you to the same cell.

## v0.12 - Names and Gates - Oct 15 2026, 11:02 PM HST

- **Rooms have names.** Under the map, in the lower left, each room shows a name drawn from 4Dungeon's lists (passages, dead ends and plain rooms each have their own), and no two rooms on a floor share one. The cell's first room is called "The way out".
- **The way out is marked on the map.** In a cell's first room, each wall that leads out to the next cell is marked with its own symbol (`:` on the sides, `=` above and below) in the door grey.

## v0.11 - Outlines - Oct 15 2026, 10:57 PM HST

- **The map outlines where you've been.** The rooms you've walked in are outlined in the map's dim grey, as in 4Dungeon, and your @ and the way you face stay bright.
- **Cells remember your steps.** Walk into a cell you've been in before and the rooms you walked there are already outlined, so a cell you know no longer looks like a brand-new one. (Remembered on this device only.)

## v0.10 - Fuller Walls - Oct 15 2026, 10:50 PM HST

- **Walls hide more, and give it up faster.** Every wall without a door now hides 0 to 3 things (before, a room hid one thing behind one wall). The first thing on a wall takes 3 to 6 searches; each one after it takes half again as many. You can find things on every wall of a room, every day.
- A faint noise now comes sooner (after 2 searches into a thing), and a bare wall still never answers.
- "Nothing more here today" now means that wall has given you everything.

## v0.09 - Numbered - Oct 15 2026, 10:34 PM HST

- **Every find is a numbered copy, and the numbers are shared with the other games.** The number now comes from one registry used by all the games, so "#4" of an item is the fourth copy anywhere, not just here.
- A number can arrive a moment late. If the registry can't be reached, you still keep what you found and it shows without a number; it gets one the next time you open [I]NVOKE or search that room.

## v0.08 - Hidden Things - Oct 15 2026, 09:10 PM HST

- **Search the walls.** In any room except a cell's first, press into a wall (up) to search it. Most walls hold nothing. Some rooms hide something behind one wall, and it takes 5 to 10 searches to turn it up. Once you have a few searches in, a faint noise can tell you you're close.
- **You found something.** A window says what you found. Items come from one shared item table used by all the games (4Dungeon's items, and 88x31 buttons). You can find one thing per room per day, and two players never find the same kind in a room on the same day.
- **[I]NVOKE** shows everything you've found. The bottom menu is simpler: TURN [A] [D], [I]NVOKE, [L]OCATE, [S]AVE.
- For now, rooms hold common, uncommon and rare things. Moon things don't drop yet.

## v0.07 - Sandbox - Oct 15 2026, 08:00 PM HST

- **Test mode for the admin.** A switch in [S]AVE opens a sandbox: no key limit, no travel limit, and nothing you do there counts or shows up for anyone. Switching it off takes you back to where you turned it on, with your real game exactly as you left it.

## v0.06 - Second Thoughts - Oct 15 2026, 07:47 PM HST

- **Rerolling your name asks first.** Tap REROLL, then YES, REROLL to change it, or KEEP IT to keep it. A name you roll past can't come back.
- **No more black bar in [S]AVE.** Messages now show at the top, under the title, instead of covering the list.

## v0.05 - Signed and Saved - Oct 15 2026, 07:37 PM HST

- **Locked doors open.** Step into one and it asks first; step again to spend today's key on it. Your opened doors come back when you return, on any of your devices.
- **First finders.** Walk every room of a wing before anyone else and it's yours on the ledger. Press Y (or tap [Y] SIGN IT) to sign it with a two-word name, and U to unsign it. The right panel shows who found the wing you're in.
- **Your name** is made when you first sign something. Reroll it any time in [S]AVE.
- **Saved cells** in [S]AVE: save the cell you're in, then GO back to it later from any device.
- **[S]AVE opens instantly**, has a COPY button for a new save code (and you can select the code), and the black bar at the bottom is gone.

## v0.04 - Street Door - Oct 15 2026, 07:08 PM HST

- **No location prompt needed.** The game starts you in a cell near you, guessed roughly from your connection. Your browser's location (press L) is now optional.
- **Walk to the next cell.** In a cell's first room, walk into a wall to step out into the next cell that way. That's how you get from the rough guess to your own street.
- Behind the scenes: jumping impossibly far, impossibly fast still lets you look around, but earns nothing there until enough time has passed.

## v0.03 - Shared Halls - Oct 15 2026, 06:42 PM HST

- **Everyone sees the same dungeon** in a cell, with the same map and the same directions.
- Behind the scenes: the server now handles the daily key, unlocking a door, and recording the first person to walk a whole wing (anonymous for now). The page doesn't use these yet.

## v0.02 - Way Back - Oct 15 2026, 06:14 PM HST

- **A [S]AVE button.** It opens a panel inside the 3D view where you can make a save code (shown once, with a download-as-text-file button) and add a passkey, so you can get your player back on any device.
- **Log in on a new device** with a save code or a passkey, and log out once you have a way back in.

## v0.01 - First Steps - Oct 15 2026, 05:58 PM HST

The first release.

- **Every ~100 m cell is a dungeon.** Press L (or tap [L]OCATE) and the page finds your cell and builds its floor.
- **4Dungeon's screen and minimap.** Turn and walk through open doors; the map fills in as you go. Locked doors stay shut for now.
- **Your location stays on your device.** Only the cell id is used; the coordinates are dropped at once.
- **Save codes and passkeys** to come back on another device.
