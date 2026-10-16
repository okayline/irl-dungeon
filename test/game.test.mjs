// The key, the doors and the first finders, as the server enforces them. Every test plays like a browser would: it asks
// the Worker, then rebuilds the same floor the way the page does. Expected values come from SQL, Date.UTC and the
// floor's own documented rules, never from the route under test.
import test from "node:test";
import assert from "node:assert/strict";
import FLOOR from "../public/floor.js";
import { makeEnv, browser, dumpAll } from "./helpers.mjs";

const CELL = "8a464b96ab2ffff";                         // a Honolulu cell (resolution 10)
const NOON = Date.UTC(2026, 9, 16, 22, 0);               // 12:00 on Oct 16 in Hawaii
const DAY = 86400000;
const days = (y, m, d) => Date.UTC(y, m - 1, d) / DAY;
const world = (t = NOON) => { const env = makeEnv(); env.clock = () => env.now; env.now = t; return env; };
const sql = (env, q, ...a) => env.DB.raw.prepare(q).all(...a);

// The page's own steps: ask for the run, build the floor from what comes back.
async function open(me, cell = CELL, offset = -600) {
  const r = await me("/api/run", { cell, offset });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const floor = FLOOR.generate(FLOOR.seedFor(cell, r.data.layer), undefined, { days: r.data.days });
  for (const d of r.data.unlocks) FLOOR.growDoor(floor, d);
  return { ...r.data, floor };
}
const unlock = (me, door, offset = -600, cell = CELL) => me("/api/unlock", { cell, door, offset });
const wingRooms = (floor, w) => floor.wings[w].rooms;

test("run: only real resolution-10 cells are accepted", async () => {
  const env = world(), me = browser(env);
  for (const bad of [undefined, null, "", "nope", 5, {}, "87283472bffffff" /* resolution 7 */, "8a464b96ab2fffe", CELL + "0", CELL.toUpperCase() + " "])
    assert.equal((await me("/api/run", { cell: bad })).status, 400, String(bad));
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM players")[0].n, 0, "refused cells make no player");
});

test("run: every player gets the same floor for a cell, and nothing about the floor is stored per player", async () => {
  const env = world(), a = browser(env), b = browser(env, { ip: "198.51.100.2" });
  const r1 = await open(a), r2 = await open(a), other = await open(b);
  assert.deepEqual(r1.unlocks, []); assert.deepEqual(r1.completed, []); assert.equal(r1.keyReady, true);
  assert.equal(r1.pseed, undefined, "no private seed is sent");
  for (const f of [r2.floor, other.floor]) assert.deepEqual(f.rooms, r1.floor.rooms, "same rooms and same direction labels");
  assert.equal(r1.floor.sym, other.floor.sym);
  assert.ok(!sql(env, "SELECT name FROM sqlite_master").some((t) => t.name === "cell_runs"), "no per-player cell table");
  assert.ok((await open(a, "8a2a1072b59ffff")).floor.rooms.length > 0);
});

test("run: keyReady needs an offset, and refuses offsets that can't exist", async () => {
  const env = world(), me = browser(env);
  assert.equal((await me("/api/run", { cell: CELL })).data.keyReady, null);
  for (const bad of [-721, 841, 1.5, "x", NaN, null]) assert.equal((await me("/api/run", { cell: CELL, offset: bad })).status, 400, String(bad));
});

test("unlock: opens a door, builds the wing, and uses the day's key", async () => {
  const env = world(), me = browser(env), r = await open(me);
  const [door] = FLOOR.lockedDoors(r.floor);
  const res = await unlock(me, door);
  assert.equal(res.status, 200); assert.equal(res.data.ok, true);
  assert.equal(res.data.day, days(2026, 10, 16), "noon in Hawaii on Oct 16 is Oct 16");
  const again = await open(me);
  assert.deepEqual(again.unlocks, [door]); assert.equal(again.keyReady, false);
  assert.equal(again.floor.wings.length, 2, "the replay builds the wing behind the door");
  assert.ok(again.floor.rooms[door], "the room behind the door exists");
  const row = sql(env, "SELECT * FROM unlocks")[0];
  assert.deepEqual([row.cell, row.layer, row.door, row.day], [CELL, 0, door, days(2026, 10, 16)]);
});

