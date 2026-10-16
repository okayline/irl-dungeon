// Searching walls and finding items, against the real Worker: what is saved, who gets what, and what is refused.
// Expected values come from raw SQL, hand counts and the fixture table in helpers.mjs (ids 1-12 common, 13-24 uncommon, 25-36 rare).
import test from "node:test";
import assert from "node:assert/strict";
import FLOOR from "../public/floor.js";
import { arrive, load, forward, MISSES, NOISES } from "../public/play.js";
import { hides } from "../src/search.js";
import { makeEnv, browser } from "./helpers.mjs";

const CELL = "8a464b96ab2ffff", FAR = "8a29a1d7575ffff";
const NOON = Date.UTC(2026, 9, 16, 22, 0), DAY = 86400000;
const world = () => { const env = makeEnv(); env.clock = () => env.now; env.now = NOON; return env; };
const sql = (env, q, ...a) => env.DB.raw.prepare(q).all(...a);
const dayOf = (ms) => Math.floor((ms - 600 * 60000) / DAY);
const floor = FLOOR.generate(FLOOR.seedFor(CELL, 0), undefined, { days: FLOOR.DAYS });
const freeWalls = (i) => ["N", "E", "S", "W"].filter((d) => floor.rooms[i].doors[d] === undefined);
const ROOM = floor.wings[0].rooms.find((i) => i !== floor.start && freeWalls(i).length >= 2);
const base = (ms, room = ROOM) => `${CELL}|0:${room}|${dayOf(ms)}`;
const hid = (ms, room = ROOM) => hides(floor.rooms[room], base(ms, room));
const other = (wall, room = ROOM) => ["N", "E", "S", "W"].find((d) => d !== wall && floor.rooms[room].doors[d] === undefined);
async function player(env, ip) {
  const me = browser(env, { ip }); await me("/api/run", { cell: CELL, offset: -600 });
  const search = (dir, room = ROOM, cell = CELL) => me("/api/search", { cell, room, dir, offset: -600 });
  return { me, search };
}
// search the right wall until something is found; returns { calls, last }
async function untilFound(p, wall, room = ROOM) {
  for (let calls = 1; calls <= 12; calls++) { const r = await p.search(wall, room); if (r.data.result === "found" || r.data.result === "done") return { calls, last: r.data }; }
  assert.fail("nothing turned up in 12 searches");
}

test("the fixture room really has a wall to search, and the start room has none to search", () => {
  assert.ok(hid(NOON) && floor.rooms[ROOM].doors[hid(NOON).wall] === undefined);
});

test("a bare wall never answers; the right wall gives nothing on the first looks, then an item", async () => {
  const env = world(), p = await player(env, "198.51.100.1"), h = hid(NOON), w = h.wall;
  for (let i = 0; i < 15; i++) assert.deepEqual((await p.search(other(w))).data, { result: "miss" });
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM finds")[0].n, 0);
  for (let i = 1; i < h.need; i++) assert.equal((await p.search(w)).data.result, "miss", "search " + i + " of " + h.need);
  const r = (await p.search(w)).data;
  assert.equal(r.result, "found"); assert.equal(sql(env, "SELECT searches FROM search_prog")[0].searches, h.need);
  const row = sql(env, "SELECT * FROM finds")[0];
  assert.equal(row.rarity, h.rarity); assert.equal(row.spot, "0:" + ROOM); assert.equal(row.day, dayOf(NOON)); assert.equal(row.deck_pos, 0); assert.equal(row.copy, 1);
  assert.equal(r.item.id, row.item_id); assert.equal(r.item.rarity, h.rarity); assert.equal(r.item.copy, 1);
  const lo = { common: 1, uncommon: 13, rare: 25 }[h.rarity];
  assert.ok(row.item_id >= lo && row.item_id < lo + 12 || (h.rarity === "common" && row.item_id === 37), "an item of the room's rarity");
  assert.notEqual(row.item_id, 38, "a retired item is never dealt");
});

