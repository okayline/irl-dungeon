// irl-dungeon Worker: cookie players, the ways back in (save codes and passkeys), and the public ledger.
// The game's own routes arrive with the game. The Worker also serves the page (public/), so the page and the API
// share one origin: no CORS, a plain cookie, and passkeys that belong to one address.
//
// API (all JSON; every POST must send content-type: application/json):
//   GET  /api/account                 your save codes and passkeys (never the codes themselves)
//   POST /api/codes {action: "new" | "remove", id}   make a save code (shown once) or forget one
//   POST /api/load {code}             become the player a save code belongs to, on this device (log in)
//   POST /api/passkey {action: register_options | register | login_options | login | remove}
//   POST /api/logout                  this browser forgets its player (needs a save code or passkey first)
//   GET  /api/ledger?before=&limit=   newest first: id, kind, record, prev_hash, hash, date (never who, never the time)
//   GET  /api/verify                  checks the whole chain and returns its head (keep a copy: see ledger.js)

import { GENESIS, sha256, verifyChain } from "./ledger.js";
import { MAX_CODES, newSaveCode, hashCode, newSession, newToken, rateLimit } from "./saves.js";
import { registerOptions, verifyRegistration, loginOptions, verifyLogin } from "./passkeys.js";

const COOKIE = "irl";
const COOKIE_MAX_AGE = 400 * 86400;
const VERIFY_CAP = 10000;                    // rows /api/verify will read in one request

class Oops extends Error { constructor(m, status = 400) { super(m); this.status = status; } }

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
});

const ROUTES = {
  "GET /api/account": account, "POST /api/codes": codes, "POST /api/load": loadCode,
  "POST /api/passkey": passkey, "POST /api/logout": logout,
  "GET /api/ledger": ledger, "GET /api/verify": verify,
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS ? env.ASSETS.fetch(req) : new Response("Not found", { status: 404 });
    try {
      const route = ROUTES[`${req.method} ${url.pathname}`];
      if (!route) return json({ error: "No such thing." }, 404);
      // A page on another site can send a form post, but not a JSON one without our say-so: requiring JSON keeps
      // other sites from acting as a player.
      if (req.method === "POST" && !/^application\/json\b/i.test(req.headers.get("content-type") || "")) throw new Oops("Send JSON.", 415);
      const ctx = { env, req, url, db: env.DB, t: env.clock ? env.clock() : Date.now(), setCookie: null };
      const res = await route(ctx);
      return json(res, 200, ctx.setCookie ? { "set-cookie": ctx.setCookie } : {});
    } catch (e) {
      if (e instanceof Oops) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Something broke. Try again in a moment." }, 500);
    }
  },
};

const sec = (ms) => Math.floor(ms / 1000);

// ---------- players ----------
// A player's first device uses players.token_hash; devices loaded later (save code or passkey) each get a row in
// sessions. Only hashes of tokens are stored.

// Exact: the whole value must be a token (nothing after it but the next cookie), so junk on the end is no cookie at all.
const readCookie = (req) => { const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,})(?=\\s*(?:;|$))`)); return m ? m[1] : null; };
const cookieFor = (token) => `${COOKIE}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
const CLEAR_COOKIE = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

// The player behind this request's cookie, or null. Reads never make players (so crawlers don't); making one is
// rate limited per address.
async function player(ctx, create = false) {
  const { db, env, req } = ctx, token = readCookie(req), now = sec(ctx.t);
  if (token) {
    const h = await sha256(token);
    let p = await db.prepare("SELECT * FROM players WHERE token_hash = ?").bind(h).first();
    if (!p) {
      p = await db.prepare("SELECT p.* FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = ?").bind(h).first();
      if (p) await db.prepare("UPDATE sessions SET seen_at = ? WHERE token_hash = ?").bind(now, h).run();
    }
    if (p) { await db.prepare("UPDATE players SET seen_at = ? WHERE id = ?").bind(now, p.id).run(); return p; }
  }
  if (!create) return null;
  if (!(await rateLimit(env, req, "new-player", 20, 3600))) throw new Oops("Too many new players from here. Try again later.", 429);
  const fresh = newToken();
  const row = await db.prepare("INSERT INTO players (token_hash, created_at, seen_at) VALUES (?,?,?) RETURNING *").bind(await sha256(fresh), now, now).first();
  ctx.setCookie = cookieFor(fresh);
  return row;
}

const must = async (ctx) => { const p = await player(ctx); if (!p) throw new Oops("No player here.", 401); return p; };
const body = async (ctx) => {
  let v;
  try { v = await ctx.req.json(); } catch { throw new Oops("That request didn't make sense."); }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Oops("That request didn't make sense.");
  return v;
};

// ---------- the public ledger ----------

