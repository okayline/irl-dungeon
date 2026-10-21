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
// A stand-in for the copy registry (the Registry entrypoint of dungeon-items): one counter per item shared by every game,
// births and marks idempotent by game + key. `down` makes calls throw, `refuse` makes it answer { error }. `calls` counts
// birth calls; `marks` lists every mark made.
export function fakeRegistry() {
  const born = new Map(), counts = new Map(), marked = new Map();
  const reg = {
    calls: 0, down: false, refuse: false, log: [], marks: [],
    async birth(a) {
      reg.calls++; reg.log.push(a);
      if (reg.down) throw new Error("registry unreachable");
      if (reg.refuse) return { error: "refused" };
      const k = `${a.game}|${a.key}`;
      if (born.has(k)) return { ...born.get(k), created: false };
      const copy = (counts.get(a.itemId) || 0) + 1; counts.set(a.itemId, copy);
      const r = { itemId: a.itemId, copy }; born.set(k, r);
      return { ...r, created: true };
    },
    async addMark(a) {
      if (reg.down) throw new Error("registry unreachable");
      if (reg.refuse) return { error: "refused" };
      const k = `${a.holder.game}|${a.key}`;
      if (marked.has(k)) return { ok: true, n: marked.get(k), created: false };
      const n = reg.marks.filter((m) => m.itemId === a.itemId && m.copy === a.copy).length + 1;
      marked.set(k, n); reg.marks.push(a);
      return { ok: true, n, created: true };
    },
    total: () => born.size,                                     // copies ever made
  };
  return reg;
}
// A stand-in for the shared accounts (the Accounts entrypoint of dungeon-items, tested there): same answers, kept in maps.
// Codes are random; a "passkey" is any credential { id, account } that was registered. 10 wrong codes per address, then 429.
export function fakeAccounts() {
  let n = 0; const codes = new Map(), keys = new Map(), links = new Map(), tries = new Map(), imported = [];
  const acct = new Set(), err = (error, status = 400) => ({ error, status });
  const own = (id) => [...codes].filter(([, v]) => v.acct === id);
  return {
    imported, codes, links,
    async createAccount() { acct.add(++n); return { accountId: n }; },
    async addCode(id) {
      if (own(id).length >= 5) return err("You have 5 save codes already. Forget one first.");
      const code = Array.from({ length: 5 }, () => Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, "X")).join("-");
      codes.set(code.replace(/-/g, ""), { acct: id, id: codes.size + 1 }); return { code };
    },
    async importCode(id, h) { imported.push([id, h]); return { ok: true }; },
    async removeCode(id, cid) { const e = [...codes].find(([, v]) => v.acct === id && v.id === cid); if (!e) return err("No such save code.", 404); codes.delete(e[0]); return { ok: true }; },
    async loginCode({ code, ip }) {
      const c = (tries.get(ip) || 0) + 1; tries.set(ip, c);
      if (c > 10) return err("Too many tries. Wait 15 minutes and try again.", 429);
      const v = codes.get(String(code).toUpperCase().replace(/[^A-Z0-9]/g, "")); return v ? { accountId: v.acct } : err("That save code didn't work. Check it and try again.", 404);
    },
    async info(id) { return { codes: own(id).map(([, v]) => ({ id: v.id, created_at: 1, last_used_at: null })), passkeys: [...keys].filter(([, v]) => v.acct === id).map(([k, v]) => ({ id: v.id, label: v.label })), games: [] }; },
    async waysIn(id) { return own(id).length + [...keys].filter(([, v]) => v.acct === id).length; },
    async playerFor(id, g) { return { playerId: links.get(id + "|" + g) ?? null }; },
    async link(id, g, p) {
      const taken = [...links].find(([k, v]) => k.endsWith("|" + g) && v === p);
      if (links.has(id + "|" + g)) return { playerId: links.get(id + "|" + g), linked: links.get(id + "|" + g) === p };
      if (taken) return { playerId: null, linked: false, taken: true };
      links.set(id + "|" + g, p); return { playerId: p, linked: true };
    },
    async accountOf(g, p) { const e = [...links].find(([k, v]) => k.endsWith("|" + g) && v === p); return { accountId: e ? Number(e[0].split("|")[0]) : null }; },
    async passkeyRegisterOptions({ accountId, origin }) { return { challenge: "c-" + accountId, origin }; },
    async passkeyRegister({ accountId, credential, label }) { keys.set(credential.id, { acct: accountId, id: keys.size + 1, label }); return { ok: true }; },
    async passkeyLoginOptions({ origin }) { return { challenge: "login", origin }; },
    async passkeyLogin({ credential }) { const k = keys.get(credential?.id); return k ? { accountId: k.acct } : err("That passkey isn't saved here.", 400); },
    async passkeyRemove(id, kid) { const e = [...keys].find(([, v]) => v.acct === id && v.id === kid); if (!e) return err("No such passkey.", 404); keys.delete(e[0]); return { ok: true }; },
  };
}
export const makeEnv = (extra = {}) => ({ DB: fakeD1(), ITEMS: fakeItems(), REGISTRY: fakeRegistry(), ACCOUNTS: fakeAccounts(), ...extra });

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
