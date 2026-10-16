// The read-only link to the shared item table. The table here is built by hand with the same columns as
// dungeon-items/schema.sql (the real one lives in its own database), with rows written out in the test.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { listItems, getItem } from "../src/items.js";

function itemsDb() {
  const db = new DatabaseSync(":memory:"), seen = [];
  db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, source TEXT, source_key TEXT, rarity TEXT, name TEXT, note TEXT, alignment TEXT, nature TEXT, type TEXT, image TEXT, extra TEXT DEFAULT '{}', retired INTEGER DEFAULT 0)");
  const ins = db.prepare("INSERT INTO items (id, source, source_key, rarity, name, note, alignment, nature, extra, retired) VALUES (?,?,?,?,?,?,?,?,?,?)");
  ins.run(1, "4dungeon", "COMMON:0", "common", "a bag of loose screws", "Rattles like teeth.", "CHAOS", "tech", "{}", 0);
  ins.run(2, "4dungeon", "COMMON:1", "common", "a spent battery", "Still faintly warm.", "NEUTRAL", "tech", "{}", 1);
  ins.run(3, "4dungeon", "UNCOMMON:0", "uncommon", "a vial of medicine", "Heals everyone by a third.", "LAW", "spirit", '{"has_use":true,"use_text":"The party breathes easier."}', 0);
  ins.run(4, "88x31", "17", "uncommon", "a neon button", null, null, null, "{}", 0);
  const prep = (sql, args = []) => { seen.push(sql); return { bind: (...a) => prep(sql, a), first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }) }; };
  return { ITEMS: { prepare: (sql) => prep(sql) }, seen, raw: db };
}

test("listItems gives the active items in id order, with extra read as JSON", async () => {
  const env = itemsDb(), got = await listItems(env);
  assert.deepEqual(got.map((i) => i.id), [1, 3, 4]);                      // id 2 is retired
  assert.deepEqual(got[1].extra, { has_use: true, use_text: "The party breathes easier." });
  assert.equal(got[0].name, "a bag of loose screws"); assert.equal(got[0].alignment, "CHAOS"); assert.equal(got[0].retired, false);
});

test("listItems filters by rarity and by source", async () => {
  const env = itemsDb();
  assert.deepEqual((await listItems(env, { rarity: "uncommon" })).map((i) => i.id), [3, 4]);
  assert.deepEqual((await listItems(env, { source: "88x31" })).map((i) => i.name), ["a neon button"]);
  assert.deepEqual(await listItems(env, { rarity: "moon" }), []);
  assert.deepEqual((await listItems(env, { rarity: "common", source: "88x31" })), []);
});

test("a value that looks like SQL is only ever a value", async () => {
  const env = itemsDb();
  assert.deepEqual(await listItems(env, { rarity: "common' OR '1'='1" }), []);
  assert.equal((await getItem(env, "1 OR 1=1")), null);
  assert.equal(env.raw.prepare("SELECT COUNT(*) AS n FROM items").get().n, 4);
});

test("getItem finds a retired item too, and null for one that isn't there", async () => {
  const env = itemsDb(), r = await getItem(env, 2);
  assert.equal(r.name, "a spent battery"); assert.equal(r.retired, true);
  assert.equal(await getItem(env, 99), null);
});

test("it only ever reads: every statement sent to the item table is a SELECT", async () => {
  const env = itemsDb();
  await listItems(env); await listItems(env, { rarity: "common", source: "4dungeon" }); await getItem(env, 1);
  assert.ok(env.seen.length >= 3);
  for (const s of env.seen) assert.match(s, /^SELECT /);
});

test("with no item table bound it says so plainly", async () => {
  await assert.rejects(() => listItems({}), /isn't bound/);
  await assert.rejects(() => getItem({}, 1), /isn't bound/);
});
