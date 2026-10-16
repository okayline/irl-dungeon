// Names, signing a first find, and saved cells. Expected values come from raw SQL, the word lists written out here,
// and the ledger's documented hash (node:crypto), never from the routes under test.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import FLOOR from "../public/floor.js";
import { arrive, load, forward, firstLine, signHere, unsignHere } from "../public/play.js";
import { freeName, nameText } from "../src/names.js";
import { makeEnv, browser, fakeD1 } from "./helpers.mjs";

const CELL = "8a464b96ab2ffff", OTHER = "8a464b96a017fff";
const NOON = Date.UTC(2026, 9, 16, 22, 0);
const world = () => { const env = makeEnv(); env.clock = () => env.now; env.now = NOON; return env; };
const sql = (env, q, ...a) => env.DB.raw.prepare(q).all(...a);
function client(env, opts) { const me = browser(env, opts); return { me, api: async (p, b) => (await me("/api/" + p, b)).data }; }
const face = (st, to) => ({ ...st, facing: Object.keys(st.floor.rooms[st.at].doors).find((d) => st.floor.rooms[st.at].doors[d] === to) });
async function goTo(st, to, api) {
  const prev = { [st.at]: null }, q = [st.at];
  while (q.length) { const i = q.shift(); for (const j of Object.values(st.floor.rooms[i].doors)) if (st.floor.rooms[j] && !(j in prev)) { prev[j] = i; q.push(j); } }
  const path = []; for (let i = to; i !== st.at; i = prev[i]) path.unshift(i);
  for (const r of path) st = await forward(face(st, r), api, -600);
  return st;
}
async function walkFirstWing(api, cell = CELL) {
  let st = await load(arrive(cell), api, -600);
  for (const room of st.floor.wings[0].rooms) st = await goTo(st, room, api);
  return st;
}
const ADJ = ["Quiet", "Amber", "Early"], NOUN = ["Heron", "Lantern", "Sparrow"];

// ---------- names ----------

test("a name is an adjective then a noun from the lists; anything else is no name", () => {
  assert.equal(nameText("adj:0", "noun:0"), `${ADJ[0]} ${NOUN[0]}`);
  assert.equal(nameText("adj:2", "noun:1"), `${ADJ[2]} ${NOUN[1]}`);
  for (const [a, b] of [["noun:0", "adj:0"], ["adj:0", "adj:1"], ["adj:999", "noun:0"], ["adj:-1", "noun:0"], [null, "noun:0"], ["adj:0", "noun:0x"], ["adj:01", ""]])
    assert.equal(nameText(a, b), null, `${a} ${b}`);
});

test("a free name skips pairs that are taken, and the pair to avoid", async () => {
  const db = fakeD1();
  db.raw.exec("INSERT INTO players (token_hash, created_at, seen_at, name_a, name_b) VALUES ('x', 0, 0, 'adj:0', 'noun:0')");
  const seq = [0, 0, 0.99, 0.99, 0.5, 0.5];               // 40 words a list: taken (0,0), the avoided one (39,39), then (20,20)
  let i = 0; const rand = () => seq[i++ % seq.length];
  assert.deepEqual(await freeName(db, { a: "adj:39", b: "noun:39" }, rand), { a: "adj:20", b: "noun:20" });
});

test("the database refuses two players with the same name", () => {
  const env = makeEnv();
  env.DB.raw.exec("INSERT INTO players (token_hash, created_at, seen_at, name_a, name_b) VALUES ('a', 0, 0, 'adj:1', 'noun:1')");
  assert.throws(() => env.DB.raw.exec("INSERT INTO players (token_hash, created_at, seen_at, name_a, name_b) VALUES ('b', 0, 0, 'adj:1', 'noun:1')"), /UNIQUE/);
  env.DB.raw.exec("INSERT INTO players (token_hash, created_at, seen_at) VALUES ('c', 0, 0)");
  env.DB.raw.exec("INSERT INTO players (token_hash, created_at, seen_at) VALUES ('d', 0, 0)");   // many players with no name
});

// ---------- signing ----------

