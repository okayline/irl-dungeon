// The AREA map: the zoomed-out view in the map panel (the `+/-` toggle). You are [@] in the middle, with the six cells around
// you in a ring, north up (it does not turn with you). Each cell is one mark for what you have done in it (the server's
// answer, POST /api/area):  .  new    o  entered (stood in a room)    O  cleared (walked its first wing)
// A thin line joins [@] to each cell that the first room's hallways lead out to (the same exits the room map draws), so
// the two maps agree: a hallway going right on the room map is a ------ going right here.
// The ring is in order upper right, right, lower right, lower left, left, upper left (public/place.js ring): the order
// is exact, the angles are approximate.
import { ring, neighbour } from "./place.js";

export const MARK = { new: ".", entered: "o", cleared: "O" };
// where each of the six cells is drawn (row, column) and the line out to it: [row, column, text]
const NODE = [[0, 18], [2, 22], [4, 18], [4, 10], [2, 6], [0, 10]];
const LINE = [[1, 17, "/"], [2, 16, "------"], [3, 17, "\\"], [3, 11, "/"], [2, 7, "------"], [1, 11, "\\"]];

// Which of the six cells the first room's walls without a door lead out to (a wall with a door goes into the wing, not out):
// [bool x6], by `ring` order. Walking out a wall goes to `neighbour(cell, wall)`, one of the six.
export function exitSlots(cell, floor) {
  const around = ring(cell), room = floor && floor.rooms[0];
  const links = [false, false, false, false, false, false];
  if (!room) return links;
  for (const d of ["N", "E", "S", "W"]) if (room.doors[d] === undefined) { const k = around.indexOf(neighbour(cell, d)); if (k >= 0) links[k] = true; }
  return links;
}

// `area` is the server's { here, ring: [six states] } (or null before it arrives), `links` the [bool x6] from exitSlots.
// Returns the 5 rows of the map panel (29 wide), the same size as the room map.
export function areaMap(area, links = []) {
  const rows = Array.from({ length: 5 }, () => Array(29).fill(" "));
  const put = (r, c, s) => [...s].forEach((ch, k) => { rows[r][c + k] = ch; });
  put(2, 13, "[@]");
  NODE.forEach(([r, c], k) => {
    if (links[k]) put(...LINE[k]);
    put(r, c, MARK[(area && area.ring && area.ring[k]) || "new"] || ".");
  });
  return rows.map((r) => r.join("").replace(/\s+$/, ""));
}
