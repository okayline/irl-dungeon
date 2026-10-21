// The Worker's players, save codes, rate limits and public ledger. These tests try to get around the rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { makeEnv, browser, dumpAll } from "./helpers.mjs";
import { seal } from "../src/ledger.js";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const count = (env, table) => env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const tokenOf = (me) => me.cookie().split("=")[1];
const CODE = /^[0-9A-Z]{4}(-[0-9A-Z]{4}){4}$/;

// ---------- players ----------

test("reading never makes a player", async () => {
  const env = makeEnv(), me = browser(env);
  for (const path of ["/api/account", "/api/ledger", "/api/verify"]) assert.equal((await me(path)).status, 200);
  assert.equal(count(env, "players"), 0);
  assert.equal((await me("/api/account")).data.player, false);
});

test("a forged cookie is nobody", async () => {
  const env = makeEnv(), me = browser(env);
  me.setCookie("irl=" + "A".repeat(43));
  assert.equal((await me("/api/account")).data.player, false);
  assert.equal(count(env, "players"), 0);
});

test("a cookie that is too short or has odd characters is ignored", async () => {
  const env = makeEnv(), me = browser(env);
  await me("/api/codes", { action: "new" });
  const real = tokenOf(me);
  for (const bad of [real.slice(0, 10), real + "!", "irl=" + real]) {
    me.setCookie("irl=" + bad);
    assert.equal((await me("/api/account")).data.player, false);
  }
});

test("the player cookie is HttpOnly, Secure and SameSite=Lax", async () => {
  const env = makeEnv(), me = browser(env);
  const r = await me("/api/codes", { action: "new" });
  const c = r.headers.get("set-cookie");
  assert.match(c, /HttpOnly/); assert.match(c, /Secure/); assert.match(c, /SameSite=Lax/);
});

test("tokens and save codes are stored only as hashes", async () => {
  const env = makeEnv(), me = browser(env);
  const { data } = await me("/api/codes", { action: "new" });
  assert.match(data.code, CODE);
  const token = tokenOf(me), dump = dumpAll(env);
  assert.equal(dump.includes(token), false);
  assert.equal(dump.includes(data.code), false);
  assert.equal(dump.includes(data.code.replace(/-/g, "")), false);
  assert.equal(env.DB.raw.prepare("SELECT token_hash FROM players").get().token_hash, sha(token));
});

test("making players is rate limited per address, and another address is unaffected", async () => {
  const env = makeEnv();
  for (let i = 0; i < 20; i++) assert.equal((await browser(env, { ip: "198.51.100.7" })("/api/codes", { action: "new" })).status, 200);
  const blocked = await browser(env, { ip: "198.51.100.7" })("/api/codes", { action: "new" });
  assert.equal(blocked.status, 429);
  assert.equal(count(env, "players"), 20);
  assert.equal((await browser(env, { ip: "198.51.100.8" })("/api/codes", { action: "new" })).status, 200);
});

// ---------- the request itself ----------

test("a POST that isn't JSON is refused and does nothing", async () => {
  const env = makeEnv(), me = browser(env);
  const asText = await me("/api/codes", undefined, { method: "POST", raw: '{"action":"new"}', headers: { "content-type": "text/plain" } });
  const asForm = await me("/api/codes", undefined, { method: "POST", raw: "action=new", headers: { "content-type": "application/x-www-form-urlencoded" } });
  const noType = await me("/api/codes", undefined, { method: "POST", raw: '{"action":"new"}' });
  assert.deepEqual([asText.status, asForm.status, noType.status], [415, 415, 415]);
  assert.equal(count(env, "players"), 0);
});

test("broken or odd JSON gets a 400, never a 500", async () => {
  const env = makeEnv(), me = browser(env), json = { "content-type": "application/json" };
  for (const raw of ["{nope", "null", "[]", "42", '"text"', ""]) {
    const r = await me("/api/codes", undefined, { method: "POST", raw, headers: json });
    assert.equal(r.status, 400, `body ${JSON.stringify(raw)}`);
  }
  assert.equal(count(env, "players"), 0);
});

test("unknown routes and wrong methods are 404", async () => {
  const env = makeEnv(), me = browser(env);
  assert.equal((await me("/api/nothing")).status, 404);
  assert.equal((await me("/api/codes")).status, 404);                       // codes is POST only
  assert.equal((await me("/api/account", {})).status, 404);                 // account is GET only
  assert.equal((await me("/api/Account")).status, 404);
});

test("no CORS headers are sent: the page and the API share one origin", async () => {
  const env = makeEnv(), me = browser(env);
  assert.equal((await me("/api/account")).headers.get("access-control-allow-origin"), null);
});

test("the page is served for everything that isn't /api/", async () => {
  const env = makeEnv({ ASSETS: { fetch: async () => new Response("the page") } }), me = browser(env);
  const page = await worker_fetch(env, "/");
  assert.equal(await page.text(), "the page");
  assert.equal((await me("/api/nothing")).status, 404);                     // the API never falls through to the page
});
async function worker_fetch(env, path) {
  const { default: worker } = await import("../src/worker.js");
  return worker.fetch(new Request("https://irl.example" + path), env);
}

