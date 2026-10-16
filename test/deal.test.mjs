import test from "node:test";
import assert from "node:assert/strict";
import { deck, dealt, deckKey } from "../src/deal.js";

const pool = (n, from = 1) => Array.from({ length: n }, (_, i) => ({ id: from + i }));
const KEY = deckKey("8a464b96ab2ffff", 3, "2026-10-16", "common");
const sameSet = (a, b) => assert.deepEqual([...a].sort((x, y) => x - y), [...b].sort((x, y) => x - y));

test("a deck holds every item of the pool exactly once", () => {
  for (const n of [1, 2, 12, 36, 52]) sameSet(deck(pool(n), KEY), pool(n).map((i) => i.id));
});

test("the same key always gives the same deck, whatever order the pool comes in", () => {
  const p = pool(12), reversed = [...p].reverse();
  assert.deepEqual(deck(p, KEY), deck(p, KEY));
  assert.deepEqual(deck(reversed, KEY), deck(p, KEY));
});

test("a different room, day, cell or rarity gives a different order", () => {
  const p = pool(12), base = deck(p, KEY).join();
  for (const k of [deckKey("8a464b96ab2ffff", 4, "2026-10-16", "common"), deckKey("8a464b96ab2ffff", 3, "2026-10-17", "common"),
    deckKey("8a29a1d7575ffff", 3, "2026-10-16", "common"), deckKey("8a464b96ab2ffff", 3, "2026-10-16", "uncommon")]) assert.notEqual(deck(p, k).join(), base);
});

test("the first pool-size takers from a room-day all get different kinds", () => {
  const p = pool(12), got = Array.from({ length: 12 }, (_, n) => dealt(p, KEY, n));
  assert.equal(new Set(got).size, 12); sameSet(got, p.map((i) => i.id));
});

test("after the deck runs out it is shuffled again: each round is a full set, and the rounds differ", () => {
  const p = pool(12), at = (r) => Array.from({ length: 12 }, (_, n) => dealt(p, KEY, r * 12 + n));
  for (const r of [0, 1, 2, 7]) sameSet(at(r), p.map((i) => i.id));
  assert.notEqual(at(0).join(), at(1).join()); assert.notEqual(at(1).join(), at(2).join());
});

test("any pool-size run of takers that starts a round is all different, for many rooms and days", () => {
  const p = pool(12);
  for (let room = 0; room < 40; room++) for (const day of ["2026-10-16", "2026-12-25"]) {
    const k = deckKey("8a464b96ab2ffff", room, day, "common");
    assert.equal(new Set(Array.from({ length: 12 }, (_, n) => dealt(p, k, n))).size, 12);
  }
});

test("the shuffle is fair: over many room-days each item leads about equally often", () => {
  const p = pool(12), lead = new Map();
  for (let room = 0; room < 1200; room++) { const id = dealt(p, deckKey("8a464b96ab2ffff", room, "2026-10-16", "common"), 0); lead.set(id, (lead.get(id) || 0) + 1); }
  assert.equal(lead.size, 12);
  for (const n of lead.values()) assert.ok(n > 60 && n < 140, "each of 12 items should lead about 100 of 1200 times, got " + n);
});

test("an empty pool deals nothing; a pool of one deals it every time", () => {
  assert.equal(dealt([], KEY, 0), null); assert.deepEqual(deck([], KEY), []);
  for (let n = 0; n < 5; n++) assert.equal(dealt(pool(1, 47), KEY, n), 47);
});

test("items in the pool are dealt by id, so a retired item left out of the pool is never dealt", () => {
  const p = pool(12).filter((i) => i.id !== 5);
  for (let n = 0; n < 22; n++) assert.notEqual(dealt(p, KEY, n), 5);
});
