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

test("arriving is standing in the first room; /api/run gives back the rooms you've stood in", async () => {
  const env = world(), me = browser(env);
  const r = (await post(me, "run", { cell: CELL, offset: -600 })).data;
  assert.deepEqual(r.rooms, [0]);
  assert.equal((await post(me, "rooms", { cell: CELL, room: ROOM })).data.ok, true);
  assert.deepEqual((await post(me, "run", { cell: CELL, offset: -600 })).data.rooms, [0, ROOM]);
  assert.deepEqual(sql(env, "SELECT cell, room FROM walked_rooms ORDER BY room"), [{ cell: CELL, room: 0 }, { cell: CELL, room: ROOM }]);
});

test("rooms are kept per player, once each, and only rooms the cell has", async () => {
  const env = world(), a = browser(env, { ip: "198.51.100.1" }), b = browser(env, { ip: "198.51.100.2" });
  await post(a, "run", { cell: CELL, offset: -600 }); await post(b, "run", { cell: CELL, offset: -600 });
  await post(a, "rooms", { cell: CELL, room: ROOM }); await post(a, "rooms", { cell: CELL, room: ROOM });
  assert.deepEqual((await post(b, "run", { cell: CELL, offset: -600 })).data.rooms, [0], "another player's rooms are not yours");
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM walked_rooms WHERE player_id = 1")[0].n, 2, "the same room twice is one row");
  assert.match((await post(a, "rooms", { cell: CELL, room: 9999 })).data.error, /isn't built/);
  assert.match((await post(a, "rooms", { cell: CELL, room: -1 })).data.error, /isn't a room/);
  assert.equal((await post(a, "rooms", { cell: "nope", room: 0 })).status, 400);
  assert.equal((await browser(env, { ip: "198.51.100.3" })("/api/rooms", { cell: CELL, room: 0 })).status, 401);
});

test("a cell reached too fast keeps no rooms; test mode keeps none either", async () => {
  const env = world(), me = browser(env, { ip: "198.51.100.4" }), FAR = "8a29a1d7575ffff";
  await post(me, "run", { cell: CELL, offset: -600 }); env.now += 60000;
  const r = (await post(me, "run", { cell: FAR, offset: -600 })).data;
  assert.equal(r.credit, false); assert.deepEqual(r.rooms, []);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM walked_rooms WHERE cell = ?", FAR)[0].n, 0);
  assert.equal((await post(me, "rooms", { cell: FAR, room: 0 })).status, 403);
  env.DB.raw.exec("UPDATE players SET admin = 1, test_mode = 1");
  const before = sql(env, "SELECT COUNT(*) AS n FROM walked_rooms")[0].n;
  assert.equal((await post(me, "rooms", { cell: CELL, room: ROOM })).data.test, true);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM walked_rooms")[0].n, before);
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

test("the page's client: load brings back the rooms you've stood in, and each step into a room is reported", async () => {
  const env = world(), me = browser(env, { ip: "198.51.100.8" }), calls = [];
  const api = async (path, body) => { calls.push(path); return (await me("/api/" + path, body)).data; };
  let st = await load(arrive(CELL), api, -600);
  const door = Object.keys(st.floor.rooms[0].doors).find((d) => st.floor.rooms[st.floor.rooms[0].doors[d]]);
  st = await forward({ ...st, facing: door }, api, -600);
  assert.ok(st.at !== 0 && calls.includes("rooms"));
  const again = await load(arrive(CELL), api, -600);
  assert.ok(again.visited[st.at], "a new visit finds the room you stood in");
  const a = await loadArea(again, api);
  assert.equal(a.area.here, "entered");
});

test("the zoom button stays where it is: the map's and the area's titles put the [ at the same column and the title starts at the same column", () => {
  const st = { floor, ...FLOOR.arrive(floor), cell: CELL, tz: "Pacific/Honolulu", log: "", strict: true, map: [] }, now = new Date(Date.UTC(2026, 9, 16, 12));
  const head = (zoom) => renderScreen({ ...st, zoom }, now).split("\n").find((l) => /\[[-+]\]/.test(l));
  const a = head("room"), b = head("area");
  assert.equal(a.indexOf("["), b.indexOf("["));
  assert.equal(a.indexOf("MAP"), b.indexOf("AREA"));
});
