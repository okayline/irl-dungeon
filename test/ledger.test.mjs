// The ledger must be a real hash chain: tamper-evident, unforkable, and safe when writers race.
// These tests try to BREAK it. Expected hashes come from node:crypto, not from the module under test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fakeD1 } from "./helpers.mjs";
import { seal, head, verifyChain, GENESIS } from "../src/ledger.js";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const entry = (n) => ({ kind: "test", record: JSON.stringify({ n }), t: 1000 + n });
const rows = (db) => db.raw.prepare("SELECT * FROM ledger ORDER BY id").all();
const sealN = async (db, n) => { for (let i = 1; i <= n; i++) assert.equal(await seal(db, entry(i)), "sealed"); };

test("an empty ledger's head is 64 zeros", async () => {
  assert.equal(GENESIS, "0".repeat(64));
  assert.equal(await head(fakeD1()), "0".repeat(64));
});

test("each entry's hash is SHA-256(prev_hash|record), starting from the genesis", async () => {
  const db = fakeD1(); await sealN(db, 3);
  let prev = "0".repeat(64);
  for (const r of rows(db)) {
    assert.equal(r.prev_hash, prev);
    assert.equal(r.hash, sha(prev + "|" + r.record));
    prev = r.hash;
  }
  assert.equal(await head(db), prev);
});

test("an untouched chain verifies and reports its length and head", async () => {
  const db = fakeD1(); await sealN(db, 5);
  const v = await verifyChain(rows(db));
  assert.deepEqual(v, { ok: true, count: 5, head: rows(db)[4].hash });
});

test("an empty chain verifies", async () => {
  assert.deepEqual(await verifyChain([]), { ok: true, count: 0, head: GENESIS });
});

test("editing an old record is caught at that row", async () => {
  const db = fakeD1(); await sealN(db, 5);
  const target = rows(db)[2];
  db.raw.prepare("UPDATE ledger SET record = ? WHERE id = ?").run('{"n":999}', target.id);
  assert.deepEqual(await verifyChain(rows(db)), { ok: false, at: target.id });
});

test("editing a record AND fixing its own hash is still caught, at the next row", async () => {
  const db = fakeD1(); await sealN(db, 5);
  const [, , target, next] = rows(db);
  const record = '{"n":999}', hash = sha(target.prev_hash + "|" + record);
  db.raw.prepare("UPDATE ledger SET record = ?, hash = ? WHERE id = ?").run(record, hash, target.id);
  assert.deepEqual(await verifyChain(rows(db)), { ok: false, at: next.id });
});

test("deleting an entry from the middle is caught", async () => {
  const db = fakeD1(); await sealN(db, 5);
  const [, , gone, after] = rows(db);
  db.raw.prepare("DELETE FROM ledger WHERE id = ?").run(gone.id);
  assert.deepEqual(await verifyChain(rows(db)), { ok: false, at: after.id });
});

test("swapping two entries is caught", async () => {
  const db = fakeD1(); await sealN(db, 5);
  const list = rows(db);
  [list[1], list[2]] = [list[2], list[1]];
  assert.equal((await verifyChain(list)).ok, false);
});

test("a forged entry slipped into the middle is caught, even with a valid hash of its own", async () => {
  const db = fakeD1(); await sealN(db, 4);
  const list = rows(db), record = '{"forged":true}';
  const forged = { id: 99, kind: "test", record, prev_hash: list[1].hash, hash: sha(list[1].hash + "|" + record) };
  list.splice(2, 0, forged);
  assert.deepEqual(await verifyChain(list), { ok: false, at: list[3].id });
});

test("a wrong first link is caught: the chain must start at the genesis", async () => {
  const db = fakeD1(); await sealN(db, 3);
  const [, second, third] = rows(db);
  assert.equal((await verifyChain([second, third])).ok, false);
});

test("a later slice verifies when told which hash it should chain from", async () => {
  const db = fakeD1(); await sealN(db, 6);
  const list = rows(db), slice = list.slice(3);
  assert.deepEqual(await verifyChain(slice, list[2].hash), { ok: true, count: 3, head: list[5].hash });
  assert.equal((await verifyChain(slice, list[1].hash)).ok, false);
});

test("KNOWN LIMIT: dropping the newest entries is invisible to the chain alone; an outside copy of the head catches it", async () => {
  const db = fakeD1(); await sealN(db, 5);
  const published = (await verifyChain(rows(db))).head;               // someone saved the head somewhere else
  db.raw.prepare("DELETE FROM ledger WHERE id > ?").run(rows(db)[2].id);   // the owner quietly drops the last two
  const v = await verifyChain(rows(db));
  assert.equal(v.ok, true);                                           // the chain itself is still internally fine...
  assert.notEqual(v.head, published);                                 // ...but it no longer ends where the published head said
});

test("two entries can never share a parent: the chain can't fork", async () => {
  const db = fakeD1(); await sealN(db, 2);
  const first = rows(db)[0];
  assert.throws(
    () => db.raw.prepare("INSERT INTO ledger (kind, record, prev_hash, hash, created_at) VALUES ('x', '{}', ?, ?, 1)").run(first.prev_hash, sha("other")),
    /UNIQUE/);
});

test("six writers racing for the head all land, in one valid chain", async () => {
  const db = fakeD1();
  const results = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => seal(db, entry(n))));
  assert.deepEqual(results, Array(6).fill("sealed"));
  assert.equal(rows(db).length, 6);
  assert.deepEqual(new Set(rows(db).map((r) => r.record)).size, 6);   // none lost, none doubled
  assert.equal((await verifyChain(rows(db))).ok, true);
});

test("under heavy racing it either seals or fails loudly, and the chain is never corrupted", async () => {
  const db = fakeD1();
  const results = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => seal(db, entry(i + 1))));
  const sealed = results.filter((r) => r.status === "fulfilled").length;
  for (const r of results.filter((r) => r.status === "rejected")) assert.match(r.reason.message, /busy/i);
  assert.equal(rows(db).length, sealed);                              // every success is on the ledger, nothing else is
  assert.equal((await verifyChain(rows(db))).ok, true);
});

test("a failed write leaves nothing behind", async () => {
  const db = fakeD1();
  const broken = { prepare: db.prepare, batch: async () => { throw new Error("boom"); } };
  await assert.rejects(() => seal(broken, entry(1)), /boom/);
  assert.equal(rows(db).length, 0);
  assert.equal(await head(db), GENESIS);
});

test("sealing a player id keeps it in its own column, never inside the sealed record", async () => {
  const db = fakeD1();
  await seal(db, { kind: "test", playerId: 7, record: '{"n":1}', t: 5 });
  const [r] = rows(db);
  assert.equal(r.player_id, 7);
  assert.equal(r.record.includes("7"), false);
});
