// irl-dungeon Worker: cookie players, the ways back in (save codes and passkeys), and the public ledger.
// The Worker also serves the page (public/), so the page and the API
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
//   GET  /api/here                    a rough first cell from the IP's approximate position (nothing stored; see place.js)
//   POST /api/run {cell, offset?}     open a cell: the doors you've unlocked, the wings you've finished, whether today's key is
//                                     ready, and whether the cell earns credit (the travel check, src/travel.js)
//   POST /api/unlock {cell, door, offset}   spend today's key on a locked door (one a day, by your local day)
//   POST /api/sign {cell, wing, unsign?}   sign a wing you found first with your name (makes your name if you have
//                                     none), or with unsign: true take your name off it again
//   POST /api/name {action: "reroll"} a new two-word name (only once you have one)
//   POST /api/cells {action: "save" | "forget", cell}   your saved cells (up to 20, listed in /api/account)
//   POST /api/admin {action: "test", on, cell?}   admins only: test mode on (remembering the cell you're in) or off
//                                     (answers `back`: that cell, to return to)
//   POST /api/rooms {cell, rooms:[...]}  the rooms you've stood in, sent in batches by the page (private, nothing published)
//   POST /api/area {cell}             for the cell and the six around it: "new", "entered" or "cleared" (first wing walked)
//   POST /api/walk {cell, visited}    the rooms you've stood in; any wing this completes is recorded, and its first finder sealed

import { GENESIS, sha256, verifyChain, head, chainInserts, isUnique, chainClash } from "./ledger.js";
import FLOOR from "../public/floor.js";
import { isCell, guessCell, ring } from "../public/place.js";
import { travelCheck, waitText } from "./travel.js";
import { nameText, freeName } from "./names.js";
import { LAYER, buildFloor, wingKey, finishedWings } from "./game.js";
import { localDay, dayFor, offsetCheck, BadOffset, dayText } from "./day.js";
import { listItems, getItems } from "./items.js";
import { deckKey, dealt } from "./deal.js";
import { numberFind, numberPending, GAME } from "./copies.js";
import { hides, WALLS, NEAR_AFTER, NEAR_CHANCE } from "./search.js";
import { hashCode, newSession, newToken, rateLimit } from "./saves.js";

const COOKIE = "irl";
const COOKIE_MAX_AGE = 400 * 86400;
const VERIFY_CAP = 10000;                    // rows /api/verify will read in one request

class Oops extends Error { constructor(m, status = 400) { super(m); this.status = status; } }

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
});

