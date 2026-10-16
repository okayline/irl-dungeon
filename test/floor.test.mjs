// src/floor.js is 4Dungeon's floor generator. These tests check 4Dungeon's documented rules from outside,
// by walking floors the way a player does, never by asking the code what it thinks the answer is.
import test from "node:test";
import assert from "node:assert/strict";
import FLOOR from "../public/floor.js";

const seeds = (n) => Array.from({ length: n }, (_, i) => [Math.imul(i + 1, 2654435761) >>> 0, Math.imul(i + 9, 40503) >>> 0, 3 + (i % 5)]);

// Unbuilt, unsealed locked doors on the newest wing (they can be on any of its rooms).
function openable(f) {
  const wing = f.wings.length - 1, out = [];
  f.rooms.forEach((r, from) => {
    if (!r || r.wing !== wing) return;
    for (const [d, to] of Object.entries(r.doors)) if (!f.rooms[to] && !FLOOR.isSealed(f, from, d)) out.push([from, d]);
  });
  return out;
}
function walk(seed, pseed, days, pick = 0) {
  const f = FLOOR.generate(seed, pseed, { days });
  for (let g = 0; g < 20; g++) { const o = openable(f); if (!o.length) break; const [from, d] = o[pick % o.length]; FLOOR.grow(f, from, d); }
  return f;
}
const snap = (f) => JSON.stringify(f);

test("same seeds make the same floor; a different shared seed makes a different one", () => {
  for (const [s, p, d] of seeds(200)) assert.equal(snap(walk(s, p, d)), snap(walk(s, p, d)));
  assert.notEqual(snap(walk(1, 5, 5)), snap(walk(2, 5, 5)));
});

test("wings are three spaces; the only other size is the rare one-space fallback", () => {
  let solo = 0, total = 0;
  for (const [s, p, d] of seeds(2000)) for (const w of walk(s, p, d).wings) {
    total++;
    assert.ok(w.rooms.length === 3 || w.rooms.length === 1, `wing of ${w.rooms.length}`);
    if (w.rooms.length === 1) solo++;
  }
  assert.ok(solo / total < 0.01, `${solo} of ${total} wings were one space`);
});

test("early wings hang two locked doors; the wing at `pairs` hangs the one wildcard; later wings none", () => {
  for (const [s, p, d] of seeds(1000)) {
    const f = walk(s, p, d);
    if (f.stuck) continue;
    f.wings.forEach((w, st) => {
      const want = st < f.pairs ? 2 : st === f.pairs ? 1 : 0;
      assert.equal(w.exits.length, want, `stage ${st} of ${f.wings.length}`);
    });
  }
});

test("opening one of a wing's two doors seals the other", () => {
  for (const [s, p, d] of seeds(300)) {
    const f = FLOOR.generate(s, p, { days: d });
    const o = openable(f);
    if (o.length < 2) continue;
    const [from, dir] = o[0];
    FLOOR.grow(f, from, dir);
    const sealed = o.slice(1).filter(([a, b]) => FLOOR.isSealed(f, a, b));
    assert.ok(sealed.length >= 1, "the other door should be sealed");
  }
});

test("growing the same door twice changes nothing", () => {
  for (const [s, p, d] of seeds(300)) {
    const f = FLOOR.generate(s, p, { days: d }), o = openable(f);
    if (!o.length) continue;
    FLOOR.grow(f, ...o[0]);
    const once = snap(f);
    FLOOR.grow(f, ...o[0]);
    assert.equal(snap(f), once);
  }
});

test("no two rooms share a map position", () => {
  for (const [s, p, d] of seeds(1000)) {
    const f = walk(s, p, d), seen = new Set();
    f.rooms.forEach((r, i) => { if (!r) return; const k = JSON.stringify(f.pos[i]); assert.ok(!seen.has(k), "overlap"); seen.add(k); });
  }
});

test("stairs end up built in a walked, unstuck floor", () => {
  for (const [s, p, d] of seeds(1000)) { const f = walk(s, p, d); if (!f.stuck) assert.ok(f.rooms[f.stairs], "stairs not built"); }
});

test("rooms are empty: only position, doors, wing and passage/dead-end flags", () => {
  for (const [s, p, d] of seeds(300)) for (const r of walk(s, p, d).rooms) if (r)
    for (const k of Object.keys(r)) assert.ok(["r", "c", "doors", "wing", "hall", "dead"].includes(k), `unexpected room field ${k}`);
});

test("KNOWN GAP: a walk can strand a floor with one-space wings (about 1 in 700 on days 6-7 with this walk). Recorded, not hidden.", () => {
  let stuck = 0;
  for (const [s, p, d] of seeds(20000)) if (walk(s, p, d).stuck) stuck++;
  assert.ok(stuck > 0 && stuck < 100, `stuck=${stuck}`);
});