test("unlock: one key a day, and the other door of the pair is gone for good", async () => {
  const env = world(), me = browser(env), r = await open(me), [first, second] = FLOOR.lockedDoors(r.floor);
  assert.equal((await unlock(me, first)).status, 200);
  const spent = await unlock(me, FLOOR.lockedDoors((await open(me)).floor)[0] ?? 0);
  assert.equal(spent.status, 403); assert.match(spent.data.error, /key is spent/);
  env.now += DAY;                                                    // the next day
  const sealed = await unlock(me, second);
  assert.equal(sealed.status, 400, "the sealed door never opens, even with a fresh key");
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM unlocks")[0].n, 1);
  const next = FLOOR.lockedDoors((await open(me)).floor)[0];
  assert.equal((await unlock(me, next)).status, 200, "a new day brings a new key");
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM unlocks")[0].n, 2);
});

test("unlock: a refused try does not use the key", async () => {
  const env = world(), me = browser(env), r = await open(me), [first, second] = FLOOR.lockedDoors(r.floor);
  for (const bad of [0, 1, 99999, -1, 1.5, "3", null, undefined, NaN]) assert.equal((await unlock(me, bad)).status, 400, String(bad));
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM unlocks")[0].n, 0);
  assert.equal((await unlock(me, first)).status, 200);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM unlocks")[0].n, 1);
  assert.equal(second !== undefined, true);
});

test("unlock: needs a player who has opened that cell", async () => {
  const env = world(), me = browser(env), stranger = browser(env, { ip: "198.51.100.9" });
  assert.equal((await unlock(me, 3)).status, 401);
  assert.equal((await unlock(stranger, 3, -600, "not a cell")).status, 400);
});

test("unlock: the day is the player's local day (from the claimed offset and the server's own clock)", async () => {
  const env = world(Date.UTC(2026, 9, 16, 3, 25)), me = browser(env), r = await open(me, CELL, -600);   // 5:25 pm Oct 15 in Hawaii
  const door = FLOOR.lockedDoors(r.floor)[0];
  assert.equal((await unlock(me, door, -600)).status, 200);
  assert.equal(sql(env, "SELECT day FROM unlocks")[0].day, days(2026, 10, 15));
  assert.equal((await open(me, CELL, -600)).keyReady, false);
  assert.equal((await open(me, CELL, 540)).keyReady, true, "claiming a zone where it is already Oct 16 (Tokyo) is a new day");
});

test("unlock: claiming offsets back and forth can't be used to take two keys in one instant after the first jump", async () => {
  const env = world(Date.UTC(2026, 9, 16, 12, 0)), me = browser(env), r = await open(me);
  const [d1] = FLOOR.lockedDoors(r.floor);
  assert.equal((await unlock(me, d1, 840)).status, 200);           // UTC+14: already Oct 17
  const d2 = FLOOR.lockedDoors((await open(me, CELL, 840)).floor)[0];
  for (const off of [-720, -600, 0, 840]) assert.equal((await unlock(me, d2, off)).status, 403, `offset ${off}`);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM unlocks")[0].n, 1);
  assert.equal(sql(env, "SELECT day FROM unlocks")[0].day, days(2026, 10, 17));
});

test("unlock: bad offsets are refused and keep the key", async () => {
  const env = world(), me = browser(env), r = await open(me), door = FLOOR.lockedDoors(r.floor)[0];
  for (const bad of [-721, 841, 1.5, "x", NaN, null]) assert.equal((await unlock(me, door, bad)).status, 400, String(bad));
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM unlocks")[0].n, 0);
});

test("unlock: the time zone Cloudflare sees is a soft check, recorded and never a reason to refuse", async () => {
  const cases = [["Pacific/Honolulu", -600, "match"], ["Pacific/Honolulu", 0, "mismatch"], [undefined, -600, "unknown"], ["Nowhere/Land", -600, "unknown"]];
  for (const [tz, offset, want] of cases) {
    const env = world(), me = browser(env, { cf: tz === undefined ? null : { timezone: tz } }), r = await open(me, CELL, offset);
    assert.equal((await unlock(me, FLOOR.lockedDoors(r.floor)[0], offset)).status, 200);
    assert.equal(sql(env, "SELECT tz_check FROM unlocks")[0].tz_check, want, `${tz} ${offset}`);
  }
});

