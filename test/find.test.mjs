// Searching walls and finding items, against the real Worker: what is saved, who gets what, and what is refused.
// Expected values come from raw SQL, hand counts and the fixture table in helpers.mjs (ids 1-12 common, 13-24 uncommon, 25-36 rare).
import test from "node:test";
import assert from "node:assert/strict";
import FLOOR from "../public/floor.js";
import { arrive, load, forward, MISSES, NOISES } from "../public/play.js";
import { hides, WALLS, NEAR_AFTER } from "../src/search.js";
import { makeEnv, browser } from "./helpers.mjs";

const CELL = "8a464b96ab2ffff", FAR = "8a29a1d7575ffff";
const NOON = Date.UTC(2026, 9, 16, 22, 0), DAY = 86400000;
const world = () => { const env = makeEnv(); env.clock = () => env.now; env.now = NOON; return env; };
const sql = (env, q, ...a) => env.DB.raw.prepare(q).all(...a);
const dayOf = (ms) => Math.floor((ms - 600 * 60000) / DAY);
const floor = FLOOR.generate(FLOOR.seedFor(CELL, 0), undefined, { days: FLOOR.DAYS });
const rooms0 = floor.wings[0].rooms.filter((i) => i !== floor.start);
const base = (ms, room) => `${CELL}|0:${room}|${dayOf(ms)}`;
const plan = (ms, room) => hides(floor.rooms[room], base(ms, room));
// A room, wall and list of things for that day, worked out here from the rules (never from the Worker): the first room
// of the wing with a wall that hides at least `min` things (and, with `bare`, another wall that hides none).
function spot(ms, min = 1, { bare = false, skip = [] } = {}) {
  for (const room of rooms0) {
    if (skip.includes(room)) continue;
    const h = plan(ms, room), wall = Object.keys(h).find((w) => h[w].length >= min);
    if (!wall) continue;
    const empty = Object.keys(h).find((w) => !h[w].length);
    if (bare && !empty) continue;
    return { room, wall, things: h[wall], empty };
  }
  assert.fail("no room with a wall of " + min + " things on that day");
}
const cum = (things, k) => things.slice(0, k + 1).reduce((n, t) => n + t.need, 0);       // searches to have found the first k+1
async function player(env, ip) {
  const me = browser(env, { ip }); await me("/api/run", { cell: CELL, offset: -600 });
  const search = (dir, room, cell = CELL) => me("/api/search", { cell, room, dir, offset: -600 });
  return { me, search };
}
// search a wall until something is found; returns { calls, last }
async function untilFound(p, wall, room) {
  for (let calls = 1; calls <= 40; calls++) { const r = await p.search(wall, room); if (r.data.result === "found" || r.data.result === "done") return { calls, last: r.data }; }
  assert.fail("nothing turned up in 40 searches");
}
const sizeOf = (env, rarity) => env.ITEMS.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE rarity = ? AND retired = 0 AND source = '4dungeon'").get(rarity).n;     // 12 of each: dungeon items only (v0.21), the button (37) is never dealt

test("the fixture has walls to search: some with one thing, some with several, some bare", () => {
  const s1 = spot(NOON, 1), s2 = spot(NOON, 2), b = spot(NOON, 1, { bare: true });
  assert.ok(floor.rooms[s1.room].doors[s1.wall] === undefined && s1.things.length >= 1);
  assert.ok(s2.things.length >= 2 && b.empty);
});

test("the rules: 0 to 3 things per wall, each needing 3 to 6 searches (half again more for each find before it), no thing behind a door", () => {
  const seen = new Set();
  for (let d = 0; d < 400; d++) for (const [wall, list] of Object.entries(hides(floor.rooms[rooms0[0]], `x|${d}`))) {
    assert.equal(floor.rooms[rooms0[0]].doors[wall], undefined);
    assert.ok(list.length <= 3); seen.add(list.length);
    list.forEach((t, k) => assert.ok(t.need >= Math.ceil(3 * 1.5 ** k) && t.need <= Math.ceil(6 * 1.5 ** k)));
  }
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3]);
});

