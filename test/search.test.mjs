// What a room hides each day (src/search.js), alone.
import test from "node:test";
import assert from "node:assert/strict";
import { hides, WALLS, ODDS } from "../src/search.js";

const room = (doors) => ({ doors });
const count = (n, f) => { const m = {}; for (let i = 0; i < n; i++) { const k = f(i); m[k] = (m[k] || 0) + 1; } return m; };

test("the same room and day always hide the same thing; another day or room hides another", () => {
  const r = room({ N: 1 }), a = hides(r, "c|0:3|20000");
  assert.deepEqual(hides(r, "c|0:3|20000"), a);
  const diff = count(60, (i) => JSON.stringify(hides(r, `c|0:3|${20001 + i}`))); assert.ok(Object.keys(diff).length > 10);
});

test("it hides behind a wall, never a door; no wall free means nothing hidden", () => {
  for (let i = 0; i < 200; i++) assert.ok(!["N", "E"].includes(hides(room({ N: 1, E: 2 }), "x" + i).wall));
  assert.equal(hides(room({ N: 1, E: 2, S: 3, W: 4 }), "x"), null);
  assert.equal(hides(room({ N: 1, E: 2, S: 3 }), "y").wall, "W");
});

test("it needs 5 to 10 searches, so nothing turns up on a first look", () => {
  const needs = count(600, (i) => hides(room({}), "n" + i).need);
  assert.deepEqual(Object.keys(needs).map(Number).sort((a, b) => a - b), [5, 6, 7, 8, 9, 10]);
  for (const n of Object.values(needs)) assert.ok(n > 60 && n < 140, "each need should come up about 100 times of 600, got " + n);
});

test("rarities come out about 60 / 30 / 10, and every wall gets hidden things", () => {
  const rar = count(3000, (i) => hides(room({}), "r" + i).rarity);
  assert.deepEqual(ODDS.map(([n]) => n), ["common", "uncommon", "rare"]);
  assert.ok(Math.abs(rar.common - 1800) < 150 && Math.abs(rar.uncommon - 900) < 130 && Math.abs(rar.rare - 300) < 90, JSON.stringify(rar));
  const walls = count(800, (i) => hides(room({}), "w" + i).wall);
  assert.deepEqual(Object.keys(walls).sort(), [...WALLS].sort());
  for (const n of Object.values(walls)) assert.ok(n > 140 && n < 260);
});
