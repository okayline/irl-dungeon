// Where a player starts and how they move between cells, without the browser's location: the server's rough guess,
// the next cell over, and the travel check. Expected values come from h3-js directly and from the haversine formula
// written out here, never from the functions under test.
import test from "node:test";
import assert from "node:assert/strict";
import * as H3 from "../public/vendor/h3-js.es.js";
import { guessCell, neighbour, GUESS_RES } from "../public/place.js";
import { travelCheck, MAX_KMH, SLACK_KM } from "../src/travel.js";
import { makeEnv, browser, dumpAll } from "./helpers.mjs";

const HNL = "8a464b96ab2ffff";                                         // a Honolulu cell
const LA = H3.latLngToCell(34.0522, -118.2437, 10);                    // a Los Angeles cell
const rad = (d) => d * Math.PI / 180;
function km([a1, o1], [a2, o2]) {                                      // haversine, Earth radius 6371.0088 km (h3's own)
  const h = Math.sin(rad(a2 - a1) / 2) ** 2 + Math.cos(rad(a1)) * Math.cos(rad(a2)) * Math.sin(rad(o2 - o1) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
}
const cellsKm = (a, b) => km(H3.cellToLatLng(a), H3.cellToLatLng(b));
function bearingOf([a1, o1], [a2, o2]) {
  const y = Math.sin(rad(o2 - o1)) * Math.cos(rad(a2)), x = Math.cos(rad(a1)) * Math.sin(rad(a2)) - Math.sin(rad(a1)) * Math.cos(rad(a2)) * Math.cos(rad(o2 - o1));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// ---------- the rough guess ----------

test("the guess is the 100 m cell at the centre of the ~1 km area around the IP's position, whatever spot in it", () => {
  assert.equal(GUESS_RES, 7);
  const area = H3.latLngToCell(21.3069, -157.8583, 7), centre = H3.cellToCenterChild(area, 10);
  assert.equal(guessCell({ latitude: "21.3069", longitude: "-157.8583" }), centre);
  // every spot inside the same area gives the same answer, so the answer says no more than "this area"
  for (const child of H3.cellToChildren(area, 10).filter((_, i) => i % 97 === 0)) {
    const [lat, lng] = H3.cellToLatLng(child);
    assert.equal(guessCell({ latitude: String(lat), longitude: String(lng) }), centre);
  }
  assert.equal(H3.getResolution(centre), 10);
});

test("no position, or a position that isn't on Earth, gives no guess", () => {
  for (const cf of [null, undefined, {}, { latitude: "21.3" }, { longitude: "-157" }, { latitude: "x", longitude: "y" },
    { latitude: "91", longitude: "0" }, { latitude: "0", longitude: "181" }, { latitude: null, longitude: null }, { latitude: "", longitude: "" }])
    assert.equal(guessCell(cf), null, JSON.stringify(cf));
});

test("GET /api/here answers the guess, makes no player and stores nothing", async () => {
  const env = makeEnv(), before = dumpAll(env);
  const r = await browser(env, { cf: { latitude: "21.3069", longitude: "-157.8583", timezone: "Pacific/Honolulu" } })("/api/here");
  assert.equal(r.status, 200);
  assert.equal(r.data.cell, H3.cellToCenterChild(H3.latLngToCell(21.3069, -157.8583, 7), 10));
  assert.equal(Object.keys(r.data).join(), "cell", "only the cell, never the coordinates");
  assert.equal(r.headers.get("set-cookie"), null);
  assert.equal(dumpAll(env), before);
  assert.equal((await browser(env)("/api/here")).data.cell, null, "no position on the request: no guess");
});

// ---------- the next cell over ----------

test("walking out N, E, S or W goes to a touching cell within 30 degrees of that compass bearing", () => {
  const want = { N: 0, E: 90, S: 180, W: 270 };
  const sample = [HNL, LA, H3.latLngToCell(64.1466, -21.9426, 10), H3.latLngToCell(-33.8688, 151.2093, 10), H3.latLngToCell(0.01, 0.01, 10)];
  for (const c of sample) {
    const ring = new Set(H3.gridDisk(c, 1)); ring.delete(c);
    const seen = new Set();
    for (const d of "NESW") {
      const n = neighbour(c, d);
      assert.ok(ring.has(n), `${c} ${d}: a touching cell`);
      const off = Math.abs(((bearingOf(H3.cellToLatLng(c), H3.cellToLatLng(n)) - want[d] + 540) % 360) - 180);
      assert.ok(off <= 30, `${c} ${d}: ${off.toFixed(1)} degrees off`);
      seen.add(n);
    }
    assert.equal(seen.size, 4, "four directions, four different cells");
  }
  assert.throws(() => neighbour(HNL, "up")); assert.throws(() => neighbour("nope", "N"));
});

// ---------- the travel check ----------

test("travel: a first claim, the same cell, and a walk next door are all fine", () => {
  assert.deepEqual(travelCheck(null, LA, 1000), { ok: true });
  assert.deepEqual(travelCheck({ cell: LA, at: 1000 }, LA, 1000), { ok: true });
  assert.deepEqual(travelCheck({ cell: HNL, at: 1000 }, neighbour(HNL, "N"), 1000), { ok: true });
});

test("travel: the limit is the slack plus the speed times the time, worked out from the real distance", () => {
  assert.equal(MAX_KMH, 150); assert.equal(SLACK_KM, 2);
  const d = cellsKm(HNL, LA);                                             // about 4,100 km
  assert.ok(d > 4000 && d < 4200, String(d));
  const need = Math.ceil(((d - 2) / 150) * 3600);                          // seconds until it is possible
  const at = 50000;
  assert.equal(travelCheck({ cell: HNL, at }, LA, at + 60).ok, false, "a minute later");
  assert.equal(travelCheck({ cell: HNL, at }, LA, at + need - 5).ok, false, "just short of the time");
  assert.equal(travelCheck({ cell: HNL, at }, LA, at + need + 1).ok, true, "just past it");
  const w = travelCheck({ cell: HNL, at }, LA, at + 3600).waitSec;
  assert.ok(Math.abs(w - (need - 3600)) <= 1, `${w} vs ${need - 3600}`);
  // the slack: a claim 1.9 km away at once is fine, 2.5 km away is not
  const near = H3.gridDisk(HNL, 15).find((c) => { const k = cellsKm(HNL, c); return k > 1.8 && k < 1.95; });
  const far = H3.gridDisk(HNL, 20).find((c) => { const k = cellsKm(HNL, c); return k > 2.3 && k < 2.6; });
  assert.equal(travelCheck({ cell: HNL, at }, near, at).ok, true);
  assert.equal(travelCheck({ cell: HNL, at }, far, at).ok, false);
});

// ---------- the travel check, through the Worker ----------

const NOON = Date.UTC(2026, 9, 16, 22, 0);
const world = () => { const env = makeEnv(); env.clock = () => env.now; env.now = NOON; return env; };
const sql = (env, q, ...a) => env.DB.raw.prepare(q).all(...a);
const FLOOR = (await import("../public/floor.js")).default;
const firstDoor = (cell) => FLOOR.lockedDoors(FLOOR.generate(FLOOR.seedFor(cell, 0), undefined, { days: FLOOR.DAYS }))[0];

test("worker: a jump across the ocean can be walked but earns nothing: no unlock, no first find, the key kept", async () => {
  const env = world(), me = browser(env);
  assert.equal((await me("/api/run", { cell: HNL, offset: -600 })).data.credit, true);
  env.now += 60000;
  const r = await me("/api/run", { cell: LA, offset: -600 });
  assert.equal(r.status, 200, "the cell still opens");
  assert.equal(r.data.credit, false); assert.ok(r.data.waitSec > 20 * 3600, String(r.data.waitSec));
  const u = await me("/api/unlock", { cell: LA, door: firstDoor(LA), offset: -600 });
  assert.equal(u.status, 403); assert.match(u.data.error, /long way/);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM unlocks")[0].n, 0, "the key is not used");
  const w = await me("/api/walk", { cell: LA, visited: [0] });
  assert.equal(w.status, 403);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM completions")[0].n + sql(env, "SELECT COUNT(*) AS n FROM ledger")[0].n, 0);
  assert.deepEqual(sql(env, "SELECT cell FROM places").map((x) => x.cell), [HNL], "the last place is still Honolulu");
  // and back home, the key still works
  assert.equal((await me("/api/unlock", { cell: HNL, door: firstDoor(HNL), offset: -600 })).status, 200);
});

test("worker: once enough time has passed, the far cell earns credit and becomes the last place", async () => {
  const env = world(), me = browser(env);
  await me("/api/run", { cell: HNL, offset: -600 });
  env.now += Math.ceil(((cellsKm(HNL, LA) - 2) / 150) * 3600 + 5) * 1000;
  assert.equal((await me("/api/run", { cell: LA, offset: -600 })).data.credit, true);
  assert.deepEqual(sql(env, "SELECT cell FROM places").map((x) => x.cell), [LA]);
  assert.equal((await me("/api/unlock", { cell: LA, door: firstDoor(LA), offset: -600 })).status, 200);
});

test("worker: hopping between neighbouring cells is never held up, and each player has their own last place", async () => {
  const env = world(), a = browser(env), b = browser(env, { ip: "198.51.100.9" });
  let c = HNL;
  await a("/api/run", { cell: c, offset: -600 });
  for (const d of "NNEESSWWN") { c = neighbour(c, d); env.now += 20000; assert.equal((await a("/api/run", { cell: c, offset: -600 })).data.credit, true, d); }
  assert.equal((await b("/api/run", { cell: LA, offset: -600 })).data.credit, true, "another player's first claim is their own");
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM places")[0].n, 2);
});