// ---------- save codes ----------

test("the account lists codes but never shows them", async () => {
  const env = makeEnv(), me = browser(env);
  const { data } = await me("/api/codes", { action: "new" });
  const acct = await me("/api/account");
  assert.equal(acct.data.codes.length, 1);
  assert.equal(JSON.stringify(acct.data).includes(data.code), false);
});

test("a save code logs another device in as the same player, in any spacing or case", async () => {
  const env = makeEnv(), a = browser(env), b = browser(env, { ip: "203.0.113.2" });
  const { data } = await a("/api/codes", { action: "new" });
  assert.equal((await b("/api/load", { code: data.code.toLowerCase().replace(/-/g, " ") })).status, 200);
  const acct = (await b("/api/account")).data;
  assert.equal(acct.player, true); assert.equal(acct.codes.length, 1); assert.equal(acct.devices, 2);
  assert.equal(count(env, "players"), 1);
  assert.equal(env.DB.raw.prepare("SELECT player_id FROM sessions").get().player_id, env.DB.raw.prepare("SELECT id FROM players").get().id);
});

test("wrong, empty and missing save codes are refused", async () => {
  const env = makeEnv(), me = browser(env);
  await browser(env, { ip: "203.0.113.9" })("/api/codes", { action: "new" });
  for (const code of ["AAAA-BBBB-CCCC-DDDD-EEEE", "", null, 12345, undefined]) {
    assert.equal((await me("/api/load", { code })).status, 404);
  }
  assert.equal((await me("/api/account")).data.player, false);
});

test("guessing save codes is rate limited per address", async () => {
  const env = makeEnv(), me = browser(env, { ip: "198.51.100.20" });
  for (let i = 0; i < 10; i++) assert.equal((await me("/api/load", { code: "AAAA-BBBB-CCCC-DDDD-EE" + i + "E" })).status, 404);
  assert.equal((await me("/api/load", { code: "AAAA-BBBB-CCCC-DDDD-EEEE" })).status, 429);
  assert.equal((await browser(env, { ip: "198.51.100.21" })("/api/load", { code: "AAAA-BBBB-CCCC-DDDD-EEEE" })).status, 404);
});

test("only five save codes per player", async () => {
  const env = makeEnv(), me = browser(env);
  for (let i = 0; i < 5; i++) assert.equal((await me("/api/codes", { action: "new" })).status, 200);
  assert.equal((await me("/api/codes", { action: "new" })).status, 400);
});

test("you can only forget your own save codes", async () => {
  const env = makeEnv(), a = browser(env, { ip: "203.0.113.1" }), b = browser(env, { ip: "203.0.113.2" });
  await a("/api/codes", { action: "new" }); await b("/api/codes", { action: "new" });
  const idA = (await a("/api/account")).data.codes[0].id;
  assert.equal((await b("/api/codes", { action: "remove", id: idA })).status, 404);
  assert.equal((await a("/api/account")).data.codes.length, 1);
  assert.equal((await a("/api/codes", { action: "remove", id: idA })).status, 200);
  assert.equal((await browser(env)("/api/codes", { action: "remove", id: idA })).status, 401);
});

test("a save code from before accounts still works once, moves to the account, and the old rows go", async () => {
  const env = makeEnv(), a = browser(env);
  const old = browser(env, { ip: "203.0.113.3" });
  await old("/api/passkey", { action: "register_options" });                      // makes a player and an account
  const pid = env.DB.raw.prepare("SELECT id FROM players").get().id;
  const hash = "ab".repeat(32);
  env.DB.raw.prepare("INSERT INTO save_codes (player_id, code_hash, created_at) VALUES (?, ?, 1)").run(pid, hash);
  await old("/api/account");                                                      // seeing the player moves the old code over
  assert.deepEqual(env.ACCOUNTS.imported, [[1, hash]]);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM save_codes").get().n, 0);
});

test("logging in links this browser's own player to the account, or reuses the account's player", async () => {
  const env = makeEnv(), a = browser(env, { ip: "203.0.113.4" });
  const { code } = (await a("/api/codes", { action: "new" })).data;               // player 1 has account 1
  const fresh = browser(env, { ip: "203.0.113.5" });
  await fresh("/api/passkey", { action: "register_options" });                    // player 2, account 2
  await fresh("/api/load", { code });                                             // account 1 already has player 1 here
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM players").get().n, 2);
  assert.equal(env.ACCOUNTS.links.get("1|irl-dungeon"), 1);
  const blank = browser(env, { ip: "203.0.113.6" });                              // no cookie at all: gets the account's player
  assert.equal((await blank("/api/load", { code })).status, 200);
  assert.equal((await blank("/api/account")).data.codes.length, 1);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM players").get().n, 2);
});

