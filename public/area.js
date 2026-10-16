// The AREA map: the zoomed-out view in the map panel (the `+/-` toggle). You are [@] in the middle, with the six cells around
// you in a ring, north up (it does not turn with you). Each cell is one mark for what you have done in it (the server's
// answer, POST /api/area):  .  new    o  entered (stood in a room)    O  cleared (walked its first wing)
// The ring is in order upper right, right, lower right, lower left, left, upper left (public/place.js ring): the order
// is exact, the angles are approximate.
export const MARK = { new: ".", entered: "o", cleared: "O" };

// `area` is the server's { here, ring: [six states] } (or null before it arrives). Returns the 5 rows of the map panel
// (29 wide), the same size as the room map.
export function areaMap(area) {
  const rows = Array.from({ length: 5 }, () => Array(29).fill(" "));
  const put = (r, c, s) => [...s].forEach((ch, k) => { rows[r][c + k] = ch; });
  put(2, 13, "[@]");
  const at = [[1, 18], [2, 22], [3, 18], [3, 10], [2, 6], [1, 10]];                // upper right, right, lower right, lower left, left, upper left
  at.forEach(([r, c], k) => put(r, c, MARK[(area && area.ring && area.ring[k]) || "new"] || "."));
  return rows.map((r) => r.join("").replace(/\s+$/, ""));
}
