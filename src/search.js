// What each room hides each day. Rules copied from 4Dungeon's search (daily-dungeon/rules.js), without the breath,
// heat, demons and moon: walls are searched with a step into them; a bare wall never answers; the hidden thing needs
// 5 to 10 searches on its wall (a search is worth one point), so nothing turns up on a first look; once 3 searches
// are in, a search on the right wall sometimes gives a near-miss noise. A door can't be searched.
//
// What a room hides is fixed by the cell, the room and the day, and is the same for everyone: one thing, behind one
// wall that has no door. How common it is (common, uncommon or rare) is part of that, so the deck it is dealt from
// is a deck of one rarity (src/deal.js). Moon items don't drop yet.
import { seedFrom, rng } from "./deal.js";

export const WALLS = ["N", "E", "S", "W"];
export const ODDS = [["common", 60], ["uncommon", 30], ["rare", 10]];   // out of 100: for testing it out
export const NEAR_AFTER = 3;                                          // searches before a near-miss noise can happen
export const NEAR_CHANCE = 0.25;

// `room` is a floor room ({ doors: { N: roomNumber, ... } }); `base` names this room on this day (cell|spot|day).
// Returns { wall, need, rarity }, or null if every wall has a door.
export function hides(room, base) {
  const free = WALLS.filter((d) => room.doors[d] === undefined);
  if (!free.length) return null;
  const r = rng(seedFrom("hides|" + base));
  const wall = free[Math.floor(r() * free.length)], need = 5 + Math.floor(r() * 6);
  let roll = r() * 100, rarity = ODDS[ODDS.length - 1][0];
  for (const [name, w] of ODDS) { if (roll < w) { rarity = name; break; } roll -= w; }
  return { wall, need, rarity };
}