test("a first find is unsigned until the finder signs it; signing makes their name and seals a 'sign' entry without it", async () => {
  const env = world(), { me, api } = client(env);
  let st = await walkFirstWing(api);
  assert.match(st.log, /Press Y to sign it/);
  assert.equal(firstLine(st), " FIRST: YOU   [Y] SIGN IT");
  assert.equal((await me("/api/account")).data.name, null, "no name before signing");
  // another player sees it found, but unsigned
  const other = client(env, { ip: "198.51.100.4" });
  assert.equal(firstLine(await goTo(await load(arrive(CELL), other.api, -600), 0, other.api)), " FIRST: UNSIGNED");
  st = await signHere(st, api);
  const p = sql(env, "SELECT name_a, name_b FROM players WHERE name_a IS NOT NULL")[0];
  const name = nameText(p.name_a, p.name_b);
  assert.ok(name); assert.equal(st.log, `> Signed. This wing was found first by ${name}.`);
  assert.equal(firstLine(st), " FIRST: YOU   [U] UNSIGN", "your own signed find offers unsigning");
  assert.deepEqual(sql(env, "SELECT signed FROM wing_firsts").map((r) => r.signed), [1]);
  const sig = sql(env, "SELECT * FROM ledger WHERE kind = 'sign'");
  assert.equal(sig.length, 1);
  assert.deepEqual(JSON.parse(sig[0].record), { cell: CELL, layer: 0, wing: "0" });
  assert.ok(!sig[0].record.includes(name.split(" ")[0]), "the ledger never holds the name");
  const prev = sql(env, "SELECT hash FROM ledger WHERE id = ?", sig[0].id - 1)[0].hash;
  assert.equal(sig[0].hash, createHash("sha256").update(prev + "|" + sig[0].record).digest("hex"), "chained like every entry");
  // the other player now sees the name
  assert.equal(firstLine(await goTo(await load(arrive(CELL), other.api, -600), 0, other.api)), " FIRST: " + name.toUpperCase());
  // signing again changes nothing
  assert.equal((await me("/api/sign", { cell: CELL, wing: "0" })).status, 200);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM ledger WHERE kind = 'sign'")[0].n, 1);
});

test("only the first finder can sign, and only a real wing in a real cell", async () => {
  const env = world(), a = client(env), b = client(env, { ip: "198.51.100.5" });
  await walkFirstWing(a.api); await walkFirstWing(b.api);
  assert.equal((await b.me("/api/sign", { cell: CELL, wing: "0" })).status, 403);
  for (const bad of [{ cell: CELL, wing: "1" }, { cell: CELL, wing: "0>x" }, { cell: CELL, wing: 0 }, { cell: "nope", wing: "0" }, { cell: OTHER, wing: "0" }])
    assert.ok([400, 403].includes((await a.me("/api/sign", bad)).status), JSON.stringify(bad));
  assert.equal((await browser(env, { ip: "198.51.100.6" })("/api/sign", { cell: CELL, wing: "0" })).status, 401, "nobody");
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM ledger WHERE kind = 'sign'")[0].n, 0);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM players WHERE name_a IS NOT NULL")[0].n, 0, "no name made by a refused sign");
});

test("a reroll needs a name, always gives a different one, and renames signed finds", async () => {
  const env = world(), { me, api } = client(env);
  assert.equal((await me("/api/name", { action: "reroll" })).status, 401, "no player yet");
  await me("/api/cells", { action: "save", cell: OTHER });
  assert.equal((await me("/api/name", { action: "reroll" })).status, 400, "a player, but no name yet");
  let st = await walkFirstWing(api); st = await signHere(st, api);
  const names = new Set([(await me("/api/account")).data.name]);
  for (let i = 0; i < 15; i++) {
    const before = (await me("/api/account")).data.name, r = await me("/api/name", { action: "reroll" });
    assert.equal(r.status, 200); assert.notEqual(r.data.name, before); names.add(r.data.name);
  }
  assert.ok(names.size > 5);
  const now = (await me("/api/account")).data.name;
  const other = client(env, { ip: "198.51.100.4" });
  assert.equal(firstLine(await goTo(await load(arrive(CELL), other.api, -600), 0, other.api)), " FIRST: " + now.toUpperCase());
  assert.equal((await me("/api/name", { action: "nope" })).status, 400);
});

// ---------- saved cells ----------

test("saved cells: save, list, no doubles, forget, and only real cells", async () => {
  const env = world(), { me } = client(env);
  assert.deepEqual((await me("/api/account")).data.cells, []);
  assert.equal((await me("/api/cells", { action: "save", cell: CELL })).status, 200);
  env.now += 1000;
  await me("/api/cells", { action: "save", cell: OTHER }); await me("/api/cells", { action: "save", cell: CELL });
  assert.deepEqual((await me("/api/account")).data.cells.map((c) => c.cell), [CELL, OTHER]);
  await me("/api/cells", { action: "forget", cell: CELL });
  assert.deepEqual(sql(env, "SELECT cell FROM saved_cells").map((r) => r.cell), [OTHER]);
  for (const bad of ["nope", "", null, CELL.toUpperCase(), "87283472bffffff"]) assert.equal((await me("/api/cells", { action: "save", cell: bad })).status, 400);
  assert.equal((await me("/api/cells", { action: "rename", cell: CELL })).status, 400);
});

