// The rooms a player has stood in (POST /api/rooms), what /api/run gives back, the area map's data (POST /api/area) and its drawing.
import test from "node:test";
import assert from "node:assert/strict";
import FLOOR from "../public/floor.js";
import { areaMap, exitSlots } from "../public/area.js";
import { ring, neighbour } from "../public/place.js";
import { renderScreen } from "../public/screen.js";
import { arrive, load, forward, loadArea } from "../public/play.js";
import { makeEnv, browser } from "./helpers.mjs";

const CELL = "8a464b96ab2ffff", NOON = Date.UTC(2026, 9, 16, 22, 0);
const world = () => { const env = makeEnv(); env.clock = () => env.now; env.now = NOON; return env; };
const sql = (env, q, ...a) => env.DB.raw.prepare(q).all(...a).map((r) => ({ ...r }));
const floor = FLOOR.generate(FLOOR.seedFor(CELL, 0), undefined, { days: FLOOR.DAYS });
const ROOM = floor.wings[0].rooms.find((i) => i !== 0);
const post = (me, path, body) => me("/api/" + path, body);

test("arriving notes the first room; a batch of rooms is kept, once each, per player, and run gives them back", async () => {
  const env = world(), me = browser(env, { ip: "198.51.100.1" }), other = browser(env, { ip: "198.51.100.2" });
  assert.deepEqual((await post(me, "run", { cell: CELL, offset: -600 })).data.rooms, [0]);
  await post(other, "run", { cell: CELL, offset: -600 });
  const wing = floor.wings[0].rooms.slice(0, 4);
  assert.equal((await post(me, "rooms", { cell: CELL, rooms: wing })).data.ok, true);
  assert.equal((await post(me, "rooms", { cell: CELL, rooms: wing })).data.ok, true);
  assert.deepEqual((await post(me, "run", { cell: CELL, offset: -600 })).data.rooms, [...new Set([0, ...wing])].sort((x, y) => x - y));
  assert.deepEqual((await post(other, "run", { cell: CELL, offset: -600 })).data.rooms, [0], "another player's rooms are not yours");
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM walked_rooms WHERE player_id = 1")[0].n, new Set([0, ...wing]).size, "the same room twice is one row");
});

