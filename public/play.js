// The game, played against the server: opening a cell, spending the day's key on a locked door, and reporting a wing
// walked in full. The rules live on the server (src/worker.js); this file only asks, and shows what it said.
// `api(path, body)` answers the server's JSON (or { error }); the page passes account.js's `api`, the tests the Worker.
// `offset` is the player's UTC offset in minutes (east positive), which the server uses for the key's local day.
import FLOOR from "./floor.js";
import { step } from "./walk.js";
import { WORD } from "./screen.js";

export const offsetNow = () => -new Date().getTimezoneOffset();

const ask = async (api, path, body) => { try { return (await api(path, body)) || { error: "No answer." }; } catch { return { error: "Couldn't reach the server." }; } };

// "about 40 minutes", "about 3 hours", "about 2 days"
export function waitText(sec) {
  const m = Math.max(1, Math.ceil(sec / 60));
  if (m < 90) return `about ${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.round(m / 60);
  return h < 48 ? `about ${h} hours` : `about ${Math.round(h / 24)} days`;
}

// Arriving in a cell: the floor is the cell's (the same for everyone), at its start room. Then `load` asks the server for
// this player's doors in it and opens them. Until then `loaded` is false and locked doors wait.
export function arrive(cell, extra = {}) {
  const floor = FLOOR.generate(FLOOR.seedFor(cell, 0), undefined, { days: FLOOR.DAYS });
  return { cell, floor, ...FLOOR.arrive(floor), loaded: false, keyReady: null, reported: [], confirm: undefined, ...extra };
}

export async function load(st, api, offset = offsetNow()) {
  const r = await ask(api, "run", { cell: st.cell, offset });
  if (r.error) return { ...st, log: `> ${r.error} Locked doors can't open right now.` };
  const floor = st.floor;
  for (const d of r.unlocks) if (!floor.rooms[d] && FLOOR.growDoor(floor, d) === undefined) return { ...st, log: "> This cell's doors don't add up. Locked doors can't open right now." };
  // wings already walked count as reported, so they aren't sent again
  const reported = floor.wings.map((w, i) => (r.completed.includes(wingKeyOf(floor, r.unlocks, i)) ? i : -1)).filter((i) => i >= 0);
  const firsts = Object.fromEntries((r.firsts || []).map((x) => [x.wing, x.name]));
  const out = { ...st, loaded: true, keyReady: r.keyReady, doors: r.unlocks.slice(), reported, credit: r.credit, firsts, unsigned: (r.unsigned || []).slice(), signed: (r.signed || []).slice() };
  if (r.credit === false) out.log = `> You got here fast. This cell earns nothing for ${waitText(r.waitSec)}.`;
  return out;
}

// The key of wing i: "0", then the doors unlocked to reach it, in order (the server's names for wings).
const wingKeyOf = (floor, doors, i) => ["0", ...doors.slice(0, i)].join(">");

// A step forward. Through an open door it moves you (and reports any wing now walked in full); into a locked door it
// first asks, and a second step into the same door spends today's key. Anything else (a turn, another door) cancels.
export async function forward(st, api, offset = offsetNow()) {
  const { unlock, ...moved } = step(st);
  if (unlock === undefined) return report({ ...moved, confirm: undefined }, api);
  const s = { ...moved, log: st.log };
  if (!s.loaded) return { ...s, confirm: undefined, log: "> The door won't move yet. Still opening this cell." };
  if (s.keyReady === false) return { ...s, confirm: undefined, log: "> The door won't unlock. Today's key is spent. Another comes tomorrow." };
  if (s.confirm !== unlock) return { ...s, confirm: unlock, log: `> Unlock the ${WORD[s.facing]} door? It uses today's key. Step again for yes.` };
  const r = await ask(api, "unlock", { cell: s.cell, door: unlock, offset });
  if (r.error) return { ...s, confirm: undefined, ...(/key is spent/.test(r.error) ? { keyReady: false } : {}), log: "> " + r.error };
  FLOOR.growDoor(s.floor, unlock);
  return { ...s, confirm: undefined, keyReady: false, doors: [...(s.doors || []), unlock], log: "> Today's key turns. The door opens." };
}

export const turned = (st) => ({ ...st, confirm: undefined });

// Any wing whose rooms you have all stood in, not yet reported, is sent to the server (with every room you've stood in).
async function report(st, api) {
  if (!st.loaded || !st.floor) return st;
  const fresh = st.floor.wings.map((w, i) => i).filter((i) => !st.reported.includes(i) && st.floor.wings[i].rooms.every((room) => st.visited[room]));
  if (!fresh.length) return st;
  const visited = st.visited.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  const r = await ask(api, "walk", { cell: st.cell, visited });
  if (r.error) return { ...st, reported: [...st.reported, ...fresh], log: "> " + r.error };   // said once, not on every step
  const out = { ...st, reported: [...st.reported, ...fresh], firsts: { ...(st.firsts || {}) }, unsigned: (st.unsigned || []).slice() };
  for (const w of r.wings) if (w.first) { out.firsts[w.key] = null; out.unsigned.push(w.key); }
  const first = r.wings.some((w) => w.first);
  if (r.wings.length) out.log = first ? "> You're the first to walk this whole wing! Press Y to sign it with your name." : "> You've walked this whole wing.";
  return out;
}

// The key of the wing you're standing in, or null.
export function wingHere(st) {
  if (!st.floor || !st.loaded) return null;
  const room = st.floor.rooms[st.at];
  return room ? wingKeyOf(st.floor, st.doors || [], room.wing) : null;
}

// The right panel's "first" line for the wing you're in: who found it first, if anyone has.
export function firstLine(st) {
  const k = wingHere(st);
  if (k === null || !st.firsts || !(k in st.firsts)) return "";
  if ((st.signed || []).includes(k)) return " FIRST: YOU   [U] UNSIGN";
  if (st.firsts[k]) return " FIRST: " + st.firsts[k].toUpperCase();
  return (st.unsigned || []).includes(k) ? " FIRST: YOU   [Y] SIGN IT" : " FIRST: UNSIGNED";
}

// Sign the wing you're standing in, if you found it first and haven't signed it. Your name is made then if you have
// none (two words; reroll it in SAVE).
export async function signHere(st, api) {
  const k = wingHere(st);
  if (k === null || !(st.unsigned || []).includes(k)) return st;
  const r = await ask(api, "sign", { cell: st.cell, wing: k });
  if (r.error) return { ...st, log: "> " + r.error };
  return { ...st, firsts: { ...st.firsts, [k]: r.name }, unsigned: st.unsigned.filter((x) => x !== k), signed: [...(st.signed || []), k], log: `> Signed. This wing was found first by ${r.name}.` };
}

// Take your name off the wing you're standing in, if you signed it.
export async function unsignHere(st, api) {
  const k = wingHere(st);
  if (k === null || !(st.signed || []).includes(k)) return st;
  const r = await ask(api, "sign", { cell: st.cell, wing: k, unsign: true });
  if (r.error) return { ...st, log: "> " + r.error };
  return { ...st, firsts: { ...st.firsts, [k]: null }, signed: st.signed.filter((x) => x !== k), unsigned: [...(st.unsigned || []), k], log: "> Unsigned. Your name is off this wing." };
}
