// What day is it for a player? The player's LOCAL day, like 4Dungeon.
// The server can't know a time zone, so the browser sends only its UTC offset in minutes (what the clock on the wall
// says minus UTC, so Hawaii is -600). The server uses its OWN clock plus that offset, so a player can never claim a date,
// only an offset, and every real offset (UTC-12:00 to UTC+14:00) puts the date within one day of the UTC date.
// A player's day also never goes backwards: if they travel west after taking a key, they stay on that day until their
// clock catches up. (See DESIGN.md for why, and for the cell-based time zone idea that could replace the claimed offset.)

export const MIN_OFFSET = -12 * 60, MAX_OFFSET = 14 * 60;
const DAY_MS = 86400000;

export class BadOffset extends Error {}

// Days since 1970-01-01 of the local date. `offsetMin` must be a whole number of minutes in the real-world range.
export function localDay(nowMs, offsetMin) {
  if (!Number.isInteger(offsetMin) || offsetMin < MIN_OFFSET || offsetMin > MAX_OFFSET) throw new BadOffset("That time zone offset isn't real.");
  return Math.floor((nowMs + offsetMin * 60000) / DAY_MS);
}

// The day a player is on right now: their local day, but never earlier than `lastDay` (the day of their last key; pass
// null/undefined if they have none).
export function dayFor(nowMs, offsetMin, lastDay) {
  const d = localDay(nowMs, offsetMin);
  return lastDay == null ? d : Math.max(d, lastDay);
}

// The date as text, for the public ledger (a date, never a time).
export const dayText = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);

// ---------- cross-check against the time zone Cloudflare infers from the player's IP (request.cf.timezone) ----------
// A soft signal only: VPNs and roaming phones make the IP's zone wrong sometimes. It never blocks anyone.

// The UTC offset in minutes that an IANA zone name has at `nowMs` (so daylight saving is counted), or null if unknown.
export function zoneOffset(tz, nowMs) {
  if (typeof tz !== "string" || !tz) return null;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric",
      day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(nowMs)).map((p) => [p.type, p.value]));
    const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return Math.round((wall - Math.floor(nowMs / 1000) * 1000) / 60000);
  } catch { return null; }                                   // not a real zone name
}

// "match" (same offset right now), "mismatch", or "unknown" (the request carried no usable zone).
export function offsetCheck(claimedOffset, tz, nowMs) {
  const z = zoneOffset(tz, nowMs);
  return z === null ? "unknown" : z === claimedOffset ? "match" : "mismatch";
}