test("unlock: two players have their own keys, floors and doors", async () => {
  const env = world(), a = browser(env), b = browser(env, { ip: "198.51.100.2" });
  const ra = await open(a), rb = await open(b);
  assert.deepEqual(FLOOR.lockedDoors(ra.floor), FLOOR.lockedDoors(rb.floor), "door numbers are the same for everyone");
  assert.equal((await unlock(a, FLOOR.lockedDoors(ra.floor)[0])).status, 200);
  assert.equal((await unlock(b, FLOOR.lockedDoors(rb.floor)[1] ?? FLOOR.lockedDoors(rb.floor)[0])).status, 200, "a's key doesn't touch b's");
});

test("unlock: a stored history that can't be replayed fails loudly, not silently", async () => {
  const env = world(), me = browser(env), r = await open(me), door = FLOOR.lockedDoors(r.floor)[0];
  await unlock(me, door);
  env.DB.raw.prepare("UPDATE unlocks SET door = 424242").run();
  const res = await me("/api/run", { cell: CELL });
  assert.equal(res.status, 500);
});

// ---------- walking whole wings, and first finders ----------

const walk = (me, visited, cell = CELL) => me("/api/walk", { cell, visited });
const ledger = async (me) => (await me("/api/ledger")).data.entries;

test("walk: a player who has stood in every room of a wing completes it, and the first one is its finder, on the ledger", async () => {
  const env = world(), me = browser(env), r = await open(me), rooms = wingRooms(r.floor, 0);
  const res = await walk(me, rooms);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.deepEqual(res.data.wings, [{ key: "0", wing: 0, first: true }]);
  assert.deepEqual(res.data.completed, ["0"]);
  const entries = await ledger(me);
  assert.equal(entries.length, 1); assert.equal(entries[0].kind, "wing");
  assert.deepEqual(JSON.parse(entries[0].record), { cell: CELL, layer: 0, wing: "0" });
  assert.deepEqual(Object.keys(entries[0]).sort(), ["date", "hash", "id", "kind", "prev_hash", "record"], "no who, no time");
  assert.equal(entries[0].date, "2026-10-16");
  const pid = sql(env, "SELECT id FROM players")[0].id;
  assert.equal(sql(env, "SELECT player_id FROM ledger")[0].player_id, pid, "the finder is kept privately, so a name can be added later");
  assert.deepEqual(sql(env, "SELECT cell, layer, wing_key, player_id FROM wing_firsts").map((r) => ({ ...r })), [{ cell: CELL, layer: 0, wing_key: "0", player_id: pid }]);
  assert.equal((await me("/api/verify")).data.ok, true);
});

test("walk: nothing about who is in the public record, in any table that is published", async () => {
  const env = world(), me = browser(env), r = await open(me);
  await walk(me, wingRooms(r.floor, 0));
  const pub = JSON.stringify((await me("/api/ledger")).data);
  const pid = String(sql(env, "SELECT id FROM players")[0].id);
  assert.ok(!/player/i.test(pub), "the word player never appears");
  assert.ok(!new RegExp(`"id":\\s*${pid}\\b.*player`).test(pub));
  assert.ok(!dumpAll(env).includes(me.cookie().split("=")[1]), "the cookie token is never stored in the clear");
});

test("walk: a missing room means the wing isn't complete", async () => {
  const env = world(), me = browser(env), r = await open(me), rooms = wingRooms(r.floor, 0);
  if (rooms.length < 2) return;
  const res = await walk(me, rooms.slice(0, -1).concat([]).filter((x, i, a) => !(i === a.length - 1 && false)));
  const short = rooms.slice(0, rooms.length - 1);
  const partial = await walk(me, short);
  assert.equal(partial.status, 200); assert.deepEqual(partial.data.wings, []);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM wing_firsts")[0].n, 0);
  assert.equal(res.status, 200);
});

test("walk: the same wing is recorded once per player, and only the first player is the finder", async () => {
  const env = world(), a = browser(env), b = browser(env, { ip: "198.51.100.2" });
  const ra = await open(a), rb = await open(b);
  assert.equal((await walk(a, wingRooms(ra.floor, 0))).data.wings[0].first, true);
  assert.deepEqual((await walk(a, wingRooms(ra.floor, 0))).data.wings, [], "again: nothing new");
  const second = await walk(b, wingRooms(rb.floor, 0));
  assert.deepEqual(second.data.wings, [{ key: "0", wing: 0, first: false }]);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM ledger")[0].n, 1, "one finder, one entry");
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM completions")[0].n, 2);
  assert.equal(sql(env, "SELECT player_id FROM wing_firsts")[0].player_id, sql(env, "SELECT id FROM players ORDER BY id")[0].id);
});