test("a batch is refused if it names a room the cell doesn't have, isn't a list, or is too long; no player is refused", async () => {
  const env = world(), me = browser(env, { ip: "198.51.100.3" });
  await post(me, "run", { cell: CELL, offset: -600 });
  const n = () => sql(env, "SELECT COUNT(*) AS n FROM walked_rooms")[0].n, before = n();
  assert.match((await post(me, "rooms", { cell: CELL, rooms: [ROOM, 9999] })).data.error, /isn't built/);
  for (const rooms of [[], "3", [-1], [1.5], Array(65).fill(0), undefined]) assert.match((await post(me, "rooms", { cell: CELL, rooms })).data.error, /aren't rooms/);
  assert.equal((await post(me, "rooms", { cell: "nope", rooms: [0] })).status, 400);
  assert.equal((await browser(env, { ip: "198.51.100.4" })("/api/rooms", { cell: CELL, rooms: [0] })).status, 401);
  assert.equal(n(), before, "nothing from a refused batch is kept");
});

test("a cell reached too fast is not noted; test mode notes nothing; other players' arrivals are theirs", async () => {
  const env = world(), me = browser(env, { ip: "198.51.100.4" }), FAR = "8a29a1d7575ffff";
  await post(me, "run", { cell: CELL, offset: -600 }); env.now += 60000;
  assert.equal((await post(me, "run", { cell: FAR, offset: -600 })).data.credit, false);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM walked_rooms WHERE cell = ?", FAR)[0].n, 0);
  env.DB.raw.exec("UPDATE players SET admin = 1, test_mode = 1"); env.now += 3600000 * 5;
  await post(me, "run", { cell: "8a1f2c4a1a07fff", offset: -600 });
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM walked_rooms")[0].n, 1, "test mode adds nothing");
  assert.equal((await post(me, "rooms", { cell: CELL, rooms: [ROOM] })).data.test, true); assert.equal(sql(env, "SELECT COUNT(*) AS n FROM walked_rooms")[0].n, 1);
  env.DB.raw.exec("UPDATE players SET test_mode = 0"); assert.equal((await post(me, "rooms", { cell: FAR, rooms: [0] })).status, 403, "a cell reached too fast keeps no rooms");
  const other = browser(env, { ip: "198.51.100.5" }); await post(other, "run", { cell: CELL, offset: -600 });
  assert.deepEqual(sql(env, "SELECT player_id FROM walked_rooms WHERE cell = ? ORDER BY player_id", CELL).map((r) => r.player_id), [1, 2]);
});

test("the area: your cell and the six cells around it are new, entered or cleared, in ring order", async () => {
  const env = world(), me = browser(env, { ip: "198.51.100.5" }), around = ring(CELL);
  await post(me, "run", { cell: CELL, offset: -600 });
  assert.deepEqual((await post(me, "area", { cell: CELL })).data, { here: "entered", ring: Array(6).fill("new") });
  env.DB.raw.exec(`INSERT INTO walked_rooms (player_id, cell, layer, room, created_at) VALUES (1, '${around[1]}', 0, 0, 1), (1, '${around[4]}', 0, 0, 1)`);
  env.DB.raw.exec(`INSERT INTO completions (player_id, cell, layer, wing_key, created_at) VALUES (1, '${around[1]}', 0, '0', 1)`);   // as if cleared
  assert.deepEqual((await post(me, "area", { cell: CELL })).data, { here: "entered", ring: ["new", "cleared", "new", "new", "entered", "new"] });
  const other = browser(env, { ip: "198.51.100.6" }); await post(other, "run", { cell: "8a29a1d7575ffff", offset: -600 });
  assert.deepEqual((await post(other, "area", { cell: CELL })).data, { here: "new", ring: Array(6).fill("new") }, "another player's marks are theirs");
  assert.equal((await post(me, "area", { cell: "nope" })).status, 400);
  assert.equal((await browser(env, { ip: "198.51.100.7" })("/api/area", { cell: CELL })).status, 401);
});

test("ring: six different cells around the cell", () => {
  for (const c of [CELL, "8a29a1d7575ffff", "8a1f2c4a1a07fff"]) {
    const r = ring(c); assert.equal(new Set(r).size, 6); assert.ok(!r.includes(c));
  }
});

test("the area map: you in the middle, the six cells around you, one mark each", () => {
  const rows = areaMap({ here: "entered", ring: ["new", "cleared", "entered", "new", "entered", "cleared"] });
  assert.equal(rows.length, 5); assert.equal(rows[2].slice(13, 16), "[@]");
  assert.deepEqual([rows[0][18], rows[2][22], rows[4][18], rows[4][10], rows[2][6], rows[0][10]], [".", "O", "o", ".", "o", "O"]);
  assert.deepEqual(areaMap(null), ["          .       .", "", "      .      [@]      .", "", "          .       ."]);
});

test("the area map joins [@] to the cells the hallways lead to, with thin lines: ------ sideways, / and \\ on the diagonals", () => {
  const all = areaMap({ here: "entered", ring: Array(6).fill("new") }, Array(6).fill(true));
  assert.deepEqual(all, ["          .       .", "           \\     /", "      .------[@]------.", "           /     \\", "          .       ."]);
  const right = areaMap(null, [false, true, false, false, false, false]);
  assert.equal(right[2], "      .      [@]------.", "a hallway going right on the room map is a line going right here");
  assert.ok(!right.join("").includes("/") && !right.join("").includes("\\"));
});

test("which cells the first room leads out to: each wall without a door goes to a different cell of the ring, doors into the wing go nowhere", () => {
  const links = exitSlots(CELL, floor), free = ["N", "E", "S", "W"].filter((d) => floor.rooms[0].doors[d] === undefined);
  assert.equal(links.filter(Boolean).length, free.length);
  const around = ring(CELL);
  for (const d of free) assert.ok(links[around.indexOf(neighbour(CELL, d))], d + " leads out");
  assert.deepEqual(exitSlots(CELL, null), Array(6).fill(false));
});

test("the panel header has the zoom button: [-] on the room map, [+] on the area map", () => {
  const st = { floor, ...FLOOR.arrive(floor), cell: CELL, tz: "Pacific/Honolulu", log: "", strict: true, map: [] };
  const now = new Date(Date.UTC(2026, 9, 16, 12));
  assert.match(renderScreen(st, now), /-+ MAP  \[-\] -+/);
  assert.match(renderScreen({ ...st, zoom: "area", map: areaMap(null, []) }, now), /-+ AREA \[\+\] -+/);
});

test("the page's client: a step makes no server call, and load brings back the rooms that were sent", async () => {
  const env = world(), me = browser(env, { ip: "198.51.100.8" }), calls = [];
  const api = async (path, body) => { calls.push(path); return (await me("/api/" + path, body)).data; };
  let st = await load(arrive(CELL), api, -600);
  const door = Object.keys(st.floor.rooms[0].doors).find((d) => st.floor.rooms[st.floor.rooms[0].doors[d]]);
  calls.length = 0; st = await forward({ ...st, facing: door }, api, -600);
  assert.ok(st.at !== 0); assert.deepEqual(calls, [], "no request for an ordinary step");
  const unsent = st.visited.map((v, i) => (v && !st.sent[i] ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(unsent, [st.at], "the room is waiting to be sent in the next batch");
  await post(me, "rooms", { cell: CELL, rooms: unsent });
  const again = await load(arrive(CELL), api, -600);
  assert.ok(again.visited[st.at] && again.sent[st.at], "a new visit finds the rooms that were sent");
  assert.equal((await loadArea(again, api)).area.here, "entered");
});
