// What a room hides each day (src/search.js), alone.
import test from "node:test";
import assert from "node:assert/strict";
import { hides, WALLS, ODDS, COUNTS } from "../src/search.js";

const room = (doors) => ({ doors });
const count = (n, f) => { const m = {}; for (let i = 0; i < n; i++) { const k = f(i); m[k] = (m[k] || 0) + 1; } return m; };

test("the same room and day always hide the same things; another day or room hides other things", () => {
  const r = room({ N: 1 }), a = hides(r, "c|0:3|20000");
  assert.deepEqual(hides(r, "c|0:3|20000"), a);
  const diff = count(60, (i) => JSON.stringify(hides(r, `c|0:3|${20001 + i}`))); assert.ok(Object.keys(diff).length > 30);
});

test("it hides behind walls, never doors; a wall with a door isn't listed, and no wall free means nothing hidden", () => {
  for (let i = 0; i < 200; i++) assert.deepEqual(Object.keys(hides(room({ N: 1, E: 2 }), "x" + i)), ["S", "W"]);
  assert.deepEqual(hides(room({ N: 1, E: 2, S: 3, W: 4 }), "x"), {});
  assert.deepEqual(Object.keys(hides(room({ N: 1, E: 2, S: 3 }), "y")), ["W"]);
});

test("a wall hides 0 to 3 things, about 30 / 35 / 25 / 10 percent of the time", () => {
  const n = count(4000, (i) => hides(room({}), "n" + i).N.length);
  assert.deepEqual(COUNTS.map(([c]) => c), [0, 1, 2, 3]);
  assert.deepEqual(Object.keys(n).map(Number).sort(), [0, 1, 2, 3]);
  for (const [c, w] of COUNTS) assert.ok(Math.abs(n[c] - w * 40) < 160, c + " things: " + n[c]);
  const walls = count(4000, (i) => hides(room({}), "w" + i).E.length > 0), none = count(4000, (i) => Object.values(hides(room({}), "w" + i)).every((l) => !l.length));
  assert.ok(walls.true > 2000 && none.true > 40, "most walls hold something; some rooms hold nothing at all");
});

test("the first thing needs 3 to 6 searches; each later one costs half again as much, rounded up", () => {
  const first = count(2000, (i) => { const l = hides(room({}), "f" + i).N; return l.length ? l[0].need : 0; });
  assert.deepEqual(Object.keys(first).map(Number).sort((a, b) => a - b), [0, 3, 4, 5, 6]);
  for (let i = 0; i < 400; i++) { const l = hides(room({}), "t" + i).N; if (l.length < 2) continue; const base = l[0].need; l.forEach((t, k) => assert.equal(t.need, Math.ceil(base * 1.5 ** k))); }
});

test("rarities come out about 60 / 30 / 10", () => {
  const rar = count(3000, (i) => { const l = hides(room({}), "r" + i).N; return l.length ? l[0].rarity : "none"; });
  const total = 3000 - rar.none;
  assert.deepEqual(ODDS.map(([n]) => n), ["common", "uncommon", "rare"]);
  assert.ok(Math.abs(rar.common - total * 0.6) < 120 && Math.abs(rar.uncommon - total * 0.3) < 100 && Math.abs(rar.rare - total * 0.1) < 70, JSON.stringify(rar));
});