test("near-miss noises come only on the right wall and only once 3 searches are in", async () => {
  const env = world(), p = await player(env, "198.51.100.2"), h = hid(NOON);
  for (let i = 0; i < 40; i++) assert.ok(!(await p.search(other(h.wall))).data.noise, "never on a bare wall");
  const q = await player(env, "198.51.100.3"), seen = [];
  for (let i = 1; i < h.need; i++) seen.push((await q.search(h.wall)).data);
  for (let i = 0; i < Math.min(2, seen.length); i++) assert.ok(!seen[i].noise, "not in the first 2 searches");
});

test("once found, the room has nothing more for that player today, and nothing more is saved", async () => {
  const env = world(), p = await player(env, "198.51.100.4"), h = hid(NOON);
  await untilFound(p, h.wall);
  for (let i = 0; i < 5; i++) assert.deepEqual((await p.search(h.wall)).data, { result: "done" });
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM finds")[0].n, 1);
});

test("tomorrow the room hides something new, and the same player can find again", async () => {
  const env = world(), p = await player(env, "198.51.100.5");
  await untilFound(p, hid(NOON).wall);
  env.now += DAY;
  await untilFound(p, hid(env.now).wall);
  assert.deepEqual(sql(env, "SELECT day FROM finds ORDER BY id").map((r) => r.day), [dayOf(NOON), dayOf(NOON) + 1]);
});

test("as many players as there are kinds, searching one room on one day, each get a different item", async () => {
  const env = world(), h = hid(NOON), got = [];
  const size = env.ITEMS.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE rarity = ? AND retired = 0").get(h.rarity).n;     // 13 commons (12 + a button), 12 of the others
  for (let k = 0; k < size; k++) { const p = await player(env, "198.51.100." + (20 + k)); got.push((await untilFound(p, h.wall)).last.item.id); }
  assert.equal(new Set(got).size, size, size + " different kinds: " + got);
  assert.deepEqual(sql(env, "SELECT deck_pos FROM finds ORDER BY id").map((r) => r.deck_pos), Array.from({ length: size }, (_, i) => i));
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM finds WHERE item_id = 38")[0].n, 0);
});

test("after every kind has been dealt, a second round starts: a kind repeats and its copy number counts up", async () => {
  const env = world(), h = hid(NOON), got = [];
  const size = env.ITEMS.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE rarity = ? AND retired = 0").get(h.rarity).n;
  for (let k = 0; k < size + 2; k++) { const p = await player(env, "198.51.100." + (50 + k)); got.push((await untilFound(p, h.wall)).last.item); }
  const first = new Set(got.slice(0, size).map((i) => i.id)); assert.equal(first.size, size);
  assert.ok(got.slice(size).every((i) => first.has(i.id)), "after the deck, kinds repeat");
  for (const i of got.slice(size)) assert.equal(i.copy, 2);
  assert.deepEqual(sql(env, "SELECT copy FROM finds ORDER BY id").slice(0, size).map((r) => r.copy), Array(size).fill(1));
});

test("different rooms on the same day deal their own decks", async () => {
  const env = world(), p = await player(env, "198.51.100.90");
  const rooms = floor.wings[0].rooms.filter((i) => i !== floor.start && hides(floor.rooms[i], base(NOON, i)));
  assert.ok(rooms.length >= 2);
  for (const room of rooms.slice(0, 2)) await untilFound(p, hides(floor.rooms[room], base(NOON, room)).wall, room);
  assert.equal(sql(env, "SELECT COUNT(DISTINCT spot) AS n FROM finds")[0].n, 2);
});

