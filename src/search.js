// What each room hides each day. Rules from 4Dungeon's search (daily-dungeon/rules.js), without the breath, heat,
// demons and moon: walls are searched with a step into them; a bare wall never answers; a door can't be searched.
// Each wall that has no door hides 0 to 3 things, in an order (the first one found first). A thing needs a few searches
// on its wall (a search is worth one point), so nothing turns up on a first look; each find on a wall makes the next one
// cost half again as much (4Dungeon's "a wall tires"). Once a few searches are in on the thing being worked at, a search
// sometimes gives a near-miss noise.
//
// What a room hides is fixed by the cell, the room and the day, and is the same for everyone. Each thing has a rarity
// (common, uncommon or rare), and its item is dealt from that room-day's deck of that rarity (src/deal.js).
// Moon items don't drop yet.
import { seedFrom, rng } from "./deal.js";

export const WALLS = ["N", "E", "S", "W"];
export const ODDS = [["common", 60], ["uncommon", 30], ["rare", 10]];   // out of 100: for testing it out
export const COUNTS = [[0, 30], [1, 35], [2, 25], [3, 10]];            // how many things a wall hides, out of 100
export const NEED_MIN = 3, NEED_SPAN = 4;                              // a thing needs 3 to 6 searches (before it tires the wall)
export const TIRE = 1.5;                                               // each find on a wall makes the next cost this much more
export const NEAR_AFTER = 2;                                           // searches into a thing before a near-miss noise can happen
export const NEAR_CHANCE = 0.35;

const pick = (table, roll) => { for (const [v, w] of table) { if (roll < w) return v; roll -= w; } return table[table.length - 1][0]; };

// `room` is a floor room ({ doors: { N: roomNumber, ... } }); `base` names this room on this day (cell|spot|day).
// Returns { N: [{ need, rarity }, ...], ... } for each wall without a door (an empty list = a bare wall), in the order
// the things are found. `need` is the searches that thing takes after the ones before it. {} if every wall has a door.
export function hides(room, base) {
  const out = {};
  for (const wall of WALLS) {
    if (room.doors[wall] !== undefined) continue;
    const r = rng(seedFrom(`hides|${base}|${wall}`)), list = [];
    const n = pick(COUNTS, r() * 100), first = NEED_MIN + Math.floor(r() * NEED_SPAN);
    for (let k = 0; k < n; k++) list.push({ need: Math.ceil(first * Math.pow(TIRE, k)), rarity: pick(ODDS, r() * 100) });
    out[wall] = list;
  }
  return out;
}