const ROUTES = {
  "GET /api/account": account, "POST /api/pin": pinCopy, "POST /api/codes": codes, "POST /api/load": loadCode,
  "POST /api/passkey": passkey, "POST /api/logout": logout,
  "GET /api/ledger": ledger, "GET /api/here": here, "GET /api/verify": verify,
  "POST /api/run": run, "POST /api/rooms": rooms, "POST /api/area": area, "POST /api/sign": sign, "POST /api/name": rename, "POST /api/cells": cells, "POST /api/admin": admin, "POST /api/unlock": unlock, "POST /api/walk": walk, "POST /api/search": search, "GET /api/finds": finds,
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

// ---------- save codes and passkeys (kept by the shared Accounts service in dungeon-items) ----------
// This game keeps its own players and cookie. Save codes and passkeys belong to an account there; the account says which
// player here is yours (account_players). A player gets an account the first time they make a code or passkey.

const ACC = (env) => { if (!env.ACCOUNTS) throw new Oops("Accounts are unavailable right now. Try again in a moment.", 503); return env.ACCOUNTS; };
const ipOf = (req) => req.headers.get("cf-connecting-ip") || "unknown";
const originOf = (ctx) => new URL(ctx.req.url).origin;
const ok = (r) => { if (r && r.error) throw new Oops(r.error, r.status || 400); return r; };

// This player's account id (or null). Players from before accounts existed have save codes in this game's own table:
// the first time we see one, its codes move to the account and the table's rows are deleted.
async function accountFor(ctx, me, make = false) {
  const acc = ACC(ctx.env), { db } = ctx;
  let id = (await acc.accountOf(GAME, me.id)).accountId;
  const legacy = (await db.prepare("SELECT code_hash FROM save_codes WHERE player_id = ?").bind(me.id).all()).results;
  if (!id && !make && !legacy.length) return null;
  if (!id) {
    id = (await acc.createAccount()).accountId;
    const l = ok(await acc.link(id, GAME, me.id));
    if (!l.linked) throw new Oops("That didn't work. Try again.");
  }
  for (const r of legacy) await acc.importCode(id, r.code_hash);
  if (legacy.length) await db.prepare("DELETE FROM save_codes WHERE player_id = ?").bind(me.id).run();
  return id;
}

// Log this browser in as the account's player here: the one it already has, else this browser's own player (if it has no
// account yet), else a new one.
async function enter(ctx, accountId) {
  const { env, db } = ctx, acc = ACC(env), t = sec(ctx.t);
  let { playerId } = await acc.playerFor(accountId, GAME);
  if (!playerId) {
    const cur = await player(ctx);
    if (cur && !(await acc.accountOf(GAME, cur.id)).accountId) playerId = cur.id;
    else {
      if (!(await rateLimit(env, ctx.req, "new-player", 20, 3600))) throw new Oops("Too many new players from here. Try again later.", 429);
      playerId = (await db.prepare("INSERT INTO players (token_hash, created_at, seen_at) VALUES (?,?,?) RETURNING id").bind(await sha256(newToken()), t, t).first()).id;
    }
    const l = ok(await acc.link(accountId, GAME, playerId));
    playerId = l.playerId;
  }
  ctx.setCookie = cookieFor(await newSession(env, playerId));
}

async function account(ctx) {
  const me = await player(ctx);
  if (!me) return { player: false, codes: [], passkeys: [], devices: 0, name: null, cells: [], carry: null, copies: [] };
  const { db } = ctx;
  const id = await accountFor(ctx, me);
  const ways = id ? ok(await ACC(ctx.env).info(id)) : { codes: [], passkeys: [] };
  const devices = 1 + (await db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE player_id = ?").bind(me.id).first()).n;
  const saved = (await db.prepare("SELECT cell, created_at FROM saved_cells WHERE player_id = ? ORDER BY created_at, cell").bind(me.id).all()).results;
  const [carry, copies] = await Promise.all([carried(ctx.env, me.id), copiesOf(ctx.env, me.id)]);   // (v0.23) the copy you carry, and the picker's list
  return { player: true, codes: ways.codes, passkeys: ways.passkeys, devices, name: nameText(me.name_a, me.name_b), cells: saved, carry: carryView(carry), copies, ...(me.admin ? { admin: true, test: !!me.test_mode } : {}) };
}

async function codes(ctx) {
  const b = await body(ctx);
  if (b.action === "new") {
    const me = await player(ctx, true);
    return { code: ok(await ACC(ctx.env).addCode(await accountFor(ctx, me, true))).code };
  }
  if (b.action === "remove") {
    const me = await must(ctx), id = await accountFor(ctx, me);
    if (!id) throw new Oops("No such save code.", 404);
    ok(await ACC(ctx.env).removeCode(id, Number(b.id)));
    return { ok: true };
  }
  throw new Oops("Unknown action.");
}

// Type a save code: this device becomes that player. (The code is an account's; this game's player comes with it.)
async function loadCode(ctx) {
  const code = (await body(ctx)).code;
  const r = await ACC(ctx.env).loginCode({ code, ip: ipOf(ctx.req) });
  if (r.error) {
    if (r.status === 404) {
      // a code from before accounts: this game's own table still has it until its player is next seen
      if (!(await rateLimit(ctx.env, ctx.req, "load", 10, 900))) throw new Oops("Too many tries. Wait 15 minutes and try again.", 429);
      const old = await ctx.db.prepare("SELECT player_id FROM save_codes WHERE code_hash = ?").bind(await hashCode(code)).first();
      if (old) {
        const p = await ctx.db.prepare("SELECT * FROM players WHERE id = ?").bind(old.player_id).first();
        await enter(ctx, await accountFor(ctx, p, true));
        return { ok: true };
      }
    }
    ok(r);
  }
  await enter(ctx, r.accountId);
  return { ok: true };
}

async function passkey(ctx) {
  const b = await body(ctx), { env, req } = ctx, acc = ACC(env), origin = originOf(ctx);
  if (b.action === "login_options") return ok(await acc.passkeyLoginOptions({ origin, ip: ipOf(req) }));
  if (b.action === "login") {
    const r = ok(await acc.passkeyLogin({ origin, ip: ipOf(req), credential: b.credential }));
    await enter(ctx, r.accountId);
    return { ok: true };
  }
  if (b.action === "register_options" || b.action === "register") {
    const me = await player(ctx, true), accountId = await accountFor(ctx, me, true);
    if (b.action === "register_options") return ok(await acc.passkeyRegisterOptions({ accountId, origin }));
    return ok(await acc.passkeyRegister({ accountId, origin, credential: b.credential, label: b.label }));
  }
  if (b.action === "remove") {
    const me = await must(ctx), id = await accountFor(ctx, me);
    if (!id) throw new Oops("No such passkey.", 404);
    return ok(await acc.passkeyRemove(id, Number(b.id)));
  }
  throw new Oops("Unknown action.");
}

// Log out: this browser forgets its player, but only once there's a save code or passkey to get back in.
async function logout(ctx) {
  const me = await player(ctx), { db } = ctx;
  if (!me) { ctx.setCookie = CLEAR_COOKIE; return { ok: true }; }
  const id = await accountFor(ctx, me);
  const ways = id ? await ACC(ctx.env).waysIn(id) : 0;
  if (!ways) throw new Oops("Make a save code or passkey first, or you'd have no way back in.");
  const h = await sha256(readCookie(ctx.req));
  const s = await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(h).run();
  if (!s.meta.changes) await db.prepare("UPDATE players SET token_hash = ? WHERE id = ? AND token_hash = ?").bind(await sha256(newToken()), me.id, h).run();
  ctx.setCookie = CLEAR_COOKIE;
  return { ok: true };
}

// ---------- the game: cells, the key, and finished wings ----------

const need = (ok, msg, status = 400) => { if (!ok) throw new Oops(msg, status); };

// The cell and the player's progress in it. Every player sees the same floor (the shape and the direction labels
// both come from the cell), so nothing private is stored per cell. Creates the player (rate limited) on first sight.
async function theRun(ctx, b, create) {
  need(isCell(b.cell), "That isn't a cell.");
  const me = create ? await player(ctx, true) : await must(ctx);
  if (testing(me)) {        // test mode: the admin's own test doors, no travel check, and the last place left alone
    const doors = (await ctx.db.prepare("SELECT door FROM test_unlocks WHERE player_id = ? AND cell = ? AND layer = ? ORDER BY id").bind(me.id, b.cell, LAYER).all()).results.map((r) => r.door);
    return { me, doors, floor: buildFloor(b.cell, doors), travel: { ok: true }, test: true };
  }
  const doors = (await ctx.db.prepare("SELECT door FROM unlocks WHERE player_id = ? AND cell = ? AND layer = ? ORDER BY id").bind(me.id, b.cell, LAYER).all()).results.map((r) => r.door);
  return { me, doors, floor: buildFloor(b.cell, doors), travel: await travel(ctx, me, b.cell) };
}

// The travel check (src/travel.js). A credited claim becomes the player's last place; one that isn't changes nothing.
async function travel(ctx, me, cell) {
  const t = sec(ctx.t), last = await ctx.db.prepare("SELECT cell, at FROM places WHERE player_id = ?").bind(me.id).first();
  const c = travelCheck(last, cell, t);
  if (c.ok) await ctx.db.prepare("INSERT INTO places (player_id, cell, at) VALUES (?,?,?) ON CONFLICT (player_id) DO UPDATE SET cell = excluded.cell, at = excluded.at").bind(me.id, cell, t).run();
  return c;
}
const needCredit = (r) => { if (!r.travel.ok) throw new Oops(`That's a long way from where you just were. This cell earns nothing until ${waitText(r.travel.waitSec)} from now.`, 403); };

// GET /api/here: the rough first cell. Makes no player and stores nothing.
async function here(ctx) {
  return { cell: guessCell(ctx.req.cf) };
}

const lastKeyDay = async (ctx, me) => (await ctx.db.prepare("SELECT MAX(day) AS d FROM unlocks WHERE player_id = ?").bind(me.id).first()).d;
const dayOf = (ctx, offset, last) => { try { return dayFor(ctx.t, offset, last); } catch (e) { if (e instanceof BadOffset) throw new Oops(e.message); throw e; } };

// Test mode: an admin's sandbox. Nothing done in it counts: no key, no travel check, no completions, no first finds,
// no signatures, nothing on the ledger, and its doors live in test_unlocks, which only that admin's test floors read.
const testing = (me) => !!(me && me.admin && me.test_mode);

// POST /api/rooms {cell, rooms: [room numbers]}: the rooms this player has stood in, sent in a batch by the page (every so often,
// not on every step). Every room must be one the cell really has, given the doors the player has unlocked; up to 64 at once.
// Only where the cell earns credit; in test mode nothing is kept. A private note: a cell id and room numbers.
async function rooms(ctx) {
  const b = await body(ctx), { db, env, req } = ctx;
  if (!(await rateLimit(env, req, "rooms", 600, 3600))) throw new Oops("Too many tries. Try again later.", 429);
  need(Array.isArray(b.rooms) && b.rooms.length >= 1 && b.rooms.length <= 64 && b.rooms.every((x) => Number.isInteger(x) && x >= 0), "Those aren't rooms.");
  const r = await theRun(ctx, b, false);
  need(b.rooms.every((x) => r.floor.rooms[x]), "A room there isn't built.");
  if (r.test) return { test: true };
  needCredit(r);
  await db.batch([...new Set(b.rooms)].map((x) => db.prepare("INSERT OR IGNORE INTO walked_rooms (player_id, cell, layer, room, created_at) VALUES (?,?,?,?,?)").bind(r.me.id, b.cell, LAYER, x, sec(ctx.t))));
  return { ok: true };
}

// POST /api/area {cell}: how this player stands with the cell they are in and the six cells around it (public/place.js ring,
// in the order the AREA map draws them): "cleared" once they have walked the cell's first wing, "entered" once they have
// stood in any of its rooms, else "new". Answers { here, ring: [six states] }. Test mode: all "new".
async function area(ctx) {
  const b = await body(ctx), { db, env, req } = ctx;
  if (!(await rateLimit(env, req, "area", 1200, 3600))) throw new Oops("Too many tries. Try again later.", 429);
  need(isCell(b.cell), "That isn't a cell.");
  const me = await must(ctx), around = ring(b.cell);
  if (testing(me)) return { here: "new", ring: around.map(() => "new") };
  const ids = [b.cell, ...around], marks = ids.map(() => "?").join(",");
  const entered = new Set((await db.prepare(`SELECT DISTINCT cell FROM walked_rooms WHERE player_id = ? AND layer = ? AND cell IN (${marks})`).bind(me.id, LAYER, ...ids).all()).results.map((x) => x.cell));
  const cleared = new Set((await db.prepare(`SELECT DISTINCT cell FROM completions WHERE player_id = ? AND layer = ? AND wing_key = '0' AND cell IN (${marks})`).bind(me.id, LAYER, ...ids).all()).results.map((x) => x.cell));
  const state = (c) => (cleared.has(c) ? "cleared" : entered.has(c) ? "entered" : "new");
  return { here: state(b.cell), ring: around.map(state) };
}

async function run(ctx) {
  const b = await body(ctx), r = await theRun(ctx, b, true), { db } = ctx;
  if (r.test) {
    const firsts = (await db.prepare("SELECT f.wing_key, f.signed, p.name_a, p.name_b FROM wing_firsts f JOIN players p ON p.id = f.player_id WHERE f.cell = ? AND f.layer = ?").bind(b.cell, LAYER).all()).results
      .map((x) => ({ wing: x.wing_key, name: x.signed ? nameText(x.name_a, x.name_b) : null }));
    return { layer: LAYER, days: FLOOR.DAYS, unlocks: r.doors, completed: [], rooms: [], keyReady: true, firsts, unsigned: [], signed: [], credit: true, test: true };
  }
  const completed = (await db.prepare("SELECT wing_key FROM completions WHERE player_id = ? AND cell = ? AND layer = ?").bind(r.me.id, b.cell, LAYER).all()).results.map((x) => x.wing_key);
  const last = await lastKeyDay(ctx, r.me);
  // keyReady is only worked out when the page says what time zone offset it is on
  const keyReady = b.offset === undefined ? null : dayOf(ctx, b.offset, last) > (last ?? -Infinity);
  // who found this cell's wings first: a name only where the finder signed (never an id)
  const firsts = (await db.prepare("SELECT f.wing_key, f.signed, p.name_a, p.name_b FROM wing_firsts f JOIN players p ON p.id = f.player_id WHERE f.cell = ? AND f.layer = ?").bind(b.cell, LAYER).all()).results
    .map((x) => ({ wing: x.wing_key, name: x.signed ? nameText(x.name_a, x.name_b) : null }));
  const mine = (await db.prepare("SELECT wing_key, signed FROM wing_firsts WHERE cell = ? AND layer = ? AND player_id = ?").bind(b.cell, LAYER, r.me.id).all()).results;
  const mineUnsigned = mine.filter((x) => !x.signed).map((x) => x.wing_key), mineSigned = mine.filter((x) => x.signed).map((x) => x.wing_key);
  if (r.travel.ok) await db.prepare("INSERT OR IGNORE INTO walked_rooms (player_id, cell, layer, room, created_at) VALUES (?,?,?,0,?)").bind(r.me.id, b.cell, LAYER, sec(ctx.t)).run();   // arriving in a cell is noted (once per cell: the first room), so the AREA map can show it as entered
  const walked = (await db.prepare("SELECT room FROM walked_rooms WHERE player_id = ? AND cell = ? AND layer = ? ORDER BY room").bind(r.me.id, b.cell, LAYER).all()).results.map((x) => x.room);
  return { layer: LAYER, days: FLOOR.DAYS, unlocks: r.doors, completed, rooms: walked, keyReady, firsts, unsigned: mineUnsigned, signed: mineSigned, credit: r.travel.ok, ...(r.travel.ok ? {} : { waitSec: r.travel.waitSec }) };
}

async function unlock(ctx) {
  const b = await body(ctx), { db, env, req } = ctx;
  if (!(await rateLimit(env, req, "unlock", 120, 3600))) throw new Oops("Too many tries. Try again later.", 429);
  need(Number.isInteger(b.door) && b.door >= 0, "That isn't a door.");
  const r = await theRun(ctx, b, false);
  if (r.test) {
    need(FLOOR.lockedDoors(r.floor).includes(b.door), "That isn't a door you can unlock.");
    await db.prepare("INSERT OR IGNORE INTO test_unlocks (player_id, cell, layer, door, created_at) VALUES (?,?,?,?,?)").bind(r.me.id, b.cell, LAYER, b.door, sec(ctx.t)).run();
    return { ok: true, door: b.door, test: true };
  }
  needCredit(r);
  const last = await lastKeyDay(ctx, r.me), day = dayOf(ctx, b.offset, last);
  if (last != null && day <= last) throw new Oops("The door won't unlock. Today's key is spent. Another comes tomorrow.", 403);
  need(FLOOR.lockedDoors(r.floor).includes(b.door), "That isn't a door you can unlock.");
  try {
    await db.prepare("INSERT INTO unlocks (player_id, cell, layer, door, day, tz_check, created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(r.me.id, b.cell, LAYER, b.door, day, offsetCheck(b.offset, req.cf && req.cf.timezone, ctx.t), sec(ctx.t)).run();
  } catch (e) { if (isUnique(e)) throw new Oops("The door won't unlock. Today's key is spent. Another comes tomorrow.", 403); throw e; }
  return { ok: true, door: b.door, day };
}

// Pressing into a wall searches it (rules in src/search.js). What the room hides today is the same for everyone; each
// player's work on it is theirs. A wall hides 0 to 3 things in order; this player's searches on it add up, and each time
// the total reaches what the next thing needs, they find it, dealt from that room-day's shuffled deck of its rarity
// (src/deal.js) out of the shared item table (src/items.js).
// Answers { result: "miss", noise? }, { result: "done" } (everything on that wall is found), or { result: "found", item }.
async function search(ctx) {
  const b = await body(ctx), { db, env, req } = ctx;
  if (!(await rateLimit(env, req, "search", 1200, 3600))) throw new Oops("Too many tries. Try again later.", 429);
  need(WALLS.includes(b.dir), "That isn't a wall.");
  need(Number.isInteger(b.room) && b.room >= 0, "That isn't a room.");
  const r = await theRun(ctx, b, false), room = r.floor.rooms[b.room];
  need(room, "That room isn't built.");
  need(b.room !== r.floor.start, "The start room's walls are the way out.");
  need(room.doors[b.dir] === undefined, "That isn't a wall.");
  if (!r.test) needCredit(r);
  const last = r.test ? null : (await db.prepare("SELECT MAX(day) AS d FROM finds WHERE player_id = ?").bind(r.me.id).first()).d;
  const day = dayOf(ctx, b.offset, last), spot = `${wingKey(r.doors, room.wing)}:${b.room}`;
  const things = hides(room, `${b.cell}|${spot}|${day}`)[b.dir] || [];
  if (!things.length) return { result: "miss" };                                      // a bare wall never answers
  const showItem = (it, copy) => ({ id: it.id, name: it.name, rarity: it.rarity, note: it.note, type: it.type, image: it.image, copy });
  const poolFor = async (rarity) => listItems(env, { rarity, source: "4dungeon" });   // dungeon items only for now (v0.21)
  if (r.test) {                                                                       // the sandbox: the first thing on the wall, nothing saved
    const pool = await poolFor(things[0].rarity);
    return pool.length ? { result: "found", item: showItem(pool.find((i) => i.id === dealt(pool, deckKey(b.cell, spot, day, things[0].rarity), 0)), null), test: true } : { result: "miss" };
  }
  const where = [r.me.id, b.cell, LAYER, spot, day, b.dir];
  const taken = async () => (await db.prepare("SELECT COUNT(*) AS n FROM finds WHERE player_id = ? AND cell = ? AND layer = ? AND spot = ? AND day = ? AND wall = ?").bind(...where).first()).n;
  let slot = await taken();
  if (slot >= things.length) { await numberPending(env, db, r.me.id); return { result: "done" }; }
  const got = (await db.prepare("INSERT INTO search_prog (player_id, cell, layer, spot, day, wall, searches) VALUES (?,?,?,?,?,?,1) ON CONFLICT (player_id, cell, layer, spot, day, wall) DO UPDATE SET searches = searches + 1 RETURNING searches")
    .bind(...where).first()).searches;
  const before = things.slice(0, slot).reduce((n, t) => n + t.need, 0);            // searches the things already found took
  if (got < before + things[slot].need) return { result: "miss", noise: got - before >= NEAR_AFTER && Math.random() < NEAR_CHANCE };
  for (let tries = 0; tries < 8; tries++) {
    const rarity = things[slot].rarity, pool = await poolFor(rarity);
    if (!pool.length) return { result: "miss" };
    const key = deckKey(b.cell, spot, day, rarity);
    const pos = (await db.prepare("SELECT COUNT(*) AS n FROM finds WHERE cell = ? AND layer = ? AND spot = ? AND day = ? AND rarity = ?").bind(b.cell, LAYER, spot, day, rarity).first()).n;
    const item = pool.find((i) => i.id === dealt(pool, key, pos));
    try {                                                                            // saved first, numbered by the registry a moment later (src/copies.js)
      const row = await db.prepare("INSERT INTO finds (player_id, cell, layer, spot, day, wall, slot, rarity, deck_pos, item_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) RETURNING id")
        .bind(r.me.id, b.cell, LAYER, spot, day, b.dir, slot, rarity, pos, item.id, sec(ctx.t)).first();
      const copy = await numberFind(env, db, { id: row.id, player_id: r.me.id, item_id: item.id, created_at: sec(ctx.t) });
      return { result: "found", item: showItem(item, copy) };
    } catch (e) {
      if (!isUnique(e)) throw e;
      const now = await taken();
      if (now > slot) { await numberPending(env, db, r.me.id); return { result: "done" }; }   // the same player's other press got it first
    }                                                                                // someone else took that deck place a moment ago: try the next
  }
  throw new Oops("Something got in the way. Search again.", 409);
}

// GET /api/finds: what this player has found, newest first (the INVOKE screen). Item details come from the shared table.
async function finds(ctx) {
  const me = await must(ctx);
  await numberPending(ctx.env, ctx.db, me.id);                                      // finds the registry couldn't number yet
  const rows = (await ctx.db.prepare("SELECT id, day, copy, item_id FROM finds WHERE player_id = ? ORDER BY id DESC LIMIT 200").bind(me.id).all()).results;
  const items = rows.length ? await getItems(ctx.env, rows.map((r) => r.item_id)) : {};
  return { finds: rows.map((r) => ({ id: r.id, day: dayText(r.day), copy: r.copy, item_id: r.item_id, item: items[r.item_id] ? { name: items[r.item_id].name, rarity: items[r.item_id].rarity, type: items[r.item_id].type, note: items[r.item_id].note, image: items[r.item_id].image } : { name: "an item that has gone missing", rarity: "common", type: null, note: null, image: null } })) };
}

// The rooms the player has stood in. Any wing this completes is recorded for them; if nobody had finished that wing
// before, they are its first finder, sealed on the ledger in the same batch (anonymous: no name, no id in the entry).
async function walk(ctx) {
  const b = await body(ctx), { db, env, req } = ctx;
  if (!(await rateLimit(env, req, "walk", 240, 3600))) throw new Oops("Too many tries. Try again later.", 429);
  const r = await theRun(ctx, b, false);
  if (r.test) {                         // checked like a real walk, recorded nowhere
    const fin = finishedWings(r.floor, r.doors, b.visited);
    need(fin.ok, fin.error);
    return { wings: fin.wings.map((w) => ({ key: w.key, wing: w.wing, first: false })), completed: [], test: true };
  }
  needCredit(r);
  const fin = finishedWings(r.floor, r.doors, b.visited);
  need(fin.ok, fin.error);
  const have = new Set((await db.prepare("SELECT wing_key FROM completions WHERE player_id = ? AND cell = ? AND layer = ?").bind(r.me.id, b.cell, LAYER).all()).results.map((x) => x.wing_key));
  const out = [];
  for (const w of fin.wings) {
    if (have.has(w.key)) continue;
    out.push({ key: w.key, wing: w.wing, first: await recordWing(ctx, r.me, b.cell, w) });
  }
  return { wings: out, completed: [...new Set([...have, ...out.map((o) => o.key)])] };
}

// Record one finished wing. Returns true if this player is its first finder. The completion, the first-finder row and
// the ledger entry go in one batch, so they all happen or none do. If someone else took "first" a moment earlier, the
// database refuses ours and we record just the completion; if the ledger head moved, we try again on the new head.
async function recordWing(ctx, me, cell, w) {
  const { db } = ctx, t = sec(ctx.t);
  const done = db.prepare("INSERT OR IGNORE INTO completions (player_id, cell, layer, wing_key, created_at) VALUES (?,?,?,?,?)").bind(me.id, cell, LAYER, w.key, t);
  for (let i = 0; i < 8; i++) {
    const taken = await db.prepare("SELECT 1 AS x FROM wing_firsts WHERE cell = ? AND layer = ? AND wing_key = ?").bind(cell, LAYER, w.key).first();
    if (taken) { await done.run(); return false; }
    const record = JSON.stringify({ cell, layer: LAYER, wing: w.key });
    const stmts = [done, db.prepare("INSERT INTO wing_firsts (cell, layer, wing_key, player_id, created_at) VALUES (?,?,?,?,?)").bind(cell, LAYER, w.key, me.id, t),
      ...(await chainInserts(db, await head(db), [{ kind: "wing", record, playerId: me.id, t }]))];
    try { await db.batch(stmts); await markCarry(ctx.env, me.id, "first_in_wing", "wing:" + cell + ":" + LAYER + ":" + w.key); return true; }   // (v0.23) first through a wing marks the carried copy
    catch (e) {
      if (chainClash(e)) continue;
      if (isUnique(e) && /wing_firsts/.test(String(e.message))) continue;     // lost the race for "first": the next pass records just the completion
      throw e;
    }
  }
  throw new Oops("The ledger is busy. Try again.", 503);
}

// ---------- names, signing, saved cells ----------

const MAX_SAVED = 20;

// Give a player a free two-word name if they have none. Returns the name text.
async function ensureName(ctx, me) {
  if (me.name_a) return nameText(me.name_a, me.name_b);
  return setFreeName(ctx, me, null);
}
async function setFreeName(ctx, me, except) {
  for (let i = 0; i < 5; i++) {
    const n = await freeName(ctx.db, except);
    if (!n) break;
    try { await ctx.db.prepare("UPDATE players SET name_a = ?, name_b = ? WHERE id = ?").bind(n.a, n.b, me.id).run(); return nameText(n.a, n.b); }
    catch (e) { if (!isUnique(e)) throw e; }                    // someone took it a moment ago: try another
  }
  throw new Oops("Couldn't find a free name. Try again.", 503);
}

// Sign a wing you found first. The signing is sealed on the ledger (cell, layer, wing; never the name), in the same
// batch as the change. The name shown is looked up when shown, so a reroll renames past signatures too.
async function sign(ctx) {
  const b = await body(ctx), { db } = ctx;
  need(isCell(b.cell), "That isn't a cell.");
  need(typeof b.wing === "string" && /^0(>\d{1,4}){0,12}$/.test(b.wing), "That isn't a wing.");
  const me = await must(ctx);
  need(!testing(me), "Test mode is on. Nothing is signed in test mode.", 403);
  const row = await db.prepare("SELECT player_id, signed FROM wing_firsts WHERE cell = ? AND layer = ? AND wing_key = ?").bind(b.cell, LAYER, b.wing).first();
  need(row && row.player_id === me.id, "Only the first to walk a wing can sign it.", 403);
  const off = b.unsign === true, want = off ? 0 : 1;
  const name = off ? null : await ensureName(ctx, me);
  if (row.signed === want) return { ok: true, name };
  const t = sec(ctx.t), record = JSON.stringify({ cell: b.cell, layer: LAYER, wing: b.wing });
  for (let i = 0; i < 8; i++) {
    const stmts = [db.prepare("UPDATE wing_firsts SET signed = ? WHERE cell = ? AND layer = ? AND wing_key = ? AND signed = ?").bind(want, b.cell, LAYER, b.wing, 1 - want),
      ...(await chainInserts(db, await head(db), [{ kind: off ? "unsign" : "sign", record, playerId: me.id, t }]))];
    try { await db.batch(stmts); return { ok: true, name }; }
    catch (e) { if (chainClash(e)) continue; throw e; }
  }
  throw new Oops("The ledger is busy. Try again.", 503);
}

// A new name, never the same as the old one. Only for a player who has a name already.
async function rename(ctx) {
  const b = await body(ctx);
  need(b.action === "reroll", "Unknown action.");
  const me = await must(ctx);
  need(!!me.name_a, "You get a name when you sign a find.");
  return { name: await setFreeName(ctx, me, { a: me.name_a, b: me.name_b }) };
}

async function cells(ctx) {
  const b = await body(ctx), { db } = ctx;
  need(isCell(b.cell), "That isn't a cell.");
  if (b.action === "save") {
    const me = await player(ctx, true);
    const n = (await db.prepare("SELECT COUNT(*) AS n FROM saved_cells WHERE player_id = ?").bind(me.id).first()).n;
    const have = await db.prepare("SELECT 1 AS x FROM saved_cells WHERE player_id = ? AND cell = ?").bind(me.id, b.cell).first();
    if (!have && n >= MAX_SAVED) throw new Oops(`You have ${MAX_SAVED} saved cells. Forget one first.`);
    await db.prepare("INSERT OR IGNORE INTO saved_cells (player_id, cell, created_at) VALUES (?,?,?)").bind(me.id, b.cell, sec(ctx.t)).run();
    return { ok: true };
  }
  if (b.action === "forget") {
    const me = await must(ctx);
    await db.prepare("DELETE FROM saved_cells WHERE player_id = ? AND cell = ?").bind(me.id, b.cell).run();
    return { ok: true };
  }
  throw new Oops("Unknown action.");
}

// ---------- admin ----------

async function admin(ctx) {
  const b = await body(ctx);
  const me = await must(ctx);
  need(!!me.admin, "Admins only.", 403);
  need(b.action === "test" && typeof b.on === "boolean", "Unknown action.");
  if (b.on) {
    need(b.cell == null || isCell(b.cell), "That isn't a cell.");
    await ctx.db.prepare("UPDATE players SET test_mode = 1, test_from = ? WHERE id = ?").bind(me.test_mode ? me.test_from : (b.cell || null), me.id).run();
    return { ok: true, test: true };
  }
  await ctx.db.prepare("UPDATE players SET test_mode = 0, test_from = NULL WHERE id = ?").bind(me.id).run();
  return { ok: true, test: false, back: me.test_mode ? me.test_from || null : null };
}

// ---------- the carried copy (copied from TILT.EXE v0.19) ----------
// Your account's pinned copy from any game (dungeon-items registry.js pinned: the pin, else your newest copy), read when
// a run starts so the page can show it, and read again when a memorable moment marks it (markCarried: a deed mark made
// in this game, keyed so a retry makes no second mark). A Moon-blessed copy (a 4Dungeon mark) shows in gold. A registry
// that's away, or no copy, carries nothing and never stops a run.
async function carried(env, playerId) {
  try {
    const c = env.REGISTRY && env.REGISTRY.pinned ? await env.REGISTRY.pinned(GAME, playerId) : null;
    return c && c.itemId ? { ...c, blessed: c.marks.some((m) => m.kind === "moon" && m.value === "blessed") ? 1 : 0 } : null;
  } catch (e) { console.error(e); return null; }
}
const carryView = (c) => c ? { name: c.item.name, copy: c.copy, blessed: c.blessed } : null;
async function markCarry(env, playerId, value, key) {
  const c = await carried(env, playerId);
  if (!c) return;
  try {
    const r = await env.REGISTRY.markCarried({ itemId: c.itemId, copy: c.copy, by: { game: GAME, playerId }, kind: "deed", value, key });
    if (r && r.error) console.error("The registry refused the mark: " + r.error);
  } catch (e) { console.error(e); }
}

// The picker (SAVE panel): /api/account lists every copy your account holds in any game (`copies`, newest first) and the
// one you carry (`carry`); POST /api/pin {itemId, copy} pins one, and every game carries it from then on.
async function pinCopy(ctx) {
  const me = await player(ctx), b = await body(ctx);
  if (!me) throw new Oops("Make a save code or passkey first.", 401);
  const r = await ctx.env.REGISTRY.pin({ game: GAME, playerId: me.id, itemId: Number(b.itemId), copy: Number(b.copy) });
  if (r && r.error) throw new Oops(r.error);
  return { ok: true };
}
async function copiesOf(env, playerId) {
  try {
    const list = env.REGISTRY && env.REGISTRY.heldAcross ? await env.REGISTRY.heldAcross(GAME, playerId, 50) : [];
    return list.map((c) => ({ itemId: c.itemId, copy: c.copy, name: c.item.name, game: c.game, pinned: c.pinned }));
  } catch (e) { console.error(e); return []; }
}
