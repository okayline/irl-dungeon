// Admin and test mode. The rule under test: nothing an admin does in test mode counts or shows anywhere real.
// Expected values come from raw SQL counts and the floor's own documented shape.
import test from "node:test";
import assert from "node:assert/strict";
import FLOOR from "../public/floor.js";
import { arrive, load, forward } from "../public/play.js";
import { makeEnv, browser } from "./helpers.mjs";

const CELL = "8a464b96ab2ffff", FAR = "8a29a1d7575ffff";
const NOON = Date.UTC(2026, 9, 16, 22, 0);
const world = () => { const env = makeEnv(); env.clock = () => env.now; env.now = NOON; return env; };
const sql = (env, q, ...a) => env.DB.raw.prepare(q).all(...a);
const n = (env, t, w = "") => sql(env, `SELECT COUNT(*) AS n FROM ${t} ${w}`)[0].n;
function client(env, opts) { const me = browser(env, opts); return { me, api: async (p, b) => (await me("/api/" + p, b)).data }; }
const face = (st, to) => ({ ...st, facing: Object.keys(st.floor.rooms[st.at].doors).find((d) => st.floor.rooms[st.at].doors[d] === to) });
async function goTo(st, to, api) {
  const prev = { [st.at]: null }, q = [st.at];
  while (q.length) { const i = q.shift(); for (const j of Object.values(st.floor.rooms[i].doors)) if (st.floor.rooms[j] && !(j in prev)) { prev[j] = i; q.push(j); } }
  const path = []; for (let i = to; i !== st.at; i = prev[i]) path.unshift(i);
  for (const r of path) st = await forward(face(st, r), api, -600);
  return st;
}
async function openNext(st, api) {                  // walk to a locked door in the newest wing and open it (ask + yes)
  for (const room of st.floor.wings.at(-1).rooms) {
    st = await goTo(st, room, api);
    const d = FLOOR.lockedDoors(st.floor).find((x) => Object.values(st.floor.rooms[st.at].doors).includes(x));
    if (d !== undefined) { st = await forward(face(st, d), api, -600); return { st: await forward(st, api, -600), door: d }; }
  }
  throw new Error("no locked door");
}
async function adminClient(env) {
  const c = client(env);
  await c.me("/api/run", { cell: CELL, offset: -600 });
  env.DB.raw.exec("UPDATE players SET admin = 1 WHERE id = 1");
  return c;
}

test("only an admin can switch test mode, and the account says so only to them", async () => {
  const env = world(), a = await adminClient(env), p = client(env, { ip: "198.51.100.2" });
  await p.me("/api/run", { cell: CELL, offset: -600 });
  assert.equal((await p.me("/api/admin", { action: "test", on: true })).status, 403);
  assert.equal((await browser(env, { ip: "198.51.100.3" })("/api/admin", { action: "test", on: true })).status, 401);
  assert.equal((await p.me("/api/account")).data.admin, undefined);
  assert.equal(n(env, "players", "WHERE test_mode = 1"), 0);
  for (const bad of [{ action: "test" }, { action: "test", on: "yes" }, { action: "nuke", on: true }]) assert.equal((await a.me("/api/admin", bad)).status, 400);
  assert.equal((await a.me("/api/admin", { action: "test", on: true })).status, 200);
  assert.deepEqual([(await a.me("/api/account")).data.admin, (await a.me("/api/account")).data.test], [true, true]);
  // a player who is not admin but has test_mode set somehow still plays for real
  env.DB.raw.exec("UPDATE players SET test_mode = 1 WHERE id = 2");
  assert.equal((await p.me("/api/run", { cell: CELL, offset: -600 })).data.test, undefined);
});