test("a bare wall never answers; a wall with things gives nothing on the first looks, then an item", async () => {
  const env = world(), p = await player(env, "198.51.100.1"), s = spot(NOON, 1, { bare: true });
  for (let i = 0; i < 15; i++) assert.deepEqual((await p.search(s.empty, s.room)).data, { result: "miss" });
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM finds")[0].n, 0);
  const need = s.things[0].need;
  for (let i = 1; i < need; i++) assert.equal((await p.search(s.wall, s.room)).data.result, "miss", "search " + i + " of " + need);
  const r = (await p.search(s.wall, s.room)).data;
  assert.equal(r.result, "found");
  const row = sql(env, "SELECT * FROM finds")[0], t = s.things[0];
  assert.equal(sql(env, "SELECT searches, wall FROM search_prog")[0].searches, need);
  assert.deepEqual([row.rarity, row.spot, row.day, row.wall, row.slot, row.deck_pos, row.copy], [t.rarity, "0:" + s.room, dayOf(NOON), s.wall, 0, 0, 1]);
  assert.equal(r.item.id, row.item_id); assert.equal(r.item.rarity, t.rarity); assert.equal(r.item.copy, 1);
  const lo = { common: 1, uncommon: 13, rare: 25 }[t.rarity];
  assert.ok(row.item_id >= lo && row.item_id < lo + 12, "a dungeon item of the thing's rarity");
  assert.notEqual(row.item_id, 38, "a retired item is never dealt");
});

test("a wall with several things gives them one after another, each costing more, then nothing more", async () => {
  const env = world(), p = await player(env, "198.51.100.4"), s = spot(NOON, 2), found = [];
  for (let n = 1; n <= cum(s.things, s.things.length - 1) + 3; n++) {
    const r = (await p.search(s.wall, s.room)).data;
    if (r.result === "found") found.push(n);
    if (n > cum(s.things, s.things.length - 1)) assert.deepEqual(r, { result: "done" });
  }
  assert.deepEqual(found, s.things.map((_, k) => cum(s.things, k)));
  assert.deepEqual(sql(env, "SELECT slot, rarity FROM finds ORDER BY id").map((r) => ({ slot: r.slot, rarity: r.rarity })), s.things.map((t, k) => ({ slot: k, rarity: t.rarity })));
  assert.equal(sql(env, "SELECT searches FROM search_prog")[0].searches, cum(s.things, s.things.length - 1), "searches after the last thing aren't counted");
});

test("walls are worked separately: finds on two walls of one room, and progress on one doesn't help the other", async () => {
  const env = world(), p = await player(env, "198.51.100.6");
  const room = rooms0.find((i) => Object.values(plan(NOON, i)).filter((l) => l.length).length >= 2);
  assert.ok(room !== undefined, "a room with two walls that hide things");
  const walls = Object.keys(plan(NOON, room)).filter((w) => plan(NOON, room)[w].length), [a, b] = walls;
  for (let i = 0; i < plan(NOON, room)[a][0].need - 1; i++) await p.search(a, room);
  const rb = (await p.search(b, room)).data;
  assert.equal(rb.result, plan(NOON, room)[b][0].need === 1 ? "found" : "miss");
  await untilFound(p, a, room); await untilFound(p, b, room);
  assert.deepEqual(sql(env, "SELECT DISTINCT wall FROM finds ORDER BY wall").map((r) => r.wall), [a, b].sort());
});

test("near-miss noises come only on a wall with things and only once enough searches are in on the thing being worked at", async () => {
  const env = world(), s = spot(NOON, 1, { bare: true }), p = await player(env, "198.51.100.2");
  for (let i = 0; i < 40; i++) assert.ok(!(await p.search(s.empty, s.room)).data.noise, "never on a bare wall");
  const q = await player(env, "198.51.100.3"), seen = [];
  for (let i = 1; i < s.things[0].need; i++) seen.push((await q.search(s.wall, s.room)).data);
  for (let i = 0; i < Math.min(NEAR_AFTER - 1, seen.length); i++) assert.ok(!seen[i].noise, "not before " + NEAR_AFTER + " searches are in");
});

