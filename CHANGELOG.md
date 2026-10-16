# Changelog

Times are Hawaii time (HST). Newest first.

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