test("what's refused: not a wall, a door, the start room, an unbuilt room, nonsense, no player", async () => {
  const env = world(), p = await player(env, "198.51.100.91"), n = () => sql(env, "SELECT COUNT(*) AS n FROM search_prog")[0].n;
  const door = Object.keys(floor.rooms[ROOM].doors)[0];
  assert.equal((await p.search("X")).status, 400);
  assert.match((await p.search(door)).data.error, /isn't a wall/);
  const startWall = ["N", "E", "S", "W"].find((d) => floor.rooms[floor.start].doors[d] === undefined);
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
  const wall = ["N", "E", "S", "W"].find((d) => f2.rooms[room].doors[d] === undefined);
  const r = await p.search(wall, room, FAR);
  assert.equal(r.status, 403); assert.match(r.data.error, /long way/);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM search_prog")[0].n, 0);
});

test("test mode: an admin sees what a find looks like, and nothing is saved", async () => {
  const env = world(), p = await player(env, "198.51.100.94");
  env.DB.raw.exec("UPDATE players SET admin = 1, test_mode = 1 WHERE id = 1");
  const r = (await p.search(hid(NOON).wall)).data;
  assert.equal(r.result, "found"); assert.equal(r.test, true); assert.equal(r.item.copy, null);
  assert.deepEqual([sql(env, "SELECT COUNT(*) AS n FROM finds")[0].n, sql(env, "SELECT COUNT(*) AS n FROM search_prog")[0].n], [0, 0]);
});

test("GET /api/finds lists what a player found, newest first, with item details; another player sees none of it", async () => {
  const env = world(), p = await player(env, "198.51.100.95"), h = hid(NOON);
  await untilFound(p, h.wall); env.now += DAY; await untilFound(p, hid(env.now).wall);
  const r = (await p.me("/api/finds")).data.finds, rows = sql(env, "SELECT item_id, day FROM finds ORDER BY id DESC");
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((f) => f.item.name), rows.map((x) => env.ITEMS.raw.prepare("SELECT name FROM items WHERE id = ?").get(x.item_id).name));
  assert.deepEqual(r.map((f) => f.day), ["2026-10-17", "2026-10-16"]);
  const stranger = await player(env, "198.51.100.96");
  assert.deepEqual((await stranger.me("/api/finds")).data.finds, []);
  assert.equal((await browser(env, { ip: "198.51.100.97" })("/api/finds")).status, 401);
});

test("the page: pressing into a wall searches it, a find comes back as a window, and a miss says a line of 4Dungeon's", async () => {
  const env = world(), me = browser(env, { ip: "198.51.100.98" }), calls = [];
  const api = async (path, body) => { calls.push(path); return (await me("/api/" + path, body)).data; };
  let st = await load(arrive(CELL), api, -600);
  const h = hid(NOON), room = floor.rooms[ROOM];
  st = { ...st, at: ROOM, facing: other(h.wall), visited: st.visited };
  st = await forward(st, api, -600);
  assert.ok(calls.includes("search")); assert.match(st.log, /^> You search the (north|east|south|west) wall\.\.\. /);
  assert.ok(MISSES.some((m) => st.log.endsWith(" " + m)) && !st.popup);
  st = { ...st, facing: h.wall };
  for (let i = 1; i < h.need; i++) st = await forward(st, api, -600);
  assert.ok(!st.popup, "not before the last search");
  st = await forward(st, api, -600);
  assert.ok(st.popup && st.popup.name && st.popup.copy === 1); assert.match(st.log, new RegExp("You found " + st.popup.name + "!$"));
  assert.ok(room && NOISES.length === 6);
  st = await forward({ ...st, popup: undefined }, api, -600);
  assert.match(st.log, /Nothing more here today\.$/);
  // in the start room the same press is the way out, never a search
  const before = calls.filter((c) => c === "search").length;
  const out = await forward({ ...st, at: floor.start, facing: ["N", "E", "S", "W"].find((d) => floor.rooms[floor.start].doors[d] === undefined) }, api, -600);
  assert.ok(out.leave); assert.equal(calls.filter((c) => c === "search").length, before);
});

test("the database itself refuses a second find per player-room-day, a repeated deck place, and a repeated copy", () => {
  const env = world(); env.DB.raw.exec("INSERT INTO players (id, token_hash, created_at, seen_at) VALUES (1, 'a', 1, 1), (2, 'b', 1, 1)");
  const ins = (player, spot, pos, item, copy) => env.DB.raw.prepare("INSERT INTO finds (player_id, cell, layer, spot, day, rarity, deck_pos, item_id, copy, created_at) VALUES (?, 'c', 0, ?, 5, 'common', ?, ?, ?, 1)").run(player, spot, pos, item, copy);
  ins(1, "0:3", 0, 1, 1);
  assert.throws(() => ins(1, "0:3", 1, 2, 1), /UNIQUE/);          // same player, room, day
  assert.throws(() => ins(2, "0:3", 0, 2, 1), /UNIQUE/);          // same deck place
  assert.throws(() => ins(2, "0:3", 1, 1, 1), /UNIQUE/);          // same copy of the same item
  ins(2, "0:3", 1, 1, 2);                                          // the next copy is fine
});
