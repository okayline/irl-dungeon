// irl-dungeon API: a Cloudflare Worker with a D1 database (binding DB). No dependencies.
// Requests that act as a player send Authorization: Bearer <device token>. A player is made on their first find,
// first save code or first passkey, and the reply then carries {token} for the page to keep.
//   GET  /wing?cell=&path=      -> {committed:false} | {committed:true, wing, date, moon, name}
//   POST /commit                -> {ok, entry, token?} | 409 {error, wing}
//          body {cell, path, day, moves, entry_id}       every find goes in anonymous
//   POST /sign   {entry_id}     -> {ok}   sign one of your own finds later: appended to signatures, never an edit
//   GET  /account               -> {player, name, codes, passkeys}   (never the codes themselves)
//   POST /codes  {action: "new" | "remove", id}   -> {code, token?}   a save code, shown once
//   POST /load   {code}         -> {token, name}   log this device in with a save code
//   POST /logout                -> {ok}   this device forgets its player (needs a save code or passkey first)
//   POST /passkey {action ...}  register_options / register / login_options / login / remove
//   GET  /cells?ids=a,b,c       -> {found: [cell, ...]}   which of up to 37 cells have a found first wing
//   GET  /ledger?cell=          -> {rows: [...]}   public ledger, a cell's entries or the latest 50
//   GET  /atlas                 -> {name, rows: [...]}   the player's own entries  (Authorization: Bearer <save code>)
// The server never sees coordinates: only cell IDs. It stores only hashes of save codes and device tokens.
// Save codes and passkeys work the same way as in scoundrel.exe and the 88x31 cLuB (saves.js, passkeys.js).
// The public side shows dates only, never times: the exact time stays in the private ledger.
import WING from "../wing.js";
import { now as nowS, MAX_CODES, newSaveCode, hashCode, newToken, newSession, rateLimit } from "./saves.js";
import { registerOptions, verifyRegistration, loginOptions, verifyLogin } from "./passkeys.js";

const MOON_REF = Date.UTC(2000, 0, 6, 18, 14), SYN = 29.530588853;
const moonIndex = ms => { let a = ((ms - MOON_REF) / 86400000) % SYN; if (a < 0) a += SYN; return Math.floor(a / SYN * 8 + 0.5) % 8; };

// PLACEHOLDER NAME LISTS: to be replaced with the designer's own lists. Names are only ever picked from these.
const ADJ = ["QUIET", "AMBER", "HOLLOW", "SALT", "PALE", "IRON", "LOW", "STATIC", "VELVET", "DIM", "COPPER", "SLOW", "GLASS", "ASH", "LATE", "TIDAL"];
const NOUN = ["MOTH", "LANTERN", "KEY", "TIDE", "HOUND", "SIGNAL", "WELL", "BELL", "CRANE", "STAIR", "RELAY", "ORCHID", "VAULT", "RIVER", "SPARK", "OWL"];
const nameFrom = hex => ADJ[parseInt(hex.slice(0, 4), 16) % ADJ.length] + " " + NOUN[parseInt(hex.slice(4, 8), 16) % NOUN.length];

const enc = new TextEncoder();
async function sha256(s) {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}

const CELL_RE = /^[0-9a-f]{15}$/, ID_RE = /^[0-9a-f]{32}$/;
const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(x => x.toString(16).padStart(2, "0")).join("");
class Oops extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

function cors(env, req) {
  const allow = (env.ALLOW_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
  const origin = req.headers.get("Origin") || "";
  const ok = !allow.length || allow.includes(origin);
  return { "Access-Control-Allow-Origin": ok ? (origin || "*") : allow[0], "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Vary": "Origin" };
}
const json = (h, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...h, "Content-Type": "application/json" } });

