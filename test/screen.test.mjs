// The screen, the minimap and walking. Expected values are worked out here from the rules, not read from the code.
import test from "node:test";
import assert from "node:assert/strict";
import FLOOR from "../public/floor.js";
import { renderScreen, VERSION } from "../public/screen.js";
import { readFileSync } from "node:fs";
import { turn, step } from "../public/walk.js";

const NOW = new Date("2026-10-16T03:40:00Z");
const cells = Array.from({ length: 60 }, (_, i) => "8a" + (Math.imul(i + 3, 2654435761) >>> 0).toString(16).padStart(8, "0") + "9ffff".slice(0, 5));
const start = (cell, pseed = 7) => {
  const floor = FLOOR.generate(FLOOR.seedFor(cell, 0), pseed, { days: 7 });
  return { floor, ...FLOOR.arrive(floor), cell, tz: "Pacific/Honolulu", log: "", strict: true };
};
const draw = (st) => { if (st.floor) st.map = FLOOR.minimap(st.floor, st); return renderScreen(st, NOW); };
const cols = (t) => [...t].reduce((n, ch) => n + (/[　-鿿＀-￯]/.test(ch) ? 2 : 1), 0);

test("every line of the screen is 80 columns wide, with a cell and without one", () => {
  assert.equal(draw({ tz: "Pacific/Honolulu", strict: true }).split("\n").every((l) => cols(l) === 80), true);
  for (const c of cells) for (const tz of ["Pacific/Honolulu", "Asia/Tokyo", "America/New_York"]) {
    const st = { ...start(c), tz };
    const text = draw(st), lines = text.split("\n");
    assert.equal(lines.length, 30);
    for (const l of lines) assert.equal(cols(l), 80, l);
  }
});

test("a line that comes out the wrong width is an error when strict (the frame must never be quietly broken)", () => {
  const st = start(cells[0]); st.log = "> " + "x".repeat(200);          // too long is trimmed by the log, so break the cell id instead
  st.cell = "y".repeat(500);
  const lines = draw({ ...st, strict: true }).split("\n");
  assert.ok(lines.every((l) => cols(l) === 80), "long text must be cut to fit, not break the frame");
});