async function ledger(ctx) {
  const before = Number(ctx.url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER;
  const limit = Math.min(200, Math.max(1, Number(ctx.url.searchParams.get("limit")) || 50));
  const rows = (await ctx.db.prepare("SELECT id, kind, record, prev_hash, hash, created_at FROM ledger WHERE id < ? ORDER BY id DESC LIMIT ?").bind(before, limit).all()).results;
  return {
    genesis: GENESIS,
    entries: rows.map((r) => ({ id: r.id, kind: r.kind, record: r.record, prev_hash: r.prev_hash, hash: r.hash,
      date: new Date(r.created_at * 1000).toISOString().slice(0, 10) })),
  };
}

async function verify(ctx) {
  const rows = (await ctx.db.prepare("SELECT id, record, prev_hash, hash FROM ledger ORDER BY id ASC LIMIT ?").bind(VERIFY_CAP + 1).all()).results;
  return { genesis: GENESIS, complete: rows.length <= VERIFY_CAP, ...(await verifyChain(rows.slice(0, VERIFY_CAP))) };
}

// ---------- save codes and passkeys ----------

async function account(ctx) {
  const me = await player(ctx);
  if (!me) return { player: false, codes: [], passkeys: [], devices: 0 };
  const { db } = ctx;
  const codes = (await db.prepare("SELECT id, created_at, last_used_at FROM save_codes WHERE player_id = ? ORDER BY id").bind(me.id).all()).results;
  const passkeys = (await db.prepare("SELECT id, label, created_at, last_used_at FROM passkeys WHERE player_id = ? ORDER BY id").bind(me.id).all()).results;
  const devices = 1 + (await db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE player_id = ?").bind(me.id).first()).n;
  return { player: true, codes, passkeys, devices };
}

async function codes(ctx) {
  const b = await body(ctx), { db } = ctx;
  if (b.action === "new") {
    const me = await player(ctx, true);
    const n = (await db.prepare("SELECT COUNT(*) AS n FROM save_codes WHERE player_id = ?").bind(me.id).first()).n;
    if (n >= MAX_CODES) throw new Oops(`You have ${MAX_CODES} save codes already. Forget one first.`);
    const code = newSaveCode();
    await db.prepare("INSERT INTO save_codes (player_id, code_hash, created_at) VALUES (?, ?, ?)").bind(me.id, await hashCode(code), sec(ctx.t)).run();
    return { code };
  }
  if (b.action === "remove") {
    const me = await must(ctx);
    const r = await db.prepare("DELETE FROM save_codes WHERE id = ? AND player_id = ?").bind(Number(b.id), me.id).run();
    if (!r.meta.changes) throw new Oops("No such save code.", 404);
    return { ok: true };
  }
  throw new Oops("Unknown action.");
}

// Type a save code: this device becomes that player.
async function loadCode(ctx) {
  const { env, db } = ctx;
  if (!(await rateLimit(env, ctx.req, "load", 10, 900))) throw new Oops("Too many tries. Wait 15 minutes and try again.", 429);
  const code = (await body(ctx)).code;
  const row = await db.prepare("SELECT c.id, c.player_id FROM save_codes c WHERE c.code_hash = ?").bind(await hashCode(code)).first();
  if (!row) throw new Oops("That save code didn't work. Check it and try again.", 404);
  await db.prepare("UPDATE save_codes SET last_used_at = ? WHERE id = ?").bind(sec(ctx.t), row.id).run();
  ctx.setCookie = cookieFor(await newSession(env, row.player_id));
  return { ok: true };
}

async function passkey(ctx) {
  const b = await body(ctx), { env, req, db } = ctx;
  try {
    if (b.action === "login_options" || b.action === "login") {
      if (!(await rateLimit(env, req, "passkey", 20, 900))) throw new Oops("Too many tries. Wait 15 minutes and try again.", 429);
      if (b.action === "login_options") return await loginOptions(env, req);
      const playerId = await verifyLogin(env, req, b.credential);
      const p = await db.prepare("SELECT id FROM players WHERE id = ?").bind(playerId).first();
      if (!p) throw new Oops("That player is gone.", 404);
      ctx.setCookie = cookieFor(await newSession(env, p.id));
      return { ok: true };
    }
    if (b.action === "register_options" || b.action === "register") {
      const me = await player(ctx, true);
      if (b.action === "register_options") return await registerOptions(env, req, me);
      const n = (await db.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE player_id = ?").bind(me.id).first()).n;
      if (n >= 10) throw new Oops("That's plenty of passkeys! Forget one first.");
      return await verifyRegistration(env, req, me, b.credential, b.label);
    }
    if (b.action === "remove") {
      const me = await must(ctx);
      const r = await db.prepare("DELETE FROM passkeys WHERE id = ? AND player_id = ?").bind(Number(b.id), me.id).run();
      if (!r.meta.changes) throw new Oops("No such passkey.", 404);
      return { ok: true };
    }
    throw new Oops("Unknown action.");
  } catch (e) {
    if (e instanceof Oops) throw e;
    throw new Oops(e.message || "Something went wrong with the passkey.");
  }
}

// Log out: this browser forgets its player, but only once there's a save code or passkey to get back in.
async function logout(ctx) {
  const me = await player(ctx), { db } = ctx;
  if (!me) { ctx.setCookie = CLEAR_COOKIE; return { ok: true }; }
  const ways = (await db.prepare("SELECT (SELECT COUNT(*) FROM save_codes WHERE player_id = ?) + (SELECT COUNT(*) FROM passkeys WHERE player_id = ?) AS n").bind(me.id, me.id).first()).n;
  if (!ways) throw new Oops("Make a save code or passkey first, or you'd have no way back in.");
  const h = await sha256(readCookie(ctx.req));
  const s = await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(h).run();
  if (!s.meta.changes) await db.prepare("UPDATE players SET token_hash = ? WHERE id = ? AND token_hash = ?").bind(await sha256(newToken()), me.id, h).run();
  ctx.setCookie = CLEAR_COOKIE;
  return { ok: true };
}
