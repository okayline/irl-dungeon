// From the browser's position to a cell. The coordinates exist only inside this file's functions: they are turned
// into an H3 cell id (resolution 10, about 100 m) and dropped. Nothing here stores, logs or sends them, and the server
// only ever sees the cell id.
import { latLngToCell, isValidCell, getResolution, cellToLatLng, gridDisk, cellToCenterChild, greatCircleDistance } from "./vendor/h3-js.es.js";

export const RES = 10;

export const cellFromLatLng = (lat, lng) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error("That isn't a place on Earth.");
  return latLngToCell(lat, lng, RES);
};

// Is this string a real cell id at our resolution?
export const isCell = (s) => typeof s === "string" && isValidCell(s) && getResolution(s) === RES;

// The server's rough first guess (src/worker.js, GET /api/here). Cloudflare puts an approximate position on every request,
// worked out from the IP address (often wrong by kilometres). It is turned into the ~1 km area around it (resolution 7)
// and answered with the 100 m cell at that area's centre, so the answer says no more than "somewhere in this area".
// The coordinates are dropped here, like the browser's. Returns null when the request carries no usable position.
export const GUESS_RES = 7;
export function guessCell(cf) {
  const num = (v) => (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) ? Number(v) : NaN;   // "" is not 0
  const lat = num(cf && cf.latitude), lng = num(cf && cf.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return cellToCenterChild(latLngToCell(lat, lng, GUESS_RES), RES);
}

// The next cell over, going N, E, S or W: of the cell's six neighbours, the one whose centre lies closest to that compass
// bearing. (Cell geometry only, nobody's position.)
const BEARING = { N: 0, E: 90, S: 180, W: 270 };
const rad = (d) => d * Math.PI / 180;
function bearing([la1, lo1], [la2, lo2]) {
  const y = Math.sin(rad(lo2 - lo1)) * Math.cos(rad(la2));
  const x = Math.cos(rad(la1)) * Math.sin(rad(la2)) - Math.sin(rad(la1)) * Math.cos(rad(la2)) * Math.cos(rad(lo2 - lo1));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
export function neighbour(cell, dir) {
  if (!isCell(cell) || !(dir in BEARING)) throw new Error("No way out there.");
  const here = cellToLatLng(cell);
  let best = null, bestOff = Infinity;
  for (const n of gridDisk(cell, 1)) {
    if (n === cell) continue;
    const off = Math.abs(((bearing(here, cellToLatLng(n)) - BEARING[dir] + 540) % 360) - 180);
    if (off < bestOff) { best = n; bestOff = off; }
  }
  return best;
}

// How far apart two cells' centres are, in km.
export const cellKm = (a, b) => greatCircleDistance(cellToLatLng(a), cellToLatLng(b), "km");

// Ask the browser where it is (it asks the person first) and answer with a cell id, or throw a sentence for the log.
// The browser's own timeout only starts once the person has answered its permission question, so if that question is
// hidden (an in-app browser, a blocked site) it would wait forever; `giveUpMs` is ours, and covers the whole wait.
export async function locate(geo = typeof navigator !== "undefined" ? navigator.geolocation : null, giveUpMs = 25000, perms = typeof navigator !== "undefined" ? navigator.permissions : null) {
  if (!geo) throw new Error("This browser can't find where it is.");
  try {
    const p = perms && perms.query ? await perms.query({ name: "geolocation" }) : null;
    if (p && p.state === "denied") throw new Error("Location is blocked for this site. Allow it in the browser's site settings, then try again.");
  } catch (e) { if (/blocked for this site/.test(e.message)) throw e; }     // a browser that can't say is simply asked
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("No answer. This browser may be hiding the location question; try a regular browser (Safari or Chrome) instead of an app's built-in one.")), giveUpMs);
    const done = (f, v) => { clearTimeout(timer); f(v); };
    geo.getCurrentPosition(
      (pos) => { try { done(resolve, cellFromLatLng(pos.coords.latitude, pos.coords.longitude)); } catch (e) { done(reject, e); } },
      (err) => done(reject, new Error(err && err.code === 1 ? "Location is off for this page." : err && err.code === 3 ? "Finding you took too long." : "Couldn't find you.")),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 },
    );
  });
}