test("saved cells: at most 20, and you can only forget your own", async () => {
  const env = world(), { me } = client(env);
  let c = CELL; const ring = [];
  const H3 = await import("../public/vendor/h3-js.es.js");
  for (const n of H3.gridDisk(CELL, 3).slice(0, 21)) ring.push(n);
  for (const n of ring.slice(0, 20)) assert.equal((await me("/api/cells", { action: "save", cell: n })).status, 200);
  const r = await me("/api/cells", { action: "save", cell: ring[20] });
  assert.equal(r.status, 400); assert.match(r.data.error, /20 saved cells/);
  assert.equal((await me("/api/cells", { action: "save", cell: ring[0] })).status, 200, "saving one you have is fine");
  const other = client(env, { ip: "198.51.100.4" });
  await other.me("/api/cells", { action: "save", cell: CELL });
  await other.me("/api/cells", { action: "forget", cell: ring[1] });
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM saved_cells WHERE cell = ?", ring[1])[0].n, 1, "someone else's stays");
  assert.equal((await browser(env, { ip: "198.51.100.9" })("/api/cells", { action: "forget", cell: CELL })).status, 401);
});

test("saved cells and names are private: the public ledger never shows them", async () => {
  const env = world(), { me, api } = client(env);
  await me("/api/cells", { action: "save", cell: OTHER });
  let st = await walkFirstWing(api); st = await signHere(st, api);
  const name = (await me("/api/account")).data.name;
  const pub = JSON.stringify((await me("/api/ledger")).data);
  assert.ok(!pub.includes(OTHER), "saved cell"); assert.ok(!pub.includes(name.split(" ")[1]), "name");
  assert.ok(!/player/.test(pub), "no player ids");
});

test("a finder who has a name stays unnamed on finds they haven't signed", async () => {
  const env = world(), { api } = client(env);
  let st = await walkFirstWing(api); await signHere(st, api);                 // now they have a name
  const name = nameText(...Object.values(sql(env, "SELECT name_a, name_b FROM players WHERE name_a IS NOT NULL")[0]));
  env.now += 20000;
  await walkFirstWing(api, OTHER);                                             // a second first find, not signed
  const other = client(env, { ip: "198.51.100.4" });
  const seen = await goTo(await load(arrive(OTHER), other.api, -600), 0, other.api);
  assert.equal(firstLine(seen), " FIRST: UNSIGNED");
  assert.ok(!JSON.stringify((await other.me("/api/run", { cell: OTHER, offset: -600 })).data).includes(name.split(" ")[1]));
});

test("the page offers signing only in a wing you found first, and doesn't ask the server otherwise", async () => {
  const env = world(), a = client(env);
  await walkFirstWing(a.api);
  const calls = [], b = client(env, { ip: "198.51.100.5" });
  const api = async (p, x) => { calls.push(p); return b.api(p, x); };
  let st = await walkFirstWing(api);
  calls.length = 0;
  const after = await signHere(st, api);
  assert.deepEqual(calls, []); assert.equal(after, st);
});

test("the finder can unsign: the name comes off for everyone, sealed as 'unsign', and they can sign again", async () => {
  const env = world(), { me, api } = client(env);
  let st = await walkFirstWing(api); st = await signHere(st, api);
  st = await unsignHere(st, api);
  assert.equal(st.log, "> Unsigned. Your name is off this wing.");
  assert.equal(firstLine(st), " FIRST: YOU   [Y] SIGN IT");
  assert.deepEqual(sql(env, "SELECT signed FROM wing_firsts").map((r) => r.signed), [0]);
  assert.deepEqual(sql(env, "SELECT kind FROM ledger ORDER BY id").map((r) => r.kind), ["wing", "sign", "unsign"]);
  assert.deepEqual(JSON.parse(sql(env, "SELECT record FROM ledger WHERE kind = 'unsign'")[0].record), { cell: CELL, layer: 0, wing: "0" });
  const other = client(env, { ip: "198.51.100.4" });
  assert.equal(firstLine(await goTo(await load(arrive(CELL), other.api, -600), 0, other.api)), " FIRST: UNSIGNED");
  assert.equal((await me("/api/account")).data.name !== null, true, "the name itself is kept, for next time");
  // unsigning again changes nothing; someone else can't unsign it
  assert.equal((await me("/api/sign", { cell: CELL, wing: "0", unsign: true })).status, 200);
  assert.equal(sql(env, "SELECT COUNT(*) AS n FROM ledger WHERE kind = 'unsign'")[0].n, 1);
  await me("/api/sign", { cell: CELL, wing: "0" });
  await walkFirstWing(other.api);
  assert.equal((await other.me("/api/sign", { cell: CELL, wing: "0", unsign: true })).status, 403);
  assert.deepEqual(sql(env, "SELECT signed FROM wing_firsts").map((r) => r.signed), [1]);
  // and unsign only works in a wing you signed: no request otherwise
  const calls = []; const spy = async (p, x) => { calls.push(p); return other.api(p, x); };
  const s2 = await goTo(await load(arrive(CELL), other.api, -600), 0, other.api);
  assert.equal(await unsignHere(s2, spy), s2); assert.deepEqual(calls, []);
});