test("a noise comes exactly when enough searches are in on the thing being worked at, restarting for the next thing on the wall", async () => {
  const env = world(), s = spot(NOON, 2), p = await player(env, "198.51.100.8"), rnd = Math.random;
  Math.random = () => 0;                                   // every near-miss chance succeeds
  try {
    let into = 0, k = 0;
    while (k < 2) {
      const r = (await p.search(s.wall, s.room)).data; into++;
      if (r.result === "found") { k++; into = 0; continue; }
      assert.equal(!!r.noise, into >= NEAR_AFTER, "search " + into + " into thing " + k);
    }
  } finally { Math.random = rnd; }
});

test("a room-day dealing things of different rarities keeps a separate deck for each rarity", async () => {
  const env = world(); let found = null;
  for (let d = 0; d < 60 && !found; d++) for (const room of rooms0) { const h = plan(NOON + d * DAY, room); const wall = Object.keys(h).find((w) => h[w].length >= 2 && h[w][0].rarity !== h[w][1].rarity); if (wall) { found = { d, room, wall, things: h[wall] }; break; } }
  assert.ok(found, "a wall with two rarities within 60 days");
  env.now = NOON + found.d * DAY; const p = await player(env, "198.51.100.9");
  for (let i = 0; i < cum(found.things, 1); i++) await p.search(found.wall, found.room);
  assert.deepEqual(sql(env, "SELECT rarity, deck_pos FROM finds ORDER BY slot").map((r) => [r.rarity, r.deck_pos]), found.things.slice(0, 2).map((t) => [t.rarity, 0]));
});

test("two presses at the last search make one find, not two", async () => {
  const env = world(), p = await player(env, "198.51.100.7"), s = spot(NOON, 1);
  for (let i = 1; i < s.things[0].need; i++) await p.search(s.wall, s.room);
  const rs = await Promise.all([p.search(s.wall, s.room), p.search(s.wall, s.room)]);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM finds WHERE wall = ? AND slot = 0", s.wall)[0].n, 1);
  assert.deepEqual(rs.map((r) => r.status), [200, 200]);
  assert.deepEqual(rs.map((r) => r.data.result).sort(), s.things.length === 1 ? ["done", "found"] : ["found", "miss"]);
});

test("tomorrow the room hides something new, and the same player can find again", async () => {
  const env = world(), p = await player(env, "198.51.100.5"), a = spot(NOON, 1);
  await untilFound(p, a.wall, a.room);
  env.now += DAY;
  const b = spot(env.now, 1);
  await untilFound(p, b.wall, b.room);
  assert.deepEqual(sql(env, "SELECT day FROM finds ORDER BY id").map((r) => r.day), [dayOf(NOON), dayOf(NOON) + 1]);
});

test("as many players as there are kinds, taking from one wall on one day, each get a different item", async () => {
  const env = world(), s = spot(NOON, 1), t = s.things[0], got = [], size = sizeOf(env, t.rarity);
  for (let k = 0; k < size; k++) { const p = await player(env, "198.51.100." + (20 + k)); got.push((await untilFound(p, s.wall, s.room)).last.item.id); }
  assert.equal(new Set(got).size, size, size + " different kinds: " + got);
  assert.deepEqual(sql(env, "SELECT deck_pos FROM finds ORDER BY id").map((r) => r.deck_pos), Array.from({ length: size }, (_, i) => i));
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM finds WHERE item_id IN (37, 38)")[0].n, 0);   // no retired item, no 88x31 button
});

test("after every kind has been dealt, a second round starts: a kind repeats and its copy number counts up", async () => {
  const env = world(), s = spot(NOON, 1), t = s.things[0], got = [], size = sizeOf(env, t.rarity);
  for (let k = 0; k < size + 2; k++) { const p = await player(env, "198.51.100." + (50 + k)); got.push((await untilFound(p, s.wall, s.room)).last.item); }
  const first = new Set(got.slice(0, size).map((i) => i.id)); assert.equal(first.size, size);
  assert.ok(got.slice(size).every((i) => first.has(i.id)), "after the deck, kinds repeat");
  for (const i of got.slice(size)) assert.equal(i.copy, 2);
  assert.deepEqual(sql(env, "SELECT copy FROM finds ORDER BY id").slice(0, size).map((r) => r.copy), Array(size).fill(1));
});