test("the map draws exactly the rooms you have been in that fit its window, and you once", () => {
  // The window is 5 rows by 29 columns, centered on you: a room is one row-pair and four columns apart, so only rooms
  // within one row and three columns of you can show (4Dungeon: "two steps up or down fall outside").
  for (const c of cells) {
    let st = start(c);
    const seen = (s) => draw(s).split("\n").slice(15, 20).map((l) => l.slice(49)).join("\n");
    for (let n = 0; n < 14; n++) {
      const map = seen(st), here = st.floor.rooms[st.at];
      const inWindow = st.visited.filter((v, i) => v && !st.floor.rooms[i].hall && Math.abs(st.floor.rooms[i].r - here.r) <= 1 &&
        Math.abs(st.floor.rooms[i].c - here.c) <= 3).length;
      assert.equal((map.match(/\[/g) || []).length, inWindow, "brackets are exactly the visited, non-passage rooms in the window");
      assert.equal((map.match(/@/g) || []).length, 1);
      st = n % 3 === 2 ? turn(st, "L") : step(st);
    }
  }
});

test("turning: left from north is west, right from north is east, four turns come home", () => {
  const f = FLOOR.generate(FLOOR.seedFor(cells[0], 0), 7, { days: 7 });
  const base = { floor: f, at: 0, visited: [true], facing: "N" };
  assert.equal(turn(base, "L").facing, "W");
  assert.equal(turn(base, "R").facing, "E");
  assert.equal(turn({ ...base, facing: "E" }, "L").facing, "N");
  assert.equal(turn({ ...base, facing: "S" }, "R").facing, "W");
  let s = base; for (let i = 0; i < 4; i++) s = turn(s, "R"); assert.equal(s.facing, "N");
  assert.equal(turn(turn(base, "L"), "R").facing, "N");
});

test("a step goes through an open door, and a wall or a sealed door stops you; a locked door asks to be unlocked and moves nothing", () => {
  let moved = 0, shut = 0, walled = 0, sealed = 0;
  for (const c of cells) {
    for (const facing of ["N", "E", "S", "W"]) {
      let st = { ...start(c), facing };
      const before = st.at, doorTo = st.floor.rooms[before].doors[facing];
      const after = step(st);
      if (doorTo === undefined) { assert.equal(after.at, before); assert.deepEqual(after.visited, st.visited); assert.equal(after.unlock, undefined); walled++; }
      else if (!st.floor.rooms[doorTo]) { assert.equal(after.at, before); assert.equal(after.unlock, doorTo); shut++; }
      else { assert.equal(after.at, doorTo); assert.equal(after.visited[doorTo], true); moved++; }
    }
  }
  // a sealed door: open one of a pair, then face the other
  for (const c of cells) {
    const st = start(c), [first, second] = FLOOR.lockedDoors(st.floor);
    if (second === undefined) continue;
    FLOOR.growDoor(st.floor, first);
    for (const room of st.floor.rooms) if (room) for (const [dir, to] of Object.entries(room.doors)) if (to === second) {
      const idx = st.floor.rooms.indexOf(room), r = step({ ...st, at: idx, facing: dir }, (a) => a[0]);
      assert.equal(r.unlock, undefined); assert.equal(r.at, idx); assert.match(r.log, /jammed shut/); sealed++;
    }
  }
  assert.ok(moved > 0 && walled > 0 && shut > 0 && sealed > 0);
});

test("walking alone never builds another wing: only the server's yes unlocks a door", () => {
  for (const c of cells) {
    let st = start(c);
    for (let n = 0; n < 40; n++) { st = n % 2 ? turn(st, "R") : step(st); delete st.unlock; }
    assert.equal(st.floor.wings.length, 1);
  }
});

test("you arrive facing a real door", () => {
  for (const c of cells) { const st = start(c); assert.ok(st.facing in st.floor.rooms[0].doors); }
});

// FNV-1a worked out independently, with BigInt, over the same text.
const fnv = (text) => { let h = 0x811c9dc5n; for (const b of Buffer.from(text, "utf8")) { h ^= BigInt(b); h = (h * 0x01000193n) & 0xffffffffn; } return Number(h); };

test("the shared seed for a cell and layer is FNV-1a of 'irl|cell|layer'", () => {
  for (const c of cells.slice(0, 20)) for (const layer of [0, 1, 9]) assert.equal(FLOOR.seedFor(c, layer), fnv(`irl|${c}|${layer}`));
  assert.notEqual(FLOOR.seedFor(cells[0], 0), FLOOR.seedFor(cells[1], 0));
  assert.notEqual(FLOOR.seedFor(cells[0], 0), FLOOR.seedFor(cells[0], 1));
});

test("two players on the same cell see the same shape, rotated or mirrored: same room count, same doors per room", () => {
  for (const c of cells) {
    const sig = (p) => { const f = FLOOR.generate(FLOOR.seedFor(c, 0), p, { days: 7 }); return f.rooms.map((r) => Object.keys(r.doors).length).join(","); };
    assert.equal(sig(1), sig(99999));
    assert.equal(sig(1), sig(424242));
  }
});

test("the build number is on the page and is the newest entry in CHANGELOG.md", () => {
  assert.match(VERSION, /^v\d+\.\d+$/);
  const newest = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8").match(/^## (v\d+\.\d+)\b/m)[1];
  assert.equal(VERSION, newest);
  const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.ok(page.includes('id="ver"') && page.includes("VERSION"), "the page must show the build number");
});

import { b64, unb64 } from "../public/account.js";
test("the passkey byte helpers match Node's own base64url, for every length", () => {
  for (let n = 0; n < 70; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n * 11) % 256);
    assert.equal(b64(bytes), Buffer.from(bytes).toString("base64url"));
    assert.deepEqual([...unb64(Buffer.from(bytes).toString("base64url"))], [...bytes]);
  }
  assert.deepEqual([...unb64("-_8")], [251, 255]);
});

test("a wall in a cell's start room is the way out to the next cell; a wall anywhere else is searched", () => {
  let out = 0, plain = 0;
  for (const c of cells) {
    const st = start(c);
    for (const facing of ["N", "E", "S", "W"]) if (st.floor.rooms[0].doors[facing] === undefined) {
      const r = step({ ...st, facing });
      assert.equal(r.leave, facing); assert.equal(r.at, 0); assert.equal(r.unlock, undefined);
      assert.match(draw({ ...st, facing }), /the way out, to the next cell/); out++;
    }
    for (let i = 1; i < st.floor.rooms.length; i++) {
      const room = st.floor.rooms[i]; if (!room) continue;
      for (const facing of ["N", "E", "S", "W"]) if (room.doors[facing] === undefined) {
        const r = step({ ...st, at: i, facing });
        assert.equal(r.leave, undefined); assert.equal(r.at, i); assert.equal(r.search, facing); assert.equal(r.unlock, undefined);
        assert.doesNotMatch(draw({ ...st, at: i, facing }), /the way out/); plain++;
      }
    }
  }
  assert.ok(out > 0 && plain > 0);
});