test("walk: two players finishing at the same moment: exactly one first finder, one entry, an unbroken chain", async () => {
  const env = world(), people = Array.from({ length: 6 }, (_, i) => browser(env, { ip: `198.51.100.${10 + i}` }));
  const runs = await Promise.all(people.map((p) => open(p)));
  const results = await Promise.all(people.map((p, i) => walk(p, wingRooms(runs[i].floor, 0))));
  assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.data)));
  assert.equal(results.filter((r) => r.data.wings[0].first).length, 1);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM ledger")[0].n, 1);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM wing_firsts")[0].n, 1);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM completions")[0].n, 6);
  assert.equal((await people[0]("/api/verify")).data.ok, true);
});

test("walk: a later wing is named by the doors taken to reach it, so different doors are different wings", async () => {
  const env = world(), a = browser(env), b = browser(env, { ip: "198.51.100.2" });
  const ra = await open(a), rb = await open(b), [d1, d2] = FLOOR.lockedDoors(ra.floor);
  assert.equal((await unlock(a, d1)).status, 200); assert.equal((await unlock(b, d2)).status, 200);
  const fa = await open(a), fb = await open(b);
  const wa = await walk(a, [...wingRooms(fa.floor, 0), ...wingRooms(fa.floor, 1)]);
  const wb = await walk(b, [...wingRooms(fb.floor, 0), ...wingRooms(fb.floor, 1)]);
  assert.deepEqual(wa.data.wings.map((w) => w.key), ["0", `0>${d1}`]);
  assert.deepEqual(wb.data.wings.map((w) => w.key), ["0", `0>${d2}`]);
  assert.deepEqual(wa.data.wings.map((w) => w.first), [true, true]);
  assert.deepEqual(wb.data.wings.map((w) => w.first), [false, true], "the first wing was a's; b's second wing is a different wing");
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM ledger")[0].n, 3);
  assert.equal((await a("/api/verify")).data.ok, true);
});

test("walk: a walk that couldn't have happened is refused and records nothing", async () => {
  const env = world(), me = browser(env), r = await open(me), [door] = FLOOR.lockedDoors(r.floor);
  const rooms = wingRooms(r.floor, 0);
  assert.equal((await unlock(me, door)).status, 200);
  const f = await open(me), w1 = wingRooms(f.floor, 1);
  const cases = {
    "no start room": rooms.filter((x) => x !== 0),
    "empty": [], "not a list": "0,1,2", "a number": 3,
    "a room that isn't built": [...rooms, 9999],
    "a negative room": [...rooms, -1], "a fraction": [...rooms, 1.5], "a string": [...rooms, "1"], "a null": [...rooms, null],
    "too long": Array.from({ length: 201 }, () => 0),
  };
  for (const [name, visited] of Object.entries(cases)) {
    const res = await walk(me, visited);
    assert.equal(res.status, 400, name);
  }
  // a gap: wing 1's rooms without a connection back to the start
  const gapped = [0, ...w1.filter((x) => !Object.values(f.floor.rooms[0].doors).includes(x) && !rooms.includes(x))];
  if (gapped.length > 1) assert.equal((await walk(me, gapped)).status, 400, "disconnected rooms");
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM completions")[0].n, 0);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM ledger")[0].n, 0);
});

test("walk: rooms of a wing that hasn't been unlocked can't be claimed", async () => {
  const env = world(), me = browser(env), r = await open(me);
  const rooms = wingRooms(r.floor, 0), [door] = FLOOR.lockedDoors(r.floor);
  assert.equal((await walk(me, [...rooms, door])).status, 400, "the room behind a locked door isn't built");
  const built = FLOOR.generate(FLOOR.seedFor(CELL, 0), undefined, { days: r.days }); FLOOR.growDoor(built, door);
  assert.equal((await walk(me, [...rooms, ...wingRooms(built, 1)])).status, 400, "not unlocked by this player, even though the wing exists");
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM ledger")[0].n, 0);
});

test("walk: needs a player who has opened the cell", async () => {
  const env = world(), me = browser(env);
  assert.equal((await walk(me, [0])).status, 401);
  assert.equal((await walk(me, [0], "nope")).status, 400);
});

test("run after finishing: the page is told which wings are done, so it doesn't send them again", async () => {
  const env = world(), me = browser(env), r = await open(me);
  await walk(me, wingRooms(r.floor, 0));
  assert.deepEqual((await open(me)).completed, ["0"]);
});
