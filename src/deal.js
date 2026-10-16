// Dealing items from a shuffled deck, so two players never get the same kind from the same room on the same day.
//
// A room-day has a DECK: every item of one rarity (the pool the caller passes), in an order shuffled from the key
// alone (cell, room, day, rarity). Nothing is stored for the deck; anyone can rebuild it. The n-th player to take
// from that room that day (n = 0, 1, 2...) gets the n-th card, so the first `pool.length` players all get different
// kinds. After that the deck is shuffled again (key + cycle) and dealing carries on: kinds repeat only then.
// Items are numbered copies, not scarce, so running out of kinds just means a second round.
//
// The shuffle is for fairness and variety, not secrecy, so a small fast hash and generator are enough.
function seedFrom(str) {                                    // xmur3: a string -> a 32-bit seed
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}
function rng(seed) {                                        // mulberry32
  return () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const deckKey = (cell, room, day, rarity) => `${cell}|${room}|${day}|${rarity}`;

// The deck for a key: item ids in dealt order. `pool` is a list of items ({ id }); its own order doesn't matter.
export function deck(pool, key, cycle = 0) {
  const ids = pool.map((i) => i.id).sort((a, b) => a - b);  // sorted first, so the same pool always shuffles the same way
  const rand = rng(seedFrom(cycle ? `${key}#${cycle}` : key));
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return ids;
}

// The id the n-th taker (0 first) gets, or null for an empty pool.
export function dealt(pool, key, n) {
  if (!pool.length) return null;
  return deck(pool, key, Math.floor(n / pool.length))[n % pool.length];
}

// ---------- the same generator, for the room's secret: where it hides, how hard it is, and how rare ----------
export { seedFrom, rng };
