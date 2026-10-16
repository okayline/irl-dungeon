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

test("the start room's walls without a door are marked as exits to the next cell: : on the sides, = above and below", () => {
  const f = floor(), st = { at: 0, visited: [true], facing: "N" }, rows = FLOOR.minimap(f, st);
  for (const d of ["N", "E", "S", "W"]) {
    const free = f.rooms[0].doors[d] === undefined;
    const ch = { N: rows[1][14], S: rows[3][14], E: rows[2][16], W: rows[2][12] }[d];
    if (free && d !== "N") assert.equal(ch, d === "S" ? "=" : ":", d);
  }
  const rows2 = FLOOR.minimap(f, { at: f.wings[0].rooms[1] ?? 0, visited: f.rooms.map((r, i) => i < 3), facing: "N" });
  assert.ok(rows2.length === 5);
});
