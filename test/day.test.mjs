// Expected values come from Date.UTC and ISO date text, never from the code under test.
import test from "node:test";
import assert from "node:assert/strict";
import { localDay, dayFor, dayText, BadOffset } from "../src/day.js";

const days = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000;

test("Hawaii at 5:25pm on Oct 15 is still Oct 15, though UTC is already Oct 16", () => {
  const now = Date.UTC(2026, 9, 16, 3, 25);                 // 03:25 UTC = 17:25 HST
  assert.equal(localDay(now, -600), days(2026, 10, 15));
  assert.equal(localDay(now, 0), days(2026, 10, 16));
});

test("midnight edges: one minute before and after local midnight", () => {
  const midnightHST = Date.UTC(2026, 9, 16, 10, 0);          // 00:00 on Oct 16 in Hawaii
  assert.equal(localDay(midnightHST - 60000, -600), days(2026, 10, 15));
  assert.equal(localDay(midnightHST, -600), days(2026, 10, 16));
  const midnightTokyo = Date.UTC(2026, 9, 15, 15, 0);        // 00:00 on Oct 16 in Tokyo (+9)
  assert.equal(localDay(midnightTokyo - 60000, 540), days(2026, 10, 15));
  assert.equal(localDay(midnightTokyo, 540), days(2026, 10, 16));
});

test("every real offset, at many times, agrees with ISO text of the shifted clock and stays within a day of UTC", () => {
  for (let off = -720; off <= 840; off += 15) for (let i = 0; i < 40; i++) {
    const now = Date.UTC(2026, 0, 1) + i * 9_137_000;
    const want = new Date(now + off * 60000).toISOString().slice(0, 10);
    const got = localDay(now, off);
    assert.equal(dayText(got), want);
    assert.ok(Math.abs(got - localDay(now, 0)) <= 1);
  }
});

test("offsets that can't exist are refused, not clamped", () => {
  const now = Date.UTC(2026, 9, 15);
  for (const bad of [-721, 841, 1000, -10000, 0.5, NaN, Infinity, "−600", "-600", null, undefined, {}, []])
    assert.throws(() => localDay(now, bad), BadOffset, String(bad));
  localDay(now, -720); localDay(now, 840);                    // the edges are fine
});

test("a player's day never goes backwards", () => {
  const now = Date.UTC(2026, 9, 16, 12, 0);
  const oct16 = days(2026, 10, 16);
  assert.equal(dayFor(now, 0, null), oct16);
  assert.equal(dayFor(now, -720, oct16 + 1), oct16 + 1);      // last key was "tomorrow" here: stay there
  assert.equal(dayFor(now, 0, oct16 - 5), oct16);             // an old key doesn't hold them back
});

test("text for the ledger is a date with no time", () => {
  assert.equal(dayText(days(2026, 10, 15)), "2026-10-15");
  assert.match(dayText(20000), /^\d{4}-\d{2}-\d{2}$/);
});

import { zoneOffset, offsetCheck } from "../src/day.js";

test("zone names give the right offset, daylight saving included (known facts, not computed)", () => {
  const oct = Date.UTC(2026, 9, 15, 12), dec = Date.UTC(2026, 11, 15, 12);
  assert.equal(zoneOffset("Pacific/Honolulu", oct), -600);      // Hawaii has no daylight saving
  assert.equal(zoneOffset("Pacific/Honolulu", dec), -600);
  assert.equal(zoneOffset("Asia/Kolkata", oct), 330);
  assert.equal(zoneOffset("America/New_York", oct), -240);      // EDT
  assert.equal(zoneOffset("America/New_York", dec), -300);      // EST
  assert.equal(zoneOffset("UTC", oct), 0);
});

test("the daylight saving switch lands on the right instant (US fall back: 2026-11-01 06:00 UTC)", () => {
  const t = Date.UTC(2026, 10, 1, 6, 0);
  assert.equal(zoneOffset("America/New_York", t - 1000), -240);
  assert.equal(zoneOffset("America/New_York", t), -300);
});

test("unknown or junk zones are 'unknown', never a guess or a crash", () => {
  const now = Date.UTC(2026, 9, 15);
  for (const bad of [undefined, null, "", "Nowhere/Land", 5, {}, "Pacific/Honolulu; DROP TABLE"]) {
    assert.equal(zoneOffset(bad, now), null);
    assert.equal(offsetCheck(-600, bad, now), "unknown");
  }
});

test("a claimed offset matches only the zone's actual offset", () => {
  const now = Date.UTC(2026, 9, 15, 12);
  assert.equal(offsetCheck(-600, "Pacific/Honolulu", now), "match");
  assert.equal(offsetCheck(-540, "Pacific/Honolulu", now), "mismatch");
  assert.equal(offsetCheck(-300, "America/New_York", now), "mismatch");   // winter offset in October
  assert.equal(offsetCheck(-240, "America/New_York", now), "match");
});
