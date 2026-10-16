// Room names (public/roomnames.js) and the start room's exit marks on the minimap.
import test from "node:test";
import assert from "node:assert/strict";
import FLOOR from "../public/floor.js";
import { roomName, START_NAME } from "../public/roomnames.js";
import { renderScreen } from "../public/screen.js";

const CELL = "8a464b96ab2ffff";
function floor() { const f = FLOOR.generate(FLOOR.seedFor(CELL, 0), undefined, { days: FLOOR.DAYS }); for (const d of FLOOR.lockedDoors(f).slice(0, 3)) FLOOR.growDoor(f, d); return f; }

test("the first room is The way out; every other built room has a name from its list, unique on the floor and the same every time", () => {
  const f = floor(), g = floor(), names = [];
  assert.equal(roomName(f, 0), START_NAME);
  f.rooms.forEach((r, i) => { if (!r || i === 0) return; const n = roomName(f, i); names.push(n); assert.equal(roomName(g, i), n); assert.ok(n.length <= 11); });
  assert.ok(names.length > 3); assert.equal(new Set(names).size, names.length, names.join());
  f.rooms.forEach((r, i) => { if (r && r.hall) assert.ok(["Passageway", "Conduit", "Crawlway", "Corridor", "Walkway", "Service way"].includes(roomName(f, i))); });
});

test("the name shows in the panel's bottom left, under the map", () => {
  const f = floor(), st = { floor: f, ...FLOOR.arrive(f), cell: CELL, tz: "Pacific/Honolulu", log: "", strict: true };
  st.map = FLOOR.minimap(f, st);
  assert.match(renderScreen(st, new Date(Date.UTC(2026, 9, 16, 12))), /\| THE WAY OUT {18}\|/);
});

test("the start room's walls without a door lead out by a hallway to the map's edge: = sideways, : up and down; the way you came in ends in *", () => {
  const f = floor(), free = ["N", "E", "S", "W"].filter((d) => f.rooms[0].doors[d] === undefined);
  assert.ok(free.length >= 1);
  const at = (rows, r, c) => (rows[r] || "")[c] || " ";
  for (const d of free) {
    const rows = FLOOR.minimap(f, { at: 0, visited: [true], facing: free.find((x) => x !== d) || d });
    if (d === "E") assert.equal(rows[2].slice(16, 25), "=========");
    if (d === "W") assert.equal(rows[2].slice(4, 13), "=========");
    if (d === "S") assert.deepEqual([at(rows, 3, 14), at(rows, 4, 14)], [":", ":"]);
    if (d === "N") assert.deepEqual([at(rows, 1, 14), at(rows, 0, 14)], [":", ":"]);
    const came = FLOOR.minimap(f, { at: 0, visited: [true], facing: free.find((x) => x !== d) || d, came: d });
    const end = { E: at(came, 2, 24), W: at(came, 2, 4), S: at(came, 4, 14), N: at(came, 0, 14) }[d];
    assert.equal(end, "*", "the hallway you came in by ends in * on the " + d + " side");
  }
});
