// The page's side of the game (public/play.js), played against the real Worker: what it asks, what it refuses to ask,
// and what ends up in the database. Expected values come from raw SQL and the floor's own documented shape.
import test from "node:test";
import assert from "node:assert/strict";
import FLOOR from "../public/floor.js";
import { arrive, load, forward, turned, waitText } from "../public/play.js";
import { makeEnv, browser } from "./helpers.mjs";

const CELL = "8a464b96ab2ffff";
const NOON = Date.UTC(2026, 9, 16, 22, 0), DAY = 86400000;
const world = () => { const env = makeEnv(); env.clock = () => env.now; env.now = NOON; return env; };
const sql = (env, q, ...a) => env.DB.raw.prepare(q).all(...a);
// the page's api(), pointed at the Worker, counting what it asks
function client(env, opts) {
  const me = browser(env, opts), calls = [];
  const api = async (path, body) => { calls.push(path); return (await me("/api/" + path, body)).data; };
  return { me, api, calls };
}
// face the door from the room you're in to room `to`
const face = (st, to) => ({ ...st, facing: Object.keys(st.floor.rooms[st.at].doors).find((d) => st.floor.rooms[st.at].doors[d] === to) });
// walk (through open doors only) to room `to`, by the shortest way
async function goTo(st, to, api) {
  const prev = { [st.at]: null }, q = [st.at];
  while (q.length) { const i = q.shift(); for (const j of Object.values(st.floor.rooms[i].doors)) if (st.floor.rooms[j] && !(j in prev)) { prev[j] = i; q.push(j); } }
  const path = []; for (let i = to; i !== st.at; i = prev[i]) path.unshift(i);
  for (const r of path) { st = await forward(face(st, r), api, -600); assert.equal(st.at, r); }
  return st;
}
const lockedFromHere = (st) => FLOOR.lockedDoors(st.floor).filter((d) => Object.values(st.floor.rooms[st.at].doors).includes(d));
async function nextToLocked(st, api) {
  for (const room of st.floor.wings[st.floor.wings.length - 1].rooms) {
    st = await goTo(st, room, api);
    const d = lockedFromHere(st); if (d.length) return { st, door: d[0] };
  }
  throw new Error("no locked door in the newest wing");
}

test("waitText says minutes, hours or days", () => {
  assert.equal(waitText(30), "about 1 minute"); assert.equal(waitText(40 * 60), "about 40 minutes");
  assert.equal(waitText(3 * 3600), "about 3 hours"); assert.equal(waitText(3 * DAY / 1000), "about 3 days");
});

