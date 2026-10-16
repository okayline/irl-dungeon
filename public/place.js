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
export function locate(geo = typeof navigator !== "undefined" ? navigator.geolocation : null) {
  return new Promise((resolve, reject) => {
    if (!geo) return reject(new Error("This browser can't find where it is."));
    geo.getCurrentPosition(
      (pos) => { try { resolve(cellFromLatLng(pos.coords.latitude, pos.coords.longitude)); } catch (e) { reject(e); } },
      (err) => reject(new Error(err && err.code === 1 ? "Location is off for this page." : err && err.code === 3 ? "Finding you took too long." : "Couldn't find you.")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
}
