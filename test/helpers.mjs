// Test helpers: Node's built-in SQLite standing in for D1, and a browser that keeps a cookie.
//
// Rule for every test here: expected values are worked out independently (node:crypto, hand-built bytes, raw SQL),
// never by calling the code under test to produce its own answer.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../src/worker.js";

// A D1 look-alike. `batch` runs its statements in one transaction and rolls the lot back if any fails, which is
// what D1 does. `raw` is the SQLite handle, for tests that poke at the tables directly.
export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const prep = (sql, args = []) => ({
    sql, args, bind: (...a) => prep(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  const batch = async (stmts) => {
    db.exec("BEGIN");
    try {
      const out = stmts.map((st) => ({ meta: { changes: Number(db.prepare(st.sql).run(...st.args).changes) } }));
      db.exec("COMMIT");
      return out;
    } catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  return { prepare: (sql) => prep(sql), batch, raw: db };
}

// A hand-made stand-in for the shared item table (okayline/dungeon-items): 12 commons (ids 1-12), 12 uncommons (13-24),
// 12 rares (25-36), a button among the commons (id 37), and a retired common (38) that must never be dealt.
export function fakeItems() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, source TEXT, source_key TEXT, rarity TEXT, name TEXT, note TEXT, alignment TEXT, nature TEXT, type TEXT, image TEXT, extra TEXT DEFAULT '{}', retired INTEGER DEFAULT 0)");
  const ins = db.prepare("INSERT INTO items (id, source, source_key, rarity, name, note, type, image, retired) VALUES (?,?,?,?,?,?,?,?,?)");
  ["common", "uncommon", "rare"].forEach((r, k) => { for (let i = 1; i <= 12; i++) ins.run(k * 12 + i, "4dungeon", r + i, r, `a ${r} thing ${i}`, `Note ${r} ${i}.`, null, null, 0); });
  ins.run(37, "88x31", "5", "common", "Bodacious", null, "neon", "https://88x31.app/api/img?d=5", 0);
  ins.run(38, "4dungeon", "gone", "common", "a retired thing", null, null, null, 1);
  const prep = (sql, args = []) => ({ bind: (...a) => prep(sql, a), first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }) });
  return { prepare: (sql) => prep(sql), raw: db };
}
export const makeEnv = (extra = {}) => ({ DB: fakeD1(), ITEMS: fakeItems(), ...extra });

// A browser: remembers the cookie the Worker sets, and sends a (fixed) client address so rate limits can be tested.
// Each call returns { status, data, headers }.
export function browser(env, { ip = "203.0.113.1", origin = "https://irl.example", cf = null } = {}) {
  let cookie = "";
  const me = async (path, body, { method, headers = {}, raw } = {}) => {
    const req = new Request(origin + path, {
      method: method || (body !== undefined || raw !== undefined ? "POST" : "GET"),
      headers: { "cf-connecting-ip": ip, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (cf) Object.defineProperty(req, "cf", { value: cf });         // what Cloudflare adds to a request (here, only what a test sets)
    const res = await worker.fetch(req, env);
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, data, headers: res.headers };
  };
  me.cookie = () => cookie;
  me.setCookie = (c) => { cookie = c; };
  return me;
}

// Every table as one big string, to prove a secret was never stored in the clear.
export function dumpAll(env) {
  const tables = env.DB.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  return tables.map((t) => JSON.stringify(env.DB.raw.prepare(`SELECT * FROM ${t}`).all())).join("\n");
}