test("a locked door asks first; only a second step into it spends the key", async () => {
  const env = world(), { api } = client(env);
  let { st, door } = await nextToLocked(await load(arrive(CELL), api, -600), api);
  st = await forward(face(st, door), api, -600);
  assert.match(st.log, /Unlock the \w+ door\? It uses today's key/);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM unlocks")[0].n, 0, "asking spends nothing");
  assert.equal(st.floor.rooms[door], undefined);
  st = await forward(st, api, -600);
  assert.equal(st.log, "> Today's key turns. The door opens.");
  assert.deepEqual(sql(env, "SELECT cell, door FROM unlocks").map((r) => [r.cell, r.door]), [[CELL, door]]);
  assert.ok(st.floor.rooms[door], "the room behind is built"); assert.equal(st.keyReady, false);
  st = await forward(st, api, -600);
  assert.equal(st.at, door, "the next step walks through, free");
});

test("turning away (or facing another door) cancels the question", async () => {
  const env = world(), { api } = client(env);
  let { st, door } = await nextToLocked(await load(arrive(CELL), api, -600), api);
  st = await forward(face(st, door), api, -600);
  const dir = st.facing;
  st = turned({ ...st, facing: dir }); st = await forward({ ...st, facing: dir }, api, -600);
  assert.match(st.log, /Unlock the/, "asked again after a turn");
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM unlocks")[0].n, 0);
});

test("with today's key spent, a locked door says so and the server isn't asked", async () => {
  const env = world(), { api, calls } = client(env);
  let { st, door } = await nextToLocked(await load(arrive(CELL), api, -600), api);
  st = await forward(face(st, door), api, -600); st = await forward(st, api, -600);
  st = await forward(st, api, -600);                                   // through the new door
  ({ st, door } = await nextToLocked(st, api));
  const before = calls.filter((c) => c === "unlock").length;
  st = await forward(face(st, door), api, -600);
  assert.match(st.log, /Today's key is spent/);
  assert.equal(calls.filter((c) => c === "unlock").length, before);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM unlocks")[0].n, 1);
});

test("doors opened before are opened again on arrival, on another device of the same player too", async () => {
  const env = world(), a = client(env);
  let { st, door } = await nextToLocked(await load(arrive(CELL), a.api, -600), a.api);
  st = await forward(face(st, door), a.api, -600); st = await forward(st, a.api, -600);
  const again = await load(arrive(CELL), a.api, -600);
  assert.ok(again.floor.rooms[door], "same browser, later");
  const code = (await a.me("/api/codes", { action: "new" })).data.code;
  const b = client(env, { ip: "198.51.100.7" }); await b.me("/api/load", { code });
  assert.ok((await load(arrive(CELL), b.api, -600)).floor.rooms[door], "a second device with the save code");
  const stranger = client(env, { ip: "198.51.100.8" });
  assert.equal((await load(arrive(CELL), stranger.api, -600)).floor.rooms[door], undefined, "another player's doors stay theirs");
});

test("before the server has answered, a locked door waits and nothing is sent", async () => {
  const env = world(), { api, calls } = client(env);
  const loaded = await load(arrive(CELL), api, -600);
  let { st, door } = await nextToLocked(loaded, api);
  st = await forward(face({ ...st, loaded: false }, door), api, -600);
  assert.match(st.log, /Still opening this cell/); assert.ok(!calls.includes("unlock"));
});

test("walking every room of the first wing reports it once, and the first walker is sealed on the ledger", async () => {
  const env = world(), { api, calls } = client(env);
  let st = await load(arrive(CELL), api, -600);
  for (const room of st.floor.wings[0].rooms) st = await goTo(st, room, api);
  assert.match(st.log, /first to walk this whole wing/);
  assert.deepEqual(sql(env, "SELECT wing_key FROM wing_firsts").map((r) => r.wing_key), ["0"]);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM ledger WHERE kind = 'wing'")[0].n, 1);
  const n = calls.filter((c) => c === "walk").length;
  assert.equal(n, 1);
  st = await goTo(st, 0, api); st = await goTo(st, st.floor.wings[0].rooms.at(-1), api);
  assert.equal(calls.filter((c) => c === "walk").length, 1, "not sent again");
  // a second player walking it is not first
  const b = client(env, { ip: "198.51.100.3" });
  let s2 = await load(arrive(CELL), b.api, -600);
  for (const room of s2.floor.wings[0].rooms) s2 = await goTo(s2, room, b.api);
  assert.equal(s2.log, "> You've walked this whole wing.");
  // and on coming back, the page knows it's done and doesn't send it
  const back = await load(arrive(CELL), b.api, -600);
  assert.deepEqual(back.reported, [0]);
});

test("a cell reached too fast says so on arrival, and its refusals are shown, not hidden", async () => {
  const env = world(), { api } = client(env);
  await load(arrive(CELL), api, -600);
  env.now += 60000;
  const far = "8a29a1d7575ffff";                                       // Los Angeles
  let st = await load(arrive(far), api, -600);
  assert.match(st.log, /You got here fast\. This cell earns nothing for about \d+ hours/);
  let found; ({ st, door: found } = await nextToLocked(st, api));
  st = await forward(face(st, found), api, -600); st = await forward(st, api, -600);
  assert.match(st.log, /long way from where you just were/);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM unlocks")[0].n, 0);
});

test("a server that can't be reached is said plainly, and nothing breaks", async () => {
  const st = await load(arrive(CELL), async () => { throw new Error("offline"); }, -600);
  assert.equal(st.loaded, false); assert.match(st.log, /Couldn't reach the server/);
});
