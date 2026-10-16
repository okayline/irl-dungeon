// The travel check: location can't be proven, so instead the server checks that a player's claims make sense together.
// It remembers each player's last credited cell and when they claimed it. A new cell is credited if getting there
// from the last one is possible at MAX_KMH, plus SLACK_KM for the server's rough first guess being off. A claim that
// isn't can still be walked; it just earns nothing (no unlock, no first find) until enough time has passed.
// Nothing here knows where anyone really is: only cell ids and times.
import { cellKm } from "../public/place.js";

export const MAX_KMH = 150;          // about a fast car
export const SLACK_KM = 2;

// last: { cell, at } (at in seconds) or null. Returns { ok: true } or { ok: false, waitSec } (how long until it would be).
export function travelCheck(last, cell, atSec) {
  if (!last || last.cell === cell) return { ok: true };
  const km = cellKm(last.cell, cell), hours = Math.max(0, atSec - last.at) / 3600;
  if (km <= SLACK_KM + MAX_KMH * hours) return { ok: true };
  return { ok: false, waitSec: Math.ceil(((km - SLACK_KM) / MAX_KMH) * 3600 - (atSec - last.at)) };
}

// "about 3 hours", "about 40 minutes", for the refusal message.
export function waitText(sec) {
  const m = Math.max(1, Math.ceil(sec / 60));
  if (m < 90) return `about ${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.round(m / 60);
  if (h < 48) return `about ${h} hours`;
  return `about ${Math.round(h / 24)} days`;
}
