// The AREA map: the zoomed-out view in the map panel (the `+/-` toggle). North is always up (it does not turn with you). It
// shows the cell you are in and, along each wall of the first room that leads out, the next cell over that way, joined by a
// hallway like the one on the room map. A cell is drawn by what you have done in it (the server's answer, POST /api/area):
//   [ ] new   [.] entered (stood in a room)   [o] cleared (walked its first wing)   [@] here
// Walls of the first room that are doors into the wing lead nowhere out, so nothing is drawn on those sides.
export const MARK = { new: " ", entered: ".", cleared: "o" };

// `floor` is the cell's floor, `area` the server's { here, N, E, S, W } (or null before it arrives). Returns the 5 rows
// of the map panel (29 wide), the same size as the room map.
export function areaMap(floor, area) {
  const rows = Array.from({ length: 5 }, () => Array(29).fill(" "));
  const put = (r, c, s) => [...s].forEach((ch, k) => { rows[r][c + k] = ch; });
  const state = (d) => `[${MARK[(area && area[d]) || "new"] ?? " "}]`;
  put(2, 13, "[@]");
  const room = floor && floor.rooms[0], out = (d) => !!room && room.doors[d] === undefined;
  if (out("N")) { put(0, 13, state("N")); put(1, 14, ":"); }
  if (out("S")) { put(3, 14, ":"); put(4, 13, state("S")); }
  if (out("W")) { put(2, 8, "====="); put(2, 5, state("W")); }
  if (out("E")) { put(2, 16, "====="); put(2, 21, state("E")); }
  return rows.map((r) => r.join("").replace(/\s+$/, ""));
}
