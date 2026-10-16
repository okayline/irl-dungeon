// The game's rules that the server enforces, as plain functions (no database, no requests), so they can be tested alone.
// The floor itself is public/floor.js (4Dungeon's generator); this file only rebuilds a player's floor from what is
// stored about them, and works out which wings a set of visited rooms completes.
import FLOOR from "../public/floor.js";

export const LAYER = 0;                      // seasons don't exist yet: everything is on layer 0

// The player's floor for a cell: the shared shape (from the cell and layer), the player's private seed, and the doors
// they have unlocked, replayed in order. Throws if a stored door can't be opened (the stored history is broken).
export function buildFloor(cell, doors, layer = LAYER) {
  const floor = FLOOR.generate(FLOOR.seedFor(cell, layer), undefined, { days: FLOOR.DAYS });
  for (const door of doors) if (FLOOR.growDoor(floor, door) === undefined) throw new Error(`stored door ${door} can't be replayed`);
  return floor;
}

// The key of the wing at stage w: the first wing is "0"; each later wing is named by the doors unlocked to reach it
// ("0>3", "0>3>7"). Two players who took the same doors are in the same wing.
export const wingKey = (doors, w) => ["0", ...doors.slice(0, w)].join(">");

// Which wings has the player walked in full? `visited` is the set of room numbers they have stood in. It must be a set
// a player could really have walked: every room built, the start included, all joined to the start through open doors
// inside the set. (A walk exists exactly when such a set exists, so the order of the steps need not be sent.)
// Returns { ok: true, wings: [{ wing, key }] } or { ok: false, error }.
export function finishedWings(floor, doors, visited) {
  const bad = (error) => ({ ok: false, error });
  if (!Array.isArray(visited) || visited.length === 0 || visited.length > 200) return bad("That walk doesn't make sense.");
  const set = new Set();
  for (const i of visited) {
    if (!Number.isInteger(i) || i < 0 || !floor.rooms[i]) return bad("That walk goes somewhere that isn't built.");
    set.add(i);
  }
  if (!set.has(floor.start)) return bad("A walk starts at the beginning.");
  const seen = new Set([floor.start]), todo = [floor.start];
  while (todo.length) {
    const room = floor.rooms[todo.pop()];
    for (const next of Object.values(room.doors)) if (set.has(next) && floor.rooms[next] && !seen.has(next)) { seen.add(next); todo.push(next); }
  }
  if (seen.size !== set.size) return bad("That walk has gaps: some rooms can't be reached from the start.");
  const wings = [];
  floor.wings.forEach((w, stage) => { if (w.rooms.every((r) => set.has(r))) wings.push({ wing: stage, key: wingKey(doors, stage) }); });
  return { ok: true, wings };
}