test("a passkey adds to the account and logs a new browser in; a missing service says so", async () => {
  const env = makeEnv(), a = browser(env, { ip: "203.0.113.7" });
  const o = await a("/api/passkey", { action: "register_options" });
  assert.equal(o.data.origin, "https://irl.example");                             // the page's own address goes to the service
  assert.equal((await a("/api/passkey", { action: "register", label: "k", credential: { id: "key1" } })).status, 200);
  assert.equal((await a("/api/account")).data.passkeys.length, 1);
  const b = browser(env, { ip: "203.0.113.8" });
  assert.equal((await b("/api/passkey", { action: "login", credential: { id: "nope" } })).status, 400);
  assert.equal((await b("/api/passkey", { action: "login", credential: { id: "key1" } })).status, 200);
  assert.equal((await b("/api/account")).data.passkeys.length, 1);
  const none = browser({ ...env, ACCOUNTS: undefined });
  assert.equal((await none("/api/codes", { action: "new" })).status, 503);
});

test("you can't log out with no way back in; once you have one you can, and the code brings you back", async () => {
  const env = makeEnv(), me = browser(env);
  await me("/api/passkey", { action: "register_options" });                  // makes a player, but they have no code or key yet
  assert.equal((await me("/api/logout", {})).status, 400);
  assert.equal((await me("/api/account")).data.player, true);               // still logged in
  const { data } = await me("/api/codes", { action: "new" });
  assert.equal((await me("/api/logout", {})).status, 200);
  assert.equal((await me("/api/account")).data.player, false);              // the cookie is dead
  assert.equal((await me("/api/codes", { action: "new" })).status, 401);   // and can't make a new player until it logs in
  assert.equal((await me("/api/load", { code: data.code })).status, 200);
  assert.equal((await me("/api/account")).data.player, true);
  assert.equal(count(env, "players"), 1);
});

test("an old cookie is dead after logging out, even if someone kept a copy", async () => {
  const env = makeEnv(), me = browser(env);
  const { data } = await me("/api/codes", { action: "new" });
  const stolen = me.cookie();
  await me("/api/logout", {});
  const thief = browser(env, { ip: "203.0.113.66" }); thief.setCookie(stolen);
  assert.equal((await thief("/api/account")).data.player, false);
  assert.ok(data.code);
});

// ---------- the public ledger ----------

const seed = async (env, n = 3) => { for (let i = 1; i <= n; i++) await seal(env.DB, { kind: "test", playerId: 5, record: JSON.stringify({ n: i }), t: 86400 * 365 + i }); };

test("the public ledger shows the chain, newest first, and never who or the exact time", async () => {
  const env = makeEnv(), me = browser(env); await seed(env);
  const { data } = await me("/api/ledger");
  assert.deepEqual(data.entries.map((e) => JSON.parse(e.record).n), [3, 2, 1]);
  for (const e of data.entries) {
    assert.deepEqual(Object.keys(e).sort(), ["date", "hash", "id", "kind", "prev_hash", "record"]);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
  }
  const text = JSON.stringify(data);
  assert.equal(text.includes("player"), false);
  assert.equal(data.genesis, "0".repeat(64));
});

test("the ledger pages with before and limit, and bad values fall back to sensible ones", async () => {
  const env = makeEnv(), me = browser(env); await seed(env, 5);
  const first = (await me("/api/ledger?limit=2")).data.entries;
  assert.equal(first.length, 2);
  const next = (await me(`/api/ledger?limit=2&before=${first[1].id}`)).data.entries;
  assert.deepEqual(next.map((e) => JSON.parse(e.record).n), [3, 2]);
  for (const q of ["limit=abc", "limit=-5", "before=xyz", "limit=999999"]) assert.equal((await me("/api/ledger?" + q)).status, 200);
  assert.equal((await me("/api/ledger?limit=999999")).data.entries.length, 5);
});

test("verify passes an honest chain and reports its head", async () => {
  const env = makeEnv(), me = browser(env); await seed(env, 4);
  const { data } = await me("/api/verify");
  const last = env.DB.raw.prepare("SELECT hash FROM ledger ORDER BY id DESC LIMIT 1").get().hash;
  assert.deepEqual(data, { genesis: "0".repeat(64), complete: true, ok: true, count: 4, head: last });
});

test("verify catches a tampered ledger and says where", async () => {
  const env = makeEnv(), me = browser(env); await seed(env, 4);
  const victim = env.DB.raw.prepare("SELECT id FROM ledger ORDER BY id LIMIT 1 OFFSET 1").get().id;
  env.DB.raw.prepare("UPDATE ledger SET record = '{\"n\":999}' WHERE id = ?").run(victim);
  const { data } = await me("/api/verify");
  assert.equal(data.ok, false); assert.equal(data.at, victim);
});

test("an empty ledger verifies", async () => {
  const env = makeEnv(), me = browser(env);
  assert.deepEqual((await me("/api/verify")).data, { genesis: "0".repeat(64), complete: true, ok: true, count: 0, head: "0".repeat(64) });
});
