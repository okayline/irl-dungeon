// Room names, as in 4Dungeon (daily-dungeon/rules.js NAMES_BY_KIND and roomName): so a player who goes back and forth can
// tell rooms apart. The cell's first room is "The way out" (its walls lead out to the next cell); a passage, a dead end
// and any other room each draw from their own list, picked by a hash of the floor's seed and the room's number, and no
// two rooms on a floor share a name (until a list runs out). 11 characters at most. Nothing is stored: a room's name is
// worked out from the floor alone, and a room's name never depends on rooms built after it, so it never changes.
const NAMES = {
  hall: ["Passageway", "Conduit", "Crawlway", "Corridor", "Walkway", "Service way"],
  dead: ["Beacon", "Lamp room", "Uplink", "Waystation", "Signal room", "Comms nook"],
  plain: ["Dusty room", "Damp room", "Grey room", "Tiled room", "Mossy room", "Sooty room", "Round room", "Echo room", "Salt room",
    "Rusty room", "Hollow room", "Side room", "Back room", "Big room", "Small room", "Odd room", "Wet room", "Dry room", "Low room",
    "High room", "Lamp room", "Bent room", "Split room", "Dim room", "Old room", "Plain room", "Faded room", "Chalky room", "Bleak room",
    "Dark room", "Pale room", "Wide room"],
};
export const START_NAME = "The way out";

export function roomName(floor, i) {
  if (i === 0) return START_NAME;
  const used = new Set();
  let name = START_NAME;
  for (let k = 1; k <= i; k++) {
    const rm = floor.rooms[k];
    if (!rm) continue;
    const lists = [NAMES[rm.hall ? "hall" : rm.dead ? "dead" : "plain"], NAMES.plain];
    const h = Math.abs(Math.imul((floor.seed | 0) ^ Math.imul(k + 1, 0x9e3779b1), 0x85ebca6b) >>> 7);
    name = null;
    for (const list of lists) {
      for (let t = 0; t < list.length && !name; t++) { const n = list[(h + t) % list.length]; if (!used.has(n)) name = n; }
      if (name) break;
    }
    if (!name) name = NAMES.plain[h % NAMES.plain.length];
    used.add(name);
  }
  return name.slice(0, 11);
}