test("in test mode the key never runs out and no real unlock, completion, first find or ledger entry is made", async () => {
  const env = world(), { me, api } = await adminClient(env);
  await me("/api/admin", { action: "test", on: true });
  const placesBefore = sql(env, "SELECT * FROM places");
  let st = await load(arrive(CELL), api, -600);
  assert.equal(st.test, true);
  for (let i = 0; i < 3; i++) { const o = await openNext(st, api); st = o.st; assert.match(st.log, /Test mode: no key used/); }
  assert.equal(n(env, "test_unlocks"), 3, "three doors in one day");
  for (const room of st.floor.wings[0].rooms) st = await goTo(st, room, api);
  for (const t of ["unlocks", "completions", "wing_firsts", "ledger"]) assert.equal(n(env, t), 0, t);
  assert.deepEqual(sql(env, "SELECT * FROM places"), placesBefore, "the real last place is untouched");
  assert.equal((await me("/api/sign", { cell: CELL, wing: "0" })).status, 403, "signing is refused");
});

test("test mode ignores the travel check and doesn't move the real last place", async () => {
  const env = world(), { me, api } = await adminClient(env);
  assert.equal((await load(arrive(CELL), api, -600)).credit, true);
  await me("/api/admin", { action: "test", on: true });
  env.now += 60000;
  const st = await load(arrive(FAR), api, -600);
  assert.equal(st.credit, true); assert.equal(st.log, undefined);
  assert.equal((await openNext(st, api)).st.log, "> The door opens. (Test mode: no key used.)");
  assert.deepEqual(sql(env, "SELECT cell FROM places").map((r) => r.cell), [CELL]);
});

test("switching test mode off brings back the real game exactly: real doors, real key, test doors gone from view", async () => {
  const env = world(), { me, api } = await adminClient(env);
  let st = await load(arrive(CELL), api, -600);
  const realOpen = await openNext(st, api);                                 // one real door, today's key spent
  await me("/api/admin", { action: "test", on: true });
  st = await load(arrive(CELL), api, -600);
  assert.equal(st.floor.rooms[realOpen.door], undefined, "test mode starts from its own doors");
  const testOpen = await openNext(st, api);
  await me("/api/admin", { action: "test", on: false });
  const back = await load(arrive(CELL), api, -600);
  assert.ok(back.floor.rooms[realOpen.door], "the real door is open");
  assert.equal(back.keyReady, false, "today's real key is still spent");
  assert.deepEqual(sql(env, "SELECT door FROM unlocks").map((r) => r.door), [realOpen.door]);
  if (testOpen.door !== realOpen.door) assert.equal(back.floor.rooms[testOpen.door], undefined, "the test door isn't in the real game");
  // and another player never sees test doors
  const other = client(env, { ip: "198.51.100.4" });
  assert.deepEqual((await other.me("/api/run", { cell: CELL, offset: -600 })).data.unlocks, []);
});

test("a wing walked in test mode can still be found first, for real, afterwards", async () => {
  const env = world(), { me, api } = await adminClient(env);
  await me("/api/admin", { action: "test", on: true });
  let st = await load(arrive(CELL), api, -600);
  for (const room of st.floor.wings[0].rooms) st = await goTo(st, room, api);
  assert.equal(st.log, "> You've walked this whole wing. (Test mode: not recorded.)");
  const p = client(env, { ip: "198.51.100.5" });
  let s2 = await load(arrive(CELL), p.api, -600);
  for (const room of s2.floor.wings[0].rooms) s2 = await goTo(s2, room, p.api);
  assert.match(s2.log, /first to walk this whole wing/);
  assert.equal(n(env, "wing_firsts", "WHERE player_id = 2"), 1);
});

test("a real find can't be signed while test mode is on, and a short hop in test mode doesn't move the real last place", async () => {
  const env = world(), { me, api } = await adminClient(env);
  let st = await load(arrive(CELL), api, -600);
  for (const room of st.floor.wings[0].rooms) st = await goTo(st, room, api);     // a real first find
  assert.equal(n(env, "wing_firsts", "WHERE player_id = 1"), 1);
  await me("/api/admin", { action: "test", on: true });
  assert.equal((await me("/api/sign", { cell: CELL, wing: "0" })).status, 403);
  assert.equal(n(env, "wing_firsts", "WHERE signed = 1"), 0);
  const { neighbour } = await import("../public/place.js");
  env.now += 30000;
  await load(arrive(neighbour(CELL, "N")), api, -600);
  assert.deepEqual(sql(env, "SELECT cell FROM places").map((r) => r.cell), [CELL]);
});