// The player behind this request's device token, or null. Never makes one.
async function findPlayer(req, db) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/, "").trim();
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const th = await sha256(token);
  let p = await db.prepare("SELECT id, name, proof_secret FROM players WHERE token_hash = ?1").bind(th).first();
  if (!p) {
    p = await db.prepare("SELECT p.id, p.name, p.proof_secret FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.token_hash = ?1").bind(th).first();
    if (p) await db.prepare("UPDATE sessions SET seen_at = ?1 WHERE token_hash = ?2").bind(nowS(), th).run();
  }
  return p ? { ...p, token_hash: th } : null;
}
// The player behind this request, made on the spot if there isn't one. Returns { player, token? }.
async function needPlayer(req, db) {
  const found = await findPlayer(req, db);
  if (found) return { player: found };
  const id = hex(16), token = newToken();
  const player = { id, name: nameFrom(await sha256("name:" + id)), proof_secret: hex(32) };
  await db.prepare("INSERT INTO players (id, token_hash, name, proof_secret, created) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(id, await sha256(token), player.name, player.proof_secret, Date.now()).run();
  return { player, token };
}

// Replay the moves on the regenerated wing: every step must go through an open side, and every tile must be
// walked. This is the whole check for "clear": the client can't just claim it.
function replay(w, moves) {
  if (typeof moves !== "string" || moves.length > 2000 || /[^FLR]/.test(moves)) return false;
  let x = w.start.x, y = w.start.y, f = "N";
  const walked = new Set([x + "," + y]);
  for (const m of moves) {
    if (m === "L") f = WING.left[f];
    else if (m === "R") f = WING.right[f];
    else {
      if (WING.blocked(w, x, y, f)) return false;
      const [dx, dy] = WING.DIRS[f]; x += dx; y += dy;
      walked.add(x + "," + y);
    }
  }
  return walked.size === WING.spaceCount(w);   // every space of the wing stepped into
}

// What the public sees of an entry. No time: older rows written with a minute never show it either.
const publicRow = r => ({ cell: r.cell, path: r.path, date: r.date, moon: r.moon,
  name: r.sname || r.anon, signed: !!r.sname, proof: r.proof, hash: r.commit_hash });

export default {
  async fetch(req, env) {
    const h = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { headers: h });
    const url = new URL(req.url), db = env.DB, path = url.pathname.replace(/\/+$/, "");
    try {
      if (req.method === "GET" && path === "/wing") {
        const cell = url.searchParams.get("cell") || "", wp = url.searchParams.get("path") || "";
        if (!CELL_RE.test(cell) || wp !== "") return json(h, { error: "bad cell" }, 400);
        const w = await db.prepare("SELECT w.snapshot, w.moon, p.date, s.signed_name FROM wings w JOIN public_ledger p ON p.entry_id = w.entry_id LEFT JOIN signatures s ON s.entry_id = w.entry_id WHERE w.cell = ?1 AND w.path = ?2").bind(cell, wp).first();
        if (!w) return json(h, { committed: false });
        return json(h, { committed: true, wing: JSON.parse(w.snapshot), date: w.date, moon: w.moon, name: w.signed_name || null });
      }

      if (req.method === "POST" && path === "/commit") {
        const b = await req.json().catch(() => ({}));
        const { cell, day, moves, entry_id } = b, wp = b.path || "", signed = false;   // (v0.06) always anonymous; sign later
        if (!CELL_RE.test(cell || "") || wp !== "" || !ID_RE.test(entry_id || "")) return json(h, { error: "bad request" }, 400);
        // The day must be today somewhere on Earth: within a day of UTC's.
        const now = Date.now(), utcDay = Math.floor(now / 86400000);
        if (!Number.isInteger(day) || Math.abs(day - utcDay) > 1) return json(h, { error: "wrong day" }, 400);
        const taken = await db.prepare("SELECT snapshot FROM wings WHERE cell = ?1 AND path = ?2").bind(cell, wp).first();
        if (taken) return json(h, { error: "already found", wing: JSON.parse(taken.snapshot) }, 409);
        const w = WING.generate(cell, day, wp);
        if (!replay(w, moves)) return json(h, { error: "not cleared" }, 400);

        const { player: p, token } = await needPlayer(req, db);
        // The proof: lets the player show "that was me" later, from their own secret. No two proofs can be linked.
        const proof = await sha256(p.proof_secret + entry_id);
        const seqRow = await db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM private_ledger").first();
        const seq = seqRow.n, moon = moonIndex(now), iso = new Date(now).toISOString();
        const priv = { entry_id, seq, player_id: p.id, cell, path: wp, day, at_ms: now, signed: signed ? 1 : 0 };
        const commit_hash = await sha256(JSON.stringify(priv));
        const anon = nameFrom(proof);
        // One batch, so the wing, both ledgers and the player row land together or not at all. The wing's
        // primary key also settles two players finishing at once: the second insert fails and gets the 409 next time.
        await db.batch([
          db.prepare("INSERT INTO wings (cell, path, day, moon, snapshot, entry_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(cell, wp, day, moon, JSON.stringify(w), entry_id),
          db.prepare("INSERT INTO private_ledger (entry_id, seq, player_id, cell, path, day, at_ms, signed, commit_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)").bind(entry_id, seq, p.id, cell, wp, day, now, priv.signed, commit_hash),
          db.prepare("INSERT INTO public_ledger (entry_id, seq, cell, path, date, minute, moon, anon, signed_name, proof, commit_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)")
            .bind(entry_id, seq, cell, wp, iso.slice(0, 10), null, moon, anon, null, proof, commit_hash),   // no minute: dates only
        ]);
        return json(h, { ok: true, token, entry: { entry_id, cell, path: wp, date: iso.slice(0, 10), moon, name: anon, signed } });
      }

      if (req.method === "POST" && path === "/sign") {
        const p = await findPlayer(req, db);
        if (!p) return json(h, { error: "no player here" }, 401);
        const b = await req.json().catch(() => ({}));
        if (!ID_RE.test(b.entry_id || "")) return json(h, { error: "bad request" }, 400);
        const mine = await db.prepare("SELECT entry_id FROM private_ledger WHERE entry_id = ?1 AND player_id = ?2").bind(b.entry_id, p.id).first();
        if (!mine) return json(h, { error: "not yours" }, 403);
        const seqRow = await db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM signatures").first();
        await db.prepare("INSERT INTO signatures (entry_id, seq, signed_name, at_ms) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (entry_id) DO NOTHING").bind(b.entry_id, seqRow.n, p.name, Date.now()).run();
        return json(h, { ok: true, name: p.name });
      }

      // Which of these cells have a found first wing (for the map of the cells around the player). Up to 37 at once.
      if (req.method === "GET" && path === "/cells") {
        const ids = (url.searchParams.get("ids") || "").split(",").filter(c => CELL_RE.test(c)).slice(0, 37);
        if (!ids.length) return json(h, { found: [] });
        const q = `SELECT cell FROM wings WHERE path = '' AND cell IN (${ids.map((_, i) => "?" + (i + 1)).join(",")})`;
        return json(h, { found: (await db.prepare(q).bind(...ids).all()).results.map(r => r.cell) });
      }

      if (req.method === "GET" && path === "/ledger") {
        const cell = url.searchParams.get("cell");
        const q = cell && CELL_RE.test(cell)
          ? db.prepare("SELECT p.*, s.signed_name AS sname FROM public_ledger p LEFT JOIN signatures s ON s.entry_id = p.entry_id WHERE p.cell = ?1 ORDER BY p.seq DESC LIMIT 50").bind(cell)
          : db.prepare("SELECT p.*, s.signed_name AS sname FROM public_ledger p LEFT JOIN signatures s ON s.entry_id = p.entry_id ORDER BY p.seq DESC LIMIT 50");
        return json(h, { rows: (await q.all()).results.map(publicRow) });
      }

      if (req.method === "GET" && path === "/atlas") {
        const p = await findPlayer(req, db);
        if (!p) return json(h, { name: null, rows: [] });
        const rows = (await db.prepare("SELECT p.*, s.signed_name AS sname FROM private_ledger v JOIN public_ledger p ON p.entry_id = v.entry_id LEFT JOIN signatures s ON s.entry_id = p.entry_id WHERE v.player_id = ?1 ORDER BY v.seq DESC LIMIT 200").bind(p.id).all()).results;
        return json(h, { name: p.name, rows: rows.map(r => ({ ...publicRow(r), entry_id: r.entry_id, name: p.name })) });
      }

      // ---------- save codes and passkeys (as in scoundrel.exe) ----------
      if (req.method === "GET" && path === "/account") {
        const p = await findPlayer(req, db);
        if (!p) return json(h, { player: false, name: null, codes: [], passkeys: [] });
        const codes = (await db.prepare("SELECT id, created_at, last_used_at FROM save_codes WHERE player_id = ?1 ORDER BY id").bind(p.id).all()).results;
        const keys = (await db.prepare("SELECT id, label, created_at, last_used_at FROM passkeys WHERE player_id = ?1 ORDER BY id").bind(p.id).all()).results;
        return json(h, { player: true, name: p.name, codes, passkeys: keys });
      }
      if (req.method === "POST" && path === "/codes") {
        const b = await req.json().catch(() => ({}));
        if (b.action === "new") {
          const { player: p, token } = await needPlayer(req, db);
          const n = (await db.prepare("SELECT COUNT(*) AS n FROM save_codes WHERE player_id = ?1").bind(p.id).first()).n;
          if (n >= MAX_CODES) throw new Oops(`You have ${MAX_CODES} save codes already. Forget one first.`);
          const code = newSaveCode();
          await db.prepare("INSERT INTO save_codes (player_id, code_hash, created_at) VALUES (?1, ?2, ?3)").bind(p.id, await hashCode(code), nowS()).run();
          return json(h, { code, token });
        }
        if (b.action === "remove") {
          const p = await findPlayer(req, db);
          if (!p) throw new Oops("No player here.", 401);
          const r = await db.prepare("DELETE FROM save_codes WHERE id = ?1 AND player_id = ?2").bind(Number(b.id), p.id).run();
          if (!r.meta.changes) throw new Oops("No such save code.", 404);
          return json(h, { ok: true });
        }
        throw new Oops("Unknown action.");
      }
      if (req.method === "POST" && path === "/load") {
        if (!(await rateLimit(env, req, "load", 10, 900))) throw new Oops("Too many tries. Wait 15 minutes and try again.", 429);
        const code = (await req.json().catch(() => ({}))).code;
        const row = await db.prepare("SELECT c.id, p.id AS player_id, p.name FROM save_codes c JOIN players p ON p.id = c.player_id WHERE c.code_hash = ?1")
          .bind(await hashCode(code)).first();
        if (!row) throw new Oops("That save code didn't work. Check it and try again.", 404);
        await db.prepare("UPDATE save_codes SET last_used_at = ?1 WHERE id = ?2").bind(nowS(), row.id).run();
        return json(h, { token: await newSession(env, row.player_id), name: row.name });
      }
      if (req.method === "POST" && path === "/logout") {
        const p = await findPlayer(req, db);
        if (!p) return json(h, { ok: true });
        const ways = (await db.prepare("SELECT (SELECT COUNT(*) FROM save_codes WHERE player_id = ?1) + (SELECT COUNT(*) FROM passkeys WHERE player_id = ?1) AS n").bind(p.id).first()).n;
        if (!ways) throw new Oops("Make a save code or passkey first, or you'd have no way back in.");
        const s = await db.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(p.token_hash).run();
        if (!s.meta.changes) await db.prepare("UPDATE players SET token_hash = ?1 WHERE id = ?2 AND token_hash = ?3").bind(await sha256(newToken()), p.id, p.token_hash).run();
        return json(h, { ok: true });
      }
      if (req.method === "POST" && path === "/passkey") {
        const b = await req.json().catch(() => ({}));
        try {
          if (b.action === "login_options" || b.action === "login") {
            if (!(await rateLimit(env, req, "passkey", 20, 900))) throw new Oops("Too many tries. Wait 15 minutes and try again.", 429);
            if (b.action === "login_options") return json(h, await loginOptions(env, req));
            const playerId = await verifyLogin(env, req, b.credential);
            const p = await db.prepare("SELECT id, name FROM players WHERE id = ?1").bind(playerId).first();
            if (!p) throw new Oops("That player is gone.", 404);
            return json(h, { token: await newSession(env, p.id), name: p.name });
          }
          if (b.action === "register_options" || b.action === "register") {
            const { player: p, token } = await needPlayer(req, db);
            if (b.action === "register_options") return json(h, { ...(await registerOptions(env, req, p)), token });
            const n = (await db.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE player_id = ?1").bind(p.id).first()).n;
            if (n >= 10) throw new Oops("That's plenty of passkeys! Forget one first.");
            return json(h, await verifyRegistration(env, req, p, b.credential, b.label));
          }
          if (b.action === "remove") {
            const p = await findPlayer(req, db);
            if (!p) throw new Oops("No player here.", 401);
            const r = await db.prepare("DELETE FROM passkeys WHERE id = ?1 AND player_id = ?2").bind(Number(b.id), p.id).run();
            if (!r.meta.changes) throw new Oops("No such passkey.", 404);
            return json(h, { ok: true });
          }
          throw new Oops("Unknown action.");
        } catch (e) {
          if (e instanceof Oops) throw e;
          throw new Oops(e.message || "Something went wrong with the passkey.");
        }
      }

      return json(h, { error: "not found" }, 404);
    } catch (e) {
      if (e instanceof Oops) return json(h, { error: e.message }, e.status);
      return json(h, { error: "server error" }, 500);
    }
  },
};
