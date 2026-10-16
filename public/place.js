// From the browser's position to a cell. The coordinates exist only inside this file's functions: they are turned
// into an H3 cell id (resolution 10, about 100 m) and dropped. Nothing here stores, logs or sends them, and the server
// only ever sees the cell id.
import { latLngToCell, isValidCell, getResolution } from "./vendor/h3-js.es.js";

export const RES = 10;

export const cellFromLatLng = (lat, lng) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error("That isn't a place on Earth.");
  return latLngToCell(lat, lng, RES);
};

// Is this string a real cell id at our resolution?
export const isCell = (s) => typeof s === "string" && isValidCell(s) && getResolution(s) === RES;

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
