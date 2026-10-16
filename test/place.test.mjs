// Cells from positions. Known answers are from H3's own documentation; distances are worked out here with the
// haversine formula, not taken from H3.
import test from "node:test";
import assert from "node:assert/strict";
import { cellFromLatLng, isCell, locate, RES } from "../public/place.js";
import { cellToLatLng, getResolution, isValidCell } from "../public/vendor/h3-js.es.js";

const haversine = (a, b, c, d) => {
  const R = 6371008.8, r = (x) => x * Math.PI / 180, dLat = r(c - a), dLng = r(d - b);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

test("H3's documented example: (37.3615593, -122.0553238) at resolution 7 is 87283472bffffff", async () => {
  const { latLngToCell } = await import("../public/vendor/h3-js.es.js");
  assert.equal(latLngToCell(37.3615593, -122.0553238, 7), "87283472bffffff");
});

test("a position becomes a valid resolution-10 cell whose center is within 100 m of it, all over the world", () => {
  let n = 0;
  for (let lat = -89; lat <= 89; lat += 7.3) for (let lng = -179; lng <= 179; lng += 11.1) {
    const cell = cellFromLatLng(lat, lng);
    assert.equal(isValidCell(cell), true); assert.equal(getResolution(cell), RES); assert.equal(isCell(cell), true);
    const [clat, clng] = cellToLatLng(cell);
    assert.ok(haversine(lat, lng, clat, clng) < 100, `${lat},${lng} is ${haversine(lat, lng, clat, clng)} m from its cell`);
    n++;
  }
  assert.ok(n > 500);
});

test("a cell's own center falls in that cell again; a point a kilometer away is a different cell", () => {
  for (let lat = -80; lat <= 80; lat += 16.1) for (let lng = -170; lng <= 170; lng += 23.7) {
    const cell = cellFromLatLng(lat, lng), [clat, clng] = cellToLatLng(cell);
    assert.equal(cellFromLatLng(clat, clng), cell);
    assert.notEqual(cellFromLatLng(lat + 0.01, lng), cell);          // 1.1 km north
  }
});

test("nonsense positions are refused", () => {
  for (const [a, b] of [[NaN, 0], [0, NaN], [91, 0], [-91, 0], [0, 181], [0, -181], [Infinity, 0], ["21", "-157"], [null, 0], [undefined, undefined]])
    assert.throws(() => cellFromLatLng(a, b), /isn't a place on Earth/);
});

test("isCell accepts only real resolution-10 cell ids", () => {
  const ok = cellFromLatLng(21.3069, -157.8583);
  assert.equal(isCell(ok), true);
  for (const bad of ["", "nope", "8a2a1072b59fffe", "87283472bffffff" /* resolution 7 */, null, undefined, 5, "8a2a1072b59ffff ", "8A2A1072B59FFFF; DROP TABLE", ok + "0"]) assert.equal(isCell(bad), false, String(bad));
});

test("locate gives a cell id and nothing else: the answer holds no coordinates", async () => {
  const geo = { getCurrentPosition: (ok) => ok({ coords: { latitude: 21.3069, longitude: -157.8583, accuracy: 5 } }) };
  const cell = await locate(geo);
  assert.equal(typeof cell, "string"); assert.equal(isCell(cell), true);
  assert.ok(!/21\.30|157\.85/.test(String(cell)));
});

test("locate explains refusals in a sentence", async () => {
  const fail = (code) => ({ getCurrentPosition: (_ok, no) => no({ code }) });
  await assert.rejects(locate(fail(1)), /Location is off/);
  await assert.rejects(locate(fail(3)), /too long/);
  await assert.rejects(locate(fail(2)), /Couldn't find you/);
  await assert.rejects(locate(null), /can't find where it is/);
  await assert.rejects(locate({ getCurrentPosition: (ok) => ok({ coords: { latitude: 999, longitude: 0 } }) }), /isn't a place on Earth/);
});

test("a browser that never answers is given up on, with a sentence (the screen must not wait forever)", async () => {
  const silent = { getCurrentPosition: () => {} };
  const t0 = Date.now();
  await assert.rejects(locate(silent, 50, null), /No answer/);
  assert.ok(Date.now() - t0 < 1000);
});

test("a site the browser has blocked is told so before asking", async () => {
  let asked = false;
  const geo = { getCurrentPosition: () => { asked = true; } };
  await assert.rejects(locate(geo, 50, { query: async () => ({ state: "denied" }) }), /blocked for this site/);
  assert.equal(asked, false);
  // 'granted', 'prompt', a browser with no permissions API, and one whose query throws all go on to ask
  const ok = { getCurrentPosition: (res) => res({ coords: { latitude: 21.3069, longitude: -157.8583 } }) };
  for (const perms of [{ query: async () => ({ state: "granted" }) }, { query: async () => ({ state: "prompt" }) }, null, { query: async () => { throw new Error("nope"); } }])
    assert.equal(isCell(await locate(ok, 50, perms)), true);
});