test("different rooms on the same day deal their own decks", async () => {
  const env = world(), p = await player(env, "198.51.100.90"), a = spot(NOON, 1), b = spot(NOON, 1, { skip: [a.room] });
  await untilFound(p, a.wall, a.room); await untilFound(p, b.wall, b.room);
  assert.equal(sql(env, "SELECT COUNT(DISTINCT spot) AS n FROM finds")[0].n, 2);
});

test("what's refused: not a wall, a door, the start room, an unbuilt room, nonsense, no player", async () => {
  const env = world(), p = await player(env, "198.51.100.91"), n = () => sql(env, "SELECT COUNT(*) AS n FROM search_prog")[0].n;
  const ROOM = spot(NOON, 1).room, door = Object.keys(floor.rooms[ROOM].doors)[0];
  assert.equal((await p.search("X", ROOM)).status, 400);
  assert.match((await p.search(door, ROOM)).data.error, /isn't a wall/);
  const startWall = WALLS.find((d) => floor.rooms[floor.start].doors[d] === undefined);
  assert.match((await p.search(startWall, floor.start)).data.error, /way out/);
  assert.match((await p.search("N", 9999)).data.error, /isn't built/);
  assert.equal((await p.search("N", -1)).status, 400); assert.equal((await p.search("N", "3")).status, 400);
  assert.equal((await p.me("/api/search", { cell: "nope", room: ROOM, dir: "N", offset: -600 })).status, 400);
  assert.equal((await p.me("/api/search", { cell: CELL, room: ROOM, dir: "N", offset: 9999 })).status, 400);
  assert.equal((await browser(env, { ip: "198.51.100.92" })("/api/search", { cell: CELL, room: ROOM, dir: "N", offset: -600 })).status, 401);
  assert.equal(n(), 0);
});

test("a cell reached too fast earns nothing: the search is refused and nothing is saved", async () => {
  const env = world(), p = await player(env, "198.51.100.93");
  env.now += 60000; await p.me("/api/run", { cell: FAR, offset: -600 });
  const f2 = FLOOR.generate(FLOOR.seedFor(FAR, 0), undefined, { days: FLOOR.DAYS }), room = f2.wings[0].rooms.find((i) => i !== f2.start);
  const wall = WALLS.find((d) => f2.rooms[room].doors[d] === undefined);
  const r = await p.search(wall, room, FAR);
  assert.equal(r.status, 403); assert.match(r.data.error, /long way/);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM search_prog")[0].n, 0);
});

test("test mode: an admin sees what a find looks like, and nothing is saved", async () => {
  const env = world(), p = await player(env, "198.51.100.94"), s = spot(NOON, 1, { bare: true });
  env.DB.raw.exec("UPDATE players SET admin = 1, test_mode = 1 WHERE id = 1");
  const r = (await p.search(s.wall, s.room)).data;
  assert.equal(r.result, "found"); assert.equal(r.test, true); assert.equal(r.item.copy, null); assert.equal(r.item.rarity, s.things[0].rarity);
  assert.equal((await p.search(s.empty, s.room)).data.result, "miss");
  assert.deepEqual([sql(env, "SELECT COUNT(*) AS n FROM finds")[0].n, sql(env, "SELECT COUNT(*) AS n FROM search_prog")[0].n], [0, 0]);
});

test("GET /api/finds lists what a player found, newest first, with item details; another player sees none of it", async () => {
  const env = world(), p = await player(env, "198.51.100.95"), a = spot(NOON, 1);
  await untilFound(p, a.wall, a.room); env.now += DAY; const b = spot(env.now, 1); await untilFound(p, b.wall, b.room);
  const r = (await p.me("/api/finds")).data.finds, rows = sql(env, "SELECT item_id, day FROM finds ORDER BY id DESC");
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((f) => f.item.name), rows.map((x) => env.ITEMS.raw.prepare("SELECT name FROM items WHERE id = ?").get(x.item_id).name));
  assert.deepEqual(r.map((f) => f.day), ["2026-10-17", "2026-10-16"]);
  const stranger = await player(env, "198.51.100.96");
  assert.deepEqual((await stranger.me("/api/finds")).data.finds, []);
  assert.equal((await browser(env, { ip: "198.51.100.97" })("/api/finds")).status, 401);
});

test("the page: pressing into a wall searches it, a find comes back as a window, and a miss says a line of 4Dungeon's", async () => {
  const env = world(), me = browser(env, { ip: "198.51.100.98" }), calls = [], s = spot(NOON, 1, { bare: true });
  const api = async (path, body) => { calls.push(path); return (await me("/api/" + path, body)).data; };
  let st = await load(arrive(CELL), api, -600);
  st = { ...st, at: s.room, facing: s.empty, visited: st.visited };
  st = await forward(st, api, -600);
  assert.ok(calls.includes("search")); assert.match(st.log, /^> You search the (north|east|south|west) wall\.\.\. /);
  assert.ok(MISSES.some((m) => st.log.endsWith(" " + m)) && !st.popup);
  st = { ...st, facing: s.wall };
  for (let i = 1; i < s.things[0].need; i++) st = await forward(st, api, -600);
  assert.ok(!st.popup, "not before the last search");
  st = await forward(st, api, -600);
  assert.ok(st.popup && st.popup.name && st.popup.copy === 1); assert.match(st.log, new RegExp("You found " + st.popup.name + "!$"));
  assert.ok(NOISES.length === 6);
  // press on until the wall has given everything: then it says so
  for (let i = 0; i < 40 && !/Nothing more here today\.$/.test(st.log); i++) st = await forward({ ...st, popup: undefined }, api, -600);
  assert.match(st.log, /Nothing more here today\.$/);
  // in the start room the same press is the way out, never a search
  const before = calls.filter((c) => c === "search").length;
  const out = await forward({ ...st, at: floor.start, facing: WALLS.find((d) => floor.rooms[floor.start].doors[d] === undefined) }, api, -600);
  assert.ok(out.leave); assert.equal(calls.filter((c) => c === "search").length, before);
});

test("the database itself refuses a repeated find slot, a repeated deck place for a rarity, and a repeated copy; other rarities may share a place", () => {
  const env = world(); env.DB.raw.exec("INSERT INTO players (id, token_hash, created_at, seen_at) VALUES (1, 'a', 1, 1), (2, 'b', 1, 1)");
  const ins = (player, wall, slot, rarity, pos, item, copy) => env.DB.raw.prepare("INSERT INTO finds (player_id, cell, layer, spot, day, wall, slot, rarity, deck_pos, item_id, copy, created_at) VALUES (?, 'c', 0, '0:3', 5, ?, ?, ?, ?, ?, ?, 1)").run(player, wall, slot, rarity, pos, item, copy);
  ins(1, "N", 0, "common", 0, 1, 1);
  assert.throws(() => ins(1, "N", 0, "common", 1, 2, 1), /UNIQUE/);   // same player, wall and slot
  ins(1, "N", 1, "common", 1, 2, 1); ins(1, "E", 0, "common", 2, 3, 1);   // another slot, another wall: fine
  assert.throws(() => ins(2, "N", 0, "common", 0, 2, 2), /UNIQUE/);   // same deck place and rarity
  ins(2, "N", 0, "uncommon", 0, 14, 1);                               // another rarity has its own deck
  assert.throws(() => ins(2, "S", 0, "common", 3, 1, 1), /UNIQUE/);   // same copy of the same item
  ins(2, "S", 0, "common", 3, 1, 2);                                  // the next copy is fine
});

// ---- numbering by the shared registry (src/copies.js) ----
// finish one find for a player: search the right wall until found
async function oneFind(env, ip = "198.51.100.50") {
  const p = await player(env, ip), s = spot(NOON, 1);
  const r = await untilFound(p, s.wall, s.room);
  return { p, r, s };
}

test("a find is numbered by the registry, keyed by the find's own row id, with no cell or day sent", async () => {
  const env = world(), { r } = await oneFind(env);
  const row = sql(env, "SELECT * FROM finds")[0];
  assert.equal(env.REGISTRY.calls, 1);
  assert.deepEqual(env.REGISTRY.log[0], { itemId: row.item_id, game: "irl-dungeon", playerId: row.player_id, key: "irl-find:" + row.id });
  assert.equal(row.copy, 1); assert.equal(r.last.item.copy, 1);
});

test("numbers are shared with other games: copies already born elsewhere come first", async () => {
  const env = world();
  for (let id = 1; id <= 37; id++) for (let k = 0; k < 3; k++) await env.REGISTRY.birth({ itemId: id, game: "4dungeon", playerId: 1, key: `x${id}-${k}` });
  const { r } = await oneFind(env);
  assert.equal(r.last.item.copy, 4); assert.equal(sql(env, "SELECT copy FROM finds")[0].copy, 4);
});

test("registry down: the find is saved unnumbered and the player is still told the item", async () => {
  const env = world(); env.REGISTRY.down = true;
  const { r } = await oneFind(env);
  assert.equal(r.last.result, "found"); assert.ok(r.last.item.name); assert.equal(r.last.item.copy, null);
  assert.equal(sql(env, "SELECT copy FROM finds")[0].copy, null);
});

test("a waiting find is numbered the next time finds are listed, and no second copy is minted", async () => {
  const env = world(), { p } = await oneFind(env);
  const first = sql(env, "SELECT copy FROM finds")[0].copy, total = env.REGISTRY.total();
  env.DB.raw.exec("UPDATE finds SET copy = NULL");
  const l = (await p.me("/api/finds")).data;
  assert.equal(l.finds[0].copy, first); assert.equal(env.REGISTRY.total(), total);
  assert.equal(sql(env, "SELECT copy FROM finds")[0].copy, first);
});

test("a waiting find is numbered when the room is searched again (already found today)", async () => {
  const env = world(); env.REGISTRY.down = true;
  const { p, s } = await oneFind(env);
  env.REGISTRY.down = false;
  for (let i = 0; (await p.search(s.wall, s.room)).data.result !== "done" && i < 40; i++);
  assert.equal((await p.search(s.wall, s.room)).data.result, "done");
  assert.equal(sql(env, "SELECT copy FROM finds")[0].copy, 1);
});

test("a registry that refuses, or is not bound at all, leaves finds unnumbered without failing", async () => {
  const a = world(); a.REGISTRY.refuse = true; await oneFind(a);
  assert.equal(sql(a, "SELECT copy FROM finds")[0].copy, null);
  const b = world(); delete b.REGISTRY; const { r } = await oneFind(b);
  assert.equal(r.last.result, "found"); assert.equal(sql(b, "SELECT copy FROM finds")[0].copy, null);
});

test("players finding at once get distinct (item, copy) pairs", async () => {
  const env = world(), ps = [];
  for (let i = 0; i < 4; i++) ps.push(await player(env, "198.51.100." + (60 + i)));
  const s = spot(NOON, 1); await Promise.all(ps.map((p) => untilFound(p, s.wall, s.room)));
  const rows = sql(env, "SELECT item_id, copy FROM finds");
  assert.equal(rows.length, 4); assert.ok(rows.every((r) => Number.isInteger(r.copy)));
  assert.equal(new Set(rows.map((r) => r.item_id + ":" + r.copy)).size, 4);
});

test("test mode never calls the registry", async () => {
  const env = world(); const p = await player(env, "198.51.100.70");
  env.DB.raw.exec("UPDATE players SET admin = 1, test_mode = 1");
  const s = spot(NOON, 1), r = await p.search(s.wall, s.room);
  assert.equal(env.REGISTRY.calls, 0); assert.ok(r.data.result);
});

test("the database lets many finds wait for a number but never repeats a number", () => {
  const env = world(); env.DB.raw.exec("INSERT INTO players (id, token_hash, created_at, seen_at) VALUES (1, 'a', 1, 1)");
  const ins = (spot, pos, copy) => env.DB.raw.prepare("INSERT INTO finds (player_id, cell, layer, spot, day, wall, slot, rarity, deck_pos, item_id, copy, created_at) VALUES (1, 'c', 0, ?, 5, 'N', 0, 'common', ?, 1, ?, 1)").run(spot, pos, copy);
  ins("0:1", 0, null); ins("0:2", 0, null);
  ins("0:3", 0, 7); assert.throws(() => ins("0:4", 0, 7), /UNIQUE/);
});
